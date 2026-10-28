'use strict';

// «عملائي» for a sales rep or a collection officer, answered a page at a time (GET /api/staff/subscribers?paged=1).
//
// The screen filtered and paged the person's whole list in the browser: every client in scope with their payments
// (5,000 clients on the production-scale lab) came down at sign-in, after every write and every two minutes. Here the
// server applies the same filters to the same clients and sends the page, the figures above the table and the tab
// counts. The rules below are the screen's own, written once more in JavaScript — admin/lib/clientFollowUp.ts,
// admin/lib/agreedPrice.ts, admin/lib/clientSearch.ts, admin/lib/coursePlacement.ts and
// admin/pages/dashboard/tabs/onlineClientsUtils.ts — and api/tests/staffClientsView.test.js runs both on the same
// clients, so a change to one that forgets the other fails there.

const { foldText, SEARCH_MIN_CHARS } = require('./searchText');
const { dateOnlyInTimeZone, addDaysToDateOnly } = require('./dates');

const TERMINAL = ['finished', 'paused', 'refunded', 'refund_pending'];
// What the browser converts with when no rate is configured (admin/lib/money.ts FX_FALLBACK): its totals and
// balances read these, so the server's do.
const FX = { EGP: 1, SAR: 13, USD: 48 };
const NO_COLLECTOR = '__none__';
const FOLLOW_FILTERS = ['due', 'overdue', 'today', 'tomorrow', 'week', 'none'];
const VIEWS = ['active', 'real-local', 'real-saudi', 'real-intl', 'finished', 'paused', 'refunded', 'old_local', 'old_intl'];
const MARKET_VIEWS = { 'real-local': 'local', 'real-saudi': 'saudi', 'real-intl': 'intl' };
// «عملاء الدقي» has its own tabs (OnlineClientsTab / ViewTabsBar): the lifecycle ones, the two booking years and the imports.
const DOKKI_VIEWS = ['active', 'finished', 'paused', 'refunded', 'booked2024', 'booked2025', 'old_data'];
const BOOKING_YEAR_VIEWS = { booked2024: 2024, booked2025: 2025 };
const OLD_DATA_STATUSES = ['old_data', 'daqqi_old_local', 'daqqi_old_intl'];
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const normBranch = value => (value ? String(value).toUpperCase().replace(/[-\s]/g, '_') : '');

/** The branch workspace a link names (?branch=…) and whether a client's branch is it (admin/pages/dashboard/branchWorkspaceFilters.ts). */
function branchSlugToFilter(slug) {
  const normalized = String(slug || '').trim().toUpperCase().replace(/[-\s]+/g, '_');
  if (!normalized || normalized === 'ALL') return '';
  if (normalized === 'ONLINE_EGYPT' || normalized === 'ONLINE') return 'ONLINE_EGYPT';
  if (normalized === 'ONLINE_SAUDI' || normalized === 'SAUDI') return 'ONLINE_SAUDI';
  if (normalized === 'ONLINE_ABROAD' || normalized === 'ABROAD' || normalized === 'INTERNATIONAL') return 'ONLINE_ABROAD';
  if (normalized === 'DAQQI' || normalized === 'DOKKI' || normalized === 'DQI') return 'DAQQI';
  return normalized;
}
function branchMatchesFilter(value, filter) {
  const wanted = branchSlugToFilter(filter);
  if (!wanted) return true;
  const branch = String(value || '').trim().toUpperCase().replace(/[-\s]+/g, '_');
  if (wanted === 'DAQQI') return branch === 'DAQQI' || branch === 'DOKKI' || branch === 'DQI';
  if (wanted === 'ONLINE_EGYPT') return branch === 'ONLINE_EGYPT' || branch === 'ONLINE';
  return branch === wanted;
}

/** A stored instant on the institute's clock, as YYYY-MM-DD (a zoneless time is UTC, a bare date is itself). */
function cairoDay(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string' && DATE_ONLY.test(value.trim())) return value.trim();
  const raw = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(value.trim())
    ? `${value.trim().replace(' ', 'T')}Z` : value;
  const instant = new Date(raw);
  return Number.isNaN(instant.getTime()) ? '' : dateOnlyInTimeZone(instant);
}

const isCollected = payment => !payment?.status || payment.status === 'paid';
const toEgp = (amount, currency) => {
  const value = Number(amount) || 0;
  return !currency || currency === 'EGP' ? value : (FX[currency] > 0 ? value * FX[currency] : value);
};

