// Cross-checks a parsed ProSolo event against the totals Pronto printed, so a
// parser that silently drops or merges rows fails instead of skewing ratings.
export function reconcileEvent(event, classPdf) {
  const problems = [];

  const classPdfClasses = event.source === 'scca-prosolo-pdf' ? classPdf.classes : [];
  for (const parsed of classPdfClasses) {
    const parsedCount = parsed.drivers.length + parsed.noTimeNames.length;
    if (parsedCount !== parsed.driverCount) {
      problems.push(`${parsed.className}: parsed ${parsedCount} drivers, header says ${parsed.driverCount}`);
    }
  }

  const classNames = new Set(Object.values(event.classResults).flat().map(d => d.name));
  const missing = event.paxIndex.overall.filter(row => !classNames.has(row.name)).map(row => row.name);
  if (missing.length) problems.push(`overall index names missing from class results: ${missing.join(', ')}`);

  if (!event.classes.length) problems.push('no classes parsed');

  if (problems.length) throw new Error(`${event.eventCode} failed reconciliation:\n    ${problems.join('\n    ')}`);
}
