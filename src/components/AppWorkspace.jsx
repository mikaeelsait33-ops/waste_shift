import { lazy, Suspense } from 'react';
import ErrorBoundary from './ErrorBoundary';
import Navbar from './Navbar';
import WasteForm from './WasteForm';

const Dashboard = lazy(() => import('./Dashboard'));
const InvoiceScanner = lazy(() => import('./InvoiceScanner'));
const ItemPriceManager = lazy(() => import('./ItemPriceManager'));
const RecipeManager = lazy(() => import('./RecipeManager'));
const Reports = lazy(() => import('./Reports'));
const Settings = lazy(() => import('./Settings'));
const StoreRoom = lazy(() => import('./StoreRoom'));
const WasteList = lazy(() => import('./WasteList'));

const PageFallback = ({ label = 'Loading screen' }) => (
  <div className="panel">
    <div className="panel-body">
      <div className="muted-box" style={{ marginBottom: 0 }}>{label}...</div>
    </div>
  </div>
);

export default function AppWorkspace({
  access,
  data,
  inventoryActions,
  menuActions,
  navigation,
  pagination,
  settingsActions,
  sync,
  wasteActions,
}) {
  const {
    accessProfile,
    activeStaffId,
    activeStaffMember,
    authSession,
    onActiveStaffChange,
    onLogout,
  } = access;
  const {
    activeWasteItems,
    auditLog,
    authSettings,
    budget,
    customMenuItems,
    customStaffList,
    effectiveRecipes,
    inventoryMovements,
    invoiceDashboardStats,
    itemPriceCatalog,
    lastSavedAt,
    menuItems,
    portionProfiles,
    settings,
    staffList,
    storeRoomItems,
    storeRoomMovements,
    wasteItems,
  } = data;
  const {
    activeTab,
    inventoryView,
    menuPricingView,
    onInventoryViewChange,
    onMenuPricingViewChange,
    onNavigate,
  } = navigation;

  return (
    <div className="app-shell">
      <Navbar
        activePage={activeTab}
        onNavigate={onNavigate}
        wasteCount={activeWasteItems.length}
        activeStaffMember={activeStaffMember}
        accessProfile={accessProfile}
        onLogout={onLogout}
      />

      <main className={`app-page${['dashboard', 'inventory', 'storeRoom', 'invoices', 'menuPricing', 'wasteLog', 'reports', 'settings'].includes(activeTab) ? ' app-page--wide' : ''}`}>
        <div key={activeTab} className="page-transition">
          <ErrorBoundary key={activeTab}>
            <Suspense fallback={<PageFallback />}>
              {activeTab === 'dashboard' && (
                <Dashboard
                  items={activeWasteItems}
                  budget={budget}
                  settings={settings}
                  staffList={staffList}
                  accessProfile={accessProfile}
                  invoiceStats={invoiceDashboardStats}
                  menuItems={menuItems}
                  recipes={effectiveRecipes}
                  onNavigate={onNavigate}
                />
              )}

              {activeTab === 'logWaste' && (
                <WasteForm
                  onAddEntry={wasteActions.onAddEntry}
                  wasteItems={activeWasteItems}
                  recipes={effectiveRecipes}
                  menuItems={menuItems}
                  staffList={staffList}
                  portionProfiles={portionProfiles}
                  itemPriceCatalog={itemPriceCatalog}
                  accessProfile={accessProfile}
                  onSavePortionProfile={wasteActions.onSavePortionProfile}
                  activeStaffId={activeStaffId}
                  onActiveStaffChange={onActiveStaffChange}
                  onRetryEntrySync={wasteActions.onRetryEntrySync}
                />
              )}

              {activeTab === 'wasteLog' && (
                <WasteList
                  items={wasteItems}
                  onDeleteEntry={wasteActions.onDeleteEntry}
                  onRestoreEntry={wasteActions.onRestoreEntry}
                  onLoadOlderEntries={pagination.onLoadOlderEntries}
                  hasOlderEntries={pagination.hasOlderEntries}
                  isLoadingOlderEntries={pagination.isLoadingOlderEntries}
                  accessProfile={accessProfile}
                />
              )}

              {activeTab === 'inventory' && (
                <>
                  <div className="settings-controls grouped-page-controls">
                    <div className="section-header settings-page-header">
                      <div>
                        <p className="eyebrow">Inventory</p>
                        <h2 className="title">Invoices & Stock</h2>
                        <p className="subtitle">Scan supplier invoices, update ingredient prices, and manage store room stock from one place.</p>
                      </div>
                    </div>
                    <div className="segmented-control settings-tabs" aria-label="Inventory sections">
                      <button
                        type="button"
                        onClick={() => onInventoryViewChange('invoices')}
                        className={`segment-button${inventoryView === 'invoices' ? ' is-active' : ''}`}
                      >
                        Invoices
                      </button>
                      <button
                        type="button"
                        onClick={() => onInventoryViewChange('stock')}
                        className={`segment-button${inventoryView === 'stock' ? ' is-active' : ''}`}
                      >
                        Stock
                      </button>
                    </div>
                  </div>

                  {inventoryView === 'invoices' ? (
                    <InvoiceScanner
                      accessProfile={accessProfile}
                      recipes={effectiveRecipes}
                      menuItems={menuItems}
                      itemPriceCatalog={itemPriceCatalog}
                      inventoryMovements={inventoryMovements}
                      onInvoiceSaved={inventoryActions.onInvoiceSaved}
                      onInvoicePricesUpdated={inventoryActions.onInvoicePricesUpdated}
                      onIngredientDeleted={inventoryActions.onIngredientDeleted}
                    />
                  ) : (
                    <StoreRoom
                      storeRoomItems={storeRoomItems}
                      storeRoomMovements={storeRoomMovements}
                      itemPriceCatalog={itemPriceCatalog}
                      accessProfile={accessProfile}
                      onSaveStoreRoomItem={inventoryActions.onSaveStoreRoomItem}
                      onRecordStoreRoomMovement={inventoryActions.onRecordStoreRoomMovement}
                      onDeleteStoreRoomItem={inventoryActions.onDeleteStoreRoomItem}
                    />
                  )}
                </>
              )}

              {activeTab === 'menuPricing' && (
                <>
                  <div className="settings-controls grouped-page-controls">
                    <div className="section-header settings-page-header">
                      <div>
                        <p className="eyebrow">Menu & Pricing</p>
                        <h2 className="title">Recipes & Ingredients</h2>
                        <p className="subtitle">Keep sellable dishes separate from raw ingredient prices and invoice-updated costs.</p>
                      </div>
                    </div>
                    <div className="segmented-control settings-tabs" aria-label="Menu and pricing sections">
                      <button
                        type="button"
                        onClick={() => onMenuPricingViewChange('recipes')}
                        className={`segment-button${menuPricingView === 'recipes' ? ' is-active' : ''}`}
                      >
                        Recipes
                      </button>
                      <button
                        type="button"
                        onClick={() => onMenuPricingViewChange('ingredients')}
                        className={`segment-button${menuPricingView === 'ingredients' ? ' is-active' : ''}`}
                      >
                        Ingredients
                      </button>
                    </div>
                  </div>

                  {menuPricingView === 'recipes' ? (
                    <RecipeManager
                      recipes={effectiveRecipes}
                      menuItems={menuItems}
                      customMenuItems={customMenuItems}
                      itemPriceCatalog={itemPriceCatalog}
                      accessProfile={accessProfile}
                      onAddRecipe={menuActions.onAddRecipe}
                      onClearRecipes={menuActions.onClearRecipes}
                      onSaveMenuItem={menuActions.onSaveMenuItem}
                      onRemoveCustomMenuItem={menuActions.onRemoveCustomMenuItem}
                      onRestoreMenuItem={menuActions.onRestoreMenuItem}
                      onImportMenuItems={menuActions.onImportMenuItems}
                      onCreateCatalogItem={menuActions.onCreateCatalogItem}
                      onCreateCatalogItems={menuActions.onCreateCatalogItems}
                      activeStaffMember={activeStaffMember}
                    />
                  ) : (
                    <ItemPriceManager
                      itemPriceCatalog={itemPriceCatalog}
                      accessProfile={accessProfile}
                      onSaveItemPrice={menuActions.onCreateCatalogItem}
                      onDeleteItemPrice={menuActions.onDeleteItemPrice}
                    />
                  )}
                </>
              )}

              {activeTab === 'storeRoom' && (
                <StoreRoom
                  storeRoomItems={storeRoomItems}
                  storeRoomMovements={storeRoomMovements}
                  itemPriceCatalog={itemPriceCatalog}
                  accessProfile={accessProfile}
                  onSaveStoreRoomItem={inventoryActions.onSaveStoreRoomItem}
                  onRecordStoreRoomMovement={inventoryActions.onRecordStoreRoomMovement}
                  onDeleteStoreRoomItem={inventoryActions.onDeleteStoreRoomItem}
                />
              )}

              {activeTab === 'invoices' && (
                <InvoiceScanner
                  accessProfile={accessProfile}
                  recipes={effectiveRecipes}
                  menuItems={menuItems}
                  itemPriceCatalog={itemPriceCatalog}
                  inventoryMovements={inventoryMovements}
                  onInvoiceSaved={inventoryActions.onInvoiceSaved}
                  onInvoicePricesUpdated={inventoryActions.onInvoicePricesUpdated}
                  onIngredientDeleted={inventoryActions.onIngredientDeleted}
                />
              )}

              {activeTab === 'reports' && (
                <Reports
                  wasteItems={wasteItems}
                  storeRoomMovements={storeRoomMovements}
                  activeStaffMember={activeStaffMember}
                  accessProfile={accessProfile}
                />
              )}

              {activeTab === 'settings' && (
                <Settings
                  budget={budget}
                  settings={settings}
                  wasteItems={wasteItems}
                  recipes={effectiveRecipes}
                  staffList={staffList}
                  customStaffList={customStaffList}
                  menuItems={menuItems}
                  customMenuItems={customMenuItems}
                  itemPriceCatalog={itemPriceCatalog}
                  storeRoomItems={storeRoomItems}
                  storeRoomMovements={storeRoomMovements}
                  portionProfiles={portionProfiles}
                  activeStaffId={activeStaffId}
                  activeStaffMember={activeStaffMember}
                  accessProfile={accessProfile}
                  inventoryMovements={inventoryMovements}
                  auditLog={auditLog}
                  syncAccessKey={sync.syncAccessKey}
                  authSettings={authSettings}
                  authSession={authSession}
                  firebaseSync={sync.firebaseSync}
                  serverSync={sync.serverSync}
                  lastSavedAt={lastSavedAt}
                  onSaveSettings={settingsActions.onSaveSettings}
                  onClearAllWaste={wasteActions.onClearAllWaste}
                  onAddStaff={settingsActions.onAddStaff}
                  onDeleteStaff={settingsActions.onDeleteStaff}
                  onResetStaffCode={settingsActions.onResetStaffCode}
                  onAddRecipe={menuActions.onAddRecipe}
                  onClearRecipes={menuActions.onClearRecipes}
                  onSaveMenuItem={menuActions.onSaveMenuItem}
                  onRemoveCustomMenuItem={menuActions.onRemoveCustomMenuItem}
                  onRestoreMenuItem={menuActions.onRestoreMenuItem}
                  onImportMenuItems={menuActions.onImportMenuItems}
                  onSaveItemPrice={menuActions.onCreateCatalogItem}
                  onDeleteItemPrice={menuActions.onDeleteItemPrice}
                  onSaveToServer={settingsActions.onSaveToServer}
                  onSaveSyncAccessKey={settingsActions.onSaveSyncAccessKey}
                  onSavePinSettings={settingsActions.onSavePinSettings}
                  onLogout={onLogout}
                  onRestoreDatabase={settingsActions.onRestoreDatabase}
                  onResetRestaurantData={settingsActions.onResetRestaurantData}
                />
              )}
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
