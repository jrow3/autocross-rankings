import { normalizeEventDates } from './event-dates.js';
import { cleanDriverName } from './driver-names.js';

// Turns a parsed class PDF and (optional) overall-index PDF into the event JSON
// shape the Vault scraper writes. The class PDF is preferred; the overall index
// stands in when the class PDF is a scanned image or SCCA linked another
// event's file (their dates disagree).
export function buildEvent({ classPdf, overall, sources }) {
  const classDates = classPdf.classes.length
    ? normalizeEventDates(classPdf.eventDates, classPdf.printedDate)
    : null;
  const isClassPdfUsable = classDates && (!overall?.eventDates || overall.eventDates === classDates);
  if (!isClassPdfUsable && !overall?.rows.length) throw new Error('class PDF unreadable and no overall index');

  const cleanRows = (overall?.rows || []).map(row => ({ ...row, name: cleanDriverName(row.name) }));
  const overallRows = isClassPdfUsable ? withoutNoTimeDrivers(cleanRows, classPdf) : cleanRows;
  const classes = isClassPdfUsable ? classesFromClassPdf(classPdf, overallRows) : classesFromOverall(overallRows);
  const eventDates = isClassPdfUsable ? classDates : overall.eventDates;
  const eventName = withYearOf(eventDates, titleCase(isClassPdfUsable ? classPdf.eventName : overall.eventName));
  const allDrivers = classes.flatMap(c => c.drivers);
  const classNameByAbbreviation = Object.fromEntries(
    classPdf.classes.filter(c => c.abbreviation).map(c => [c.abbreviation, c.className])
  );

  return {
    eventCode: eventName.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-'),
    eventName,
    eventDates,
    eventType: 'prosolo',
    source: isClassPdfUsable ? 'scca-prosolo-pdf' : 'scca-prosolo-overall-index',
    sources,
    scrapedAt: new Date().toISOString(),
    isIndexedScore: !isClassPdfUsable || isIndexedScore(overallRows, allDrivers),
    totalDrivers: allDrivers.length,
    classes: classes.map(c => c.className),
    classResults: Object.fromEntries(classes.map(c => [c.className, c.drivers])),
    paxIndex: {
      overall: overallRows.map(row => ({ ...row, className: classNameByAbbreviation[row.className] || row.className })),
    },
  };
}

// Same rule as scraper.js so codes stay stable on case-sensitive filesystems.
function titleCase(name) {
  return name.replace(/\b\w/g, c => c.toUpperCase());
}

// A protest DSQ shows in the official class results but not always in the
// overall index; the class results win.
function withoutNoTimeDrivers(rows, classPdf) {
  const noTimeNames = classPdf.classes.flatMap(c => c.noTimeNames).map(cleanDriverName);
  return rows.filter(row => !noTimeNames.some(name => row.name.startsWith(name)));
}

// The 2016 Finale's header was left reading "2015 Tire Rack Finale ProSolo",
// and some headers carry a timing-crew prefix ("ACTIVE 2026 ...", "PRO-2020 ...").
function withYearOf(eventDates, eventName) {
  return eventName.replace(/^[A-Za-z]+[-\s]+(?=\d{4}\b)/, '').replace(/^\d{4}\b/, eventDates.slice(6, 10));
}

function classesFromClassPdf(classPdf, overallRows) {
  for (const driver of classPdf.classes.flatMap(c => c.drivers)) {
    driver.name = fullName({ ...driver, name: cleanDriverName(driver.name) }, overallRows);
  }
  return classPdf.classes;
}

// The class PDF cuts long names at a fixed print width (12–20 characters);
// the overall index prints them whole. Car number separates father and son
// ("Jeremy Fenstermaker Sr/Jr" both print as "Jeremy Fenstermake").
function fullName(driver, overallRows) {
  if (overallRows.some(row => row.name === driver.name)) return driver.name;
  const candidates = overallRows.filter(row => row.name.startsWith(driver.name));
  const sameCar = candidates.filter(row => row.carNumber === driver.carNumber);
  if (candidates.length === 1) return candidates[0].name;
  return sameCar.length === 1 ? sameCar[0].name : driver.name;
}

function classesFromOverall(rows) {
  const byClass = new Map();
  for (const row of rows) {
    if (!byClass.has(row.className)) byClass.set(row.className, []);
    const drivers = byClass.get(row.className);
    drivers.push({
      position: drivers.length + 1,
      trophy: false,
      carNumber: row.carNumber,
      name: row.name,
      car: '',
      tire: '',
      className: row.className,
      region: '',
      cityState: '',
      paxTime: row.paxTime,
    });
  }
  return [...byClass].map(([className, drivers]) => ({ className, drivers }));
}

// Recent ProSolos score every class on index time; older ones on raw time.
function isIndexedScore(overallRows, drivers) {
  const winner = overallRows[0];
  const classRow = winner && drivers.find(driver => driver.name === winner.name);
  return Boolean(classRow) && Math.abs(classRow.paxTime - winner.paxTime) < 0.001;
}
