import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileEvent } from './reconcile.js';

function eventWith({ drivers, overallNames = [] }) {
  return {
    eventCode: 'Test-ProSolo',
    source: 'scca-prosolo-pdf',
    classes: ['Street 1'],
    classResults: { 'Street 1': drivers.map(name => ({ name })) },
    paxIndex: { overall: overallNames.map(name => ({ name })) },
  };
}

const classPdfWith = (driverCount, drivers, noTimeNames = []) => ({
  classes: [{ className: 'Street 1', driverCount, drivers: drivers.map(name => ({ name })), noTimeNames }],
});

test('passes when every header count and overall name is accounted for', () => {
  const event = eventWith({ drivers: ['A', 'B'], overallNames: ['B', 'A'] });
  assert.doesNotThrow(() => reconcileEvent(event, classPdfWith(3, ['A', 'B'], ['C'])));
});

test('fails when the parser dropped a driver the header counted', () => {
  const event = eventWith({ drivers: ['A', 'B'] });
  assert.throws(() => reconcileEvent(event, classPdfWith(3, ['A', 'B'])), /Street 1: parsed 2 drivers, header says 3/);
});

test('fails when the overall index has a driver the class results lack', () => {
  const event = eventWith({ drivers: ['A'], overallNames: ['A', 'Z'] });
  assert.throws(() => reconcileEvent(event, classPdfWith(1, ['A'])), /missing from class results: Z/);
});
