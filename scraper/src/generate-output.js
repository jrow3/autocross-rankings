import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadRegistry, normalizeName } from './driver-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const EVENTS_DIR = join(DATA_DIR, 'events');
const SITE_DATA_DIR = join(__dirname, '..', '..', 'site', 'data');

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// Generate all output JSON files for the static frontend
async function generateOutput() {
  console.log('=== Generating frontend data ===\n');

  ensureDir(join(SITE_DATA_DIR, 'drivers'));
  ensureDir(join(SITE_DATA_DIR, 'events'));

  // 1. Copy rankings.json
  const rankingsFile = join(DATA_DIR, 'rankings.json');
  if (!existsSync(rankingsFile)) {
    console.error('No rankings.json found. Run rank-algorithm first.');
    process.exit(1);
  }

  const rankings = JSON.parse(readFileSync(rankingsFile, 'utf8'));
  // nationalsWins will be added after building driver histories below

  // 2. Generate per-driver detail files
  const registry = loadRegistry();
  const eventFiles = readdirSync(EVENTS_DIR).filter(f => f.endsWith('.json'));
  const allEvents = eventFiles.map(f => JSON.parse(readFileSync(join(EVENTS_DIR, f), 'utf8')));

  // Build driver event histories
  const driverHistories = new Map();

  for (const event of allEvents) {
    // From class results
    for (const [className, classResults] of Object.entries(event.classResults || {})) {
      for (const result of classResults) {
        const normalName = normalizeName(result.name);
        if (!driverHistories.has(normalName)) {
          driverHistories.set(normalName, []);
        }
        driverHistories.get(normalName).push({
          eventCode: event.eventCode,
          eventName: event.eventName,
          eventDates: event.eventDates,
          eventType: event.eventType,
          className,
          position: result.position,
          totalInClass: classResults.length,
          paxTime: result.paxTime,
          trophy: result.trophy,
          car: result.car,
          carNumber: result.carNumber,
          tire: result.tire,
          runs: result.runs,
        });
      }
    }

    // From PAX index
    if (event.paxIndex?.overall) {
      for (const result of event.paxIndex.overall) {
        const normalName = normalizeName(result.name);
        if (!driverHistories.has(normalName)) {
          driverHistories.set(normalName, []);
        }
        // Add PAX overall position if not already tracked
        const existing = driverHistories.get(normalName);
        const eventEntry = existing.find(e => e.eventCode === event.eventCode);
        if (eventEntry) {
          eventEntry.paxOverallPosition = result.position;
          eventEntry.paxOverallTotal = event.paxIndex.overall.length;
        }
      }
    }
  }

  // Enrich rankings with nationalsWins count
  for (const ranked of rankings) {
    const history = driverHistories.get(ranked.driverName) || [];
    ranked.nationalsWins = history.filter(h => h.eventType === 'nationals' && h.position === 1 && h.trophy).length;
  }
  writeFileSync(join(SITE_DATA_DIR, 'rankings.json'), JSON.stringify(rankings));
  console.log(`Wrote rankings.json (${rankings.length} drivers)`);

  // Write per-driver files
  let driverFileCount = 0;
  for (const ranked of rankings) {
    const history = driverHistories.get(ranked.driverName) || [];
    const regEntry = Object.values(registry).find(d => d.normalizedName === ranked.driverName);

    const driverData = {
      ...ranked,
      regions: regEntry?.regions || [],
      cars: regEntry?.cars || [],
      tires: regEntry?.tires || [],
      cities: regEntry?.cities || [],
      history: history.sort((a, b) => {
        // Sort by date descending - parse actual dates from strings
        const parseDate = (str) => {
          if (!str) return new Date(0);
          const match = str.match(/((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i);
          if (match) return new Date(match[1]);
          const slashMatch = str.match(/(\d{2}\/\d{2}\/\d{4})/);
          if (slashMatch) return new Date(slashMatch[1]);
          return new Date(0);
        };
        return parseDate(b.eventDates) - parseDate(a.eventDates);
      }),
    };

    writeFileSync(
      join(SITE_DATA_DIR, 'drivers', `${ranked.driverId}.json`),
      JSON.stringify(driverData)
    );
    driverFileCount++;
  }
  console.log(`Generated ${driverFileCount} driver detail files`);

  // 3. Generate per-event summary files
  let eventFileCount = 0;
  for (const event of allEvents) {
    const eventSummary = {
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventDates: event.eventDates,
      eventType: event.eventType,
      totalDrivers: event.totalDrivers,
      classes: event.classes,
      paxIndex: event.paxIndex?.overall?.slice(0, 100) || [], // Top 100 PAX
      classResults: {},
    };

    // Slim down class results (remove run details for size)
    for (const [cls, results] of Object.entries(event.classResults || {})) {
      eventSummary.classResults[cls] = results.map(r => ({
        position: r.position,
        name: r.name,
        car: r.car,
        carNumber: r.carNumber,
        paxTime: r.paxTime,
        trophy: r.trophy,
      }));
    }

    writeFileSync(
      join(SITE_DATA_DIR, 'events', `${event.eventCode}.json`),
      JSON.stringify(eventSummary)
    );
    eventFileCount++;
  }
  console.log(`Generated ${eventFileCount} event files`);

  // 4. Generate meta.json
  // Calculate total pairwise comparisons (n choose 2 per class per event)
  let totalComparisons = 0;
  for (const event of allEvents) {
    for (const [, classResults] of Object.entries(event.classResults || {})) {
      const n = classResults.length;
      totalComparisons += (n * (n - 1)) / 2;
    }
    if (event.paxIndex?.overall) {
      const n = event.paxIndex.overall.length;
      totalComparisons += (n * (n - 1)) / 2;
    }
  }

  const meta = {
    lastUpdated: new Date().toISOString(),
    totalDrivers: rankings.length,
    totalEvents: allEvents.length,
    totalComparisons,
    totalClasses: [...new Set(allEvents.flatMap(e => e.classes || []))].length,
    events: allEvents.map(e => ({
      eventCode: e.eventCode,
      eventName: e.eventName,
      eventDates: e.eventDates,
      eventType: e.eventType,
      totalDrivers: e.totalDrivers,
    })).sort((a, b) => (b.eventDates || '').localeCompare(a.eventDates || '')),
  };

  writeFileSync(join(SITE_DATA_DIR, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log('Generated meta.json');

  console.log('\nDone! Frontend data is ready in site/data/');
}

// Main
generateOutput().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
