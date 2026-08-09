'use strict';
// ── Free-preview gate for public lecture listings ────────────────────────────
// Course video is the asset the whole subscription protects, so deciding whether
// an anonymous caller may see a lecture's real video_url is a security decision.
// It lives here, alone, with no database or Express dependency, so it can be
// unit-tested directly and so there is exactly one implementation of the rule.
//
// The rule: a lecture's URL is public only when it is explicitly flagged as a
// preview, or when its rank *inside its own course* falls within the tenant's
// free allowance.
//
// How this broke: the rank used to be the row's index in the HTTP response.
// `GET /api/lectures` is public and paginated, so that counter restarted at 0 on
// every page, and the default allowance is one free lecture per course. That made
// `GET /api/lectures?limit=1&offset=N` return lecture N+1 at "rank 0" — the real
// video_url of a paid lecture, to a caller with no token at all. Walking `offset`
// dumped the entire catalogue. The rank must therefore come from the database,
// which is what courseRankSql() below is for: a window function is unaffected by
// LIMIT/OFFSET, because it is evaluated before the page window is applied.

// The one definition of "rank within the course", as SQL.
//
// Both public lecture queries call this rather than spelling out the window
// function, so they cannot drift apart: if the two routes ranked differently, a
// lecture could be free on one and paid on the other, and the free answer is the
// one an attacker would use. `- 1` makes it 0-based so it can be compared
// directly against the allowance (1 free lecture ⇒ ranks [0, 1)).
//
// ORDER BY includes id as a tiebreak because sort_order is not unique: without
// it, two lectures sharing a sort_order get an arbitrary rank each, so which one
// is "free" could change between identical requests.
function courseRankSql(alias = 'l') {
  return `ROW_NUMBER() OVER (PARTITION BY ${alias}.course_id `
       + `ORDER BY ${alias}.sort_order ASC, ${alias}.id ASC) - 1`;
}

// Coerce a value to a non-negative integer, or NaN if it is not one.
//
// Number() is deliberately NOT the gate. It maps far too many "there is no value
// here" inputs onto 0, and 0 is precisely the rank that IS free:
//   Number(null) === 0   Number('') === 0   Number('   ') === 0
//   Number([]) === 0     Number(false) === 0
// Any of those arriving here means the query did not produce a rank for the row.
// Treating that as "rank 0" would hand out the paid URL — the original leak,
// reached from a different direction. Negative and fractional values are refused
// for the same reason: ROW_NUMBER cannot produce them, so their presence means
// something upstream is wrong, and the safe answer to "is this free?" is no.
//
// Digit strings are accepted because mysql2 can return BIGINT as a string
// depending on driver configuration.
function rankOf(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? value : Number.NaN;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return Number.NaN;
}

// Is this lecture's video_url safe to hand to an anonymous caller?
// Fails closed: anything not positively verified as free is not free.
function isFreePreview({ isPreview, rank, previewLimit }) {
  if (isPreview === true) return true;
  const position = rankOf(rank);
  const allowance = rankOf(previewLimit);
  if (Number.isNaN(position) || Number.isNaN(allowance)) return false;
  return position < allowance;
}

// Apply the gate to an already-mapped lecture. Returns a new object — the caller
// may be handing us a cached row, and blanking a URL in place would poison the
// cache for every subsequent reader, including authorised ones.
function applyPreviewGate(lecture, rank, previewLimit) {
  const free = isFreePreview({ isPreview: lecture.isPreview, rank, previewLimit });
  return free ? { ...lecture } : { ...lecture, videoUrl: '' };
}

module.exports = { courseRankSql, rankOf, isFreePreview, applyPreviewGate };
