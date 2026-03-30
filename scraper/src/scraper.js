import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import https from 'https';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data', 'events');
const KNOWN_EVENTS_FILE = join(__dirname, '..', 'data', 'known-events.json');

const VAULT_BASE = 'https://vault.autocrossdigits.com';
const SOLOLIVE_BASE = 'https://sololive.scca.com';

// Vault has an SSL cert issue, so we use a custom agent only for Vault requests
const vaultAgent = new https.Agent({ rejectUnauthorized: false });

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// Normalize event name to Title-Case for consistent event codes.
// The Vault sometimes changes casing between scrapes (e.g., "red hills" vs "Red Hills"),
// which on case-sensitive filesystems (Linux CI) creates duplicate files.
function normalizeEventName(name) {
  return name.replace(/\b\w/g, c => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Shared fetch with retry
// ---------------------------------------------------------------------------

async function fetchHTML(url, retries = 3, timeout = 30000, agent = null) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'AutocrossRankings/1.0 (research)' },
        timeout,
        ...(agent ? { agent } : {}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === retries - 1) throw e;
      console.log(`  Retry ${i + 1} for ${url}: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

// ===========================================================================
// VAULT: Discovery + Class Results + PAX Overall
// ===========================================================================

// Discover all events for given years from the Vault
async function discoverEvents(years = (() => { const currentYear = new Date().getFullYear(); return Array.from({length: currentYear - 1995 + 2}, (_, i) => 1995 + i); })()) {
  const allEvents = [];

  for (const year of years) {
    console.log(`Discovering ${year} events...`);
    let html;
    try {
      html = await fetchHTML(`${VAULT_BASE}/year/${year}/`, 3, 30000, vaultAgent);
    } catch (e) {
      console.log(`  No data for ${year} (${e.message}), skipping`);
      continue;
    }
    const $ = cheerio.load(html);

    $('a').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim();
      // Event links: /event/EVENT+NAME/ or ?event=EVENT+NAME (support both old and new format)
      const match = href.match(/\/event\/([^/]+)\/?/) || href.match(/\?event=(.+)/);
      if (match && text) {
        const eventName = decodeURIComponent(match[1].replace(/\+/g, ' '));
        const type = eventName.toLowerCase().includes('nationals') ? 'nationals' : 'tour';
        if (!allEvents.find(e => e.name === eventName)) {
          allEvents.push({ name: eventName, type, year });
        }
      }
    });

    await new Promise(r => setTimeout(r, 500));
  }

  return allEvents;
}

// Get list of classes for an event from the Vault
async function getEventClasses(eventName) {
  // Support both old (?event=) and new (/event/) URL formats
  const encodedName = encodeURIComponent(eventName).replace(/%20/g, '+');
  const url = `${VAULT_BASE}/event/${encodedName}/`;
  console.log(`  Fetching event classes: ${eventName}`);
  const html = await fetchHTML(url, 3, 30000, vaultAgent);
  const $ = cheerio.load(html);

  const classes = [];
  let eventDates = '';

  // Extract dates from h3 or other header elements
  $('h3, h4, .event-dates').each((_, el) => {
    const text = $(el).text().trim();
    if (text.match(/\d{4}/) && (text.match(/[A-Z][a-z]+\s+\d/) || text.match(/\d{2}\/\d{2}/))) {
      eventDates = text;
    }
  });

  // Class links: support both /eventresults/EVENT|CLASS/ and ?eventresults=EVENT|CLASS formats
  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    // New format: /eventresults/EVENT+NAME|CLASS+NAME/
    const matchNew = href.match(/\/eventresults\/([^|]+)\|([^/]+)\/?/);
    // Old format: ?eventresults=EVENT_NAME|CLASS_NAME
    const matchOld = href.match(/\?eventresults=([^|]+)\|(.+)/);
    const match = matchNew || matchOld;
    if (match) {
      const className = decodeURIComponent(match[2].replace(/\+/g, ' ').replace(/\/$/, ''));
      if (!classes.includes(className)) classes.push(className);
    }
  });

  // PAX results links: support both formats
  let hasPax = false;
  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href.includes('type/pax') || href.includes('type=pax')) hasPax = true;
  });

  return { classes, eventDates, hasPax };
}

// Parse class results from Vault HTML
function parseVaultClassResults(html, className) {
  const $ = cheerio.load(html);
  const results = [];

  // Vault uses pairs of rows: main row (trophy, pos, number, name, car, tire, region, time)
  // then info row (empty, empty, [alt number], city/state, sponsor, empty, division, diff)
  const rows = $('table.results tbody tr').toArray();

  for (let i = 0; i < rows.length - 1; i += 2) {
    const mainRow = $(rows[i]);
    const infoRow = $(rows[i + 1]);

    const mainCells = mainRow.find('td').toArray();
    const infoCells = infoRow.find('td').toArray();

    if (mainCells.length < 8) continue;

    const trophy = $(mainCells[0]).text().trim();
    const position = parseInt($(mainCells[1]).text().trim()) || 0;
    const carNumber = $(mainCells[2]).text().trim();
    const name = $(mainCells[3]).text().trim();
    const car = $(mainCells[4]).text().trim();
    const tire = $(mainCells[5]).text().trim();
    const region = $(mainCells[6]).text().trim();
    const time = parseFloat($(mainCells[7]).text().trim()) || 0;

    if (!name || position === 0) continue;

    // Info row
    const cityState = infoCells[3] ? $(infoCells[3]).text().trim() : '';
    const sponsor = infoCells[4] ? $(infoCells[4]).text().trim() : '';
    const division = infoCells[6] ? $(infoCells[6]).text().trim() : '';

    results.push({
      position,
      trophy: trophy === 'T' ? true : trophy === 'M' ? 'masters' : false,
      carNumber,
      name,
      car,
      tire,
      className,
      region,
      cityState,
      sponsor,
      division,
      paxTime: time,
    });
  }

  return results;
}

// Parse PAX overall results from Vault
function parseVaultPaxResults(html) {
  const $ = cheerio.load(html);
  const results = [];

  // PAX table: 9 cols: empty, rank, name, class, category, rawTime, multiplier, paxTime, diff
  const rows = $('table tbody tr').toArray();
  for (const row of rows) {
    const cells = $(row).find('td').toArray();
    if (cells.length < 8) continue;

    const position = parseInt($(cells[1]).text().trim()) || 0;
    if (!position) continue;

    results.push({
      position,
      name: $(cells[2]).text().trim(),
      className: $(cells[3]).text().trim(),
      category: $(cells[4]).text().trim(),
      rawTime: parseFloat($(cells[5]).text().trim()) || 0,
      paxMultiplier: parseFloat($(cells[6]).text().trim()) || 0,
      paxTime: parseFloat($(cells[7]).text().trim()) || 0,
    });
  }

  return results;
}

// ===========================================================================
// SOLOLIVE: Day-by-day PAX index (supplementary)
// ===========================================================================

// Known National Tour location codes for SoloLive
const TOUR_LOCATION_CODES = [
  { code: 'PHXNT',  keywords: ['phoenix'] },
  { code: 'RHNT',   keywords: ['red hills', 'redhills'] },
  { code: 'STXNT',  keywords: ['south texas', 'stx'] },
  { code: 'CHRNT',  keywords: ['charlotte'] },
  { code: 'CLNT',   keywords: ['crows landing', 'crowslanding'] },
  { code: 'LNKNT',  keywords: ['lincoln'] },
  { code: 'BRKNT',  keywords: ['brunswick'] },
  { code: 'CLVNT',  keywords: ['cleveland'] },
  { code: 'BRNT',   keywords: ['bristol'] },
  { code: 'PKNT',   keywords: ['packwood'] },
  { code: 'CHINT',  keywords: ['chicago'] },
  { code: 'ROMNT',  keywords: ['romulus'] },
  { code: 'GRSNT',  keywords: ['grissom'] },
  { code: 'FLNT',   keywords: ['finger lakes'] },
  { code: 'DETNT',  keywords: ['detroit'] },
];

// Build list of expected SoloLive event codes by year (for probing)
function generateExpectedEventCodes(years = (() => { const currentYear = new Date().getFullYear(); return Array.from({length: currentYear - 2021 + 2}, (_, i) => 2021 + i); })()) {
  const codes = [];

  for (const year of years) {
    const yy = String(year).slice(-2);

    for (const loc of TOUR_LOCATION_CODES) {
      codes.push({
        code: `${yy}${loc.code}`,
        type: 'tour',
        year,
        location: loc.code.replace('NT', ''),
      });
    }

    codes.push({
      code: `${yy}NATSGEN`,
      type: 'nationals',
      year,
      location: 'Lincoln',
    });
  }

  return codes;
}

// Check which SoloLive event codes actually exist (parallel batches)
async function probeEvents(codes) {
  const existing = [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < codes.length; i += BATCH_SIZE) {
    const batch = codes.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (event) => {
        const url = `${SOLOLIVE_BASE}/${event.code}/index.php`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        try {
          const res = await fetch(url, {
            method: 'HEAD',
            headers: { 'User-Agent': 'AutocrossRankings/1.0 (research)' },
            redirect: 'follow',
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (res.ok) {
            console.log(`  Found SoloLive event: ${event.code}`);
            return event;
          }
        } catch (e) {
          clearTimeout(timer);
        }
        return null;
      })
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) existing.push(r.value);
    }
  }

  return existing;
}

// Map a Vault event name + year to a SoloLive event code (best-effort)
function mapVaultEventToSoloLiveCode(eventName, year) {
  if (year < 2021) return null;

  const yy = String(year).slice(-2);
  const lower = eventName.toLowerCase();

  // Nationals -> YYNATSGEN
  if (lower.includes('nationals')) {
    return `${yy}NATSGEN`;
  }

  // Try to match tour by location keywords
  for (const loc of TOUR_LOCATION_CODES) {
    for (const kw of loc.keywords) {
      if (lower.includes(kw)) {
        return `${yy}${loc.code}`;
      }
    }
  }

  return null;
}

// Parse the SoloLive PAX Index page (Day1, Day2, or Overall)
async function parseSoloLivePaxIndex(eventCode, dayOrOverall = 'Overall') {
  const filename = `PaxIndex${dayOrOverall}.html`;
  const url = `${SOLOLIVE_BASE}/${eventCode}/${filename}`;
  console.log(`  Fetching SoloLive PAX index: ${url}`);

  let html;
  try {
    html = await fetchHTML(url, 2, 10000);
  } catch (e) {
    console.warn(`    Could not fetch SoloLive PAX index (${dayOrOverall}): ${e.message}`);
    return [];
  }

  const $ = cheerio.load(html);
  const results = [];

  $('table#tbl01 tr').each((_, row) => {
    const cells = $(row).find('td').toArray();
    if (cells.length < 7) return;

    const position = parseInt($(cells[0]).text().trim());
    if (isNaN(position)) return;

    results.push({
      position,
      className: $(cells[1]).text().trim(),
      indexClass: $(cells[2]).text().trim(),
      carNumber: $(cells[3]).text().trim(),
      name: $(cells[4]).text().trim(),
      car: $(cells[5]).text().trim(),
      paxTime: parseFloat($(cells[6]).text().trim()) || 0,
    });
  });

  return results;
}

// Parse a run time string like "45.553", "48.305(1)", or strikethrough
function parseRunTime(text, isBest, isStrikethrough) {
  const match = text.match(/^(\d+\.\d+)(?:\((\d+)\))?$/);
  if (!match) return { raw: text, time: 0, cones: 0, best: isBest, dnf: text.includes('DNF') || isStrikethrough };

  const baseTime = parseFloat(match[1]);
  const cones = match[2] ? parseInt(match[2]) : 0;

  return {
    raw: text,
    time: baseTime,
    cones,
    best: isBest,
    dnf: isStrikethrough,
    adjusted: baseTime + (cones * 2), // 2 second cone penalty
  };
}

// ===========================================================================
// Combined scrape: Vault primary + SoloLive day supplement
// ===========================================================================

async function scrapeEvent(eventName, eventType = 'tour', eventYear = null) {
  console.log(`\n=== Scraping: ${eventName} ===`);

  // Determine year from event name if not provided
  if (!eventYear) {
    const yearMatch = eventName.match(/(20\d{2})/);
    eventYear = yearMatch ? parseInt(yearMatch[1]) : null;
  }

  // --- Vault: class results + PAX overall ---
  const { classes, eventDates, hasPax } = await getEventClasses(eventName);
  console.log(`  Dates: ${eventDates}`);
  console.log(`  Classes: ${classes.length} found`);

  const classResults = {};
  const allResults = [];

  for (const cls of classes) {
    const encodedEvent = encodeURIComponent(eventName).replace(/%20/g, '+');
    const encodedCls = encodeURIComponent(cls).replace(/%20/g, '+');
    const url = `${VAULT_BASE}/eventresults/${encodedEvent}|${encodedCls}/`;
    console.log(`  Scraping ${cls}...`);

    try {
      const html = await fetchHTML(url, 3, 30000, vaultAgent);
      const results = parseVaultClassResults(html, cls);
      classResults[cls] = results;
      allResults.push(...results);
      console.log(`    ${results.length} drivers`);
    } catch (e) {
      console.warn(`    Error: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 300));
  }

  // Get PAX overall from Vault
  let paxOverall = [];
  if (hasPax) {
    try {
      const paxEncodedName = encodeURIComponent(eventName).replace(/%20/g, '+');
      const paxUrl = `${VAULT_BASE}/eventresults/${paxEncodedName}/type/pax/`;
      console.log(`  Scraping Vault PAX index...`);
      const html = await fetchHTML(paxUrl, 3, 30000, vaultAgent);
      paxOverall = parseVaultPaxResults(html);
      console.log(`    ${paxOverall.length} PAX entries`);
    } catch (e) {
      console.warn(`    PAX error: ${e.message}`);
    }
  }

  // --- SoloLive: day-by-day PAX supplement (2021+ only) ---
  let paxDay1 = [];
  let paxDay2 = [];

  if (eventYear && eventYear >= 2021) {
    const soloLiveCode = mapVaultEventToSoloLiveCode(eventName, eventYear);
    if (soloLiveCode) {
      console.log(`  Attempting SoloLive day data (code: ${soloLiveCode})...`);

      // Quick probe to see if the event exists on SoloLive
      let soloLiveExists = false;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${SOLOLIVE_BASE}/${soloLiveCode}/index.php`, {
          method: 'HEAD',
          headers: { 'User-Agent': 'AutocrossRankings/1.0 (research)' },
          redirect: 'follow',
          signal: controller.signal,
        });
        clearTimeout(timer);
        soloLiveExists = res.ok;
      } catch (e) {
        // SoloLive not available for this event
      }

      if (soloLiveExists) {
        paxDay1 = await parseSoloLivePaxIndex(soloLiveCode, 'Day1');
        paxDay2 = await parseSoloLivePaxIndex(soloLiveCode, 'Day2');
        if (paxDay1.length) console.log(`    SoloLive Day1: ${paxDay1.length} PAX entries`);
        if (paxDay2.length) console.log(`    SoloLive Day2: ${paxDay2.length} PAX entries`);
        if (!paxDay1.length && !paxDay2.length) {
          console.log(`    SoloLive event found but no day PAX data available`);
        }
      } else {
        console.log(`    SoloLive event not found, skipping day data`);
      }
    } else {
      console.log(`  Could not map event to SoloLive code, skipping day data`);
    }
  }

  // --- Build output ---
  const eventCode = normalizeEventName(eventName).replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');

  const paxIndex = { overall: paxOverall };
  if (paxDay1.length) paxIndex.day1 = paxDay1;
  if (paxDay2.length) paxIndex.day2 = paxDay2;

  const eventData = {
    eventCode,
    eventName: normalizeEventName(eventName),
    eventDates,
    eventType,
    source: 'vault.autocrossdigits.com',
    scrapedAt: new Date().toISOString(),
    totalDrivers: allResults.length || paxOverall.length,
    classes: Object.keys(classResults),
    classResults,
    paxIndex,
  };

  ensureDir(DATA_DIR);
  const outFile = join(DATA_DIR, `${eventCode}.json`);
  writeFileSync(outFile, JSON.stringify(eventData, null, 2));
  console.log(`  Saved ${allResults.length} results to ${eventCode}.json`);

  return eventData;
}

// ===========================================================================
// CLI
// ===========================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === 'discover') {
    const years = args[1] ? args[1].split(',').map(Number) : (() => { const currentYear = new Date().getFullYear(); return Array.from({length: currentYear - 1995 + 2}, (_, i) => 1995 + i); })();
    const events = await discoverEvents(years);
    console.log(`\nFound ${events.length} events:`);
    events.forEach(e => console.log(`  ${e.name} (${e.type}, ${e.year})`));

    ensureDir(join(__dirname, '..', 'data'));
    writeFileSync(KNOWN_EVENTS_FILE, JSON.stringify(events, null, 2));
    console.log(`Saved to ${KNOWN_EVENTS_FILE}`);

  } else if (args[0] === 'event') {
    const eventName = args.slice(1).join(' ');
    if (!eventName) {
      console.error('Usage: node scraper.js event <EVENT NAME>');
      process.exit(1);
    }
    await scrapeEvent(eventName);

  } else if (args[0] === 'all') {
    if (!existsSync(KNOWN_EVENTS_FILE)) {
      console.error('No known events file. Run "discover" first.');
      process.exit(1);
    }
    const events = JSON.parse(readFileSync(KNOWN_EVENTS_FILE, 'utf8'));
    console.log(`Scraping ${events.length} events...`);

    let scraped = 0, skipped = 0, failed = 0;
    for (const event of events) {
      const eventCode = normalizeEventName(event.name).replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
      const outFile = join(DATA_DIR, `${eventCode}.json`);
      if (existsSync(outFile)) {
        console.log(`Skipping ${event.name} (already scraped)`);
        skipped++;
        continue;
      }
      try {
        await scrapeEvent(event.name, event.type, event.year);
        scraped++;
      } catch (e) {
        console.error(`Failed: ${event.name}: ${e.message}`);
        failed++;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    console.log(`\nDone: ${scraped} scraped, ${skipped} skipped, ${failed} failed`);

  } else {
    console.log('Usage:');
    console.log('  node scraper.js discover [years]   - Find all events (e.g., discover 2021,2022)');
    console.log('  node scraper.js event <NAME>       - Scrape a specific event');
    console.log('  node scraper.js all                - Scrape all known events');
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});

export {
  scrapeEvent,
  discoverEvents,
  parseVaultClassResults,
  parseVaultPaxResults,
  parseSoloLivePaxIndex,
  parseRunTime,
  generateExpectedEventCodes,
  probeEvents,
  mapVaultEventToSoloLiveCode,
};