// ── Where a client belongs ───────────────────────────────────────────────────────────────────────────────────
const isOnlineBranch = branch => !['DAQQI', 'TAGAMOA'].includes(normBranch(branch));
const isOnlineClient = client => isOnlineBranch(client.branch);
const holdsOnline = client => isOnlineBranch(client.branch) || Object.values(client.coursePlacements || {}).some(isOnlineBranch);

function isInternational(client) {
  const branch = normBranch(client.branch);
  if (branch === 'ONLINE_SAUDI' || branch === 'ONLINE_ABROAD') return true;
  const raw = String(client.branch || '').toLowerCase();
  if (raw.includes('saudi') || raw.includes('abroad') || raw.includes('خارج')) return true;
  return (client.paymentHistory || []).some(payment => payment.currency === 'SAR' || payment.currency === 'USD');
}

/** «محلي / سعودي / دولي»: where the desk moved the client, else what their latest collected payment was in, else their branch. */
function marketOf(client) {
  if (['local', 'saudi', 'intl'].includes(client.market)) return client.market;
  const latest = (client.paymentHistory || []).filter(isCollected)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))[0];
  if (latest?.currency === 'SAR') return 'saudi';
  if (latest?.currency === 'USD') return 'intl';
  if (latest?.currency === 'EGP') return 'local';
  const branch = normBranch(client.branch);
  if (branch === 'ONLINE_SAUDI') return 'saudi';
  if (branch === 'ONLINE_ABROAD') return 'intl';
  return 'local';
}

// ── Follow-up (admin/lib/clientFollowUp.ts) ─────────────────────────────────────────────────────────────────
const dayOf = value => {
  const text = String(value || '').trim();
  if (!text) return null;
  const day = DATE_ONLY.test(text) ? text : cairoDay(text);
  return DATE_ONLY.test(day) ? day : null;
};

function followUpOf(client, today) {
  const comms = client.communications || [];
  const last = comms.length ? [...comms].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] : null;
  const contactDate = dayOf(client.nextFollowUpDate) || dayOf(last?.nextFollowUp);
  let installmentDate = null;
  for (const plan of client.installmentPlans || []) {
    for (const entry of plan.entries || []) {
      const due = entry.paidAt ? null : dayOf(entry.dueDate);
      if (due && (!installmentDate || due < installmentDate)) installmentDate = due;
    }
  }
  const installmentDue = installmentDate && installmentDate <= today ? installmentDate : null;
  const date = [contactDate, installmentDue].filter(Boolean).sort()[0] || null;
  let status = 'none';
  if (date) {
    if (date < today) status = 'overdue';
    else if (date === today) status = 'today';
    else if (date === addDaysToDateOnly(today, 1)) status = 'tomorrow';
    else if (date <= addDaysToDateOnly(today, 7)) status = 'week';
    else status = 'later';
  }
  return status;
}

function matchesFollow(status, filter) {
  switch (filter) {
    case '': return true;
    case 'due': return status === 'overdue' || status === 'today';
    case 'week': return status === 'today' || status === 'tomorrow' || status === 'week';
    default: return status === filter;
  }
}

// ── What the client holds and owes (admin/lib/agreedPrice.ts) ───────────────────────────────────────────────
const itemKeyOf = payment => (payment.bundleId ? `bundle:${payment.bundleId}` : (payment.courseId || ''));
const isCoursePayment = payment => !payment.paymentType || payment.paymentType === 'course'
  || (payment.paymentType === 'other' && Boolean(payment.courseId || payment.bundleId));
const catalogueIn = (price, currency) => Number((price || {})[currency]) || Number((price || {}).EGP) || 0;

function paidFor(client, item, currency) {
  return (client.paymentHistory || [])
    .filter(payment => isCollected(payment) && isCoursePayment(payment) && itemKeyOf(payment) === item && (!currency || payment.currency === currency))
    .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
}

function agreedPriceFor(client, item, catalogue, currency) {
  const custom = Number(client.customPrices?.[item]) || 0;
  if (custom > 0) return custom;
  const booked = (client.paymentHistory || [])
    .filter(payment => (isCollected(payment) || payment.status === 'pending') && itemKeyOf(payment) === item && (!currency || payment.currency === currency))
    .reduce((max, payment) => Math.max(max, Number(payment.courseExpected) || 0), 0);
  if (booked > 0) return Math.max(booked, paidFor(client, item, currency));
  return catalogue;
}

