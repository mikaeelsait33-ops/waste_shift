import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const navbar = await readFile(new URL('../src/components/Navbar.jsx', import.meta.url), 'utf8');
const settings = await readFile(new URL('../src/components/Settings.jsx', import.meta.url), 'utf8');
const workspace = await readFile(new URL('../src/components/AppWorkspace.jsx', import.meta.url), 'utf8');

assert.match(navbar, /key: 'inventory'/, 'Navigation should expose one Inventory tab.');
assert.match(navbar, /key: 'menuPricing'/, 'Navigation should expose one Menu & Pricing tab.');
assert.doesNotMatch(navbar, /key: 'invoices'/, 'Invoices should not be a duplicate top-level navigation tab.');
assert.doesNotMatch(navbar, /key: 'storeRoom'/, 'Stock should not be a duplicate top-level navigation tab.');
assert.doesNotMatch(navbar, /key: 'reports'/, 'Reports should not crowd the main navigation as a duplicate dashboard destination.');

assert.doesNotMatch(settings, /key: 'ingredients', label: 'Ingredients'/, 'Ingredients should not be duplicated as a Settings tab.');
assert.doesNotMatch(settings, /key: 'items', label: 'Menu & Recipes'/, 'Menu recipes should not be duplicated as a Settings tab.');

assert.match(workspace, /activeTab === 'inventory'/, 'Workspace should render a grouped Inventory page.');
assert.match(workspace, /onInventoryViewChange\('invoices'\)/, 'Inventory should include an invoices sub-tab.');
assert.match(workspace, /onInventoryViewChange\('stock'\)/, 'Inventory should include a stock sub-tab.');
assert.match(workspace, /activeTab === 'menuPricing'/, 'Workspace should render a grouped Menu & Pricing page.');
assert.match(workspace, /onMenuPricingViewChange\('recipes'\)/, 'Menu & Pricing should include a recipes sub-tab.');
assert.match(workspace, /onMenuPricingViewChange\('ingredients'\)/, 'Menu & Pricing should include an ingredients sub-tab.');

console.log('navigation grouping tests passed');
