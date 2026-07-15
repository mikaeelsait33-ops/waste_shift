import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getAccessProfile, inferRoleKey, normalizeAccessRoleKey, requirePermission } from '../src/utils/accessControl.js';
import { createRecordId } from '../src/utils/ids.js';
import {
  DEFAULT_AUTH_SETTINGS,
  authPinsAreConfigured,
  createPinRecord,
  sanitizeAuthSettings,
  validatePin,
  verifyPin,
} from '../src/utils/pinAuth.js';

assert.equal(validatePin('123'), 'Use a 4 to 8 digit PIN.');
assert.equal(validatePin('123456789'), 'Use a 4 to 8 digit PIN.');
assert.equal(validatePin('12ab'), 'Use a 4 to 8 digit PIN.');
assert.equal(validatePin('4826'), '');

const pinRecord = await createPinRecord('4826');
assert.equal(pinRecord.algorithm, 'sha256-salt-v1');
assert.notEqual(pinRecord.hash, '4826');
assert.notEqual(pinRecord.salt, '4826');
assert.equal(await verifyPin('4826', pinRecord), true);
assert.equal(await verifyPin('4827', pinRecord), false);
assert.equal(await verifyPin('123', pinRecord), false);

assert.equal(authPinsAreConfigured(DEFAULT_AUTH_SETTINGS), false);
assert.equal(authPinsAreConfigured({ managementPin: pinRecord }), true);
assert.equal(sanitizeAuthSettings({ managementPin: { hash: 'plain' } }).managementPin, null);

assert.equal(inferRoleKey('Owner'), 'owner');
assert.equal(inferRoleKey('Shift Manager'), 'manager');
assert.equal(inferRoleKey('Kitchen chef'), 'chef');
assert.equal(inferRoleKey('Barista'), 'barista');
assert.equal(inferRoleKey('Waiter'), 'waiter');
assert.equal(normalizeAccessRoleKey('staff'), 'waiter');

const managerProfile = getAccessProfile({ id: 'staff_1', name: 'Nadia', role: 'Manager' });
const staffProfile = getAccessProfile({ id: 'staff_2', name: 'Team', role: 'Waiter' });
const chefProfile = getAccessProfile({ id: 'staff_3', name: 'Chef', role: 'Chef' });

assert.equal(managerProfile.canManageStaff, true);

const legacyManagerProfile = getAccessProfile({
  id: 'staff_legacy_manager',
  name: 'Nadia',
  role: 'Manager',
  roleKey: 'management',
  staffSection: 'management',
});
assert.equal(legacyManagerProfile.roleKey, 'manager');
assert.equal(legacyManagerProfile.canUseAiImports, true);
assert.equal(managerProfile.canClearData, true);
assert.equal(managerProfile.canUseAiImports, true);
assert.equal(staffProfile.canLogWaste, true);
assert.equal(staffProfile.canManageStaff, false);
assert.equal(staffProfile.canViewFinancials, false);
assert.equal(staffProfile.canUseAiImports, false);
assert.equal(staffProfile.canCreateWasteOnly, true);
assert.equal(chefProfile.canManageMenu, true);
assert.equal(chefProfile.canManageStoreRoom, true);
assert.equal(chefProfile.canManageStaff, false);
assert.deepEqual(requirePermission(managerProfile, 'canManageStaff'), { ok: true, message: '' });
assert.equal(requirePermission(staffProfile, 'canManageStaff', 'manage staff').ok, false);
assert.match(requirePermission(staffProfile, 'canManageStaff', 'manage staff').message, /does not have permission/);
assert.match(requirePermission(null, 'canManageStaff', 'manage staff').message, /Select an owner or manager/);

const generatedId = createRecordId('Waste Entry');
assert.match(generatedId, /^waste_entry_/);
assert.doesNotMatch(generatedId, /\d{13}$/);

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const firestoreSource = await readFile(new URL('../src/services/firestoreMenuItems.js', import.meta.url), 'utf8');
const managerAccountsSource = await readFile(new URL('../src/services/managerAccounts.js', import.meta.url), 'utf8');
const settingsSource = await readFile(new URL('../src/components/Settings.jsx', import.meta.url), 'utf8');
const setupWizardSource = await readFile(new URL('../src/components/SetupWizard.jsx', import.meta.url), 'utf8');
const idsSource = await readFile(new URL('../src/utils/ids.js', import.meta.url), 'utf8');

assert.equal(DEFAULT_AUTH_SETTINGS.managementPin, null);
assert.equal(DEFAULT_AUTH_SETTINGS.staffPin, null);
assert.equal(/managementPin:\s*['"]\d{4,8}['"]/.test(appSource), false);
assert.equal(/staffPin:\s*['"]\d{4,8}['"]/.test(appSource), false);
assert.doesNotMatch(appSource, new RegExp(`19${'05'}`));
assert.match(appSource, /managerPin/);
assert.match(appSource, /Enter a 5 digit staff PIN/);
assert.match(appSource, /That staff PIN is already in use/);
assert.match(settingsSource, /Add manager account/);
assert.match(settingsSource, /Staff PIN/);
assert.match(settingsSource, /5 digit staff PIN/);
assert.match(setupWizardSource, /Use a unique 5 digit staff PIN/);
assert.match(setupWizardSource, /PIN set/);
assert.equal(setupWizardSource.includes('createRandomPin'), false);
assert.match(setupWizardSource, /managerPin: _managerPin/);
assert.match(setupWizardSource, /confirmManagerPin: _confirmManagerPin/);
assert.match(setupWizardSource, /staffMembers: _staffMembers/);
assert.doesNotMatch(setupWizardSource, /JSON\.stringify\(\{\s*\.\.\.progress/);
assert.match(managerAccountsSource, /'managers'/);
assert.match(managerAccountsSource, /managerPin/);
assert.match(managerAccountsSource, /loadManagerAccounts/);
assert.match(appSource, /managerAccountsLoaded/);
assert.match(appSource, /mergeManagerAccountsIntoStaffList/);
assert.match(appSource, /stripStaffCredentialsForStorage/);
assert.match(appSource, /managementPin: _managementPin/);
assert.doesNotMatch(appSource, /localStorage\.setItem\('customStaffList', JSON\.stringify\(customStaffList\)\)/);
assert.equal(idsSource.includes('Date.now'), false);
assert.match(firestoreSource, /photoUrl:\s*''/);
assert.match(firestoreSource, /hasPhoto:/);

console.log('auth and permissions tests passed');
