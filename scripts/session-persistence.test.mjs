import assert from 'node:assert/strict';
import {
  loadPersistedAuthSession,
  savePersistedAuthSession,
} from '../src/utils/sessionPersistence.js';

const session = savePersistedAuthSession({
  mode: 'management',
  staffId: 'staff_nadia',
  staffName: 'Nadia',
  roleKey: 'manager',
  startedAt: '2026-07-14T10:00:00.000Z',
}, 'restaurant_one');

assert.equal(session.databaseId, 'restaurant_one');
assert.equal(loadPersistedAuthSession('restaurant_one'), null, 'Browser sessions must not be restored from local storage.');
assert.equal(loadPersistedAuthSession('restaurant_two'), null, 'Browser sessions must not cross restaurant scopes.');

console.log('session persistence tests passed');
