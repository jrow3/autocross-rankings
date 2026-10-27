import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvent } from './build-event.js';
import { reconcileEvent } from './reconcile.js';

const sources = { classResults: 'class.pdf', overallIndex: 'overall.pdf' };

function driver(name, carNumber, paxTime, position = 1) {
  return { position, trophy: true, carNumber, name, car: '', tire: '', className: 'Street 1', region: '', cityState: '', paxTime, runs: { left: [], right: [] } };
}

function classPdf({ drivers, noTimeNames = [], eventDates = '08/01/2025 - 08/03/2025' }) {
  return {
    eventName: '2025 Tire Rack SCCA Lincoln AirPark ProSolo',
    eventDates,
    printedDate: '8/3/2025',
    classes: [{ className: 'Street 1', abbreviation: 'S1', driverCount: drivers.length + noTimeNames.length, trophyCount: 1, drivers, noTimeNames }],
  };
}

function overallRow(name, carNumber, paxTime, position = 1) {
  return { position, name, className: 'S1', carNumber, rawTime: paxTime / 0.85, paxMultiplier: 0.85, paxTime };
}

test('truncated class-PDF names are restored from the overall index, using car number for Sr/Jr', () => {
  const event = buildEvent({
    classPdf: classPdf({ drivers: [driver('Jeremy Fenstermake', '18', 70.1), driver('Jeremy Fenstermake', '118', 70.4, 2), driver('Brayden Knickerboc', '29', 71)] }),
    overall: {
      eventDates: '08/01/2025 - 08/03/2025',
      rows: [overallRow('Jeremy Fenstermaker Sr', '18', 70.1), overallRow('Jeremy Fenstermaker Jr', '118', 70.4, 2), overallRow('Brayden Knickerbocker', '29', 71, 3)],
    },
    sources,
  });
  assert.deepEqual(event.classResults['Street 1'].map(d => d.name), ['Jeremy Fenstermaker Sr', 'Jeremy Fenstermaker Jr', 'Brayden Knickerbocker']);
  assert.equal(event.paxIndex.overall[0].className, 'Street 1');
  assert.equal(event.isIndexedScore, true);
  assert.equal(event.eventCode, '2025-Tire-Rack-SCCA-Lincoln-AirPark-ProSolo');
  reconcileEvent(event, classPdf({ drivers: event.classResults['Street 1'] }));
});

test('a class PDF from another event (dates disagree) gives way to the overall index', () => {
  const event = buildEvent({
    classPdf: classPdf({ drivers: [driver('Someone Else', '1', 70)] }),
    overall: {
      eventName: '2025 Tire Rack SCCA Lincoln ProSolo',
      eventDates: '05/22/2025 - 05/24/2025',
      rows: [overallRow('Vivek Goel', '52', 72), overallRow('Daniel McCelvey', '98', 72.5, 2)],
    },
    sources,
  });
  assert.equal(event.source, 'scca-prosolo-overall-index');
  assert.equal(event.eventName, '2025 Tire Rack SCCA Lincoln ProSolo');
  assert.equal(event.eventDates, '05/22/2025 - 05/24/2025');
  assert.deepEqual(event.classResults.S1.map(d => [d.position, d.name, d.paxTime]), [[1, 'Vivek Goel', 72], [2, 'Daniel McCelvey', 72.5]]);
});

test('a driver DSQ in the class results is dropped from the overall index too', () => {
  const event = buildEvent({
    classPdf: classPdf({ drivers: [driver('Brian Mason', '7', 70)], noTimeNames: ['Robert Chrismas'] }),
    overall: { eventDates: '08/01/2025 - 08/03/2025', rows: [overallRow('Brian Mason', '7', 70), overallRow('Robert Chrismas', '8', 71, 2)] },
    sources,
  });
  assert.deepEqual(event.paxIndex.overall.map(row => row.name), ['Brian Mason']);
});

test('the event name takes its year from the dates', () => {
  const pdf = { ...classPdf({ drivers: [driver('A Driver', '1', 70)] }), eventName: '2015 Tire Rack Finale ProSolo', eventDates: 'Sep 2-4, 2016', printedDate: '9/4/2016' };
  const event = buildEvent({ classPdf: pdf, overall: null, sources });
  assert.equal(event.eventName, '2016 Tire Rack Finale ProSolo');
  assert.equal(event.eventDates, '09/02/2016 - 09/04/2016');
});

test('timing-crew prefixes are dropped from the event name', () => {
  for (const prefixed of ['ACTIVE 2026 Tire Rack SCCA Toledo ProSolo', 'ACTIVE-2026 Tire Rack SCCA Toledo ProSolo']) {
    const pdf = { ...classPdf({ drivers: [driver('A Driver', '1', 70)] }), eventName: prefixed, eventDates: '06/12/2026 - 06/14/2026', printedDate: '6/14/2026' };
    assert.equal(buildEvent({ classPdf: pdf, overall: null, sources }).eventCode, '2026-Tire-Rack-SCCA-Toledo-ProSolo');
  }
});

test('nothing readable fails instead of writing an empty event', () => {
  assert.throws(() => buildEvent({ classPdf: { classes: [] }, overall: null, sources }), /unreadable/);
});
