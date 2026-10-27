import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResultsPage, resultsPageUrl } from './discover.js';

const page = links => `<div id="content"><div class="page_content">${links}</div></div>`;
const link = (text, url) => `<a href="${url}">${text}</a>&nbsp;`;

test('one entry per heading with its class, overall and 60Ft/RT PDFs', () => {
  const html = page(`
    <p><strong>South Texas</strong></p>
    <p>${link('Class', '/downloads/61482-class/download')}${link('60Ft/RT', '/downloads/61511-rt/download')}
       ${link('Overall Index', '/downloads/61483-overall/download')}${link('Super Challenge', '/downloads/61487-super/download')}</p>
    <p><strong><br />Packwood</strong></p>
    <p>${link('Class', '/downloads/68807-class/download')}${link('Overall&nbsp;Index (Sat)', '/downloads/68808-overall/download')}</p>`);

  assert.deepEqual(parseResultsPage(html), [
    { heading: 'South Texas', classUrl: '/downloads/61482-class/download', overallUrl: '/downloads/61483-overall/download', reactionTimeUrl: '/downloads/61511-rt/download' },
    { heading: 'Packwood', classUrl: '/downloads/68807-class/download', overallUrl: '/downloads/68808-overall/download', reactionTimeUrl: null },
  ]);
});

test('a revised class PDF under the same heading replaces the original', () => {
  const html = page(`
    <p><strong>Bristol</strong></p>
    <p>${link('Class', 'https://cdn.connectsites.net/user_files/scca/downloads/000/076/685/Protest.pdf')}
       ${link('Class', 'https://cdn.connectsites.net/user_files/scca/downloads/000/076/601/Original.pdf')}</p>`);
  const [event] = parseResultsPage(html);
  assert.equal(event.classUrl, 'https://cdn.connectsites.net/user_files/scca/downloads/000/076/685/Protest.pdf');
});

test('pages without headings keep each class link as its own event, and points PDFs are skipped', () => {
  const html = page(`
    ${link('Class', 'http://www.scca.com/downloads/4668-2013-el-toro-results/download')}
    ${link('Class', 'http://www.scca.com/downloads/4674-2013-mineral-wells-results/download')}
    ${link('Class', 'http://www.scca.com/downloads/4750-2013-pro-solo-final-points5/download')}
    <p><strong>Points Final</strong></p>${link('Class', '/downloads/9999-standings/download')}`);
  assert.deepEqual(parseResultsPage(html).map(e => e.classUrl), [
    'http://www.scca.com/downloads/4668-2013-el-toro-results/download',
    'http://www.scca.com/downloads/4674-2013-mineral-wells-results/download',
  ]);
});

test('2019 lives under a reused 2018 slug', () => {
  assert.equal(resultsPageUrl(2019), 'https://www.scca.com/pages/2018-tire-rack-prosolo-results-1571080139-62');
  assert.equal(resultsPageUrl(2025), 'https://www.scca.com/pages/2025-tire-rack-prosolo-results');
});
