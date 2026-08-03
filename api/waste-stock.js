import { authorizeRestaurantSessionRequest } from './_auth.js';
import { getFirebaseAdmin } from './_firebaseAdmin.js';

export const config = {
  maxDuration: 30,
};

const sendJson = (response, status, body) => {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-robots-tag', 'noindex, nofollow');
  response.status(status).json(body);
};

const readJsonBody = async (request) => {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') return JSON.parse(request.body);

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
};

const safeString = (value) => String(value || '').trim();
const safeNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const roundQuantity = (value) => Math.round(safeNumber(value) * 10000) / 10000;
const scopeDocId = (databaseId, id) => `${databaseId}__${safeString(id)}`;
const entryIsVoided = (entry) => (
  ['voided', 'deleted'].includes(safeString(entry?.status).toLowerCase())
  || Boolean(entry?.voidedAt)
);

const groupDeductions = (deductions) => {
  const grouped = new Map();

  (Array.isArray(deductions) ? deductions : []).forEach((deduction) => {
    const ingredientId = safeString(deduction?.ingredientId);
    const quantityBase = roundQuantity(deduction?.quantityBase);

    if (!ingredientId || quantityBase <= 0) return;
    const current = grouped.get(ingredientId) || {
      ingredientId,
      ingredientName: safeString(deduction?.ingredientName) || ingredientId,
      quantityBase: 0,
      baseUnit: safeString(deduction?.baseUnit) || 'each',
      cost: 0,
    };
    current.quantityBase = roundQuantity(current.quantityBase + quantityBase);
    current.cost = Math.round((current.cost + safeNumber(deduction?.cost)) * 100) / 100;
    grouped.set(ingredientId, current);
  });

  return [...grouped.values()];
};

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, message: 'Use POST to sync waste stock.' });
    return;
  }

  const authorization = await authorizeRestaurantSessionRequest(request);
  if (!authorization.ok) {
    sendJson(response, authorization.status, authorization.body);
    return;
  }

  const firebaseAdmin = getFirebaseAdmin();
  if (!firebaseAdmin) {
    sendJson(response, 503, {
      ok: false,
      code: 'firebase_access_not_configured',
      message: 'Restaurant stock sync is not configured on the server.',
    });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const entryId = safeString(body?.entryId);

    if (!entryId) {
      sendJson(response, 400, { ok: false, message: 'Waste entry id is required.' });
      return;
    }

    const databaseId = authorization.databaseId;
    const wasteRef = firebaseAdmin.db.collection('wasteEntries').doc(scopeDocId(databaseId, entryId));
    const result = await firebaseAdmin.db.runTransaction(async (transaction) => {
      const wasteSnapshot = await transaction.get(wasteRef);
      if (!wasteSnapshot.exists) {
        return { ok: false, status: 404, message: 'The saved waste entry could not be found.' };
      }

      const wasteEntry = wasteSnapshot.data() || {};
      const canSyncEntry = ['owner', 'manager'].includes(authorization.roleKey)
        || wasteEntry.createdByUid === authorization.uid;

      if (wasteEntry.databaseId !== databaseId || !canSyncEntry) {
        return { ok: false, status: 403, message: 'This account cannot update stock for that waste entry.' };
      }

      const deductions = groupDeductions(wasteEntry.stockDeductions);
      const shouldBeApplied = !entryIsVoided(wasteEntry);
      const isApplied = wasteEntry.stockConsumptionApplied === true;
      const now = firebaseAdmin.Timestamp.now();

      if (deductions.length === 0) {
        transaction.set(wasteRef, {
          stockConsumptionApplied: false,
          stockConsumptionStatus: 'not_applicable',
          stockConsumptionUpdatedAt: now,
        }, { merge: true });
        return { ok: true, skipped: true, updates: [] };
      }

      if (shouldBeApplied === isApplied) {
        return {
          ok: true,
          alreadySynced: true,
          applied: isApplied,
          updates: [],
        };
      }

      const stockRefs = deductions.map((deduction) => (
        firebaseAdmin.db.collection('stockLevels').doc(scopeDocId(databaseId, deduction.ingredientId))
      ));
      const stockSnapshots = await Promise.all(stockRefs.map((stockRef) => transaction.get(stockRef)));
      const revision = Math.max(0, Math.trunc(safeNumber(wasteEntry.stockConsumptionRevision))) + 1;
      const direction = shouldBeApplied ? -1 : 1;
      const updates = [];

      deductions.forEach((deduction, index) => {
        const stockRef = stockRefs[index];
        const stockData = stockSnapshots[index].exists ? stockSnapshots[index].data() : {};
        const previousQty = roundQuantity(stockData?.currentQty);
        const currentQty = roundQuantity(previousQty + (direction * deduction.quantityBase));
        const reorderPoint = safeNumber(stockData?.reorderPoint);
        const parLevel = safeNumber(stockData?.parLevel);
        const status = reorderPoint > 0 && currentQty <= reorderPoint
          ? 'low'
          : parLevel > 0 && currentQty > parLevel
            ? 'overstocked'
            : 'ok';
        const movementId = `${entryId}-waste-${revision}-${deduction.ingredientId}`
          .replace(/[^a-zA-Z0-9_-]/g, '_')
          .slice(0, 180);
        const signedQuantity = roundQuantity(direction * deduction.quantityBase);

        transaction.set(stockRef, {
          databaseId,
          ingredientId: deduction.ingredientId,
          currentQty,
          unit: safeString(stockData?.unit || deduction.baseUnit) || 'each',
          status,
          reorderPoint,
          parLevel,
          lastMovementId: movementId,
          lastUpdated: now,
          lastWasteEntryId: entryId,
        }, { merge: true });
        transaction.set(
          firebaseAdmin.db.collection('stockMovements').doc(scopeDocId(databaseId, movementId)),
          {
            databaseId,
            id: movementId,
            movementId,
            ingredientId: deduction.ingredientId,
            ingredientName: deduction.ingredientName,
            type: shouldBeApplied ? 'waste' : 'waste_reversal',
            quantityBase: signedQuantity,
            baseUnit: deduction.baseUnit,
            previousQuantityBase: previousQty,
            resultingQuantityBase: currentQty,
            status,
            sourceType: 'waste_entry',
            sourceId: entryId,
            wasteEntryId: entryId,
            wasteReason: safeString(wasteEntry.reason),
            staff: safeString(wasteEntry.staff),
            lineTotalExVAT: deduction.cost,
            sortDate: safeString(wasteEntry.createdAt || wasteEntry.timestamp) || new Date().toISOString(),
            createdAt: now,
          },
          { merge: true },
        );
        updates.push({
          ingredientId: deduction.ingredientId,
          ingredientName: deduction.ingredientName,
          previousQty,
          changeQty: signedQuantity,
          currentQty,
          unit: deduction.baseUnit,
          status,
        });
      });

      transaction.set(wasteRef, {
        stockConsumptionApplied: shouldBeApplied,
        stockConsumptionRevision: revision,
        stockConsumptionStatus: shouldBeApplied ? 'deducted' : 'reversed',
        stockConsumptionUpdatedAt: now,
        stockConsumptionUpdatedBy: authorization.staffId,
      }, { merge: true });

      return {
        ok: true,
        applied: shouldBeApplied,
        revision,
        updates,
      };
    });

    if (!result.ok) {
      sendJson(response, result.status || 400, result);
      return;
    }

    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      message: error?.message || 'Could not sync waste with stock.',
    });
  }
}
