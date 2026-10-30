'use strict';

/**
 * 30 Oct 2026, a security pass: the join-us form's «LinkedIn / الموقع» box is free text from an anonymous visitor
 * and the HR screen put it straight into an `href`. `javascript:fetch(...)` there was a script running in the HR
 * officer's session on one click. The routes keep web links only, the screens refuse to render anything else, and
 * the rows already stored are emptied by migration 350.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('webAddress keeps web links, completes a bare address and refuses every other scheme', () => {
  const { webAddress } = require('../lib/joinApplication');
  assert.equal(webAddress(''), '');
  assert.equal(webAddress(null), '');
  assert.equal(webAddress('https://www.linkedin.com/in/someone'), 'https://www.linkedin.com/in/someone');
  assert.equal(webAddress('  http://example.com/cv  '), 'http://example.com/cv');
  assert.equal(webAddress('linkedin.com/in/someone'), 'https://linkedin.com/in/someone');
  assert.equal(webAddress('example.com:8080/cv'), 'https://example.com:8080/cv', 'a host:port is an address, not a scheme');
  for (const bad of [
    'javascript:alert(1)', ' JavaScript:alert(1)', 'jAvAsCrIpT:fetch("/api")', 'data:text/html,<script>1</script>',
    'vbscript:msgbox(1)', 'mailto:a@b.c', 'file:///etc/passwd', '//evil.example/x', '/relative/path',
    'https://exa mple.com', 'https://a.com/"onmouseover="1',
  ]) {
    assert.equal(webAddress(bad), null, bad);
  }
});

test('the join-us form refuses a link that is not a web link, and every writer of the column cleans it', () => {
  const route = read('api/routes/public.js');
  assert.match(route, /const website = joinApplication\.webAddress\(linkedin\);\s+if \(website === null\) return res\.status\(400\)/);
  assert.match(route, /type: safeType, linkedin: website,/);
  assert.match(read('api/routes/hr/talent.js'), /webAddress\(data\.linkedin\) \|\| null/);
  const recruiting = read('api/routes/hr/recruiting.js');
  assert.match(recruiting, /if \(body\.linkedin && webAddress\(body\.linkedin\) === null\) return/);
  assert.match(recruiting, /clean\(webAddress\(req\.body\.linkedin\)\)/);
});

test('migration 350 empties the scripts already stored', () => {
  const sql = read('api/migrations/350_v26_applicant_links_are_web_links.sql');
  for (const table of ['join_us_applications', 'job_applicants']) {
    assert.match(sql, new RegExp(`UPDATE ${table} SET linkedin = NULL`));
  }
  assert.match(sql, /\(javascript\|data\|vbscript\|file\|blob\):/);
});

test('every screen that opens a link from a record goes through webLink', () => {
  const guarded = [
    ['admin/pages/dashboard/tabs/join-us/ApplicationCard.tsx', 'app.linkedin'],
    ['admin/pages/dashboard/tabs/JobApplicantsPanel.tsx', 'row.cv_url'],
    ['admin/pages/dashboard/tabs/CertRequestsTab.tsx', 'row.personalPhotoUrl'],
    ['admin/pages/dashboard/tabs/CertRequestsTab.tsx', 'row.idPhotoUrl'],
    ['admin/components/payment-modal/PhotoPicker.tsx', 'link'],
    ['admin/pages/TherapistPortal.tsx', 'item.meetingLink'],
    ['admin/pages/InstructorLivePanel.tsx', 'live.streamUrl'],
    ['admin/pages/dashboard/tabs/LiveStreamsTab.tsx', 'ls.streamUrl'],
    ['admin/pages/dashboard/tabs/LiveStreamsTab.tsx', 'ls.recordingUrl'],
    ['admin/pages/dashboard/tabs/consultations/ConsultationBookingsTab.tsx', 'meetingLink'],
    ['admin/pages/lecturer/LecturerConsultations.tsx', 'item.meetingLink'],
    ['client/components/student-dashboard/StudentConsultationsTab.tsx', 'consultation.meetingLink'],
    ['client/components/student-dashboard/StudentLiveStreamsTab.tsx', 'nextLive.streamUrl'],
    ['client/components/student-dashboard/StudentLiveStreamsTab.tsx', 'live.streamUrl'],
    ['client/components/student-dashboard/StudentMaterialsTab.tsx', 'material.url'],
    ['client/pages/Community.tsx', 'item.downloadUrl'],
  ];
  for (const [file, expression] of guarded) {
    const source = read(file);
    assert.ok(source.includes(`href={webLink(${expression})}`), `${file} opens ${expression} unguarded`);
    assert.doesNotMatch(source, new RegExp(`href=\\{${expression.replace(/\./g, '\\.')}\\}`), `${file} still has a bare href for ${expression}`);
    assert.ok(source.includes("import { webLink } from '"), file + " does not import webLink");
  }
  for (const area of ['admin', 'client']) {
    const helper = read(`${area}/lib/webLink.ts`);
    assert.match(helper, /\^https\?:\\\/\\\/\[\^\\s"'<>\]\+\$/);
  }
});

test('a name or an address a visitor typed is escaped in the emails the institute sends with their credentials', () => {
  const convert = read('api/routes/admin/leads/convert.js');
  assert.ok(convert.includes('<strong>${escapeHtml(lead.name)}</strong>'));
  assert.ok(convert.includes('${escapeHtml(normEmail)}</strong>'));
  assert.ok(!convert.includes('<strong>${lead.name}</strong>'), 'a lead\'s name went into the email as HTML');
  const accounts = read('api/routes/auth/staffAccounts.js');
  assert.equal(accounts.split('<strong>${escapeHtml(displayName)}</strong>').length - 1, 2);
  assert.equal(accounts.split('<strong>${escapeHtml(normEmail)}</strong>').length - 1, 2);
  assert.ok(!accounts.includes('<strong>${displayName}</strong>') && !accounts.includes('<strong>${normEmail}</strong>'));
});
