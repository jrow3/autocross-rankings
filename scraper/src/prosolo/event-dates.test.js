import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEventDates } from './event-dates.js';

test('every Pronto header style becomes MM/DD/YYYY - MM/DD/YYYY', () => {
  assert.equal(normalizeEventDates('08/29/2025 - 08/31/2025'), '08/29/2025 - 08/31/2025');
  assert.equal(normalizeEventDates('Apr 13-14, 2013'), '04/13/2013 - 04/14/2013');
  assert.equal(normalizeEventDates('Mar 31 - Apr 2, 2017'), '03/31/2017 - 04/02/2017');
  assert.equal(normalizeEventDates('Sept 9 - 10, 2016'), '09/09/2016 - 09/10/2016');
});

test('missing or mistyped headers fall back to the print date', () => {
  assert.equal(normalizeEventDates("Pos Nb Driver's name", '4/14/2014'), '04/14/2014 - 04/14/2014');
  assert.equal(normalizeEventDates('Mat 21 - 23, 2015', '6/23/2015'), '06/23/2015 - 06/23/2015');
  assert.equal(normalizeEventDates('April 29 - May 1, 12016', '5/1/2016'), '05/01/2016 - 05/01/2016');
});

test('a header year that disagrees with the print date loses', () => {
  assert.equal(normalizeEventDates('Sep 2-4, 2016', '9/4/2015'), '09/04/2015 - 09/04/2015');
});

test('no usable date at all fails loudly', () => {
  assert.throws(() => normalizeEventDates('2014 ProSolo Points'), /Unrecognized ProSolo date/);
});
