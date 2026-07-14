import assert from 'node:assert/strict';
import {
  AUTH_SESSION_STORAGE_KEY,
  clearPersistedAuthSession,
  loadPersistedAuthSession,
  savePersistedAuthSession,
} from '../src/utils/sessionPersistence.js';

const createStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
};

globalThis.localStorage = createStorage();
globalThis.sessionStorage = createStorage();

const session = savePersistedAuthSession({
  mode: 'management',
  staffId: 'staff_nadia',
  staffName: 'Nadia',
  roleKey: 'manager',
  startedAt: '2026-07-14T10:00:00.000Z',
}, 'restaurant_one');

assert.equal(session.databaseId, 'restaurant_one');
assert.ok(globalThis.localStorage.getItem(AUTH_SESSION_STORAGE_KEY));
assert.equal(globalThis.sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY), null);
assert.equal(loadPersistedAuthSession('restaurant_one')?.staffId, 'staff_nadia');
assert.equal(loadPersistedAuthSession('restaurant_two'), null, 'A login must not cross into a different restaurant.');

globalThis.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
globalThis.sessionStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify({
  mode: 'staff',
  staffId: 'staff_chef',
  staffName: 'Chef',
}));
assert.equal(loadPersistedAuthSession('restaurant_one')?.databaseId, 'restaurant_one');
assert.ok(globalThis.localStorage.getItem(AUTH_SESSION_STORAGE_KEY), 'Legacy session storage should migrate to durable storage.');

clearPersistedAuthSession();
assert.equal(globalThis.localStorage.getItem(AUTH_SESSION_STORAGE_KEY), null);
assert.equal(globalThis.sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY), null);

console.log('session persistence tests passed');