/** `catalogue`: { courses: Map(id → {price}), bundles: Map(id → {price, courseIds}) }. */
function clientItems(client, catalogue, fallbackCurrency) {
  const keys = new Set();
  (client.paymentHistory || []).forEach(payment => {
    const item = itemKeyOf(payment);
    if (item && isCoursePayment(payment)) keys.add(item);
  });
  Object.keys(client.customPrices || {}).forEach(item => { if (!item.startsWith('multi:')) keys.add(item); });
  (client.enrolledBundleIds || []).forEach(id => { if (id) keys.add(`bundle:${id}`); });
  const inTracks = new Set([...keys].filter(item => item.startsWith('bundle:'))
    .flatMap(item => catalogue.bundles.get(item.slice(7))?.courseIds || []));
  (client.enrolledCourseIds || []).forEach(id => { if (id && !inTracks.has(id)) keys.add(id); });
  Object.entries(client.priorPaid || {}).forEach(([item, amount]) => {
    if (item && Number(amount) > 0 && !item.startsWith('multi:') && !inTracks.has(item)) keys.add(item);
  });
  return [...keys].map(item => {
    const entry = item.startsWith('bundle:') ? catalogue.bundles.get(item.slice(7)) : catalogue.courses.get(item);
    const currency = (client.paymentHistory || []).find(payment => itemKeyOf(payment) === item)?.currency || fallbackCurrency;
    const expected = agreedPriceFor(client, item, catalogueIn(entry?.price, currency), currency);
    const paid = paidFor(client, item, currency) + (Number(client.priorPaid?.[item]) || 0);
    return { currency, paid, remaining: Math.max(0, expected - paid) };
  });
}

const BRANCH_CURRENCY = { ONLINE_SAUDI: 'SAR', ONLINE_ABROAD: 'USD' };
function clientCurrency(client) {
  if (isOnlineClient(client)) return { local: 'EGP', saudi: 'SAR', intl: 'USD' }[marketOf(client)];
  return BRANCH_CURRENCY[normBranch(client.branch)] || 'EGP';
}

function balanceOf(client, catalogue) {
  const items = clientItems(client, catalogue, clientCurrency(client));
  return {
    items: items.length,
    remainingEgp: items.reduce((sum, item) => sum + toEgp(item.remaining, item.currency), 0),
    paidAnything: items.some(item => item.paid > 0),
  };
}

// ── Search (admin/lib/clientSearch.ts) ──────────────────────────────────────────────────────────────────────
const digitsOf = value => foldText(value).replace(/\D/g, '');
function matchesSearch(query, fields) {
  const q = foldText(query);
  if (q.length < SEARCH_MIN_CHARS) return true;
  if ([fields.name, fields.email, fields.code].some(value => foldText(value).includes(q))) return true;
  const digits = q.replace(/\D/g, '');
  if (digits.length < 3 || digits.length !== q.replace(/[\s+\-()]/g, '').length) return false;
  const core = digits.replace(/^0+/, '') || digits;
  return [fields.phone, fields.nationalId, fields.code]
    .some(value => { const stored = digitsOf(value); return Boolean(stored) && (stored.includes(digits) || stored.includes(core)); });
}

// ── The view ─────────────────────────────────────────────────────────────────────────────────────────────────
const hasBooking = client => (client.paymentHistory || [])
  .some(payment => Boolean(payment.courseId || payment.bundleId) && payment.status !== 'refunded' && payment.status !== 'failed');
const holdsItem = (client, item) => (item.startsWith('bundle:')
  ? (client.enrolledBundleIds || []).includes(item.slice(7))
  : (client.enrolledCourseIds || []).includes(item))
  || (client.paymentHistory || []).some(payment => itemKeyOf(payment) === item);

