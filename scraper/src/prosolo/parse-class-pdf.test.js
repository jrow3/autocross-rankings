import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { parseClassPdf } from './parse-class-pdf.js';

const fixture = name => readFileSync(new URL(`./fixtures/${name}.pdf`, import.meta.url));

function assertEveryDriverAccountedFor(result) {
  for (const parsed of result.classes) {
    assert.equal(parsed.drivers.length + parsed.noTimeNames.length, parsed.driverCount, parsed.className);
  }
}

test('2025 Finale: every class reconciles with its header and the SS winner is read whole', async () => {
  const result = await parseClassPdf(fixture('2025-finale-class'));
  assert.equal(result.eventName, '2025 Tire Rack SCCA ProSolo Finale');
  assert.equal(result.eventDates, '08/29/2025 - 08/31/2025');
  assertEveryDriverAccountedFor(result);

  const superStreet = result.classes.find(c => c.className === 'Super Street');
  assert.equal(superStreet.abbreviation, 'SS');
  assert.deepEqual(
    { ...superStreet.drivers[0], runs: undefined },
    {
      position: 1, trophy: true, carNumber: '98', name: 'Brian Franke', car: '2024 Porsche GT4 RS Golf',
      tire: 'Bridgesto', className: 'Super Street', region: '', cityState: 'Rapid City, SD', paxTime: 72.675, runs: undefined,
    }
  );
  assert.deepEqual(superStreet.drivers[0].runs.right, ['42.698', '43.374', '50.602', '49.447', '43.230']);
});

test('two-digit positions shift left but still parse', async () => {
  const result = await parseClassPdf(fixture('2025-finale-class'));
  const tenth = result.classes.find(c => c.className === 'Super Street').drivers[9];
  assert.equal(tenth.position, 10);
  assert.equal(tenth.name, 'Brandon Olvey');
  assert.equal(tenth.trophy, false);
});

test('2013 layout: class name sits below the driver count and index classes print a base class', async () => {
  const result = await parseClassPdf(fixture('2013-mineral-wells-class'));
  assertEveryDriverAccountedFor(result);
  assert.equal(result.eventDates, 'Apr 13-14, 2013');
  assert.equal(result.printedDate, '4/14/2013');

  const index1 = result.classes.find(c => c.className === 'Stock/Street Index 1');
  assert.equal(index1.abbreviation, null);
  assert.equal(index1.drivers[0].name, 'CB Ramey');
  assert.ok(result.classes.some(c => c.className === 'Street Touring Compact'), 'truncated class name restored');
});

test('No Time and DSQ drivers count toward the header but get no result', async () => {
  const result = await parseClassPdf(fixture('2017-finale-class'));
  assertEveryDriverAccountedFor(result);
  const noTime = result.classes.flatMap(c => c.noTimeNames);
  assert.deepEqual(noTime, ['Adam Tarnoff', 'Tim White']);
  assert.ok(!result.classes.flatMap(c => c.drivers).some(d => noTime.includes(d.name)));
});

test('60Ft/RT printout: reads names and scores, including "indexed [raw]" index-class scores', async () => {
  const result = await parseClassPdf(fixture('2023-packwood-reaction-time'));
  assertEveryDriverAccountedFor(result);
  const street1 = result.classes.find(c => c.className === 'Street 1');
  assert.equal(street1.drivers[0].name, 'Austin Clark');
  assert.equal(street1.drivers[0].paxTime, 44.938);
  assert.equal(street1.drivers[0].car, '');
  assert.ok(result.classes.some(c => c.className === 'Street Touring Roadster'));
});
