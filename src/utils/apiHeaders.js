import { getClientDatabaseHeaders } from './clientDatabaseId';

export const getManagerApiHeaders = (extraHeaders = {}) => {
  const syncAccessKey = String(localStorage.getItem('wasteShiftSyncAccessKey') || '').trim();

  return getClientDatabaseHeaders({
    ...extraHeaders,
    ...(syncAccessKey
      ? {
          'x-wasteshift-manager-secret': syncAccessKey,
          'x-wasteshift-sync-secret': syncAccessKey,
        }
      : {}),
  });
};
