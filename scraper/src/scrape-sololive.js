import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getPaxFactor } from './pax-factors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data', 'events');
const BASE_URL = 'https://sololive.scca.com';

// Known event codes - we discover these by scraping the sololive index
// Format: {code, name, type: 'tour'|'nationals'|'prosolo', year, dates}
const KNOWN_EVENTS_FILE = join(__dirname, '..', 'data', 'known-events.json');

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// Fetch HTML with retry
async function fetchHTML(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'AutocrossRankings/1.0 (research)' },
        timeout: 15000,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// Parse the index page of an event to get class list and event metadata
async function parseEventIndex(eventCode) {
  const url = `${BASE_URL}/${eventCode}/index.php`;
  console.log(`Fetching event index: ${url}`);
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  // Extract event name and dates from header
  // Index pages have event name in BIG tags or span.style1
  let eventName = eventCode;
  let eventDates = '';

  // Try BIG tags first (common format)
  const bigTags = $('big, BIG').map((_, el) => $(el).text().trim()).get();
  for (const text of bigTags) {
    // Skip generic headers
    if (text.includes('Pronto Timing') || text.includes('QUICK LINKS')) continue;
    if (text.match(/\d{4}.*(?:Tour|Nationals|ProSolo|Challenge)/i)) {
      eventName = text.replace(/\s+/g, ' ').trim();
      break;
    }
  }

  // Try to find dates
  const allText = $('body').text();
  const dateMatch = allText.match(/((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*[-–]\s*\d{1,2},?\s*\d{4})/i)
    || allText.match(/(\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4})/);
  if (dateMatch) eventDates = dateMatch[1].trim();

  // Fallback: try tblHeader (class result pages use this)
  if (eventName === eventCode) {
    const headerText = $('table#tblHeader td b').map((_, el) => $(el).text().trim()).get();
    eventName = headerText[0] || eventCode;
    eventDates = eventDates || headerText[1] || '';
  }

  // Find class links - they're in the format CLASS.php
  const classLinks = [];
  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    // Class pages end with .php and are short uppercase codes
    if (href.endsWith('.php') && href !== 'index.php' && /^[A-Z]{1,5}\.php$/.test(href)) {
      classLinks.push(href.replace('.php', ''));
    }
  });

  // Also look for class links in text content (some pages list them differently)
  $('td a, div a').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (/^[A-Z]{1,5}\.php$/.test(href)) {
      const cls = href.replace('.php', '');
      if (!classLinks.includes(cls)) classLinks.push(cls);
    }
  });

  return { eventName, eventDates, classes: classLinks, eventCode };
}

// Parse a class results page and extract all driver results
function parseClassResults(html, className, eventCode) {
  const $ = cheerio.load(html);
  const results = [];

  // The HTML structure uses 3 rows per driver:
  // Row 1: Trophy, Position, Car#, Name (colspan=2), Car (colspan=2), Tire, PAX time
  // Row 2 (hidden inforow): Region/Division, City/State, Notes
  // Row 3: Run times for Course 1 and Course 2, then TOTAL

  const rows = $('table#tbl01 tr').toArray();
  let i = 0;

  // Skip header rows (class w3-black and w3-gray)
  while (i < rows.length) {
    const cls = $(rows[i]).attr('class') || '';
    if (cls.includes('w3-black') || cls.includes('w3-gray')) {
      i++;
      continue;
    }
    break;
  }

  // Process driver rows in groups of 3
  while (i < rows.length - 2) {
    const mainRow = $(rows[i]);
    const infoRow = $(rows[i + 1]);
    const timesRow = $(rows[i + 2]);

    // Extract main row data
    const cells = mainRow.find('td').toArray();
    if (cells.length < 5) { i++; continue; }

    const trophy = $(cells[0]).text().trim();
    const position = parseInt($(cells[1]).text().trim()) || 0;
    const carNumber = $(cells[2]).text().trim();
    const name = $(cells[3]).text().trim();
    // cells[4] is part of name colspan
    const car = $(cells[4]) ? $(cells[4]).text().trim() : '';
    // cells[5] is part of car colspan, cells[6] is tire, cells[7] is PAX time
    const tire = cells[6] ? $(cells[6]).text().trim() : '';
    const paxTime = cells[7] ? parseFloat($(cells[7]).text().trim()) : 0;

    if (!name || position === 0) { i++; continue; }

    // Extract info row data
    const infoCells = infoRow.find('td').toArray();
    const regionDiv = infoCells[0] ? $(infoCells[0]).text().trim() : '';
    const cityState = infoCells[1] ? $(infoCells[1]).text().trim() : '';
    const notes = infoCells[2] ? $(infoCells[2]).text().trim() : '';

    // Extract run times
    const timeCells = timesRow.find('td').toArray();
    const runs = { course1: [], course2: [], total: '' };

    for (let t = 0; t < timeCells.length; t++) {
      const cell = $(timeCells[t]);
      const text = cell.text().trim();
      const cellClass = cell.attr('class') || '';

      if (cellClass.includes('course1') && text) {
        const isBest = cell.find('b').length > 0;
        const isStrikethrough = cell.find('s').length > 0;
        runs.course1.push(parseRunTime(text, isBest, isStrikethrough));
      } else if (cellClass.includes('course2') && text) {
        const isBest = cell.find('b').length > 0;
        const isStrikethrough = cell.find('s').length > 0;
        runs.course2.push(parseRunTime(text, isBest, isStrikethrough));
      } else if (t === timeCells.length - 1 && text) {
        runs.total = text;
      }
    }

    results.push({
      position,
      trophy: trophy === 'T',
      carNumber,
      name,
      car,
      tire,
      paxTime,
      className,
      region: regionDiv,
      cityState,
      notes,
      runs,
    });

    i += 3;
  }

  return results;
}

