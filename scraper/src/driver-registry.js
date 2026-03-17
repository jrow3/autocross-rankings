import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const EVENTS_DIR = join(DATA_DIR, 'events');
const REGISTRY_FILE = join(DATA_DIR, 'drivers.json');

// Normalize a driver name for matching
function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/['']/g, "'")
    .replace(/\bjr\.?\b/gi, '')
    .replace(/\bsr\.?\b/gi, '')
    .replace(/\biii\b/gi, '')
    .replace(/\bii\b/gi, '')
    .trim();
}

// Generate a stable driver ID from name
function makeDriverId(name) {
  return normalizeName(name)
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Build driver registry from all scraped events
function buildRegistry() {
  if (!existsSync(EVENTS_DIR)) {
    console.error('No events directory found. Scrape events first.');
    process.exit(1);
  }

  const eventFiles = readdirSync(EVENTS_DIR).filter(f => f.endsWith('.json'));
  console.log(`Processing ${eventFiles.length} event files...`);

  // Map: normalized name -> driver data
  const drivers = new Map();

  for (const file of eventFiles) {
    const event = JSON.parse(readFileSync(join(EVENTS_DIR, file), 'utf8'));

    for (const [className, classResults] of Object.entries(event.classResults || {})) {
      for (const result of classResults) {
        const normalName = normalizeName(result.name);
        const id = makeDriverId(result.name);

        if (!drivers.has(normalName)) {
          drivers.set(normalName, {
            id,
            name: result.name, // Use the first occurrence as canonical
            normalizedName: normalName,
            regions: new Set(),
            classes: new Set(),
            cars: new Set(),
            tires: new Set(),
            cities: new Set(),
            eventCount: 0,
            events: [],
          });
        }

        const driver = drivers.get(normalName);

        // Update with latest/best info
        if (result.region) driver.regions.add(result.region);
        if (className) driver.classes.add(className);
        if (result.car) driver.cars.add(result.car);
        if (result.tire) driver.tires.add(result.tire.trim());
        if (result.cityState) driver.cities.add(result.cityState);

        driver.events.push({
          eventCode: event.eventCode,
          eventName: event.eventName,
          eventDates: event.eventDates,
          eventType: event.eventType,
          className,
          position: result.position,
          paxTime: result.paxTime,
          trophy: result.trophy,
          carNumber: result.carNumber,
        });
        driver.eventCount++;
      }
    }
  }

  // Convert to serializable format
  const registry = {};
  for (const [, driver] of drivers) {
    registry[driver.id] = {
      ...driver,
      regions: [...driver.regions],
      classes: [...driver.classes],
      cars: [...driver.cars],
      tires: [...driver.tires],
      cities: [...driver.cities],
    };
  }

  writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
  console.log(`Registry built: ${Object.keys(registry).length} unique drivers`);
  return registry;
}

// Load existing registry
function loadRegistry() {
  if (!existsSync(REGISTRY_FILE)) return {};
  return JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'));
}

// Main
if (process.argv[1] && process.argv[1].includes('driver-registry')) {
  buildRegistry();
}

export { buildRegistry, loadRegistry, normalizeName, makeDriverId };
