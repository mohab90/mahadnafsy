'use strict';

/**
 * The answer of one of the server's own GET routes, taken inside the server (5 Nov 2026).
 *
 * A screen that used to ask five routes asks one, and that one runs the five routes' own handlers against the SAME request (the signed-in user, the tenant) and puts
 * their answers side by side. Nothing is copied: the answer of each piece is, by construction, what its route answers, with the same rules for who may see what.
 * Only the route's last handler runs (the guards before it, the limiter and requireAuth, have already run for the request that asked), the query it reads
 * is the one given, and a refusal or failure (status 400 and over) is `null`, so the caller can ask that route for itself.
 */

async function answerOfRoute(router, routePath, req, query = {}) {
  const layer = router.stack.find(entry => entry.route && entry.route.path === routePath && entry.route.methods.get);
  if (!layer) throw new Error(`no GET ${routePath} on that router`);
  const answer = { statusCode: 200, body: undefined };
  const res = {
    status(code) { answer.statusCode = code; return res; },
    json(body) { answer.body = body; return res; },
    send(body) { answer.body = body; return res; },
    set() { return res; },
    setHeader() { return res; },
    end() { return res; },
  };
  const request = Object.create(req);
  Object.defineProperty(request, 'query', { value: query, configurable: true, writable: true });
  await layer.route.stack.at(-1).handle(request, res, error => { if (error) throw error; });
  return answer.statusCode >= 400 || answer.body === undefined ? null : answer.body;
}

module.exports = { answerOfRoute };
