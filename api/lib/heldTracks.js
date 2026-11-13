'use strict';

// The tracks a client holds, for display and for the money lines that follow them — ONE function, read by the list rows and the client's page
// (lib/clientItems.js) and by the SQL balance the receipts and the student's page read (lib/agreedPrice.js itemBalances).
//
// The owner, 13 Nov 2026: «في عملاء بيظهرلهم أكتر من مسار. يعني لو عميل حاجز المعالج النفسي المحترف ليه يظهرله كمان مسار التشخيص الإكلينيكي والعلاج
// النفسي؟ مينفعش يظهر مسارين لنفس العميل، اختار المناسب لكورساته واعرضه. مينفعش تعرض جزء من الكل. إنما ممكن مثلاً السيلز يحجزه التشخيص والعلاج وبعدها
// يحجزه مسار تاني العلاج المتقدم — ده تمام، مسارين ولكن بيكملوا بعض. مينفعش بردو انت تروح محولهم لمسار العلاج الكامل».
//
//  1. A track the client was booked in (a payment, a price, money paid before the system, or the track on his enrolments) is a RECORDED track and is shown as
//     it was booked. A recorded track whose courses are all inside another recorded track is a part of it and is not shown beside it.
//  2. Two recorded tracks that complete each other (neither inside the other) are both shown.
//  3. Recorded tracks are never joined into a bigger one: A and B booked, covering every course of P, stay A and B. The old rule («every course of a track
//     held = the track») added a P line with the catalogue price on top of them.
//  4. Courses held that no recorded track covers take the track that fits them, biggest first, each course in one track only — a client enrolled course
//     by course (the sheet imports) is shown the track those courses make.

/**
 * @param {Map<string, string[]>} tracks  track id → its course ids, every track that may matter (the recorded ones and the candidates)
 * @param {Iterable<string>} recorded     track ids the client was booked in
 * @param {Iterable<string>} held         course ids the client holds
 * @returns {{ shown: string[], parts: Map<string, string>, derived: string[] }}
 *          shown: recorded tracks that are not part of another, parts: part id → the whole that shows it, derived: tracks the held courses make
 */
function heldTracks({ tracks, recorded, held }) {
  const courseSet = new Map();
  const coursesOf = id => {
    if (!courseSet.has(id)) courseSet.set(id, new Set((tracks.get(id) || []).map(String)));
    return courseSet.get(id);
  };
  const rec = [...new Set([...recorded].map(String))];
  const known = rec.filter(id => tracks.has(id) && coursesOf(id).size > 0);
  // A track nothing is known about (taken off the catalogue) cannot be compared: it is shown as it was booked.
  const unknown = rec.filter(id => !known.includes(id));

  // a is part of w: every course of a is in w, and w is the bigger one (or, the same courses twice, the one that sorts first).
  const partOfWhole = (a, w) => a !== w && [...coursesOf(a)].every(course => coursesOf(w).has(course))
    && (coursesOf(w).size > coursesOf(a).size || (coursesOf(w).size === coursesOf(a).size && w < a));
  const order = (x, y) => coursesOf(y).size - coursesOf(x).size || (x < y ? -1 : 1);
  const maximal = known.filter(id => !known.some(other => partOfWhole(id, other))).sort(order);
  const parts = new Map();
  for (const id of known) {
    if (maximal.includes(id)) continue;
    parts.set(id, maximal.find(whole => partOfWhole(id, whole)));
  }

  // The courses no recorded track covers make the track they fit, biggest first.
  const free = new Set([...held].map(String));
  for (const id of known) coursesOf(id).forEach(course => free.delete(course));
  const derived = [];
  const candidates = [...tracks.keys()].map(String).filter(id => !rec.includes(id) && coursesOf(id).size > 1).sort(order);
  for (const id of candidates) {
    if (![...coursesOf(id)].every(course => free.has(course))) continue;
    derived.push(id);
    coursesOf(id).forEach(course => free.delete(course));
  }
  return { shown: [...maximal, ...unknown], parts, derived };
}

module.exports = { heldTracks };
