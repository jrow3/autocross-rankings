import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const EVENTS_DIR = join(DATA_DIR, 'events');
const REGISTRY_FILE = join(DATA_DIR, 'drivers.json');

// ============================================================
// Nickname / variant mapping
// Maps informal first names to their canonical (formal) form.
// When two names differ only by a known nickname, they merge.
// ============================================================
const NICKNAME_MAP = {
  mike: 'michael', mick: 'michael', mikey: 'michael',
  rob: 'robert', bob: 'robert', bobby: 'robert', robbie: 'robert',
  bill: 'william', will: 'william', willy: 'william', billy: 'william', liam: 'william',
  dan: 'daniel', danny: 'daniel',
  dave: 'david',
  jim: 'james', jimmy: 'james', jamie: 'james',
  tom: 'thomas', tommy: 'thomas',
  joe: 'joseph', joey: 'joseph',
  jon: 'jonathan', jonny: 'jonathan', johnny: 'jonathan',
  ben: 'benjamin', benny: 'benjamin',
  matt: 'matthew', matty: 'matthew',
  greg: 'gregory',
  ron: 'ronald', ronny: 'ronald', ronnie: 'ronald',
  tony: 'anthony',
  chris: 'christopher',
  steve: 'steven', stephen: 'steven',
  rick: 'richard', rich: 'richard', dick: 'richard',
  ed: 'edward', eddie: 'edward', ted: 'edward',
  al: 'albert', bert: 'albert',
  alex: 'alexander',
  andy: 'andrew', drew: 'andrew',
  jeff: 'jeffrey',
  josh: 'joshua',
  nick: 'nicholas',
  pat: 'patrick',
  pete: 'peter',
  sam: 'samuel',
  tim: 'timothy', timmy: 'timothy',
  ken: 'kenneth', kenny: 'kenneth',
  larry: 'lawrence',
  jerry: 'gerald',
  terry: 'terrence', terri: 'terrence',
  charlie: 'charles', chuck: 'charles',
  fred: 'frederick', freddy: 'frederick',
  ray: 'raymond',
  denny: 'dennis',
  doug: 'douglas',
  phil: 'phillip',
  hank: 'henry',
  liz: 'elizabeth', beth: 'elizabeth',
  kate: 'katherine', kathy: 'katherine', cathy: 'katherine',
  sue: 'susan', suzy: 'susan',
  meg: 'margaret', maggie: 'margaret', peggy: 'margaret',
  jen: 'jennifer', jenny: 'jennifer',
  michele: 'michelle',
};

// ============================================================
// Manual alias table for confirmed duplicates
// Maps alternate spellings/typos to their canonical name.
// Key = normalized alternate name, Value = normalized canonical name.
// ============================================================
const MANUAL_ALIASES = {
  // Typos / spelling variants
  'micahel meyers': 'michael meyers',
  'bryan wells': 'brian wells',
  // Spacing / punctuation variants
  'g.h. sharp': 'g h sharp',
  'mark vandecarr': 'mark van de carr',
  // Middle initial inconsistencies (confirmed same person)
  'berry a langley': 'berry langley',
  'eric d jones': 'eric jones',
};

// ============================================================
// Suffix-aware name normalization
//
// Strategy:
//   1. Strip suffixes (Jr, Sr, II, III, IV) for base matching
//   2. If BOTH "Name Jr" and "Name Sr" exist in the dataset,
//      keep them separate (father/son)
//   3. If only one suffix variant exists, merge with the base name
//
// This is handled in two passes:
//   Pass 1: normalizeName() strips suffixes for initial grouping
//   Pass 2: detectSuffixCollisions() identifies pairs that must stay separate
// ============================================================

// Extract suffix from raw name (returns { base, suffix })
function extractSuffix(name) {
  const suffixMatch = name.match(/\b(jr\.?|sr\.?|iii|ii|iv)\s*$/i);
  if (suffixMatch) {
    const suffix = suffixMatch[1].replace('.', '').toLowerCase();
    const base = name.slice(0, suffixMatch.index).trim();
    return { base, suffix };
  }
  return { base: name, suffix: null };
}

// Canonicalize a first name through the nickname map
function canonicalizeFirstName(firstName) {
  const lower = firstName.toLowerCase();
  return NICKNAME_MAP[lower] || lower;
}

