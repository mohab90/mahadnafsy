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

function audit(project) {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const args = npmCli ? [npmCli, 'audit', '--json'] : ['audit', '--json'];
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

export function run() {
  let failed = false;
  for (const project of PROJECTS) {
    const result = audit(project);
    for (const item of result.accepted) {
      console.warn(`⚠ ${project.name}: accepted ${item.advisory} for ${item.package} until ${item.expires}`);
    }
    if (result.failures.length) {
      failed = true;
      for (const item of result.failures) console.error(`✗ ${project.name}: ${JSON.stringify(item)}`);
    } else {
      console.log(`✓ ${project.name}: dependency gate passed`);
    }
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
