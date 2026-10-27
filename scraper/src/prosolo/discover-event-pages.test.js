import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHubPage, parseEventPage } from './discover-event-pages.js';

const eventPage = (title, labels) => `<html><head><title>${title} - Sports Car Club of America</title></head><body>
  ${labels.map(([label, id]) => `<a href="/downloads/${id}-x/download">${label}</a>`).join('\n')}</body></html>`;

test('hub page yields that season\'s ProSolo event pages once each', () => {
  const html = `
    <a href="/events/2009098-2026-tire-rack-scca-las-vegas-prosolo-las-vegas-motor-speedway">Las Vegas</a>
    <a href="/events/2009098-2026-tire-rack-scca-las-vegas-prosolo-las-vegas-motor-speedway">Las Vegas</a>
    <a href="/events/2009396-2026-tire-rack-scca-solo-national-championships-lincoln-airpark">Nationals</a>
    <a href="/events/2008164-2025-tire-rack-scca-prosolo-championship-finale-lincoln-airpark">2025 Finale</a>`;
  assert.deepEqual(parseHubPage(html, 2026), [
    'https://www.scca.com/events/2009098-2026-tire-rack-scca-las-vegas-prosolo-las-vegas-motor-speedway',
  ]);
});

test('event page: full-event class, overall and 60ft/RT PDFs, skipping Day 1 and Ladies/Masters', () => {
  const html = eventPage('2026 Tire Rack SCCA Lincoln ProSolo @ Lincoln Airpark', [
    ['Day 1 Class Results', 1], ['Day 1 Overall Index Results', 2], ['Ladies Index Results', 3],
    ['Masters Index Results', 4], ['Class Results W 60 Ft And Rt', 5], ['Overall Index Results', 6], ['Official Class Results', 7],
  ]);
  assert.deepEqual(parseEventPage(html), {
    heading: '2026 Tire Rack SCCA Lincoln ProSolo @ Lincoln Airpark',
    classUrl: 'https://www.scca.com/downloads/7-x/download',
    overallUrl: 'https://www.scca.com/downloads/6-x/download',
    reactionTimeUrl: 'https://www.scca.com/downloads/5-x/download',
  });
});

test('event-specific label styles are recognised', () => {
  const atlanta = parseEventPage(eventPage('Atlanta', [['26ATLPS Class Results w/Reaction Times & 60ft', 1], ['26ATLPS Official Class Results', 2], ['26ATLPS Overall Index', 3]]));
  assert.equal(atlanta.classUrl, 'https://www.scca.com/downloads/2-x/download');
  assert.equal(atlanta.overallUrl, 'https://www.scca.com/downloads/3-x/download');

  const beeville = parseEventPage(eventPage('Beeville', [['2026 Beeville Pro Solo Masters Index Results', 1], ['2026 Beeville Pro Solo Index Results', 2], ['2026 Beeville Pro Solo Official Class Results', 3]]));
  assert.equal(beeville.overallUrl, 'https://www.scca.com/downloads/2-x/download');
});

test('an event with no results posted yet (or cancelled) is skipped', () => {
  assert.equal(parseEventPage(eventPage('CANCELED - 2026 Brunswick ProSolo', [['Supplemental Regulations', 1]])), null);
});