// Normalize a driver name for matching
// Handles: case, whitespace, apostrophes, suffixes, nicknames, punctuation
function normalizeName(name) {
  let normalized = name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/['']/g, "'")
    .replace(/\./g, ' ')       // G.H. Sharp → G H Sharp
    .replace(/\s+/g, ' ')
    .trim();

  // Strip suffixes (will be handled by suffix collision detection)
  normalized = normalized
    .replace(/\s+(jr|sr|iii|ii|iv)\s*$/i, '')
    .trim();

  // Apply nickname canonicalization to first name
  const parts = normalized.split(' ');
  if (parts.length >= 2) {
    parts[0] = canonicalizeFirstName(parts[0]);
    normalized = parts.join(' ');
  }

  // Apply manual aliases
  if (MANUAL_ALIASES[normalized]) {
    normalized = MANUAL_ALIASES[normalized];
  }

  return normalized;
}

// Generate a stable driver ID from name
function makeDriverId(name) {
  return normalizeName(name)
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Detect suffix collisions (e.g., both "Brian Tefft Jr" and "Brian Tefft Sr" exist)
// Returns a Set of raw names that should keep their suffix in the normalized form
function detectSuffixCollisions(allNames) {
  // Group by base name (without suffix)
  const suffixGroups = new Map(); // baseName -> Set of suffixes found

  for (const rawName of allNames) {
    const { base, suffix } = extractSuffix(rawName);
    if (!suffix) continue;

    const normalBase = normalizeName(base);
    if (!suffixGroups.has(normalBase)) {
      suffixGroups.set(normalBase, new Set());
    }
    suffixGroups.get(normalBase).add(suffix);
  }

  // Find bases that have multiple different suffixes (jr AND sr, etc.)
  const collisionBases = new Set();
  for (const [base, suffixes] of suffixGroups) {
    if (suffixes.size > 1) {
      collisionBases.add(base);
    }
  }

  return collisionBases;
}

// Full normalization with suffix collision awareness
function normalizeNameWithSuffix(rawName, collisionBases) {
  const { base, suffix } = extractSuffix(rawName);
  const normalBase = normalizeName(base);

  // If this base name has a collision (e.g., both Jr and Sr exist),
  // keep the suffix to distinguish them
  if (suffix && collisionBases.has(normalBase)) {
    return `${normalBase} ${suffix.replace('.', '')}`;
  }

  // Otherwise, just use the base (suffix is stripped)
  return normalBase;
}

// Build driver registry from all scraped events
function buildRegistry() {
  if (!existsSync(EVENTS_DIR)) {
    console.error('No events directory found. Scrape events first.');
    process.exit(1);
  }

  const eventFiles = readdirSync(EVENTS_DIR).filter(f => f.endsWith('.json'));
  console.log(`Processing ${eventFiles.length} event files...`);

  // Pass 1: Collect all raw driver names to detect suffix collisions
  const allRawNames = new Set();
  const events = [];
  for (const file of eventFiles) {
    const event = JSON.parse(readFileSync(join(EVENTS_DIR, file), 'utf8'));
    events.push(event);
    for (const classResults of Object.values(event.classResults || {})) {
      for (const result of classResults) {
        allRawNames.add(result.name);
      }
    }
  }

  // Detect which base names have suffix collisions (father/son pairs)
  const collisionBases = detectSuffixCollisions(allRawNames);
  if (collisionBases.size > 0) {
    console.log(`Suffix collisions detected (keeping separate): ${[...collisionBases].join(', ')}`);
  }

  // Pass 2: Build registry with collision-aware normalization
  const drivers = new Map();
  let mergeCount = 0;

  for (const event of events) {
    for (const [className, classResults] of Object.entries(event.classResults || {})) {
      for (const result of classResults) {
        const normalName = normalizeNameWithSuffix(result.name, collisionBases);
        const id = normalName.replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

        if (!drivers.has(normalName)) {
          drivers.set(normalName, {
            id,
            name: result.name,
            normalizedName: normalName,
            regions: new Set(),
            classes: new Set(),
            cars: new Set(),
            tires: new Set(),
            cities: new Set(),
            eventCount: 0,
            events: [],
          });
        } else {
          // Track merges: if raw name differs from stored canonical, we merged
          const existing = drivers.get(normalName);
          if (existing.name !== result.name) {
            // Keep the more common spelling as canonical (longer name = more formal)
            if (result.name.length > existing.name.length) {
              existing.name = result.name;
            }
          }
        }

        const driver = drivers.get(normalName);

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
  console.log(`(merged from ${allRawNames.size} raw name variants)`);
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
