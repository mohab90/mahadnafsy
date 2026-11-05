const test = require('node:test');
const assert = require('node:assert/strict');
const { read, bundle } = require('./support/repo');

const load = () => bundle('client/lib/studentExtras.ts');
const answer = over => ({ notifications: { notifications: [{ id: 'n' }], readIds: [] }, liveStreams: [{ id: 'l' }], quizzes: [{ id: 'q' }], quizAttempts: [], consultations: [], ...over });

test('five pieces, one request: every consumer of one student gets its piece from the same answer', async () => {
  const lib = load();
  if (!lib) return;
  let asked = 0;
  const fetchExtras = async () => { asked++; return answer(); };
  const own = () => { throw new Error('its own route must not be asked'); };
  const pieces = await Promise.all(['notifications', 'liveStreams', 'quizzes', 'quizAttempts', 'consultations'].map(key => lib.studentPiece('u1', fetchExtras, key, own)));
  assert.equal(asked, 1);
  assert.deepEqual(pieces[1], [{ id: 'l' }]);
  assert.deepEqual(pieces[3], [], 'an empty list is an answer, not a missing piece');
});

test('a piece the server could not answer is asked of its own route, and only that piece', async () => {
  const lib = load();
  if (!lib) return;
  const fetchExtras = async () => answer({ quizzes: null });
  assert.deepEqual(await lib.studentPiece('u2', fetchExtras, 'quizzes', async () => [{ id: 'own' }]), [{ id: 'own' }]);
  assert.deepEqual(await lib.studentPiece('u2', fetchExtras, 'liveStreams', () => { throw new Error('not this one'); }), [{ id: 'l' }]);
});

test('a request that fails changes nothing, and a failure is not kept: the next asker tries again', async () => {
  const lib = load();
  if (!lib) return;
  let asked = 0;
  const flaky = async () => { asked++; if (asked === 1) throw new Error('network'); return answer(); };
  assert.deepEqual(await lib.studentPiece('u3', flaky, 'quizzes', async () => [{ id: 'own' }]), [{ id: 'own' }], 'the first asker is served by the route itself');
  assert.deepEqual(await lib.studentPiece('u3', flaky, 'quizzes', async () => [{ id: 'own' }]), [{ id: 'q' }], 'and the second by the bundle');
  assert.equal(asked, 2);
});

test('another student asks again: one student\'s answer is never another\'s', async () => {
  const lib = load();
  if (!lib) return;
  let asked = 0;
  const fetchExtras = async () => { asked++; return answer({ quizzes: [{ id: `q${asked}` }] }); };
  const a = await lib.studentPiece('ua', fetchExtras, 'quizzes', async () => []);
  const b = await lib.studentPiece('ub', fetchExtras, 'quizzes', async () => []);
  assert.deepEqual([a[0].id, b[0].id], ['q1', 'q2']);
});

test('the dashboard consumers read their piece from here and nothing asks the five routes directly', () => {
  for (const file of ['useNotifications.ts', 'useLiveStreams.ts', 'useQuizzes.ts', 'useClientAccountRuntime.ts']) {
    assert.match(read(`client/context/site-data-hooks/${file}`), /studentPiece\(/, file);
  }
  const routeSource = read('api/routes/public.js');
  assert.match(routeSource, /router\.get\('\/api\/me\/student-extras', publicLimiter, requireAuth/);
  assert.match(routeSource, /answerOfRoute\(configRouter, '\/api\/notifications\/broadcasts', req\)/);
});
