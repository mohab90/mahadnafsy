'use strict';

// What one client holds and owes, item by item — the ONE rule (8 Nov 2026: «محتاجين نوصل لتوحيد مصدر البيانات المحاسبية ونتأكد إن كلها متطابقة»).
//
// It was written three times: in the browser (admin/lib/agreedPrice.ts), for the staff lists' filters (lib/staffClientsView.js) and as SQL
// (lib/agreedPrice.js itemBalances). The browser copy is gone; every list row now carries `moneyItems`, the output of this function on the row's own data,
// and GET /api/admin/clients/:id/money (lib/clientMoney.js) is the same function on the client's freshly loaded data — so a table, the client's page and the
// dialog cannot say two things. itemBalances stays for the writers (receipts, instalments, collections) and a test (tests/integration/oneMoneyParity) and the
// nightly check hold it to this function on the same clients.
//
// The rule per item (a course id, or `bundle:<id>` for a track): the client's own price (client_item_money), else the highest price a booking recorded —
// never below what was paid for it — else the catalogue (lib/agreedPrice.js resolveAgreedDetail). A track is paid once (which tracks a client holds: lib/heldTracks.js, 13 Nov 2026 — a booked track is shown as booked, never beside a bigger one that contains it): a client who holds the courses of it
// holds the track, and a course inside a held track is not a debt of its own — what was paid for it counts toward the track, in the same currency.
// A certificate, a carnet, a book is its own service and never the course's money.

const { resolveAgreedDetail } = require('./agreedPrice');
const { heldTracks } = require('./heldTracks');

const itemKeyOf = payment => (payment.bundleId ? `bundle:${payment.bundleId}` : (payment.courseId || ''));
const isCollected = payment => !payment?.status || payment.status === 'paid';
// A row typed «other» that names a course or track is old course money; one typed «bundle» is a track's (payment proofs and instalments for a track).
const isCoursePayment = payment => !payment.paymentType || payment.paymentType === 'course' || payment.paymentType === 'bundle'
  || (payment.paymentType === 'other' && Boolean(payment.courseId || payment.bundleId));
// The catalogue's price in the item's own currency, 0 when it has none: a pound price is never shown as riyals (lib/catalogPrice.js says the same).
const catalogueIn = (price, currency) => Number((price || {})[currency]) || 0;
const cents = value => Math.round((Number(value) || 0) * 100);
const fromCents = value => value / 100;

function paidFor(client, item, currency) {
  return fromCents((client.paymentHistory || [])
    .filter(payment => isCollected(payment) && isCoursePayment(payment) && itemKeyOf(payment) === item && (!currency || payment.currency === currency))
    .reduce((sum, payment) => sum + cents(payment.amount), 0));
}

function pendingFor(client, item, currency) {
  return fromCents((client.paymentHistory || [])
    .filter(payment => payment.status === 'pending' && isCoursePayment(payment) && itemKeyOf(payment) === item && (!currency || payment.currency === currency))
    .reduce((sum, payment) => sum + cents(payment.amount), 0));
}

/** The price agreed for one item and where it came from — lib/agreedPrice.js resolveAgreedDetail on this client's own figures. */
function agreedPriceDetail(client, item, catalogue, currency) {
  const booked = (client.paymentHistory || [])
    // Only the item's own money: a certificate or a carnet names the course too and its price is not the course's.
    .filter(payment => (isCollected(payment) || payment.status === 'pending') && isCoursePayment(payment) && itemKeyOf(payment) === item && (!currency || payment.currency === currency))
    .reduce((max, payment) => Math.max(max, Number(payment.courseExpected) || 0), 0);
  return resolveAgreedDetail({ custom: client.customPrices?.[item], booked, paid: paidFor(client, item, currency), catalogue });
}

/**
 * @param client    { paymentHistory, customPrices, priorPaid, enrolledCourseIds, enrolledBundleIds } — as a list row or a freshly loaded client carries them
 * @param catalogue { courses: Map(id → {price, title}), bundles: Map(id → {price, title, courseIds}) }
 * @returns [{ item, title, isTrack, courseIds (of a track), currency, catalogue, expected, source, paid, priorPaid, pending, remaining }] — `paid` is the money recorded here plus
 *          `priorPaid` («مدفوع قبل السيستم»); `expected` is the agreed price, 0 when there is none.
 */
