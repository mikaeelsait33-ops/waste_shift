import { getClientDatabaseHeaders } from './clientDatabaseId';

export const getStoredManagerApiAccessKey = () => (
  typeof localStorage === 'undefined'
    ? ''
    : String(localStorage.getItem('wasteShiftSyncAccessKey') || '').trim()
);

export const saveManagerApiAccessKey = (value) => {
  const accessKey = String(value || '').trim();

  if (typeof localStorage === 'undefined') {
    return accessKey;
  }

  if (accessKey) {
    localStorage.setItem('wasteShiftSyncAccessKey', accessKey);
  } else {
    localStorage.removeItem('wasteShiftSyncAccessKey');
  }

  return accessKey;
};

export const getManagerApiErrorMessage = (payload, fallback = 'The protected request failed.') => {
  const code = String(payload?.code || '').trim();

  if (code === 'manager_api_secret_required' || code === 'sync_api_secret_required') {
    return 'Your manager login is active, but this device still needs the Gemini access key. Enter it below once on this trusted device.';
  }

  if (code === 'manager_api_secret_invalid' || code === 'sync_api_secret_invalid') {
    return 'The Gemini access key saved on this device does not match the key in Vercel. Re-enter the correct key and try again.';
  }

  if (code === 'manager_api_secret_not_configured' || code === 'sync_api_secret_not_configured') {
    return 'Gemini access is not configured on Vercel yet. Add WASTESHIFT_MANAGER_API_SECRET, then redeploy the app.';
  }

  return payload?.message || payload?.errors?.[0] || fallback;
};

export const getManagerApiHeaders = (extraHeaders = {}) => {
  const syncAccessKey = getStoredManagerApiAccessKey();

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
