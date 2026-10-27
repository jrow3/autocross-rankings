import fetch from 'node-fetch';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resultsPageUrl, allYears, parseResultsPage } from './discover.js';
import { HUB_PAGE_URL, parseHubPage, parseEventPage } from './discover-event-pages.js';
import { parseClassPdf } from './parse-class-pdf.js';
import { parseOverallPdf } from './parse-overall-pdf.js';
import { buildEvent } from './build-event.js';
import { reconcileEvent } from './reconcile.js';
import { completeName } from './driver-names.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data', 'events');
const USER_AGENT = 'AutocrossRankings/1.0 (research)';
const DOWNLOAD_PAUSE_MS = 1000;

async function download(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, timeout: 60000 });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// scca.com leaves an event's downloads list out of the page unless the
// request asks for HTML (node-fetch's default Accept is */*).
function fetchPage(url) {
  return fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, timeout: 60000 });
}

async function readPage(url) {
  const res = await fetchPage(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// SCCA has linked one class PDF under two events (2025 Lincoln and Lincoln
// AirPark), so an event is identified by its pair of source PDFs.
function sourceKey(classUrl, overallUrl) {
  return `${classUrl} ${overallUrl}`;
}

function loadEvents() {
  return readdirSync(DATA_DIR).map(file => ({ file, event: JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) }));
}

function scrapedSourceKeys() {
  const keys = loadEvents()
    .map(({ event }) => event)
    .filter(event => event.eventType === 'prosolo')
    .map(event => sourceKey(event.sources.classResults, event.sources.overallIndex));
  return new Set(keys);
}

// Names in ProSolos without an overall index may still be cut short; see completeName.
function completeTruncatedNames() {
  const events = loadEvents();
  const isTrusted = event => event.eventType !== 'prosolo' || Boolean(event.sources.overallIndex);
  const rowsOf = event => Object.values(event.classResults || {}).flat();
  const trustedNames = [...new Set(events.filter(({ event }) => isTrusted(event)).flatMap(({ event }) => rowsOf(event).map(row => row.name)))];

  for (const { file, event } of events.filter(({ event }) => !isTrusted(event))) {
    const truncated = rowsOf(event)
      .map(row => ({ row, fullName: completeName(row.name, trustedNames) }))
      .filter(({ row, fullName }) => fullName !== row.name);
    for (const { row, fullName } of truncated) row.name = fullName;
    if (!truncated.length) continue;
    writeFileSync(join(DATA_DIR, file), JSON.stringify(event, null, 2));
    console.log(`  Completed ${truncated.length} truncated names in ${file}`);
  }
}

// Class PDFs are sometimes scanned, wholly or a page at a time (2026 Finale).
// The 60Ft/RT printout carries the same results, and the overall index is the
// last resort. The first source that reconciles wins; each fallback is logged.
async function readReconciledEvent(source) {
  const overall = source.overallUrl ? await parseOverallPdf(await download(source.overallUrl)) : null;
  const sources = { classResults: source.classUrl, overallIndex: source.overallUrl };
  const problems = [];
  for (const url of [source.classUrl, source.reactionTimeUrl].filter(Boolean)) {
    const classPdf = await parseClassPdf(await download(url));
    try {
      const event = buildEvent({ classPdf, overall, sources });
      reconcileEvent(event, classPdf);
      if (problems.length) console.log(`  Using ${url}: ${problems.join('; ')}`);
      return event;
    } catch (e) {
      problems.push(e.message.split('\n').slice(0, 2).join(' '));
    }
  }
  if (!overall?.rows.length) throw new Error(problems.join('\n    '));
  console.log(`  Using the overall index: ${problems.join('; ')}`);
  return buildEvent({ classPdf: { classes: [] }, overall, sources });
}

async function scrapeEvent(source) {
  const event = await readReconciledEvent(source);
  writeFileSync(join(DATA_DIR, `${event.eventCode}.json`), JSON.stringify(event, null, 2));
  console.log(`  Saved ${event.totalDrivers} results to ${event.eventCode}.json`);
}

// 2013–2025 have one yearly results page; from 2026 results sit on each event's
// page, found through the ProSolo hub.
async function discoverSources(year) {
  const res = await fetchPage(resultsPageUrl(year));
  if (res.ok) return parseResultsPage(await res.text());
  if (res.status !== 404) throw new Error(`HTTP ${res.status} for ${resultsPageUrl(year)}`);

  const eventPages = parseHubPage(await readPage(HUB_PAGE_URL), year);
  const sources = [];
  for (const url of eventPages) {
    const source = parseEventPage(await readPage(url));
    if (source) sources.push(source);
    await new Promise(r => setTimeout(r, DOWNLOAD_PAUSE_MS));
  }
  console.log(`${year}: ${sources.length} of ${eventPages.length} event pages have results posted`);
  return sources;
}

async function scrapeYear(year, alreadyScraped) {
  const sources = (await discoverSources(year))
    .filter(source => !alreadyScraped.has(sourceKey(source.classUrl, source.overallUrl)));
  console.log(`${year}: ${sources.length} new ProSolo events`);

  let failed = 0;
  for (const source of sources) {
    try {
      await scrapeEvent(source);
    } catch (e) {
      console.error(`  Failed ${source.heading || source.classUrl}: ${e.message}`);
      failed++;
    }
    await new Promise(r => setTimeout(r, DOWNLOAD_PAUSE_MS));
  }
  return failed;
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.log('Usage: node src/prosolo/scrape.js <year|all>');
    process.exit(1);
  }
  const years = arg === 'all' ? allYears() : [parseInt(arg)];
  mkdirSync(DATA_DIR, { recursive: true });
  const alreadyScraped = scrapedSourceKeys();

  let failed = 0;
  for (const year of years) failed += await scrapeYear(year, alreadyScraped);
  completeTruncatedNames();
  if (failed) {
    console.error(`${failed} ProSolo events failed`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