function readFilters(query, { dokki = false } = {}) {
  const text = key => String(query[key] ?? '').trim();
  const view = (dokki ? DOKKI_VIEWS : VIEWS).includes(text('view')) ? text('view') : 'active';
  const follow = FOLLOW_FILTERS.includes(text('follow')) ? text('follow') : '';
  return {
    view, follow,
    branch: text('branch').slice(0, 40),
    q: text('q').slice(0, 100),
    from: DATE_ONLY.test(text('from')) ? text('from') : '',
    to: DATE_ONLY.test(text('to')) ? text('to') : '',
    course: text('course').slice(0, 80),
    collector: text('collector').slice(0, 80),
    status: text('status').slice(0, 40),
    cert: ['has_cert', 'no_cert'].includes(text('cert')) ? text('cert') : '',
    remaining: ['has_remaining', 'paid'].includes(text('remaining')) ? text('remaining') : '',
    // The Dokki screen's three: seated or not, in a round, with a reception's rounds.
    housing: dokki && ['housed', 'unhoused'].includes(text('housing')) ? text('housing') : '',
    round: dokki ? text('round').slice(0, 80) : '',
    reception: dokki ? text('reception').slice(0, 80) : '',
  };
}

/**
 * What the Dokki screen reads of the rounds, per client (OnlineClientsTab housingMap / housingNeeds / bookingYearsById,
 * daqqi/daqqiHousingNeeds.ts). `rounds`: [{ id, courseId, receptionId, finished, attendees: [{ subscriberId, bookedAt }] }]
 * in the order the schedule lists them (newest first).
 */
function dokkiRoundFacts(rounds) {
  // The round a client follows: the latest booking, a running round over a finished one (the first in the list on a tie).
  const chosen = new Map();
  const years = new Map();
  const seats = new Map();
  for (const round of rounds) {
    const live = !round.finished;
    for (const attendee of round.attendees || []) {
      const bookedAt = String(attendee.bookedAt || '');
      const held = chosen.get(attendee.subscriberId);
      if (!(held && ((held.live && !live) || (held.live === live && held.bookedAt >= bookedAt)))) {
        chosen.set(attendee.subscriberId, { roundId: round.id, receptionId: round.receptionId, bookedAt, live });
      }
      const year = Number(bookedAt.slice(0, 4));
      if (Number.isInteger(year) && year >= 1900) {
        if (!years.has(attendee.subscriberId)) years.set(attendee.subscriberId, new Set());
        years.get(attendee.subscriberId).add(year);
      }
      if (!seats.has(attendee.subscriberId)) seats.set(attendee.subscriberId, new Set());
      seats.get(attendee.subscriberId).add(round.courseId);
    }
  }
  return { chosen, years, seats, withRounds: [...new Set(rounds.map(round => round.courseId))] };
}

/**
 * `clients`: every client in the person's scope, as the list endpoint shapes them (payments, enrolments, plans).
 * Returns `ids` of the clients matching, newest first as given, with the tab counts, the follow-up chips and the
 * figures above the table — all over the same clients, as the screen worked them out of its loaded list.
 */
