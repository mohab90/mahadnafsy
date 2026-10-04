'use strict';

// ── CSV (the same reading as shared/csv.ts) ──────────────────────────────────
function detectDelimiter(headerLine) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const char of String(headerLine || '').replace(/^\uFEFF/, '')) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char in counts) counts[char] += 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

function parseCsv(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(source.split(/\r?\n/)[0]);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let wasQuoted = false;
  const endField = () => { row.push(wasQuoted ? field : field.trim()); field = ''; wasQuoted = false; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char !== '"') { field += char; continue; }
      if (source[index + 1] === '"') { field += '"'; index++; continue; }
      quoted = false;
      continue;
    }
    if (char === '"' && field.trim() === '') { quoted = true; wasQuoted = true; field = ''; continue; }
    if (char === delimiter) { endField(); continue; }
    if (char === '\r') { if (source[index + 1] === '\n') index++; endRow(); continue; }
    if (char === '\n') { endRow(); continue; }
    field += char;
  }
  if (field !== '' || row.length) endRow();
  return rows.filter(cells => cells.some(cell => cell !== ''));
}

module.exports = { detectDelimiter, parseCsv };
