#!/usr/bin/env node
'use strict';
// Reads the public DNS of the sending domain and says what is missing for mail to arrive (31 Oct 2026 audit: SPF without Brevo, no MX,
// DMARC on «none»). Read-only, public records only.
//
//   node tools/mail-dns-check.cjs [domain]        (default: mahadnafsy.com)
//   exit code 0 = nothing missing, 1 = something is
const { Resolver } = require('node:dns').promises;

const domain = (process.argv[2] || 'mahadnafsy.com').toLowerCase();
const resolver = new Resolver();
resolver.setServers(['1.1.1.1', '8.8.8.8']);

const txt = async name => (await resolver.resolveTxt(name).catch(() => [])).map(parts => parts.join(''));
const cname = async name => resolver.resolveCname(name).catch(() => []);
const mx = async name => resolver.resolveMx(name).catch(() => []);

(async () => {
  const problems = [];
  const ok = line => console.log(`  ✓  ${line}`);
  const bad = (line, fix) => { problems.push(line); console.log(`  ✗  ${line}\n       ← ${fix}`); };

  console.log(`Mail DNS for ${domain}\n`);

  const spf = (await txt(domain)).find(record => /^v=spf1\b/i.test(record));
  if (!spf) bad('no SPF record', `add TXT  ${domain}  "v=spf1 include:spf.brevo.com include:_spf.reach.hostinger.com ~all"`);
  else {
    ok(`SPF: ${spf}`);
    if (!/include:spf\.brevo\.com|include:sendinblue\.com/i.test(spf)) bad('SPF does not include Brevo', `change it to  "v=spf1 include:spf.brevo.com ${spf.replace(/^v=spf1\s*/i, '')}"  (one SPF record only, never two)`);
    else ok('SPF includes Brevo');
    if (/\s\+all\b|\s\?all\b/.test(spf)) bad('SPF ends in +all/?all (anyone may send as the domain)', 'end it with ~all (or -all once everything that sends is listed)');
  }

  for (const selector of ['brevo1', 'brevo2']) {
    const target = await cname(`${selector}._domainkey.${domain}`);
    if (target.length) ok(`DKIM ${selector}: ${target[0]}`);
    else bad(`DKIM ${selector}._domainkey is missing`, 'Brevo → Senders & IP → Domains → your domain → copy the two DKIM CNAMEs');
  }

  const dmarc = (await txt(`_dmarc.${domain}`)).find(record => /^v=DMARC1/i.test(record));
  if (!dmarc) bad('no DMARC record', `add TXT  _dmarc.${domain}  "v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com"  (then move to quarantine)`);
  else {
    ok(`DMARC: ${dmarc}`);
    const policy = (dmarc.match(/\bp=(\w+)/i) || [])[1] || '';
    if (/^none$/i.test(policy)) bad('DMARC policy is none (reports only, nothing is refused)', 'after two weeks of clean reports, change p=none to p=quarantine');
  }

  const records = await mx(domain);
  if (!records.length) bad('no MX record: nobody can send mail TO an address at the domain (replies to info@, support@ … are lost)', 'add the MX records of the provider that holds the mailboxes (Hostinger Email: mx1.hostinger.com 5, mx2.hostinger.com 10 · Zoho Mail: mx.zoho.com 10, mx2.zoho.com 20, mx3.zoho.com 50)');
  else ok(`MX: ${records.sort((a, b) => a.priority - b.priority).map(r => `${r.priority} ${r.exchange}`).join(', ')}`);

  console.log(problems.length ? `\n${problems.length} thing(s) to fix.` : '\nNothing missing.');
  process.exit(problems.length ? 1 : 0);
})().catch(error => { console.error(error.message); process.exit(2); });
