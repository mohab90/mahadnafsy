'use strict';

function safeIsoString(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('0000-00-00')) return '';
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}

function safeDateOnly(value) {
  return safeIsoString(value).slice(0, 10);
}

module.exports = { safeIsoString, safeDateOnly };
