import { test, expect, type Page, type PlaywrightWorkerArgs } from '@playwright/test';
import { loginAdmin } from '../helpers/adminLogin';

/**
 * Live end-to-end pass over the Dokki (الدقي) section, against a RUNNING
 * deployment. Covers, in order: creating a round with a training room, the
 * refusal of a second round in the same hall on the same weekday and slot,
 * adding a client, marking attendance, the shape of the dates that come back,
 * and a sweep of the Dokki screens for unexpected 4xx/5xx.
 *
 * This suite WRITES, into whatever database the target points at, so it is gated
 * on DAQQI_E2E_WRITE=1 being set explicitly.
 *
 *   ADMIN_BASE_URL=https://admin.mahadnafsy.com \
 *   TEST_DAQQI_MANAGER_EMAIL=... TEST_DAQQI_MANAGER_PASSWORD=... \
 *   DAQQI_E2E_WRITE=1 npm --prefix e2e test daqqi-section
 *
 * It is written to be safe to point at production, which is where the useful
 * answer is. Everything it creates carries the E2E_TAG below, the hall it books
 * is a made-up name that cannot collide with a real one, and afterAll puts
 * the section back:
 *   - the spare round is deleted outright (still empty and NEW)
 *   - the round that took attendance is set FINISHED rather than deleted — the
 *     API refuses to drop attendance history, and rightly so. A finished round
 *     releases its hall and drops out of the desk's active views.
 *   - the test client is archived through DELETE /api/admin/subscribers/:id,
 *     which is a soft archive with a /restore counterpart, not a hard delete.
 * Whatever it could not clear is printed at the end.
 */
const ADMIN = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:4000';
const EMAIL = process.env.TEST_DAQQI_MANAGER_EMAIL || process.env.TEST_ADMIN_EMAIL || '';
const PASSWORD = process.env.TEST_DAQQI_MANAGER_PASSWORD || process.env.TEST_ADMIN_PASSWORD || '';
const MANAGEMENT_EMAIL = process.env.E2E_ADMIN_EMAIL || process.env.TEST_ADMIN_EMAIL || '';
const MANAGEMENT_PASSWORD = process.env.E2E_ADMIN_PASSWORD || process.env.TEST_ADMIN_PASSWORD || '';
const WRITES_ALLOWED = process.env.DAQQI_E2E_WRITE === '1';

const STAMP = Date.now().toString(36).toUpperCase();
const E2E_TAG = `E2E-${STAMP}`;
const ROOM = `E2E-QAA-${STAMP}`.slice(0, 60);
const DAY = 'الثلاثاء';
const SLOT = 'مساءً';
// A fixed calendar date, not "today": the point of the date assertions below is
// that what goes in comes back out unshifted, which a value derived from the
// runner's clock would hide.
const START_DATE = '2026-06-17';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// id → what it is. Populated the moment a thing is created, so a crashed run
// still reports it, and cleared by the cleanup test as each one is dealt with.
const leftBehind = new Map<string, string>();
let page: Page;
let courseId = '';
let roundAId = '';
let roundBId = '';
let subscriberId = '';

