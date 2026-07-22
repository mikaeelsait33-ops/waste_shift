import { getClientDatabaseHeaders } from './clientDatabaseId';
import { ensureFirebaseAuth } from '../services/firestoreMenuItems';

export const getManagerApiErrorMessage = (payload, fallback = 'The protected request failed.') => {
  const code = String(payload?.code || '').trim();

  if (code === 'manager_session_required' || code === 'manager_session_rejected') {
    return 'Your manager session has expired. Lock the app and sign in again with your manager PIN.';
  }

  if (code === 'firebase_token_required' || code === 'firebase_token_invalid') {
    return 'Your sign-in session needs to be refreshed. Lock the app and sign in again.';
  }

  if (code === 'restaurant_session_required' || code === 'restaurant_session_rejected' || code === 'access_session_expired') {
    return 'Your restaurant session has expired. Lock the app and sign in again.';
  }

  if (code === 'firebase_manager_session_not_configured') {
    return 'Gemini is almost ready. An owner still needs to add Firebase Admin credentials in Vercel once; no key is needed in this app.';
  }

  if (code === 'manager_session_unavailable') {
    return 'Manager access is temporarily unavailable. Please try again.';
  }

  return payload?.message || payload?.errors?.[0] || fallback;
};

// Firebase ID tokens are short-lived and can be verified by Vercel with Firebase Admin.
// No server secret is ever stored in the browser for Gemini/OCR requests.
export const getAutomaticManagerApiHeaders = async (extraHeaders = {}) => {
  let idToken = '';

  try {
    const user = await ensureFirebaseAuth();
    idToken = await user?.getIdToken?.();
  } catch (error) {
    console.warn('Could not refresh Firebase sign-in for a manager request.', error);
  }

  return getClientDatabaseHeaders({
    ...extraHeaders,
    ...(idToken ? { 'x-wasteshift-firebase-token': idToken } : {}),
  });
};
