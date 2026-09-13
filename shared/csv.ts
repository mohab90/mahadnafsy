/**
 * One CSV writer for both apps.
 *
 * Fifteen screens had built their own. They all remembered the BOM — Excel
 * reads a UTF-8 file as Windows-1252 without one, and Arabic opens as
 * mojibake, so that failure is loud enough that it got fixed everywhere.
 *
 * Quoting is the quiet one, and two of the fifteen skipped it: the client
 * database export and the commissions export dropped their values straight
 * into the line. The institute's fields are free text — a course list, a
 * staff note like «اتفقنا على 3 أقساط, الأول في سبتمبر», a name written
 * «أحمد "أبو مازن"». Any of those opens an extra column, and every heading
 * after it in that row is then wrong. Nothing warns you; the file just says
 * something else than the screen did.
 *
 * The quoting rule is RFC 4180: quote a field that contains a comma, a quote,
 * a newline or edge whitespace, and double any quote inside it. Quoting every
 * field is also valid — the other thirteen did that — but it makes the file
 * unreadable in a text editor, which is how the desk checks an export before
 * sending it on.
 */

export type CsvValue = string | number | boolean | null | undefined;

/** One field, quoted only when it has to be. */
export function csvField(value: CsvValue): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (!/[",\n\r]/.test(text) && text.trim() === text) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Rows to a CSV body, without the BOM.
 *
 * CRLF because that is what RFC 4180 says and what Excel on Windows expects;
 * a lone \n makes older Excel put the whole file on one line.
 */
export function toCsv(rows: CsvValue[][]): string {
  return rows.map(row => row.map(csvField).join(',')).join('\r\n');
}

/** The mark that tells Excel the file is UTF-8. Without it, Arabic is mojibake. */
export const CSV_BOM = '﻿';

/**
 * Which character separates the columns.
 *
 * Counted on the header line only, and only outside quotes — a header is short
 * and never has an embedded newline, and a quoted heading containing a comma
 * would otherwise elect the comma. Ties go to the comma, which is what the
 * exports here write.
 */
export function detectCsvDelimiter(headerLine: string): string {
  const line = headerLine.charCodeAt(0) === 0xfeff ? headerLine.slice(1) : headerLine;
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { index++; continue; }
      quoted = !quoted;
      continue;
    }
    if (!quoted && char in counts) counts[char] += 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

/**
 * Read a CSV back — the other half of the round trip.
 *
 * The three import screens each split on '\n' and then on their delimiter,
 * which cannot read what this module writes: a comma inside a quoted note
 * opened an extra column, a doubled quote «""» toggled twice and vanished, and
 * a note with a newline in it became two half rows. Exporting the client
 * database and importing it back was enough to corrupt it.
 *
 * The delimiter is a parameter because the institute's own sheets are not all
 * commas: Excel on an Arabic or European locale writes ';', and a sheet pasted
 * out of Google Sheets uses tabs. detectCsvDelimiter reads it off the header.
 *
 * Unquoted fields are trimmed, which is what the import screens have always
 * done; a quoted field is kept exactly as written, because the quotes are how
 * the writer says the whitespace was meant.
 */
export function parseCsvRows(text: string, delimiter = ','): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
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
  if (field !== '' || row.length > 0) endRow();

  return rows.filter(cells => cells.some(cell => cell !== ''));
}

/**
 * Hand the browser a finished CSV body — for the two reports that are several
 * tables stacked in one file and so cannot be expressed as one row list.
 *
 * The object URL is revoked on the next tick rather than immediately: Safari
 * has not started the download when click() returns, and revoking first leaves
 * the user with an empty file.
 */
export function downloadCsvText(filename: string, csv: string): void {
  const name = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  const blob = new Blob([CSV_BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The usual case: rows in, file out. */
export function downloadCsv(filename: string, rows: CsvValue[][]): void {
  downloadCsvText(filename, toCsv(rows));
}
