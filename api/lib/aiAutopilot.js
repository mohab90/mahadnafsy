'use strict';

// «نخلي السيستم كله ذكي … وخلي السيستم يفيد نفسه ويكون ذكي يعني يعمل seo
// للموقع والمحتوي، ينزل محتوي مفيد علي المجتمع، يعمل مادة علميه بسيطة، يعمل
// اسئله تفاعليه قوية للعملاء علي الموقع».
//
// Once a Cairo day, with the key the institute set in «إعدادات AI»:
//   - SEO: a search title, description and keywords for each published course
//     that has none, where the course page and the prerendered pages read them.
//     A value someone typed is never replaced.
//   - المجتمع: one short, useful post; on Sundays and Wednesdays a simple study
//     article ties a concept to one of the institute's courses.
//   - أسئلة تفاعلية: a ten-question quiz for published courses that have none,
//     which enrolled students take in «حسابي».
// Each task is switched in «مركز الذكاء الاصطناعي» (tenant setting
// ai_autopilot); posts go straight to the community unless «مراجعة قبل النشر»
// is on, and every run is written to the activity log.

const { pool } = require('./db');
const { uuidv4 } = require('./id');
const { cairoToday } = require('./dates');
const { getTenantSetting } = require('./tenantSettings');
const { generateAdminAi, resolveAiConfig } = require('./adminAi');

const SECTION = 'ai_autopilot';
const DEFAULTS = { enabled: true, seo: true, communityPosts: true, studyArticles: true, quizzes: true, reviewBeforePublish: false };
const AUTHOR = 'فريق معهد الدراسات النفسية';
const SAFETY = [
  'المحتوى توعوي عام باللغة العربية المبسطة، ومش تشخيص ولا علاج.',
  'ممنوع ذكر أدوية أو جرعات، وممنوع تخترع دراسات أو أرقام أو أسماء مراجع.',
  'لو الموضوع فيه خطر على النفس (زي أفكار انتحارية) وجّه القارئ لمتخصص أو خط مساعدة فوراً.',
].join(' ');

async function autopilotSettings(tenantId, db = pool) {
  const stored = await getTenantSetting(SECTION, { tenantId, fallback: {}, db }).catch(() => ({}));
  return { ...DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) };
}

/** The model's answer as JSON — it is asked for JSON and sometimes wraps it. */
function parseJson(text) {
  const body = String(text || '').replace(/^```(?:json)?/im, '').replace(/```\s*$/m, '').trim();
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('the model returned no JSON');
  const open = body[start];
  const end = body.lastIndexOf(open === '[' ? ']' : '}');
  return JSON.parse(body.slice(start, end + 1));
}

async function askJson(config, prompt, maxTokens = 1500) {
  const text = await generateAdminAi({ ...config, temperature: 0.6 }, {
    systemPrompt: `أنت محرر محتوى لمعهد الدراسات النفسية (mahadnafsy.com) في مصر. ${SAFETY} رد بـ JSON بس من غير أي كلام قبله أو بعده.`,
    messages: [{ role: 'user', content: prompt }],
    maxTokens,
  });
  return parseJson(text);
}

const plain = (value, max) => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

async function publishedCourses(db, tenantId) {
  const [rows] = await db.query(
    `SELECT id, slug, COALESCE(NULLIF(title_ar,''), title) AS title, short_description, description,
            seo_title, seo_description, seo_keywords
       FROM courses WHERE tenant_id=? AND deleted_at IS NULL AND is_published=1
      ORDER BY sort_order, created_at`,
    [tenantId]
  );
  return rows;
}

// ── SEO ───────────────────────────────────────────────────────────────────
async function fillCourseSeo({ tenantId, config, limit = 8 }, db = pool) {
  const courses = (await publishedCourses(db, tenantId))
    .filter(course => !course.seo_title || !course.seo_description).slice(0, limit);
  let filled = 0;
  for (const course of courses) {
    const seo = await askJson(config, [
      'اكتب بيانات SEO لصفحة الكورس ده على موقع معهد الدراسات النفسية:',
      `الاسم: ${course.title}`,
      `الوصف: ${plain(course.short_description || course.description, 900)}`,
      'المطلوب JSON: {"title": "عنوان للبحث أقل من 60 حرف فيه اسم الكورس", "description": "وصف جذاب أقل من 155 حرف فيه فايدة الكورس ودعوة للتسجيل", "keywords": "6 كلمات مفتاحية بينهم فاصلة"}',
    ].join('\n'), 400);
    // Only the fields still empty: a title someone wrote stays theirs.
    await db.query(
      `UPDATE courses SET seo_title=COALESCE(NULLIF(seo_title,''), ?), seo_description=COALESCE(NULLIF(seo_description,''), ?),
              seo_keywords=COALESCE(NULLIF(seo_keywords,''), ?)
        WHERE id=? AND tenant_id=?`,
      [plain(seo.title, 70) || null, plain(seo.description, 170) || null, plain(seo.keywords, 300) || null, course.id, tenantId]
    );
    filled += 1;
  }
  return filled;
}

