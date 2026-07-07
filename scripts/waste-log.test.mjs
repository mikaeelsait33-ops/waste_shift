import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const wasteList = await readFile(new URL('../src/components/WasteList.jsx', import.meta.url), 'utf8');

assert.doesNotMatch(wasteList, /\bviewMode\b/, 'WasteList must not reference the removed DateNavigator viewMode state.');
assert.doesNotMatch(wasteList, /\bselectedDate\b/, 'WasteList must not reference the removed DateNavigator selectedDate state.');
assert.match(wasteList, /dateRangeFilter/, 'WasteList should use the current date range filter state.');
assert.match(wasteList, /useState\('all'\)/, 'WasteList should default to all active entries so badge counts and visible rows match.');
assert.match(wasteList, /No waste was logged today\./, 'WasteList should render date-range-aware empty states.');

console.log('Waste log tests passed');