function buildView(clients, filters, { today, weekStart, monthStart, catalogue, allBranches, dokki }) {
  const inBranch = filters.branch ? clients.filter(client => branchMatchesFilter(client.branch, filters.branch)) : clients;
  // The Dokki screen holds the clients the branch owns and the ones with a course placed in it (holdsIn on the branch).
  const dokkiHere = dokki ? branch => normBranch(branch) === dokki.branch : null;
  const all = dokki
    ? inBranch.filter(client => dokkiHere(client.branch) || Object.values(client.coursePlacements || {}).some(dokkiHere))
    : (allBranches ? inBranch : inBranch.filter(holdsOnline));
  const rounds = dokki ? dokkiRoundFacts(dokki.rounds) : null;
  const bookedIn = (client, year) => {
    const booked = rounds.years.get(client.id);
    // A client in no round has no booking date: the year they registered stands in.
    return booked?.size ? booked.has(year) : Number(String(client.createdAt || '').slice(0, 4)) === year;
  };
  // Seated for every course of theirs that has a round (daqqiHousingNeeds.ts): { housed, missing } as sets of courses.
  const needOf = client => {
    const housed = rounds.seats.get(client.id) || new Set();
    const held = new Set(client.enrolledCourseIds || []);
    return { housed, missing: rounds.withRounds.filter(courseId => !housed.has(courseId) && held.has(courseId)) };
  };
  const facts = new Map();
  const factsOf = client => {
    if (!facts.has(client.id)) {
      const status = client.clientStatus || '';
      facts.set(client.id, {
        status, terminal: TERMINAL.includes(status), online: isOnlineClient(client), market: marketOf(client),
        follow: followUpOf(client, today), balance: balanceOf(client, catalogue), international: isInternational(client),
      });
    }
    return facts.get(client.id);
  };

  const live = client => client.isActive !== false && !factsOf(client).terminal;
  const marketTab = (client, market) => factsOf(client).online && factsOf(client).market === market;
  // «النشطين» at Dokki is the current clients: the ones before 2024 have their own tab and are not counted twice
  const tabCounts = dokki ? {
    active: all.filter(client => live(client) && !OLD_DATA_STATUSES.includes(factsOf(client).status)).length,
    finished: all.filter(client => factsOf(client).status === 'finished').length,
    paused: all.filter(client => factsOf(client).status === 'paused').length,
    refunded: all.filter(client => ['refunded', 'refund_pending'].includes(factsOf(client).status)).length,
    booked2024: all.filter(client => bookedIn(client, 2024)).length,
    booked2025: all.filter(client => bookedIn(client, 2025)).length,
    old_data: all.filter(client => OLD_DATA_STATUSES.includes(factsOf(client).status)).length,
  } : {
    // the clients with a tab of their own for their age (محلي قديم / سعودي قديم) are not counted twice
    active: all.filter(client => live(client) && !['old_local', 'old_intl'].includes(factsOf(client).status)).length,
    'real-local': 0, 'real-saudi': 0, 'real-intl': 0,
    finished: all.filter(client => factsOf(client).status === 'finished').length,
    paused: all.filter(client => factsOf(client).status === 'paused').length,
    refunded: all.filter(client => ['refunded', 'refund_pending'].includes(factsOf(client).status)).length,
    old_local: all.filter(client => !factsOf(client).international && factsOf(client).status === 'old_local').length,
    old_intl: all.filter(client => factsOf(client).international && factsOf(client).status === 'old_intl').length,
  };
  if (!dokki) for (const [tab, market] of Object.entries(MARKET_VIEWS)) {
    // The count on the tab asks for an open course; the list below also takes a booking that waits for approval.
    tabCounts[tab] = all.filter(client => marketTab(client, market) && live(client) && (client.enrolledCourseIds || []).length > 0).length;
  }

  const inView = client => {
    const { status, terminal } = factsOf(client);
    if (dokki) {
      switch (filters.view) {
        case 'active': return client.isActive !== false && !terminal && !OLD_DATA_STATUSES.includes(status);
        case 'booked2024': case 'booked2025': return bookedIn(client, BOOKING_YEAR_VIEWS[filters.view]);
        case 'refunded': return status === 'refunded' || status === 'refund_pending';
        case 'old_data': return OLD_DATA_STATUSES.includes(status);
        default: return status === filters.view;
      }
    }
    switch (filters.view) {
      case 'active': return client.isActive !== false && !terminal && !['old_local', 'old_intl'].includes(status);
      case 'real-local': case 'real-saudi': case 'real-intl':
        return marketTab(client, MARKET_VIEWS[filters.view]) && client.isActive !== false && !terminal
          && ((client.enrolledCourseIds || []).length > 0 || hasBooking(client));
      case 'refunded': return status === 'refunded' || status === 'refund_pending';
      case 'old_local': return !factsOf(client).international && status === 'old_local';
      case 'old_intl': return factsOf(client).international && status === 'old_intl';
      default: return status === filters.view;
    }
  };
  const matchesOthers = client => {
    if (!matchesSearch(filters.q, { name: client.name, phone: client.phone, email: client.email, code: client.clientCode, nationalId: client.nationalId })) return false;
    if (filters.from && cairoDay(client.createdAt) < filters.from) return false;
    if (filters.to && cairoDay(client.createdAt) > filters.to) return false;
    if (filters.course && !holdsItem(client, filters.course)) return false;
    if (filters.collector === NO_COLLECTOR) { if (client.assignedCsId) return false; }
    else if (filters.collector && client.assignedCsId !== filters.collector) return false;
    if (filters.status && (client.status || 'active') !== filters.status) return false;
    if (dokki) {
      // «مسكن» is seated for every course of theirs that has a round; «غير مسكن» is none, or one still missing.
      if (filters.housing) {
        const { housed, missing } = needOf(client);
        const fully = housed.size > 0 && missing.length === 0;
        if (filters.housing === 'housed' && !fully) return false;
        if (filters.housing === 'unhoused' && fully) return false;
      }
      if (filters.round && rounds.chosen.get(client.id)?.roundId !== filters.round) return false;
      if (filters.reception && rounds.chosen.get(client.id)?.receptionId !== filters.reception) return false;
    }
    if (filters.cert === 'has_cert' && (client.certificates || []).length === 0) return false;
    if (filters.cert === 'no_cert' && (client.certificates || []).length > 0) return false;
    if (filters.remaining === 'has_remaining' && factsOf(client).balance.remainingEgp <= 0) return false;
    if (filters.remaining === 'paid') {
      const balance = factsOf(client).balance;
      if (!(balance.items > 0 && balance.paidAnything && balance.remainingEgp <= 0)) return false;
    }
    return true;
  };

  const followCounts = { overdue: 0, today: 0, tomorrow: 0 };
  const matching = [];
  let unassignedMatching = 0;
  for (const client of all) {
    if (!inView(client) || !matchesOthers(client)) continue;
    const follow = factsOf(client).follow;
    if (follow in followCounts) followCounts[follow] += 1;
    if (matchesFollow(follow, filters.follow)) {
      matching.push(client.id);
      if (!client.assignedCsId) unassignedMatching += 1;
    }
  }

  let collectedToday = 0; let collectedWeek = 0; let collectedMonth = 0; let remaining = 0; let unassigned = 0;
  const markets = { local: 0, saudi: 0, intl: 0 };
  // The Dokki strip: how many, how many not finished, paused or refunded, the finished and the paused.
  const dokkiCounts = { active: 0, finished: 0, paused: 0 };
  const assignedCounts = {};
  for (const client of all) {
    const { online, market, balance, status, terminal } = factsOf(client);
    if (online) markets[market] += 1;
    if (!terminal && !OLD_DATA_STATUSES.includes(status)) dokkiCounts.active += 1;
    if (status === 'finished') dokkiCounts.finished += 1;
    if (status === 'paused') dokkiCounts.paused += 1;
    remaining += balance.remainingEgp;
    if (!client.assignedCsId) unassigned += 1;
    else assignedCounts[client.assignedCsId] = (assignedCounts[client.assignedCsId] || 0) + 1;
    for (const payment of client.paymentHistory || []) {
      if (!isCollected(payment)) continue;
      const day = cairoDay(payment.at);
      const amount = toEgp(payment.amount, payment.currency);
      if (day === today) collectedToday += amount;
      if (day >= weekStart) collectedWeek += amount;
      if (day >= monthStart) collectedMonth += amount;
    }
  }
  return {
    ids: matching, tabCounts, followCounts,
    figures: { total: all.length, ...markets, ...(dokki ? dokkiCounts : {}), today: collectedToday, week: collectedWeek, month: collectedMonth, remaining, unassigned },
    // The old-data distribution panel's: how many of the matching clients nobody holds, and how many each person holds.
    ...(dokki ? { unassignedMatching, assignedCounts } : {}),
  };
}

