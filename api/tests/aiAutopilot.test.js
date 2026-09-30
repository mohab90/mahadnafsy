'use strict';

// «خلي السيستم يفيد نفسه ويكون ذكي يعني يعمل seo للموقع والمحتوي، ينزل محتوي
// مفيد علي المجتمع، يعمل مادة علميه بسيطة، يعمل اسئله تفاعليه قوية للعملاء».

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

// The model, answering by what it is asked for.
let answers = {};
const realAdminAi = require('../lib/adminAi');
const adminAiFile = require.resolve('../lib/adminAi');
require.cache[adminAiFile] = {
  id: adminAiFile, filename: adminAiFile, loaded: true,
  exports: {
    ...realAdminAi,
    generateAdminAi: async (_config, payload) => {
      const prompt = payload.messages[0].content;
      const key = Object.keys(answers).find(part => prompt.includes(part));
      if (!key) throw new Error('unexpected prompt');
      const answer = answers[key];
      if (answer instanceof Error) throw answer;
      return answer;
    },
  },
};
const autopilot = require('../lib/aiAutopilot');

function fakeDb({ courses = [], quizzes = [], settings = {} } = {}) {
  const writes = [];
  return {
    writes,
    async query(sql, params) {
      const flat = sql.replace(/\s+/g, ' ');
      if (/SELECT config_json FROM tenant_settings/.test(flat)) {
        const section = params[1];
        return [[section in settings ? { config_json: JSON.stringify(settings[section]) } : undefined]];
      }
      if (/FROM courses WHERE tenant_id=\? AND deleted_at IS NULL AND is_published=1/.test(flat)) return [courses];
      if (/SELECT DISTINCT course_id FROM course_quizzes/.test(flat)) return [quizzes];
      if (/SELECT title FROM community_posts/.test(flat)) return [[]];
      if (/^\s*(UPDATE|INSERT)/.test(sql)) { writes.push({ sql: flat, params }); return [{ affectedRows: 1 }]; }
      return [[]];
    },
  };
}

const COURSE = { id: 'c1', slug: 'mental-health', title: 'الصحة النفسية', short_description: 'أساسيات', description: '', seo_title: 'عنوان كتبه المدير', seo_description: '' };
const AI_SETTINGS = { settings: { adminAiConfig: { provider: 'gemini', apiKey: 'AQ.test', model: 'gemini-2.5-flash' } } };

test('the model\'s JSON is read even when it wraps it', () => {
  assert.deepEqual(autopilot.parseJson('```json\n{"title":"أ"}\n```'), { title: 'أ' });
  assert.deepEqual(autopilot.parseJson('إليك: [1,2]'), [1, 2]);
  assert.throws(() => autopilot.parseJson('مفيش'), /no JSON/);
});

test('a quiz keeps only questions a student can answer', () => {
  const kept = autopilot.validQuestions([
    { question: 'س1', options: ['أ', 'ب', 'ج', 'د'], correctIndex: 2, explanation: 'لأن' },
    { question: 'س2', options: ['أ', 'ب', 'ج'], correctIndex: 0 },
    { question: 'س3', options: ['أ', 'ب', 'ج', 'د'], correctIndex: 4 },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].correctIndex, 2);
});

test('SEO fills what is empty and never replaces what someone wrote', async () => {
  answers = { 'بيانات SEO': '{"title":"عنوان مولد","description":"وصف مولد","keywords":"أ، ب"}' };
  const db = fakeDb({ courses: [COURSE] });
  assert.equal(await autopilot.fillCourseSeo({ tenantId: 't', config: {} }, db), 1);
  const update = db.writes.find(write => write.sql.startsWith('UPDATE courses'));
  assert.match(update.sql, /seo_title=COALESCE\(NULLIF\(seo_title,''\), \?\)/);
  assert.deepEqual(update.params.slice(0, 2), ['عنوان مولد', 'وصف مولد']);
});

test('a post goes to the community, or waits for review when that is switched on', async () => {
  answers = { 'منشور قصير': JSON.stringify({ title: 'نصيحة', body: 'نص طويل كفاية '.repeat(10), tags: ['وعي'] }) };
  const published = fakeDb({ courses: [COURSE] });
  const post = await autopilot.writeCommunityPost({ tenantId: 't', config: {}, kind: 'tip', review: false }, published);
  assert.equal(post.status, 'approved', 'the status the community shows');
  const insert = published.writes.find(write => write.sql.startsWith('INSERT INTO community_posts'));
  assert.match(insert.params[4], /مش بديل عن استشارة متخصص/);
  const held = await autopilot.writeCommunityPost({ tenantId: 't', config: {}, kind: 'tip', review: true }, fakeDb({ courses: [COURSE] }));
  assert.equal(held.status, 'pending');
});

test('one task failing does not stop the others, and without a key nothing runs', async () => {
  answers = {
    'بيانات SEO': new Error('quota exceeded'),
    'منشور قصير': JSON.stringify({ title: 'نصيحة', body: 'نص طويل كفاية '.repeat(10), tags: [] }),
    'اختيار من متعدد': JSON.stringify({ questions: Array.from({ length: 6 }, (_, i) => ({ question: `س${i}`, options: ['أ', 'ب', 'ج', 'د'], correctIndex: 1 })) }),
  };
  const db = fakeDb({ courses: [COURSE], settings: AI_SETTINGS });
  const result = await autopilot.runAutopilot({ tenantId: 't', date: '2026-09-30' }, db);
  assert.equal(result.done.seo.error, 'quota exceeded');
  assert.equal(result.done.communityPosts.status, 'approved');
  assert.equal(result.done.quizzes, 1);
  assert.ok(result.done.studyArticles?.error || result.done.studyArticles?.title, 'a Wednesday brings the study article');
  const none = await autopilot.runAutopilot({ tenantId: 't', date: '2026-09-30' }, fakeDb({ courses: [COURSE] }));
  assert.equal(none.ok, false);
});

test('the search fields reach the site, and the day\'s run is queued once', () => {
  assert.match(read('api/lib/mappers.js'), /seo_title: r\.seo_title \|\| undefined,/);
  assert.match(read('tools/generate-seo.mjs'), /title: `\$\{c\.seo_title \|\| c\.title\} \| معهد الدراسات النفسية`/);
  assert.match(read('api/lib/aiAutopilot.js'), /dedupeKey: `ai_autopilot:\$\{clock\.date\}`/);
  assert.match(read('api/lib/backgroundScheduler.js'), /ai_autopilot: \(\{ tenantId, date, only \}\) =>/);
});
