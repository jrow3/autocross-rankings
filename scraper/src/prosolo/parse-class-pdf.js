import { readPdfLines, textBetween } from './pdf-lines.js';

// Column x-ranges of Pronto's "Official Class Results" layout (2013–2025).
const CLASS_RESULTS_COLUMNS = {
  // Right-aligned and shared with the trophy "T" marker.
  position: [0, 37],
  carNumber: [37, 58],
  name: [58, 145],
  car: [145, 248],
  tire: [248, 285],
  runs: [285, 530],
  // Index classes print the car's base class (e.g. "CSP") just right of the score.
  score: [530, 585],
};

// The "60Ft/RT" printout of the same results swaps car and tire for reaction
// times. Only needed when an event's class PDF is a scanned image.
const REACTION_TIME_COLUMNS = {
  position: [0, 37],
  carNumber: [37, 58],
  name: [58, 210],
  car: null,
  tire: null,
  runs: null,
  score: [530, 585],
};

// The 2026 Finale introduced a new Pronto layout: columns moved right, a region
// column was added, and the position prints on its own line under the name,
// so positions come from finishing order instead.
const CLASS_RESULTS_2026_COLUMNS = {
  position: null,
  carNumber: [45, 70],
  name: [70, 146],
  car: [146, 226],
  tire: [226, 272],
  runs: [310, 530],
  score: [530, 600],
};

function columnsFor(lines) {
  const hasHeader = text => lines.some(line => line.some(item => item.text.startsWith(text)));
  if (hasHeader('Driver / City')) return CLASS_RESULTS_2026_COLUMNS;
  if (hasHeader('Time (cone)')) return REACTION_TIME_COLUMNS;
  return CLASS_RESULTS_COLUMNS;
}

// Pronto truncates class names by print width.
const TRUNCATED_CLASS_NAMES = {
  'Street Touring Compac': 'Street Touring Compact',
  'Street Touring Roads': 'Street Touring Roadster',
  'Street Touring Roadste': 'Street Touring Roadster',
  'Street Touring Xtrem': 'Street Touring Xtreme',
  'Super Street Prepare': 'Super Street Prepared',
  'Classic American Mus': 'Classic American Muscle',
};

export async function parseClassPdf(bytes) {
  const lines = await readPdfLines(bytes);
  const columns = columnsFor(lines);
  const classes = [];
  let current = null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const classHeader = parseClassHeader(line);
    if (classHeader) {
      current = { ...classHeader, drivers: [], noTimeNames: [] };
      classes.push(current);
      continue;
    }
    if (!current) continue;
    if (isNoTimeLine(line, columns)) current.noTimeNames.push(textBetween(line, ...columns.name));
    if (!isDriverLine(line, columns)) continue;
    const detailLine = detailLineAfter(lines, index, columns);
    current.drivers.push(parseDriver({ line, detailLine }, current, columns));
  }

  return { ...parseHeader(lines), printedDate: printedDate(lines), classes };
}

// Every page footer reads "<M/D/YYYY> <time> Pronto Timing System Page N of M".
function printedDate(lines) {
  const footer = lines.find(line => line.some(item => item.text === 'Pronto Timing System'));
  return footer?.find(item => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(item.text))?.text;
}

function parseHeader(lines) {
  const texts = lines.slice(0, 4).map(line => line.map(item => item.text).join(' '));
  const titleIndex = texts.findIndex(text => text === 'Results') + 1;
  return { eventName: texts[titleIndex], eventDates: texts[titleIndex + 1] };
}

// The line with the driver's city and right-course runs: the next line that has
// text in the name column, before the next driver. In the 2026 layout a line
// holding only the trophy marker and position comes first.
function detailLineAfter(lines, index, columns) {
  for (const next of lines.slice(index + 1, index + 4)) {
    if (isDriverLine(next, columns) || parseClassHeader(next)) return [];
    if (textBetween(next, ...columns.name)) return next;
  }
  return [];
}

// "Super Street ... (SS) Drivers: 22" before 2026, "SS — Super Street Drivers: 23" after.
function parseClassHeader(line) {
  const text = line.map(item => item.text).join(' ');
  const counts = text.match(/Drivers:\s*(\d+)\s*Trophies:\s*(\d+)/);
  if (!counts) return null;
  const driversX = line.find(item => item.text.startsWith('Drivers:')).x;
  const label = textBetween(line, 0, driversX);
  const abbreviation = label.match(/\(([A-Z0-9]+)\)/)?.[1] || label.match(/^([A-Z0-9]+) — /)?.[1] || null;
  const rawName = label.replace(/\([A-Z0-9]+\)/, '').replace(/^[A-Z0-9]+ — /, '').trim();
  return {
    className: TRUNCATED_CLASS_NAMES[rawName] || rawName,
    abbreviation,
    driverCount: parseInt(counts[1]),
    trophyCount: parseInt(counts[2]),
  };
}

function positionOf(line, columns) {
  if (!columns.position) return null;
  const match = textBetween(line, ...columns.position).match(/(?:^|\s)(\d+)$/);
  return match ? parseInt(match[1]) : null;
}

// Index classes in the 60Ft/RT printout show "indexed [raw]", e.g. "44.938 [52.436]".
function isDriverLine(line, columns) {
  const isRanked = columns.position ? positionOf(line, columns) !== null : textBetween(line, ...columns.name) !== '';
  return isRanked && /^\d+\.\d+( \[\d+\.\d+\])?$/.test(textBetween(line, ...columns.score));
}

// Drivers without a result: "No Time" keeps a position, a DSQ prints none and
// scores "999 DSQ". Both count toward the class header's driver total.
function isNoTimeLine(line, columns) {
  return textBetween(line, ...columns.name) !== '' && /(No Time|DSQ)$/.test(textBetween(line, ...columns.score));
}

function parseDriver({ line, detailLine }, classInfo, columns) {
  const position = positionOf(line, columns) ?? classInfo.drivers.length + 1;
  const columnText = (row, range) => (range ? textBetween(row, ...range) : '');
  return {
    position,
    trophy: position <= classInfo.trophyCount,
    carNumber: columnText(line, columns.carNumber),
    // A co-driver's "[112]" car number sometimes runs into the name text.
    name: columnText(line, columns.name).replace(/^[\d[\]]+/, ''),
    car: columnText(line, columns.car),
    tire: columnText(line, columns.tire),
    className: classInfo.className,
    region: '',
    cityState: columnText(detailLine, columns.name).replace(/^,\s*$/, ''),
    paxTime: parseFloat(columnText(line, columns.score)),
    runs: {
      left: runsIn(line, columns.runs),
      right: runsIn(detailLine, columns.runs),
    },
  };
}

function runsIn(line, range) {
  if (!range) return [];
  return line.filter(item => item.x >= range[0] && item.x < range[1]).map(item => item.text);
}