// ── المجتمع ───────────────────────────────────────────────────────────────
async function writeCommunityPost({ tenantId, config, kind, review }, db = pool) {
  const courses = await publishedCourses(db, tenantId);
  const [recent] = await db.query(
    'SELECT title FROM community_posts WHERE tenant_id=? AND author=? ORDER BY created_at DESC LIMIT 30',
    [tenantId, AUTHOR]
  );
  const course = courses.length ? courses[Math.floor(Math.random() * courses.length)] : null;
  const post = await askJson(config, [
    kind === 'study'
      ? `اكتب مادة علمية مبسطة (350 لـ 500 كلمة) تشرح مفهوم واحد مهم من مجال الكورس ده بأسلوب سهل وأمثلة من الحياة اليومية: «${course?.title || 'علم النفس'}» — ${plain(course?.short_description, 300)}. قسمها لفقرات قصيرة بعناوين، واختمها بسطر إن الكورس بيشرح الموضوع بالتفصيل.`
      : 'اكتب منشور قصير ومفيد (120 لـ 200 كلمة) لمجتمع طلاب علم النفس: نصيحة عملية أو معلومة نفسية تنفع في الحياة أو الدراسة، وفي آخره سؤال يشجع الناس يعلقوا.',
    `العناوين اللي اتنشرت قبل كده (متكررهاش): ${recent.map(row => row.title).join(' | ') || 'مفيش'}`,
    'المطلوب JSON: {"title": "عنوان قصير جذاب", "body": "النص كامل، الفقرات بينها سطر فاضي", "tags": ["3 وسوم قصيرة"]}',
  ].join('\n'), kind === 'study' ? 2000 : 900);
  const title = plain(post.title, 200);
  const body = String(post.body || '').trim().slice(0, 5000);
  if (!title || body.length < 80) throw new Error('the model returned an empty post');
  const link = kind === 'study' && course ? `\n\nاتعلم الموضوع بالتفصيل في «${course.title}»: https://mahadnafsy.com/c/${course.slug || course.id}` : '';
  const id = `ai-${uuidv4()}`;
  await db.query(
    `INSERT INTO community_posts (id, tenant_id, title, category, body, author, author_role, subscriber_id, image_url, tags, featured, pinned, likes, status, created_at)
     VALUES (?,?,?,?,?,?,?,NULL,NULL,?,0,0,0,?,?)`,
    [id, tenantId, title, kind === 'study' ? 'مادة علمية' : 'نصايح', `${body}${link}\n\n— محتوى توعوي، مش بديل عن استشارة متخصص.`,
      AUTHOR, 'فريق المعهد', JSON.stringify((Array.isArray(post.tags) ? post.tags : []).map(tag => plain(tag, 30)).slice(0, 5)),
      review ? 'pending' : 'approved', new Date().toISOString()]
  );
  return { id, title, status: review ? 'pending' : 'approved' };
}

// ── أسئلة تفاعلية ─────────────────────────────────────────────────────────
function validQuestions(list) {
  return (Array.isArray(list) ? list : [])
    .map(item => ({
      id: uuidv4(),
      question: plain(item?.question, 400),
      options: (Array.isArray(item?.options) ? item.options : []).map(option => plain(option, 200)).slice(0, 4),
      correctIndex: Number(item?.correctIndex),
      explanation: plain(item?.explanation, 400),
    }))
    .filter(item => item.question && item.options.length === 4 && item.options.every(Boolean)
      && Number.isInteger(item.correctIndex) && item.correctIndex >= 0 && item.correctIndex <= 3);
}