// The suite-wide 30s would be spent before loginAdmin's own 75s deadline could
// even elapse, so a slow sign-in surfaced as a torn-down page rather than as the
// login timing out. Each step here is one or two API calls; the budget is for
// the login and the dashboard renders in the 4xx/5xx sweep.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.describe('Dokki section — live pass', () => {
  test.skip(!WRITES_ALLOWED, 'set DAQQI_E2E_WRITE=1 to run: this suite creates a real round and client');
  test.skip(!EMAIL || !PASSWORD, 'set TEST_DAQQI_MANAGER_EMAIL / TEST_DAQQI_MANAGER_PASSWORD');

  test.beforeAll(async ({ browser }) => {
    // describe.configure({ timeout }) sets the timeout for tests, not for this
    // hook, which kept the config's 30s while loginAdmin runs to its own 75s
    // deadline. The hook was always torn down first, so a refused or slow login
    // could never report itself — it surfaced as "target page has been closed".
    test.setTimeout(120_000);
    page = await browser.newPage();
    await loginAdmin(page, ADMIN, EMAIL, PASSWORD);
    // The session cookie is Secure, and page.request — unlike the browser —
    // will not send a Secure cookie over the plain-http staging proxy: every
    // write below answered 401 while the screens loaded. The same token goes
    // as a header instead.
    const token = (await page.context().cookies()).find(c => c.name === 'authToken')?.value || '';
    await page.context().setExtraHTTPHeaders({ Authorization: `Bearer ${decodeURIComponent(token)}` });
  });

  // In afterAll rather than a last test: the suite runs serially, so one failed
  // step skipped a cleanup test and left live rounds holding a hall.
  test.afterAll(async ({ playwright }) => {
    const failures = await cleanUp(playwright);
    if (leftBehind.size) {
      console.log(`\n[daqqi-e2e] left in the database:\n  ${[...leftBehind.values()].join('\n  ')}\n`);
    } else {
      console.log('\n[daqqi-e2e] nothing left behind.\n');
    }
    await page?.close();
    expect(failures, 'cleanup must not leave live test data behind').toEqual([]);
  });

  test('a course is available to build a round on', async () => {
    const response = await page.request.get(`${ADMIN}/api/courses?limit=1`);
    expect(response.status(), 'course list must load').toBe(200);
    const courses = await response.json();
    expect(Array.isArray(courses) && courses.length, 'need at least one course').toBeTruthy();
    courseId = String(courses[0].id);
  });

  test('a round records the training room it was booked into', async () => {
    const response = await page.request.post(`${ADMIN}/api/admin/daqqi-rounds`, {
      data: {
        courseId,
        instructorName: `${E2E_TAG} instructor`,
        receptionName: `${E2E_TAG} reception`,
        dayOfWeek: DAY,
        startDate: START_DATE,
        timeSlot: SLOT,
        status: 'new',
        currentLecture: 0,
        postponedWeeks: [],
        room: ROOM,
      },
    });
    expect(response.status(), await response.text()).toBeLessThan(300);
    const saved = await response.json();
    roundAId = String(saved.id || saved.round?.id || '');
    expect(roundAId, 'created round must come back with an id').toBeTruthy();
    leftBehind.set(roundAId, `round ${roundAId} — active, holding hall ${ROOM}`);
  });

  test('the same hall on the same day and slot is refused', async () => {
    const response = await page.request.post(`${ADMIN}/api/admin/daqqi-rounds`, {
      data: {
        courseId,
        instructorName: `${E2E_TAG} instructor 2`,
        receptionName: `${E2E_TAG} reception`,
        dayOfWeek: DAY,
        startDate: START_DATE,
        timeSlot: SLOT,
        status: 'new',
        currentLecture: 0,
        postponedWeeks: [],
        room: ROOM,
      },
    });
    expect(response.status(), 'a double-booked hall must be refused, not saved').toBe(409);
    expect(await response.text()).toContain(ROOM);
  });

  test('the clash is about the hall — a different room in the same slot saves', async () => {
    const response = await page.request.post(`${ADMIN}/api/admin/daqqi-rounds`, {
      data: {
        courseId,
        instructorName: `${E2E_TAG} instructor 3`,
        receptionName: `${E2E_TAG} reception`,
        dayOfWeek: DAY,
        startDate: START_DATE,
        timeSlot: SLOT,
        status: 'new',
        currentLecture: 0,
        postponedWeeks: [],
        room: `${ROOM}-B`,
      },
    });
    expect(response.status(), await response.text()).toBeLessThan(300);
    roundBId = String((await response.json()).id || '');
    expect(roundBId).toBeTruthy();
    leftBehind.set(roundBId, `spare round ${roundBId} — active, holding hall ${ROOM}-B`);
  });

  test('a client can be added and booked into the round', async () => {
    const created = await page.request.post(`${ADMIN}/api/admin/subscribers`, {
      data: {
        name: `${E2E_TAG} عميل`,
        phone: `0100${String(Date.now()).slice(-7)}`,
        email: `${E2E_TAG.toLowerCase()}@e2e.invalid`,
        branch: 'DAQQI',
        status: 'active',
        enrolledCourseIds: [courseId],
      },
    });
    expect(created.status(), await created.text()).toBeLessThan(300);
    subscriberId = String((await created.json()).id || '');
    expect(subscriberId, 'created client must come back with an id').toBeTruthy();
    leftBehind.set(subscriberId, `subscriber ${subscriberId} — active in the CRM`);

    const round = await fetchRound(roundAId);
    const booked = await page.request.post(`${ADMIN}/api/admin/daqqi-rounds`, {
      data: {
        ...round,
        attendees: [
          ...(round.attendees || []),
          { subscriberId, name: `${E2E_TAG} عميل`, phone: '0100000000', bookedAt: START_DATE, amountPaid: 0 },
        ],
      },
    });
    expect(booked.status(), await booked.text()).toBeLessThan(300);

    const after = await fetchRound(roundAId);
    expect(after.attendees.map((a: { subscriberId: string }) => a.subscriberId)).toContain(subscriberId);
  });

  test('attendance is recorded and starts the round', async () => {
    const response = await page.request.post(
      `${ADMIN}/api/admin/daqqi-rounds/${encodeURIComponent(roundAId)}/attendance`,
      { data: { subscriberId } },
    );
    expect(response.status(), await response.text()).toBeLessThan(300);

    const round = await fetchRound(roundAId);
    // Marking attendance IS starting the session — a NEW round becomes ACTIVE.
    expect(round.status).toBe('active');
    expect(Number(round.currentLecture)).toBeGreaterThanOrEqual(1);
    const attendee = round.attendees.find((a: { subscriberId: string }) => a.subscriberId === subscriberId);
    expect(Number(attendee.attendedLectures)).toBeGreaterThanOrEqual(1);
  });

  test('the same session cannot be marked twice', async () => {
    const response = await page.request.post(
      `${ADMIN}/api/admin/daqqi-rounds/${encodeURIComponent(roundAId)}/attendance`,
      { data: { subscriberId } },
    );
    expect(response.status(), 'a repeated session mark must be refused').toBe(409);
  });

  test('dates read back as calendar dates, unshifted', async () => {
    const round = await fetchRound(roundAId);
    // The regression this guards: DATETIME columns arrive as JS Date objects, and
    // String(date).slice(0, 10) turns 2026-06-17 into "Wed Jun 17".
    expect(round.startDate, 'startDate must be YYYY-MM-DD').toMatch(ISO_DATE);
    expect(round.startDate, 'the date saved must be the date returned').toBe(START_DATE);
    const attendee = round.attendees.find((a: { subscriberId: string }) => a.subscriberId === subscriberId);
    expect(attendee.bookedAt, 'bookedAt must be YYYY-MM-DD').toMatch(ISO_DATE);
    expect(round.createdAt, 'createdAt must parse as a real instant').not.toBeNaN();
    expect(Number.isNaN(Date.parse(round.createdAt))).toBe(false);
  });

  test('every round in the list has a usable start date', async () => {
    const response = await page.request.get(`${ADMIN}/api/admin/daqqi-rounds`);
    expect(response.status()).toBe(200);
    const rounds = await response.json();
    const broken = rounds
      .filter((r: { startDate: string }) => r.startDate && !ISO_DATE.test(r.startDate))
      .map((r: { code: string; startDate: string }) => `${r.code}: ${r.startDate}`);
    expect(broken, 'no round may render a Date.toString() as its start date').toEqual([]);
  });

  test('the Dokki screens load with no unexpected 4xx/5xx', async () => {
    const bad: string[] = [];
    const onResponse = (response: { status: () => number; url: () => string; request: () => { method: () => string } }) => {
      const status = response.status();
      if (status < 400) return;
      // 401 on a polling endpoint after logout, and 404 on optional assets, are
      // noise; anything else on an /api/ call is not.
      if (!response.url().includes('/api/')) return;
      bad.push(`${status} ${response.request().method()} ${response.url()}`);
    };
    page.on('response', onResponse);
    for (const tab of ['daqqi_schedule', 'daqqi_clients', 'daqqi_attendance']) {
      // /dashboard/<key>: ?tab= is read by nothing, so this swept the overview
      // three times. And not networkidle — the panel polls, so it never comes.
      await page.goto(`${ADMIN}/dashboard/${tab}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
    }
    page.off('response', onResponse);
    expect(bad, 'Dokki screens must not produce API errors').toEqual([]);
  });
});

async function fetchRound(id: string) {
  const response = await page.request.get(`${ADMIN}/api/admin/daqqi-rounds`);
  expect(response.status()).toBe(200);
  const rounds = await response.json();
  const round = rounds.find((r: { id: string }) => r.id === id);
  expect(round, `round ${id} must be in the list`).toBeTruthy();
  return round;
}

/**
 * Put the section back. The round with attendance is closed as the Dokki
 * manager; deleting the spare round and archiving the client are management's
 * alone — the Dokki manager is refused both, correctly — so those two go
 * through the admin account.
 */
async function cleanUp(playwright: PlaywrightWorkerArgs['playwright']): Promise<string[]> {
  const failures: string[] = [];

  // Round A carries attendance history, which the API refuses to delete. Close
  // it instead: a FINISHED round releases its hall and leaves the active views.
  if (roundAId && page) {
    const round = await fetchRound(roundAId);
    const response = await page.request.post(`${ADMIN}/api/admin/daqqi-rounds`, { data: { ...round, status: 'finished' } });
    if (response.status() >= 300) failures.push(`round ${roundAId} close → ${response.status()}`);
    else leftBehind.set(roundAId, `round ${roundAId} — finished, hall released; kept for its attendance history`);
  }
  if (!roundBId && !subscriberId) return failures;

  // Signed in last: when the suite itself runs as the admin, this login ends
  // the page's session, which has nothing left to do by now.
  const signIn = await playwright.request.newContext();
  const login = await signIn.post(`${ADMIN}/api/auth/login`, { data: { email: MANAGEMENT_EMAIL, password: MANAGEMENT_PASSWORD } });
  const token = decodeURIComponent((/authToken=([^;]+)/.exec(login.headers()['set-cookie'] || '') || [])[1] || '');
  await signIn.dispose();
  if (!token) return [...failures, `the admin sign-in for cleanup failed (${login.status()}) — set E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD`];
  const management = await playwright.request.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });

  // Round B never took attendance, so it is still an empty NEW round.
  if (roundBId) {
    const response = await management.delete(`${ADMIN}/api/admin/daqqi-rounds/${encodeURIComponent(roundBId)}`);
    if (response.status() >= 300) failures.push(`spare round ${roundBId} delete → ${response.status()}`);
    else leftBehind.delete(roundBId);
  }
  // Soft archive — is_active=0 + deleted_at, reversible via /restore.
  if (subscriberId) {
    const response = await management.delete(`${ADMIN}/api/admin/subscribers/${encodeURIComponent(subscriberId)}`);
    if (response.status() >= 300) failures.push(`client ${subscriberId} archive → ${response.status()}`);
    else leftBehind.delete(subscriberId);
  }
  await management.dispose();
  return failures;
}
