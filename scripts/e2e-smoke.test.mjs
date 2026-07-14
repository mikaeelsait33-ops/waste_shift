import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const app = await read('../src/App.jsx');
const setupWizard = await read('../src/components/SetupWizard.jsx');
const authGate = await read('../src/components/AuthGate.jsx');
const wasteForm = await read('../src/components/WasteForm.jsx');
const wasteList = await read('../src/components/WasteList.jsx');
const dashboard = await read('../src/components/Dashboard.jsx');
const settings = await read('../src/components/Settings.jsx');
const invoiceScanner = await read('../src/components/InvoiceScanner.jsx');
const recipeManager = await read('../src/components/RecipeManager.jsx');
const menuImportPanel = await read('../src/components/MenuImportPanel.jsx');
const apiHeaders = await read('../src/utils/apiHeaders.js');

assert.match(app, /activeTab === 'dashboard'/);
assert.match(app, /activeTab === 'logWaste'/);
assert.match(app, /activeTab === 'wasteLog'/);
assert.match(app, /activeTab === 'invoices'/);
assert.match(app, /activeTab === 'settings'/);
assert.match(app, /onResetRestaurantData/);
assert.match(app, /WIPE MENU/);
assert.match(app, /deleteFirestoreMenuItems/);

assert.match(setupWizard, /Set Up This Restaurant/);
assert.match(setupWizard, /Manager PINs do not match/);
assert.match(setupWizard, /Finish setup/);
assert.match(setupWizard, /MenuImport/);

assert.match(authGate, /Management login/);
assert.match(authGate, /Staff login/);
assert.match(authGate, /onLogout|onLogin/);

assert.match(wasteForm, /Log waste/);
assert.match(wasteForm, /Repeat last/);
assert.match(wasteForm, /selectedComponentKeys/);
assert.match(wasteForm, /Retry sync/);
assert.match(wasteForm, /Clear form/);

assert.match(dashboard, /Today At A Glance/);
assert.match(dashboard, /Invoice & Stock Signals/);
assert.match(dashboard, /Daily waste cost/);
assert.match(dashboard, /Below R150/);
assert.match(dashboard, /Invoice spend trend/);
assert.match(dashboard, /Top waste items/);
assert.match(dashboard, /Worst cost margin/);
assert.match(dashboard, /worstMarginItems/);
assert.match(wasteList, /Load more entries/);
assert.match(wasteList, /Needs cost review/);
assert.match(settings, /Reset restaurant data/);
assert.match(settings, /Staff setup/);
assert.match(settings, /accessProfile=\{accessProfile\}/);
assert.match(recipeManager, /accessProfile=\{accessProfile\}/);
assert.match(recipeManager, /Wipe menu/);
assert.match(menuImportPanel, /canUseAiImports/);
assert.match(menuImportPanel, /getManagerApiErrorMessage/);
assert.match(apiHeaders, /Your manager login is active/);
assert.match(apiHeaders, /saveManagerApiAccessKey/);
assert.match(invoiceScanner, /Load more invoice lines/);
assert.match(invoiceScanner, /Cost review queue/);

console.log('E2E smoke checks passed');
