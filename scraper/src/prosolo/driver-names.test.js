import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDriverName, completeName } from './driver-names.js';

test('timing-crew annotations are stripped from names', () => {
  assert.equal(cleanDriverName('Kit* Gauthier'), 'Kit Gauthier');
  assert.equal(cleanDriverName('Rad_ Delgado_'), 'Rad Delgado');
  assert.equal(cleanDriverName('Mark (late) Andy'), 'Mark Andy');
  assert.equal(cleanDriverName('Charlie Davis 2'), 'Charlie Davis');
  assert.equal(cleanDriverName('Brian Franke'), 'Brian Franke');
});

test('a truncated name completes to the one trusted full name it starts', () => {
  const trusted = ['Jeremiah McClintock', 'Brayden Knickerbock', 'Brayden Knickerbocker'];
  assert.equal(completeName('Jeremiah McClintoc', trusted), 'Jeremiah McClintock');
  assert.equal(completeName('Brayden Knicker', trusted), 'Brayden Knickerbocker');
});

test('real names, short names and ambiguous prefixes stay as they are', () => {
  const trusted = ['Christopher Scott', 'Christopher Scott McCarthy', 'Jeremy Fenstermaker Sr', 'Jeremy Fenstermaker Jr', 'Tom Ottey'];
  assert.equal(completeName('Christopher Scott', trusted), 'Christopher Scott');
  assert.equal(completeName('Jeremy Fenstermake', trusted), 'Jeremy Fenstermake');
  assert.equal(completeName('Tom Ott', trusted), 'Tom Ott');
});
