'use strict';

const { cairoToday } = require('./dates');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The lecture a Dokki round is on today, counted as the Dokki team's schedule
 * counts it (admin daqqiScheduleUtils.calcCurrentLecture): one session a week
 * from the start date, a postponed week not counted. 0 = it has not started.
 *
 * Read from the dates, not daqqi_rounds.current_lecture: nothing moves that
 * column on, and every open round on production read 1 on 8 Oct 2026, the
 * ones that began in August included.
 */
function lectureToday(startDate, postponedWeeks = [], today = cairoToday()) {
  const start = Date.parse(String(startDate || '').slice(0, 10));
  if (!Number.isFinite(start)) return 1;
  const days = Math.floor((Date.parse(today) - start) / DAY_MS);
  if (days < 0) return 0;
  return Math.max(1, Math.floor(days / 7) + 1 - (Array.isArray(postponedWeeks) ? postponedWeeks.length : 0));
}

/** The date of the round's next session — its start until it begins, then the next weekly slot. */
function nextSessionDate(startDate, today = cairoToday()) {
  const start = Date.parse(String(startDate || '').slice(0, 10));
  if (!Number.isFinite(start)) return null;
  const days = Math.floor((Date.parse(today) - start) / DAY_MS);
  if (days <= 0) return new Date(start).toISOString().slice(0, 10);
  const weeksAhead = days % 7 === 0 ? days / 7 : Math.floor(days / 7) + 1;
  return new Date(start + weeksAhead * 7 * DAY_MS).toISOString().slice(0, 10);
}

/** Monday of the week a date falls in — the key a postponed week is stored under. */
function weekMonday(dateOnly) {
  const at = Date.parse(dateOnly);
  if (!Number.isFinite(at)) return '';
  const weekday = new Date(at).getUTCDay();
  return new Date(at - ((weekday + 6) % 7) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The client's next session in a round: its date, stepping over a week the
 * desk postponed, and the lecture it will be — counted as lectureToday counts,
 * by the weeks postponed up to then. «كارت خطوتك الجاية» (11 Oct 2026).
 */
function nextHeldSession(startDate, postponedWeeks = [], today = cairoToday()) {
  let date = nextSessionDate(startDate, today);
  if (!date) return null;
  const postponed = new Set((Array.isArray(postponedWeeks) ? postponedWeeks : []).map(String));
  // A run of postponed weeks is a handful at most; the cap is only a guard.
  for (let step = 0; step < 52 && postponed.has(weekMonday(date)); step++) {
    date = new Date(Date.parse(date) + 7 * DAY_MS).toISOString().slice(0, 10);
  }
  const upToThen = [...postponed].filter(week => week <= date);
  return { date, lecture: Math.max(1, lectureToday(startDate, upToThen, date)) };
}

module.exports = { lectureToday, nextHeldSession, nextSessionDate, weekMonday };