// Parse a run time string like "45.553", "48.305(1)", or strikethrough
function parseRunTime(text, isBest, isStrikethrough) {
  // Extract base time and cone count
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

// Parse the PAX Index Overall page for cross-class rankings
async function parsePaxIndex(eventCode, dayOrOverall = 'Overall') {
  const filename = `PaxIndex${dayOrOverall}.html`;
  const url = `${BASE_URL}/${eventCode}/${filename}`;
  console.log(`Fetching PAX index: ${url}`);

  let html;
  try {
    html = await fetchHTML(url);
  } catch (e) {
    console.warn(`Could not fetch PAX index: ${e.message}`);
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

// Scrape an entire event
async function scrapeEvent(eventCode, eventType = 'tour') {
  console.log(`\n=== Scraping event: ${eventCode} ===`);

  const eventInfo = await parseEventIndex(eventCode);
  console.log(`Event: ${eventInfo.eventName} (${eventInfo.eventDates})`);
  console.log(`Classes found: ${eventInfo.classes.join(', ')}`);

  const allResults = [];
  const classResults = {};

  // Scrape each class
  for (const cls of eventInfo.classes) {
    const url = `${BASE_URL}/${eventCode}/${cls}.php`;
    console.log(`  Scraping class ${cls}...`);

    try {
      const html = await fetchHTML(url);
      const results = parseClassResults(html, cls, eventCode);
      classResults[cls] = results;
      allResults.push(...results);
      console.log(`    Found ${results.length} drivers`);
    } catch (e) {
      console.warn(`    Error scraping ${cls}: ${e.message}`);
    }

    // Be polite - small delay between requests
    await new Promise(r => setTimeout(r, 500));
  }

  // Also get PAX index for cross-class comparison
  const paxOverall = await parsePaxIndex(eventCode, 'Overall');
  const paxDay1 = await parsePaxIndex(eventCode, 'Day1');
  const paxDay2 = await parsePaxIndex(eventCode, 'Day2');

  const eventData = {
    eventCode,
    eventName: eventInfo.eventName,
    eventDates: eventInfo.eventDates,
    eventType,
    scrapedAt: new Date().toISOString(),
    totalDrivers: allResults.length,
    classes: Object.keys(classResults),
    classResults,
    paxIndex: {
      overall: paxOverall,
      day1: paxDay1,
      day2: paxDay2,
    },
  };

  // Save to file
  ensureDir(DATA_DIR);
  const outFile = join(DATA_DIR, `${eventCode}.json`);
  writeFileSync(outFile, JSON.stringify(eventData, null, 2));
  console.log(`Saved ${allResults.length} results to ${outFile}`);

  return eventData;
}

// Discover events from sololive.scca.com
async function discoverEvents() {
  console.log('Discovering events from sololive.scca.com...');
  const html = await fetchHTML(`${BASE_URL}/`);
  const $ = cheerio.load(html);

  // The index page typically redirects to the latest event
  // We need to check for known event code patterns
  // National Tour codes: YY[LOCATION]NT (e.g., 26RHNT = 2026 Red Hills National Tour)
  // Nationals codes: YYNATSGEN, YYNATSSUP etc.
  // We'll also check the SCCA archives page for historical event codes

  const events = [];

  // Check for redirect in JavaScript
  const scriptText = $('script').text();
  const redirectMatch = scriptText.match(/location\.href\s*=\s*['"]\.\/(\w+)\/index\.php['"]/);
  if (redirectMatch) {
    events.push({ code: redirectMatch[1], discovered: 'redirect' });
  }

  // Check all links
  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/\.\/(\d{2}\w+)\//);
    if (match) {
      events.push({ code: match[1], discovered: 'link' });
    }
  });

  return events;
}

// Build list of known National Tour event codes by year
function generateExpectedEventCodes(years = [2021, 2022, 2023, 2024, 2025, 2026]) {
  // Known National Tour location codes
  const tourLocations = [
    'PHXNT',   // Phoenix
    'RHNT',    // Red Hills
    'STXNT',   // South Texas
    'CHRNT',   // Charlotte
    'CLNT',    // Crows Landing
    'LNKNT',   // Lincoln
    'BRKNT',   // Brunswick
    'CLVNT',   // Cleveland
    'BRNT',    // Bristol
    'PKNT',    // Packwood
    'CHINT',   // Chicago
    'ROMNT',   // Romulus
    'GRSNT',   // Grissom
    'FLNT',    // Finger Lakes
    'DETNT',   // Detroit
  ];

  // Nationals codes
  const nationalsLocations = [
    'NATSGEN',  // Nationals General/Combined
  ];

  const codes = [];

  for (const year of years) {
    const yy = String(year).slice(-2);

    for (const loc of tourLocations) {
      codes.push({
        code: `${yy}${loc}`,
        type: 'tour',
        year,
        location: loc.replace('NT', ''),
      });
    }

    for (const loc of nationalsLocations) {
      codes.push({
        code: `${yy}${loc}`,
        type: 'nationals',
        year,
        location: 'Lincoln',
      });
    }
  }

  return codes;
}

// Check which events actually exist on sololive
async function probeEvents(codes) {
  const existing = [];

  for (const event of codes) {
    const url = `${BASE_URL}/${event.code}/index.php`;
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        headers: { 'User-Agent': 'AutocrossRankings/1.0 (research)' },
        redirect: 'follow',
        timeout: 5000,
      });
      if (res.ok) {
        console.log(`  Found: ${event.code}`);
        existing.push(event);
      }
    } catch (e) {
      // Event doesn't exist
    }
    await new Promise(r => setTimeout(r, 200));
  }

  return existing;
}

