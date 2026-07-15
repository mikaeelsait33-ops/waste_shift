import { getAutomaticManagerApiHeaders, getManagerApiErrorMessage } from '../utils/apiHeaders';

export const establishManagerSession = async ({ managerId, pin } = {}) => {
  const safeManagerId = String(managerId || '').trim();
  const safePin = String(pin || '').trim();

  if (!safeManagerId || !/^\d{4,8}$/.test(safePin)) {
    return { ok: false, message: 'A valid manager account and PIN are required.' };
  }

  try {
    const response = await fetch('/api/manager-session', {
      method: 'POST',
      headers: await getAutomaticManagerApiHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ managerId: safeManagerId, pin: safePin }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload?.ok === false) {
      return {
        ok: false,
        message: getManagerApiErrorMessage(payload, 'Could not prepare manager access for Gemini.'),
      };
    }

    return { ok: true, expiresAt: String(payload?.expiresAt || '') };
  } catch (error) {
    return { ok: false, message: error?.message || 'Could not prepare manager access for Gemini.' };
  }
};

export const revokeManagerSession = async () => {
  try {
    const response = await fetch('/api/manager-session', {
      method: 'DELETE',
      headers: await getAutomaticManagerApiHeaders(),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload?.ok === false) {
      return {
        ok: false,
        message: getManagerApiErrorMessage(payload, 'Could not close the server manager session.'),
      };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, message: error?.message || 'Could not close the server manager session.' };
  }
};

export const recoverManagerSession = async ({ managerId, name, pin, recoveryKey } = {}) => {
  try {
    const response = await fetch('/api/manager-recovery', {
      method: 'POST',
      headers: await getAutomaticManagerApiHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ managerId, name, pin, recoveryKey }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload?.ok === false) {
      return {
        ok: false,
        message: getManagerApiErrorMessage(payload, 'Could not recover manager access.'),
      };
    }

    return payload;
  } catch (error) {
    return { ok: false, message: error?.message || 'Could not recover manager access.' };
  }
};
