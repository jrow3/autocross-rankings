import { readPdfLines } from './pdf-lines.js';

// "Pos [Nbr] Name Class Number TotalTime Index IndexTime ..." — the Nbr column
// only exists in some years, and column x-positions shift between years, so
// rows are matched on their text instead of their position.
const ROW = /^(\d+)\s+(?:\d+\s+)?(\D.*?)\s+(\S+)\s+(\S+)\s+(\d+\.\d+)\s+(\d\.\d{3})\s+(\d+\.\d+)(?:\s|$)/;
const HEADER = /^(.*?)\s+(\d{2}\/\d{2}\/\d{4} - \d{2}\/\d{2}\/\d{4})$/;

export async function parseOverallPdf(bytes) {
  const texts = (await readPdfLines(bytes)).map(line => line.map(item => item.text).join(' '));
  const header = texts.slice(0, 4).map(text => text.match(HEADER)).find(Boolean);
  return {
    eventName: header?.[1] || null,
    eventDates: header?.[2] || null,
    rows: texts.map(parseRow).filter(Boolean),
  };
}

function parseRow(text) {
  const match = text.match(ROW);
  if (!match) return null;
  return {
    position: parseInt(match[1]),
    name: match[2],
    // "S3/SST" is ProSolo class / car's base class; the ProSolo class is the one raced.
    className: match[3].split('/')[0],
    carNumber: match[4],
    rawTime: parseFloat(match[5]),
    paxMultiplier: parseFloat(match[6]),
    paxTime: parseFloat(match[7]),
  };
}
