import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data', 'events');
const KNOWN_EVENTS_FILE = join(__dirname, '..', 'data', 'known-events.json');
const BASE_URL = 'https://vault.autocrossdigits.com';

// Vault has an SSL cert issue, so we need to disable verification
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

async function fetchHTML(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'AutocrossRankings/1.0 (research)' },
        timeout: 30000,
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

// Discover all events for given years from the Vault
async function discoverEvents(years = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]) {
  const allEvents = [];

  for (const year of years) {
    console.log(`Discovering ${year} events...`);
    const html = await fetchHTML(`${BASE_URL}/?year=${year}`);
    const $ = cheerio.load(html);

    $('a').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim();
      // Event links look like: ?event=2025 Red Hills National Tour
      const match = href.match(/\?event=(.+)/);
      if (match && text) {
        const eventName = decodeURIComponent(match[1].replace(/\+/g, ' '));
        const type = eventName.toLowerCase().includes('nationals') ? 'nationals' : 'tour';
        allEvents.push({ name: eventName, type, year });
      }
    });

    await new Promise(r => setTimeout(r, 500));
  }

  return allEvents;
}

// Get list of classes for an event
async function getEventClasses(eventName) {
  const url = `${BASE_URL}/?event=${encodeURIComponent(eventName)}`;
  console.log(`  Fetching event classes: ${eventName}`);
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const classes = [];
  let eventDates = '';

  // Extract dates from h3
  $('h3').each((_, el) => {
    const text = $(el).text().trim();
    if (text.match(/\d{4}/)) eventDates = text;
  });

  // Class links look like: ?eventresults=EVENT_NAME|CLASS_NAME
  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/\?eventresults=([^|]+)\|(.+)/);
    if (match) {
      const className = decodeURIComponent(match[2].replace(/\+/g, ' '));
      if (!classes.includes(className)) classes.push(className);
    }
  });

  // Also check for PAX results links
  let hasPax = false;
  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href.includes('type=pax')) hasPax = true;
  });

  return { classes, eventDates, hasPax };
}

// Parse class results from Vault HTML
function parseClassResults(html, className) {
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

// Parse PAX overall results
function parsePaxResults(html) {
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

// Scrape a full event from the Vault
async function scrapeEvent(eventName, eventType = 'tour') {
  console.log(`\n=== Scraping: ${eventName} ===`);

  const { classes, eventDates, hasPax } = await getEventClasses(eventName);
  console.log(`  Dates: ${eventDates}`);
  console.log(`  Classes: ${classes.length} found`);

  const classResults = {};
  const allResults = [];

  for (const cls of classes) {
    const url = `${BASE_URL}/?eventresults=${encodeURIComponent(eventName)}|${encodeURIComponent(cls)}`;
    console.log(`  Scraping ${cls}...`);

    try {
      const html = await fetchHTML(url);
      const results = parseClassResults(html, cls);
      classResults[cls] = results;
      allResults.push(...results);
      console.log(`    ${results.length} drivers`);
    } catch (e) {
      console.warn(`    Error: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 300));
  }

  // Get PAX overall if available
  let paxOverall = [];
  if (hasPax) {
    try {
      const paxUrl = `${BASE_URL}/?eventresults=${encodeURIComponent(eventName)}&type=pax`;
      console.log(`  Scraping PAX index...`);
      const html = await fetchHTML(paxUrl);
      paxOverall = parsePaxResults(html);
      console.log(`    ${paxOverall.length} PAX entries`);
    } catch (e) {
      console.warn(`    PAX error: ${e.message}`);
    }
  }

  // Generate a code from the event name for file naming
  const eventCode = eventName.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');

  const eventData = {
    eventCode,
    eventName,
    eventDates,
    eventType,
    source: 'vault.autocrossdigits.com',
    scrapedAt: new Date().toISOString(),
    totalDrivers: allResults.length,
    classes: Object.keys(classResults),
    classResults,
    paxIndex: {
      overall: paxOverall,
    },
  };

  ensureDir(DATA_DIR);
  const outFile = join(DATA_DIR, `${eventCode}.json`);
  writeFileSync(outFile, JSON.stringify(eventData, null, 2));
  console.log(`  Saved ${allResults.length} results to ${eventCode}.json`);

  return eventData;
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === 'discover') {
    const years = args[1] ? args[1].split(',').map(Number) : [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
    const events = await discoverEvents(years);
    console.log(`\nFound ${events.length} events:`);
    events.forEach(e => console.log(`  ${e.name} (${e.type}, ${e.year})`));

    ensureDir(join(__dirname, '..', 'data'));
    writeFileSync(KNOWN_EVENTS_FILE, JSON.stringify(events, null, 2));
    console.log(`Saved to ${KNOWN_EVENTS_FILE}`);

  } else if (args[0] === 'event') {
    const eventName = args.slice(1).join(' ');
    if (!eventName) {
      console.error('Usage: node scrape-vault.js event <EVENT NAME>');
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
      const eventCode = event.name.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
      const outFile = join(DATA_DIR, `${eventCode}.json`);
      if (existsSync(outFile)) {
        console.log(`Skipping ${event.name} (already scraped)`);
        skipped++;
        continue;
      }
      try {
        await scrapeEvent(event.name, event.type);
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
    console.log('  node scrape-vault.js discover [years]   - Find all events (e.g., discover 2021,2022)');
    console.log('  node scrape-vault.js event <NAME>       - Scrape a specific event');
    console.log('  node scrape-vault.js all                - Scrape all known events');
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
