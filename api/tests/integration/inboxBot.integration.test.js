'use strict';
/**
 * The inbox bot answering a real conversation (lib/inboxBot.js) — the AI and
 * the send are stand-ins, the database is real. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-inboxbot-it';
let pool; let bot; let settingsLib;

const sent = [];
const deps = extra => {
  const d = {
    generate: async (config, payload) => { d.lastPayload = payload; return extra?.answer ?? 'أهلاً! سعر الدبلومة في الدقي 3000 جنيه.'; },
    deliver: async (thread, text) => { sent.push({ thread: thread.id, text }); return { ok: true, id: `wamid.${sent.length}`, channelId: null }; },
  };
  return d;
};

async function clean() {
  for (const table of ['communications', 'inbox_threads', 'tenant_settings', 'catalog_prices', 'courses', 'notifications']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

async function customerSays(threadId, text, minutesAgo = 1) {
  const at = new Date(Date.now() - minutesAgo * 60000);
  await pool.query(
    `INSERT INTO communications (id, tenant_id, type, direction, date, notes, thread_id, created_at)
     VALUES (UUID(), ?, 'WHATSAPP', 'IN', ?, ?, ?, NOW())`, [TENANT, at, text, threadId]);
  await require('../../lib/inboxThreads').recordOnThread(pool, { tenantId: TENANT, threadId, direction: 'IN', text, at });
  return at;
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  bot = require('../../lib/inboxBot');
  settingsLib = require('../../lib/tenantSettings');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [TENANT, TENANT]);
  await settingsLib.setTenantSetting('settings', { adminAiConfig: { provider: 'claude', apiKey: 'sk-test', model: 'claude-test' } }, { tenantId: TENANT });
  await bot.saveSettings(TENANT, { enabled: true, mode: 'always', maxReplies: 2 });
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, is_published, price_egp)
     VALUES ('co-bot-1', ?, 'دبلومة العلاج المعرفي السلوكي', '', 'تدريب عملي', '', '', 'GENERAL', 'RECORDED', 1, 2500)`, [TENANT]);
  await pool.query(`INSERT INTO catalog_prices (tenant_id, item_type, item_id, tier, price, discount_price) VALUES (?, 'course', 'co-bot-1', 'DAQQI', 3000, 2700)`, [TENANT]);
  for (const id of ['th-bot-1', 'th-bot-2', 'th-bot-3']) {
    await pool.query(
      `INSERT INTO inbox_threads (id, tenant_id, platform, contact_key, status) VALUES (?, ?, 'whatsapp', ?, 'open')`,
      [id, TENANT, `2010190000${id.slice(-1)}`]);
  }
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('it answers from the catalogue, marks the answer as the bot\'s, and counts it', { skip }, async () => {
  const at = await customerSays('th-bot-1', 'سعر دبلومة العلاج المعرفي كام؟');
  const d = deps();
  const result = await bot.answerThread({ tenantId: TENANT, threadId: 'th-bot-1', expectInboundAt: at }, d);
  assert.equal(result.answered, true, JSON.stringify(result));
  assert.match(d.lastPayload.systemPrompt, /دبلومة العلاج المعرفي السلوكي/);
  assert.match(d.lastPayload.systemPrompt, /فرع الدقي: 3,000 جنيه \(بعد الخصم 2,700 جنيه\)/);
  assert.deepEqual(d.lastPayload.messages.map(m => m.role), ['user']);
  const [[row]] = await pool.query("SELECT outcome, staff_id, notes FROM communications WHERE tenant_id=? AND thread_id='th-bot-1' AND direction='OUT'", [TENANT]);
  assert.deepEqual([row.outcome, row.staff_id], ['BOT', null]);
  const [[thread]] = await pool.query("SELECT bot_replies, last_direction FROM inbox_threads WHERE id='th-bot-1'");
  assert.deepEqual([thread.bot_replies, thread.last_direction], [1, 'OUT']);
});

test('an older message waiting its turn is skipped when a newer one arrived', { skip }, async () => {
  const first = await customerSays('th-bot-2', 'سلام', 2);
  await customerSays('th-bot-2', 'عايز أعرف المواعيد', 1);
  const before = sent.length;
  const result = await bot.answerThread({ tenantId: TENANT, threadId: 'th-bot-2', expectInboundAt: first }, deps());
  assert.equal(result.reason, 'superseded');
  assert.equal(sent.length, before);
});

test('[HANDOFF] steps aside: the bot is paused here and the team is told', { skip }, async () => {
  await customerSays('th-bot-3', 'عايز أدفع دلوقتي');
  const result = await bot.answerThread({ tenantId: TENANT, threadId: 'th-bot-3' }, deps({ answer: 'تمام، زميل هيكلمك حالاً [HANDOFF]' }));
  assert.equal(result.handoff, true);
  assert.equal(sent.at(-1).text, 'تمام، زميل هيكلمك حالاً');
  const [[thread]] = await pool.query("SELECT bot_paused FROM inbox_threads WHERE id='th-bot-3'");
  assert.equal(thread.bot_paused, 1);
  await customerSays('th-bot-3', 'فين حد؟');
  assert.equal((await bot.answerThread({ tenantId: TENANT, threadId: 'th-bot-3' }, deps())).reason, 'paused');
});

test('after maxReplies the conversation goes to the team', { skip }, async () => {
  // Now, not a minute ago: the bot's answer above is stamped now.
  await customerSays('th-bot-1', 'طيب والتقسيط؟', 0);
  assert.equal((await bot.answerThread({ tenantId: TENANT, threadId: 'th-bot-1' }, deps())).answered, true);
  await customerSays('th-bot-1', 'تمام وبعدين؟', 0);
  assert.equal((await bot.answerThread({ tenantId: TENANT, threadId: 'th-bot-1' }, deps())).reason, 'limit');
  const [[thread]] = await pool.query("SELECT bot_paused FROM inbox_threads WHERE id='th-bot-1'");
  assert.equal(thread.bot_paused, 1);
});