/**
 * The unpaid instalments that are due (on or before `today`) and the ones coming within `soonUntil`, over the
 * clients' plans — the online manager's badge and «متابعات التحصيل والأقساط» panel (admin/pages/dashboard/
 * DashboardOnlineManagerPanels.tsx). `plans`: [{ clientId, name, phone, plan }] with the plan as mapInstallmentPlan shapes it.
 */
function dueInstallments(plans, today, soonUntil) {
  const overdue = [];
  const upcoming = [];
  for (const { clientId, name, phone, plan } of plans) {
    for (const entry of plan.entries || []) {
      if (entry.paidAt || !entry.dueDate) continue;
      const row = { clientId, name, phone: phone || '', courseTitle: plan.courseTitle || '', amount: entry.amount, currency: entry.currency, dueDate: entry.dueDate };
      if (entry.dueDate <= today) overdue.push(row);
      else if (entry.dueDate <= soonUntil) upcoming.push(row);
    }
  }
  const byDate = (a, b) => a.dueDate.localeCompare(b.dueDate);
  return { overdue: overdue.sort(byDate), upcoming: upcoming.sort(byDate) };
}

module.exports = {
  NO_COLLECTOR, dueInstallments, VIEWS, balanceOf, branchMatchesFilter, buildView, cairoDay, followUpOf, holdsOnline, isCollected,
  isInternational, marketOf, matchesSearch, readFilters, toEgp,
};
