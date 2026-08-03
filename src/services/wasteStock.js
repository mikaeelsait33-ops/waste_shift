import { getAutomaticManagerApiHeaders, getManagerApiErrorMessage } from '../utils/apiHeaders';

export const syncWasteStockForEntry = async (entryId) => {
  const safeEntryId = String(entryId || '').trim();

  if (!safeEntryId) {
    return { ok: false, skipped: true, message: 'Waste entry id is missing.' };
  }

  const response = await fetch('/api/waste-stock', {
    method: 'POST',
    headers: await getAutomaticManagerApiHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ entryId: safeEntryId }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload?.ok === false) {
    throw new Error(getManagerApiErrorMessage(payload, 'Waste was saved, but stock could not be updated.'));
  }

  return payload;
};