function clientItems(client, catalogue, fallbackCurrency = 'EGP') {
  const keys = new Set();
  (client.paymentHistory || []).forEach(payment => {
    const item = itemKeyOf(payment);
    if (item && isCoursePayment(payment)) keys.add(item);
  });
  Object.keys(client.customPrices || {}).forEach(item => { if (!item.startsWith('multi:')) keys.add(item); });
  // A track the client was enrolled in is the track, even when no payment or saved price names it.
  (client.enrolledBundleIds || []).forEach(id => { if (id) keys.add(`bundle:${id}`); });
  // «مدفوع قبل السيستم» names its course: the money is the evidence. A course inside a held track is kept here too, its row folded into the track below.
  Object.entries(client.priorPaid || {}).forEach(([item, amount]) => {
    if (item && Number(amount) > 0 && !item.startsWith('multi:')) keys.add(item);
  });
  // The tracks he was booked in are shown as booked, a part never beside its whole, and the courses no booked track covers make the track that fits
  // them (lib/heldTracks.js — the owner's rule of 13 Nov 2026).
  const tracksById = new Map([...catalogue.bundles].map(([id, bundle]) => [String(id), bundle?.courseIds || []]));
  const { parts, derived } = heldTracks({
    tracks: tracksById,
    recorded: [...keys].filter(item => item.startsWith('bundle:')).map(item => item.slice(7)),
    held: client.enrolledCourseIds || [],
  });
  derived.forEach(id => keys.add(`bundle:${id}`));
  const inTracks = new Set([...keys].filter(item => item.startsWith('bundle:'))
    .flatMap(item => catalogue.bundles.get(item.slice(7))?.courseIds || []));
  (client.enrolledCourseIds || []).forEach(id => { if (id && !inTracks.has(id)) keys.add(id); });

  const partOf = item => (parts.has(item.slice(7)) ? `bundle:${parts.get(item.slice(7))}` : null);
  const built = [...keys].map(item => {
    const isTrack = item.startsWith('bundle:');
    const entry = isTrack ? catalogue.bundles.get(item.slice(7)) : catalogue.courses.get(item);
    // The first payment of the item's own money names its currency (a certificate or a carnet in riyals does not turn a course into one).
    const named = (client.paymentHistory || []).find(payment => isCoursePayment(payment) && itemKeyOf(payment) === item);
    const currency = named?.currency || fallbackCurrency;
    const listed = catalogueIn(entry?.price, currency);
    const agreed = agreedPriceDetail(client, item, listed, currency);
    const priorPaid = Number(client.priorPaid?.[item]) || 0;
    return {
      item, title: entry?.title || item, isTrack, partOf: isTrack ? partOf(item) : null, courseIds: isTrack ? (entry?.courseIds || []) : [], currency, fromPayment: Boolean(named), catalogue: listed, expected: agreed.price || 0, source: agreed.source,
      paidHere: paidFor(client, item, currency), priorPaid, pending: pendingFor(client, item, currency),
    };
  });

  // A course inside a track the client holds is not an item of its own — its price is the track's — and what was paid for it counts toward the track,
  // in the same currency only.
  const trackOf = new Map();
  for (const row of built) {
    if (!row.isTrack || row.partOf) continue;
    for (const courseId of catalogue.bundles.get(row.item.slice(7))?.courseIds || []) if (!trackOf.has(courseId)) trackOf.set(courseId, row.item);
  }
  const carried = new Map();
  const shown = built.filter(row => {
    // A part of a track he holds is not a track of its own beside it. It is kept only when it carries money (a booking, a price, a payment, money paid before the
    // system): that money is his and stays where it was recorded, with the whole it belongs to named, so no balance moves. One with none is a line nobody booked.
    if (row.partOf && !(row.fromPayment || row.source === 'client' || row.priorPaid > 0)) return false;
    const track = row.isTrack ? undefined : trackOf.get(row.item);
    if (!track) return true;
    const owner = built.find(candidate => candidate.item === track);
    // what was paid for it in the track's currency, or money that names no payment (paid before the system), counts toward the track
    if (owner && (!row.fromPayment || owner.currency === row.currency)) {
      const entry = carried.get(track) || { paidHere: 0, priorPaid: 0, pending: 0 };
      entry.paidHere += cents(row.paidHere); entry.priorPaid += cents(row.priorPaid); entry.pending += cents(row.pending);
      carried.set(track, entry);
    }
    return false;
  });
  return shown.map(row => {
    const extra = carried.get(row.item) || { paidHere: 0, priorPaid: 0, pending: 0 };
    const paidHere = cents(row.paidHere) + extra.paidHere;
    const priorPaid = cents(row.priorPaid) + extra.priorPaid;
    const paid = paidHere + priorPaid;
    return {
      item: row.item, title: row.title, isTrack: row.isTrack, partOf: row.partOf || null, courseIds: row.courseIds, currency: row.currency, catalogue: row.catalogue, expected: row.expected, source: row.source,
      paid: fromCents(paid), priorPaid: fromCents(priorPaid), pending: fromCents(cents(row.pending) + extra.pending),
      remaining: fromCents(Math.max(0, cents(row.expected) - paid)),
    };
  });
}

module.exports = { agreedPriceDetail, catalogueIn, clientItems, isCollected, isCoursePayment, itemKeyOf, paidFor, pendingFor };