async function generateCourseQuizzes({ tenantId, config, limit = 3 }, db = pool) {
  const [withQuiz] = await db.query('SELECT DISTINCT course_id FROM course_quizzes WHERE tenant_id=?', [tenantId]);
  const has = new Set(withQuiz.map(row => String(row.course_id)));
  const courses = (await publishedCourses(db, tenantId)).filter(course => !has.has(String(course.id))).slice(0, limit);
  let made = 0;
  for (const course of courses) {
    const source = plain(`${course.short_description || ''} ${course.description || ''}`, 2500);
    const data = await askJson(config, [
      `اعمل 10 أسئلة اختيار من متعدد قوية وتفاعلية عن كورس «${course.title}» تقيس الفهم مش الحفظ، مستواها مناسب لطالب بيدرس الكورس.`,
      `محتوى الكورس: ${source}`,
      'كل سؤال له 4 اختيارات، واحد بس صح، وشرح قصير ليه هو الصح.',
      'المطلوب JSON: {"questions": [{"question": "...", "options": ["أ", "ب", "ج", "د"], "correctIndex": 0, "explanation": "..."}]}',
    ].join('\n'), 3500);
    const questions = validQuestions(data.questions);
    if (questions.length < 5) continue;
    await db.query(
      `INSERT INTO course_quizzes (id, tenant_id, course_id, title, questions_json, passing_score, required_for_completion, generated_by_ai, source_material, created_at, updated_at)
       VALUES (?,?,?,?,?,60,0,1,?,NOW(),NOW())`,
      [uuidv4(), tenantId, course.id, `اختبر نفسك: ${plain(course.title, 180)}`, JSON.stringify(questions), source.slice(0, 2000)]
    );
    made += 1;
  }
  return made;
}

/**
 * One day's work for a tenant. Each task stands alone: one failing (a refused
 * key, a model that answered badly) does not stop the others, and what each
 * did or why it failed is returned for the activity log and the screen.
 */
async function runAutopilot({ tenantId, date = cairoToday(), only = null }, db = pool) {
  const settings = await autopilotSettings(tenantId, db);
  const aiSettings = await getTenantSetting('settings', { tenantId, fallback: {}, db }).catch(() => ({}));
  const config = resolveAiConfig(aiSettings, 'admin');
  if (!config) return { ok: false, reason: 'لسه مفيش مفتاح ذكاء اصطناعي في «إعدادات AI»' };
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const wants = task => (only ? only === task : settings.enabled && settings[task]);
  const done = {};
  const attempt = async (task, fn) => {
    if (!wants(task)) return;
    try { done[task] = await fn(); } catch (error) { done[task] = { error: String(error.message || error).slice(0, 300) }; }
  };
  await attempt('seo', () => fillCourseSeo({ tenantId, config }, db));
  await attempt('communityPosts', () => writeCommunityPost({ tenantId, config, kind: 'tip', review: settings.reviewBeforePublish }, db));
  if (only === 'studyArticles' || weekday === 0 || weekday === 3) {
    await attempt('studyArticles', () => writeCommunityPost({ tenantId, config, kind: 'study', review: settings.reviewBeforePublish }, db));
  }
  await attempt('quizzes', () => generateCourseQuizzes({ tenantId, config }, db));
  await db.query(
    'INSERT INTO activity_logs (id, tenant_id, action, entity, entity_id, label, actor, at) VALUES (?,?,?,?,?,?,?,NOW())',
    [uuidv4(), tenantId, 'run', 'ai-autopilot', date, JSON.stringify(done).slice(0, 2000), 'ai-autopilot']
  ).catch(() => {});
  return { ok: true, date, done };
}

/** Called by the scheduler: today's run, once its hour (10:00 Cairo) has come. */
async function queueDueAutopilot({ queue, logger }, db = pool) {
  const { cairoClock } = require('./dates');
  const clock = cairoClock();
  if (clock.minutes < 10 * 60) return;
  const [rows] = await db.query("SELECT DISTINCT tenant_id FROM tenant_settings WHERE section='settings'");
  for (const { tenant_id: tenantId } of rows) {
    const settings = await autopilotSettings(tenantId, db);
    if (!settings.enabled) continue;
    await queue.enqueue('ai_autopilot', { tenantId, date: clock.date }, {
      tenantId, maxAttempts: 1, dedupeKey: `ai_autopilot:${clock.date}`,
    }).catch(error => logger.warn('[ai-autopilot] could not queue', { tenantId, error: error.message }));
  }
}

module.exports = {
  DEFAULTS, SECTION, autopilotSettings, fillCourseSeo, generateCourseQuizzes, parseJson,
  queueDueAutopilot, runAutopilot, validQuestions, writeCommunityPost,
};
