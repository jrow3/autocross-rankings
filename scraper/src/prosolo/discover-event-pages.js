import * as cheerio from 'cheerio';

// From 2026 SCCA stopped publishing a yearly ProSolo results page. Results are
// posted on each event's own page instead, and the ProSolo hub links the events.
const SCCA = 'https://www.scca.com';
export const HUB_PAGE_URL = `${SCCA}/pages/prosolo`;

export function parseHubPage(html, year) {
  const $ = cheerio.load(html);
  const pattern = new RegExp(`/events/\\d+-${year}-[^"]*prosolo`, 'i');
  const urls = $('a[href]').toArray()
    .map(element => $(element).attr('href'))
    .filter(href => pattern.test(href))
    .map(href => new URL(href, SCCA).href);
  return [...new Set(urls)];
}

// Each event names its PDFs its own way ("Official Class Results",
// "26ATLPS Official Class Results", "2026 Beeville Pro Solo Index Results").
// Day 1 and the Ladies/Masters subsets are not the event's full results.
function classify(label) {
  if (/60\s*ft|reaction/i.test(label)) return 'reactionTimeUrl';
  if (/ladies|masters|day 1|challenge|qual/i.test(label)) return null;
  if (/class results/i.test(label)) return 'classUrl';
  if (/index/i.test(label)) return 'overallUrl';
  return null;
}

export function parseEventPage(html) {
  const $ = cheerio.load(html);
  const event = { heading: $('title').text().split(' - ')[0].trim(), classUrl: null, overallUrl: null, reactionTimeUrl: null };
  $('a[href*="downloads"]').each((_, element) => {
    const field = classify($(element).text().replace(/\s+/g, ' ').trim());
    if (field && !event[field]) event[field] = new URL($(element).attr('href'), SCCA).href;
  });
  return event.classUrl ? event : null;
}