// Main entry point
async function main() {
  const args = process.argv.slice(2);

  if (args[0] === 'discover') {
    // Discover and probe all possible events
    console.log('Generating expected event codes...');
    const expected = generateExpectedEventCodes();
    console.log(`Probing ${expected.length} possible event codes...`);
    const found = await probeEvents(expected);
    console.log(`\nFound ${found.length} events:`);
    found.forEach(e => console.log(`  ${e.code} (${e.type}, ${e.year})`));

    ensureDir(join(__dirname, '..', 'data'));
    writeFileSync(KNOWN_EVENTS_FILE, JSON.stringify(found, null, 2));
    console.log(`Saved to ${KNOWN_EVENTS_FILE}`);

  } else if (args[0] === 'event') {
    // Scrape a specific event
    const eventCode = args[1];
    const eventType = args[2] || 'tour';
    if (!eventCode) {
      console.error('Usage: node scrape-sololive.js event <EVENT_CODE> [tour|nationals]');
      process.exit(1);
    }
    await scrapeEvent(eventCode, eventType);

  } else if (args[0] === 'all') {
    // Scrape all known events
    if (!existsSync(KNOWN_EVENTS_FILE)) {
      console.error('No known events file. Run with "discover" first.');
      process.exit(1);
    }
    const events = JSON.parse(readFileSync(KNOWN_EVENTS_FILE, 'utf8'));
    console.log(`Scraping ${events.length} events...`);

    for (const event of events) {
      const outFile = join(DATA_DIR, `${event.code}.json`);
      if (existsSync(outFile)) {
        console.log(`Skipping ${event.code} (already scraped)`);
        continue;
      }
      try {
        await scrapeEvent(event.code, event.type);
      } catch (e) {
        console.error(`Failed to scrape ${event.code}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 1000));
    }

  } else {
    console.log('Usage:');
    console.log('  node scrape-sololive.js discover          - Find all available events');
    console.log('  node scrape-sololive.js event <CODE>       - Scrape a specific event');
    console.log('  node scrape-sololive.js all                - Scrape all known events');
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});

export { scrapeEvent, parseClassResults, parsePaxIndex, parseEventIndex, probeEvents, generateExpectedEventCodes };
