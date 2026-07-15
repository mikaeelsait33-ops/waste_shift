import { getAutomaticManagerApiHeaders, getManagerApiErrorMessage } from '../utils/apiHeaders';

const readResponse = async (response, fallback) => {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload?.ok === false) {
    return {
      ok: false,
      code: String(payload?.code || ''),
      message: getManagerApiErrorMessage(payload, fallback),
    };
  }

  return payload;
};

export const loadStaffDirectory = async () => {
  try {
    const response = await fetch('/api/staff-session?action=directory', {
      cache: 'no-store',
      headers: await getAutomaticManagerApiHeaders(),
    });
    const payload = await readResponse(response, 'Could not load staff profiles.');
    return payload.ok === false ? payload : { ok: true, staff: Array.isArray(payload.staff) ? payload.staff : [] };
  } catch (error) {
    return { ok: false, staff: [], message: error?.message || 'Could not load staff profiles.' };
  }
};

export const establishStaffSession = async ({ staffId, pin } = {}) => {
  const safeStaffId = String(staffId || '').trim();
  const safePin = String(pin || '').trim();

  if (!safeStaffId || !/^\d{4,8}$/.test(safePin)) {
    return { ok: false, message: 'Choose a staff profile and enter its PIN.' };
  }

  try {
    const response = await fetch('/api/staff-session', {
      method: 'POST',
      headers: await getAutomaticManagerApiHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ staffId: safeStaffId, pin: safePin }),
    });
    return readResponse(response, 'Could not start the staff session.');
  } catch (error) {
    return { ok: false, message: error?.message || 'Could not start the staff session.' };
  }
};

export const validateRestaurantSession = async () => {
  try {
    const response = await fetch('/api/staff-session', {
      cache: 'no-store',
      headers: await getAutomaticManagerApiHeaders(),
    });
    return readResponse(response, 'Your restaurant session has expired.');
  } catch (error) {
    return { ok: false, message: error?.message || 'Could not validate this restaurant session.' };
  }
};

export const revokeStaffSession = async () => {
  try {
    const response = await fetch('/api/staff-session', {
      method: 'DELETE',
      headers: await getAutomaticManagerApiHeaders(),
    });
    return readResponse(response, 'Could not close the staff session.');
  } catch (error) {
    return { ok: false, message: error?.message || 'Could not close the staff session.' };
  }
};

export const saveStaffAccessAccount = async (staff) => {
  try {
    const response = await fetch('/api/staff-accounts', {
      method: 'POST',
      headers: await getAutomaticManagerApiHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ staff }),
    });
    return readResponse(response, 'Could not save the staff account.');
  } catch (error) {
    return { ok: false, message: error?.message || 'Could not save the staff account.' };
  }
};
