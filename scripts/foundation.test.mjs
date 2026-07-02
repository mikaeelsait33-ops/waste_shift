import assert from 'node:assert/strict';
import { createRecordId } from '../src/utils/ids.js';

const firstId = createRecordId('waste');
const secondId = createRecordId('waste');

assert.match(firstId, /^waste_/);
assert.match(secondId, /^waste_/);
assert.notEqual(firstId, secondId);
assert.match(createRecordId('Store Movement'), /^store_movement_/);

console.log('foundation tests passed');
