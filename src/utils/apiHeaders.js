export const getManagerApiHeaders = (extraHeaders = {}) => {
  const syncAccessKey = String(localStorage.getItem('wasteShiftSyncAccessKey') || '').trim();

  return {
    ...extraHeaders,
    ...(syncAccessKey ? { 'x-wasteshift-sync-secret': syncAccessKey } : {}),
  };
};
