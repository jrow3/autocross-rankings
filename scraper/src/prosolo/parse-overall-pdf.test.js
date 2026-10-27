import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { parseOverallPdf } from './parse-overall-pdf.js';

const overallPdf = readFileSync(new URL('./fixtures/2025-finale-overall.pdf', import.meta.url));

test('reads the header and every row of the 2025 Finale overall index', async () => {
  const result = await parseOverallPdf(overallPdf);
  assert.equal(result.eventName, '2025 Tire Rack SCCA ProSolo Finale');
  assert.equal(result.eventDates, '08/29/2025 - 08/31/2025');
  assert.equal(result.rows.length, 312);
  assert.deepEqual(result.rows.map(row => row.position), Array.from({ length: 312 }, (_, i) => i + 1));
  assert.deepEqual(result.rows[0], {
    position: 1, name: 'Dave Schotz', className: 'CAM', carNumber: '71', rawTime: 85.892, paxMultiplier: 0.832, paxTime: 71.462,
  });
});

test('three-digit positions glued to the name split cleanly', async () => {
  const { rows } = await parseOverallPdf(overallPdf);
  assert.equal(rows[110].position, 111);
  assert.equal(rows[110].name, 'Kim Whitener');
  assert.equal(rows[110].className, 'L3');
});
