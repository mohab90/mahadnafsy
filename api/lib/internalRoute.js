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

/**
 * The same, for a route whose guards ARE the point (the admin panel's start-up, 5 Nov 2026): every handler of the route runs in order — the permission checks as well as
 * the handler — against the request that asked, so an account that may not read a piece gets `null` for it, exactly as that route's own 401/403 would have said no.
 * A guard or handler that answers 400+, fails, calls next() without answering, or takes longer than `timeoutMs` leaves the piece `null`; the caller asks that route for
 * itself and gets the real refusal. Never throws.
 */
function runRoute(router, routePath, req, query = {}, { timeoutMs = 10_000 } = {}) {
  const layer = router.stack.find(entry => entry.route && entry.route.path === routePath && entry.route.methods.get);
  if (!layer) return Promise.resolve(null);
  const handlers = layer.route.stack.map(entry => entry.handle);
  const request = Object.create(req);
  Object.defineProperty(request, 'query', { value: query, configurable: true, writable: true });
  return new Promise(resolve => {
    let settled = false;
    let status = 200;
    const timer = setTimeout(() => finish(null), timeoutMs);
    function finish(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }
    const answer = body => finish(status >= 400 || body === undefined ? null : body);
    const res = {
      locals: {},
      headersSent: false,
      status(code) { status = code; return res; },
      json(body) { answer(body); return res; },
      send(body) { answer(body); return res; },
      set() { return res; },
      setHeader() { return res; },
      getHeader() { return undefined; },
      end() { finish(null); return res; },
    };
    const step = async index => {
      if (settled) return;
      if (index >= handlers.length) return finish(null);
      try {
        await handlers[index](request, res, error => { if (error) finish(null); else step(index + 1); });
      } catch { finish(null); }
    };
    step(0);
  });
}

module.exports = { answerOfRoute, runRoute };
