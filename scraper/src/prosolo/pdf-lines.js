import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Pronto prints a driver's left-course runs 1pt above the rest of the row and
// 2013 class names 3pt below their driver count;
// rows are 10pt+ apart, so items within this distance share a visual line.
const SAME_LINE_TOLERANCE = 4;

// Reads a PDF into visual lines, top to bottom across pages. Each line is a
// list of { x, text } items sorted left to right.
export async function readPdfLines(bytes) {
  const doc = await getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const lines = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const { items } = await page.getTextContent();
    lines.push(...groupIntoLines(items));
  }
  await doc.destroy();
  return lines;
}

function groupIntoLines(items) {
  const sorted = items
    .filter(item => item.str.trim())
    .map(item => ({ x: item.transform[4], y: item.transform[5], text: item.str.trim() }))
    .sort((a, b) => b.y - a.y);

  const lines = [];
  for (const item of sorted) {
    const line = lines.at(-1);
    if (line && line.y - item.y <= SAME_LINE_TOLERANCE) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  return lines.map(line => line.items.sort((a, b) => a.x - b.x));
}

export function textBetween(line, minX, maxX) {
  return line
    .filter(item => item.x >= minX && item.x < maxX)
    .map(item => item.text)
    .join(' ')
    .trim();
}
