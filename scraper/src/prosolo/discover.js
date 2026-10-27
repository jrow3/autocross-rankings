import * as cheerio from 'cheerio';

const SCCA_PAGES = 'https://www.scca.com/pages';
const FIRST_YEAR = 2013;

// SCCA reused the 2018 slug for the 2019 page.
const PAGE_SLUG_EXCEPTIONS = {
  2019: '2018-tire-rack-prosolo-results-1571080139-62',
};

export function resultsPageUrl(year) {
  return `${SCCA_PAGES}/${PAGE_SLUG_EXCEPTIONS[year] || `${year}-tire-rack-prosolo-results`}`;
}

export function allYears(currentYear = new Date().getFullYear()) {
  return Array.from({ length: currentYear - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);
}

// Each event on a year page is a bold heading followed by links labelled
// "Class", "Overall Index", "Super Challenge", ... Returns one entry per event
// with its class-results PDF and, when posted, its overall-index PDF.
export function parseResultsPage(html) {
  const $ = cheerio.load(html);
  const events = [];
  let heading = null;

  $('#content .page_content').find('strong, a').each((_, element) => {
    const text = $(element).text().replace(/\s+/g, ' ').trim();
    if (element.tagName === 'strong') {
      if (text) heading = text;
      return;
    }
    const url = $(element).attr('href');
    // Season points standings are also labelled "Class".
    if (text === 'Class' && !/points/i.test(`${heading} ${url}`)) addClassLink(events, heading, url);
    // Usually "Overall Index"; 2023 Packwood posted "Overall Index (Sat)".
    if (text.startsWith('Overall Index') && events.length) events.at(-1).overallUrl = url;
    if (/^60\s*ft/i.test(text) && events.length) events.at(-1).reactionTimeUrl = url;
  });

  return events;
}

// A revised PDF ("w Protest") is sometimes posted beside the original under
// the same heading; the higher download id is the later upload.
function addClassLink(events, heading, url) {
  const previous = events.at(-1);
  if (previous && heading && previous.heading === heading) {
    if (downloadId(url) > downloadId(previous.classUrl)) previous.classUrl = url;
    return;
  }
  events.push({ heading, classUrl: url, overallUrl: null, reactionTimeUrl: null });
}

function downloadId(url) {
  const match = url.match(/downloads\/(\d+)-/) || url.match(/downloads\/(\d{3})\/(\d{3})\/(\d{3})\//);
  return match ? parseInt(match.slice(1).join('')) : 0;
}
