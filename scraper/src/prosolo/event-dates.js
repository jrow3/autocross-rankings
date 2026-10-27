const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Pronto headers print dates as "08/29/2025 - 08/31/2025", "Apr 13-14, 2013"
// or "March 31 - April 2, 2017". rank-algorithm's parseEventDate only reads
// MM/DD/YYYY or full month names, so everything becomes "MM/DD/YYYY - MM/DD/YYYY".
// A few headers are missing or mistyped ("Mat 21 - 23", "12016", the 2015
// Finale dated 2016); those fall back to the date Pronto printed the results,
// usually the last day.
export function normalizeEventDates(text, printedDate) {
  const parsed = parseHeaderDates(text || '');
  const printed = printedDate?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (parsed && (!printed || parsed.slice(6, 10) === printed[3])) return parsed;
  if (!printed) throw new Error(`Unrecognized ProSolo date: "${text}"`);
  const date = format(printed[1], printed[2], printed[3]);
  return `${date} - ${date}`;
}

function parseHeaderDates(text) {
  if (/^\d{2}\/\d{2}\/\d{4}/.test(text)) return text;

  const year = text.match(/\b(\d{4})$/)?.[1];
  const parts = [...text.matchAll(/([A-Za-z]{3,})\.?\s+(\d{1,2})|\b(\d{1,2})\b(?!\d)/g)]
    .map(match => ({ month: match[1] && monthNumber(match[1]), day: parseInt(match[2] || match[3]) }))
    .filter(part => part.day <= 31);
  const start = parts[0];
  if (!year || !start?.month) return null;

  const end = parts[1] || start;
  return `${format(start.month, start.day, year)} - ${format(end.month || start.month, end.day, year)}`;
}

function monthNumber(word) {
  const index = MONTHS.indexOf(word.slice(0, 3).toLowerCase());
  return index >= 0 ? index + 1 : null;
}

function format(month, day, year) {
  return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`;
}
