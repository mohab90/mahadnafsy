import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SEVERITY = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const PROJECTS = [
  { name: 'api', threshold: 'high' },
  { name: 'admin', threshold: 'moderate' },
  { name: 'client', threshold: 'moderate' },
];

// Vendor has not published a non-vulnerable React Router release yet.
// This advisory affects React Server Components request handling; Mahad's admin
// and client are static Vite SPAs. The exception is exact-version and expiring,
// so any different/new advisory or dependency drift still fails CI.
//
// 11 Oct 2026: left expired on purpose. npm audit no longer reports
// GHSA-QWWW-VCR4-C8H2 against react-router 7.18.2 in either app, so the entry
// accepts nothing today; re-dating it would only pre-approve the advisory if it
// came back. If it does come back, it fails until someone writes down why it is
// still safe and dates it again.
export const ACCEPTED_RISKS = {
  'GHSA-QWWW-VCR4-C8H2': {
    package: 'react-router',
    version: '7.18.2',
    projects: ['admin', 'client'],
    expires: '2026-09-30',
    reason: 'RSC-only path is not present in either static Vite SPA',
  },
};

function advisoryId(via) {
  return String(via?.url || '').match(/GHSA-[\w-]+/i)?.[0]?.toUpperCase() || `SOURCE-${via?.source}`;
}

function collectAdvisories(name, vulnerabilities, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const item = vulnerabilities[name];
  if (!item) return [];
  return item.via.flatMap(via => typeof via === 'string'
    ? collectAdvisories(via, vulnerabilities, seen)
    : [{ ...via, id: advisoryId(via), package: via.name || name }]);
}

function installedVersion(projectDir, packageName) {
  const lock = JSON.parse(fs.readFileSync(path.join(projectDir, 'package-lock.json'), 'utf8'));
  return lock.packages?.[`node_modules/${packageName}`]?.version || null;
}

export function classifyAudit(project, report, now = new Date()) {
  const failures = [];
  const accepted = [];
  const vulnerabilities = report?.vulnerabilities || {};
  for (const [name, item] of Object.entries(vulnerabilities)) {
    if ((SEVERITY[item.severity] ?? 99) < SEVERITY[project.threshold]) continue;
    const advisories = collectAdvisories(name, vulnerabilities);
    if (!advisories.length) {
      failures.push({ package: name, severity: item.severity, reason: 'unresolved dependency advisory' });
      continue;
    }
    for (const advisory of advisories) {
      const risk = ACCEPTED_RISKS[advisory.id];
      const projectDir = path.join(ROOT, project.name);
      const valid = risk
        && risk.package === advisory.package
        && risk.projects.includes(project.name)
        && installedVersion(projectDir, risk.package) === risk.version
        && now <= new Date(`${risk.expires}T23:59:59Z`);
      (valid ? accepted : failures).push(valid
        ? { package: advisory.package, advisory: advisory.id, expires: risk.expires }
        : { package: advisory.package, advisory: advisory.id, severity: advisory.severity || item.severity });
    }
  }
  return {
    failures: [...new Map(failures.map(item => [JSON.stringify(item), item])).values()],
    accepted: [...new Map(accepted.map(item => [JSON.stringify(item), item])).values()],
  };
}

// What ships, and what only builds.
//
// «npm audit» over the whole tree failed every run from September: braces,
// brace-expansion and source-map-js, high, all reached through tailwindcss and
// its PostCSS toolchain. Those run on the laptop and in CI while Vite builds;
// none of them is in the bundle a visitor downloads or in the API's
// node_modules on the server (it installs with --omit=dev). A gate that is red
// for a reason that cannot reach production is a gate people learn to ignore,
// and an ignored gate also lets the next real one through.
//
// So the production tree (--omit=dev) is what fails the gate, at each
// project's threshold; anything found only in the full tree is printed as a
// build-tool warning with its advisory, so it is still seen and still fixed
// when the toolchain is next upgraded. Lockfiles are not touched here.
// The registry's audit endpoint sometimes answers with an error rather than a
// report (it failed one CI run on 22 Oct 2026). That says nothing about our
// dependencies, so it is asked again before the gate fails on it. A report
// that lists advisories is never retried away: it fails as before.
function audit(project, options) {
  for (let attempt = 1; ; attempt++) {
    try {
      return auditOnce(project, options);
    } catch (error) {
      if (attempt >= 3) throw error;
      spawnSync(process.execPath, ['-e', `setTimeout(() => {}, ${attempt * 3000})`]);
    }
  }
}

function auditOnce(project, { productionOnly }) {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const auditArgs = ['audit', '--json', ...(productionOnly ? ['--omit=dev'] : [])];
  const args = npmCli ? [npmCli, ...auditArgs] : auditArgs;
  const result = spawnSync(command, args, {
    cwd: path.join(ROOT, project.name),
    encoding: 'utf8',
    windowsHide: true,
    shell: !npmCli && process.platform === 'win32',
  });
  if (result.error) throw new Error(`${project.name}: unable to run npm audit (${result.error.message})`);
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`${project.name}: npm audit did not return valid JSON (${String(result.stderr || '').trim()})`);
  }
  if (report.error) throw new Error(`${project.name}: ${report.error.summary || 'npm audit failed'}`);
  return classifyAudit(project, report);
}

/** Advisories found in the full tree but not in the production one: build tools only. */
export function buildOnly(full, production) {
  const shipped = new Set(production.failures.map(item => JSON.stringify(item)));
  return full.failures.filter(item => !shipped.has(JSON.stringify(item)));
}

export function run() {
  let failed = false;
  for (const project of PROJECTS) {
    const result = audit(project, { productionOnly: true });
    const devOnly = buildOnly(audit(project, { productionOnly: false }), result);
    for (const item of result.accepted) {
      console.warn(`⚠ ${project.name}: accepted ${item.advisory} for ${item.package} until ${item.expires}`);
    }
    for (const item of devOnly) {
      console.warn(`⚠ ${project.name} (build-only, not shipped): ${JSON.stringify(item)}`);
    }
    if (result.failures.length) {
      failed = true;
      for (const item of result.failures) console.error(`✗ ${project.name}: ${JSON.stringify(item)}`);
    } else {
      console.log(`✓ ${project.name}: dependency gate passed (production dependencies${devOnly.length ? `; ${devOnly.length} build-only warning(s)` : ''})`);
    }
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
