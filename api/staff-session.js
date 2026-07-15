import { getFirebaseAdmin } from './_firebaseAdmin.js';
import { verifyFirebaseIdToken } from './_firebaseIdentity.js';
import { getHeaderValue, getRequestDatabaseId } from './_auth.js';
import { createAccessSession, deleteAccessSession, loadValidAccessSession } from './_accessSession.js';
import { checkPinAttemptAllowed, clearPinFailures, recordPinFailure } from './_loginThrottle.js';
import { isPinRecord, verifyPinRecord } from './_pinVerification.js';

const sendJson = (response, status, body) => {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-robots-tag', 'noindex, nofollow');
  response.status(status).json(body);
};

const readJsonBody = async (request) => {
  if (!request.body) return {};
  if (typeof request.body === 'object') return request.body;
  return JSON.parse(request.body);
};

const normalizeStaffRecord = (record) => {
  const id = String(record?.id || '').trim();
  const name = String(record?.name || '').trim();
  const role = String(record?.role || 'Team').trim();
  const roleKey = String(record?.roleKey || '').trim().toLowerCase()
    || (/chef|kitchen|cook/i.test(role) ? 'chef' : /barista|coffee|bar/i.test(role) ? 'barista' : 'waiter');

  if (!id || !name || record?.removed === true || record?.active === false) {
    return null;
  }

  if (record?.staffSection === 'management' || /owner|manager|management/i.test(role)) {
    return null;
  }

  return {
    id,
    name,
    role,
    roleKey: ['chef', 'barista', 'waiter'].includes(roleKey) ? roleKey : 'waiter',
    staffSection: String(record?.staffSection || '').trim(),
    staffCode: isPinRecord(record?.staffCode) ? record.staffCode : null,
    active: true,
  };
};

const normalizeManagerRecord = (record) => {
  const id = String(record?.id || '').trim();
  const name = String(record?.name || '').trim();
  const role = String(record?.role || '').trim();
  const isManager = record?.staffSection === 'management'
    || String(record?.roleKey || '').trim().toLowerCase() === 'manager'
    || /owner|manager|management/i.test(role);

  if (!id || !name || !isManager || record?.removed === true || record?.active === false) {
    return null;
  }

  return {
    id,
    name,
    role: 'Manager',
    roleKey: 'manager',
    staffSection: 'management',
    managerPin: isPinRecord(record?.managerPin) ? record.managerPin : null,
    active: true,
  };
};

const stripCredentialFields = (records) => (
  (Array.isArray(records) ? records : []).map((record) => {
    const { staffCode: _staffCode, managerPin: _managerPin, ...safeRecord } = record || {};
    return safeRecord;
  })
);

const applyLegacySharedPins = (records, authSettings) => {
  const managementPin = isPinRecord(authSettings?.managementPin) ? authSettings.managementPin : null;
  const staffPin = isPinRecord(authSettings?.staffPin) ? authSettings.staffPin : null;

  return records.map((record) => {
    const isManager = record?.staffSection === 'management'
      || String(record?.roleKey || '').trim().toLowerCase() === 'manager'
      || /owner|manager|management/i.test(String(record?.role || ''));

    if (isManager && !isPinRecord(record?.managerPin) && managementPin) {
      return { ...record, managerPin: managementPin };
    }

    if (!isManager && !isPinRecord(record?.staffCode) && staffPin) {
      return { ...record, staffCode: staffPin };
    }

    return record;
  });
};

const migrateAccessRecords = async (firebaseAdmin, databaseId, records, existingStaffIds = new Set(), existingManagerIds = new Set()) => {
  let migratedCount = 0;

  for (const rawRecord of records) {
    const manager = normalizeManagerRecord(rawRecord);
    if (manager?.managerPin && !existingManagerIds.has(manager.id)) {
      const now = new Date().toISOString();
      await firebaseAdmin.db.collection('managers').doc(`${databaseId}__${manager.id}`).set({
        databaseId,
        ...manager,
        removed: false,
        createdAt: String(rawRecord?.createdAt || now),
        updatedAt: now,
      }, { merge: true });
      existingManagerIds.add(manager.id);
      migratedCount += 1;
      continue;
    }

    const staff = normalizeStaffRecord(rawRecord);
    if (staff?.staffCode && !existingStaffIds.has(staff.id)) {
      const now = new Date().toISOString();
      await firebaseAdmin.db.collection('staffAccounts').doc(`${databaseId}__${staff.id}`).set({
        databaseId,
        ...staff,
        createdAt: String(rawRecord?.createdAt || now),
        updatedAt: now,
      }, { merge: true });
      existingStaffIds.add(staff.id);
      migratedCount += 1;
    }
  }

  return migratedCount;
};

const migrateLegacyStaffAccounts = async (firebaseAdmin, databaseId) => {
  const appDataRef = firebaseAdmin.db.collection('appData').doc(`${databaseId}__main`);
  const [accountsSnapshot, managersSnapshot, appDataSnapshot] = await Promise.all([
    firebaseAdmin.db.collection('staffAccounts').where('databaseId', '==', databaseId).get(),
    firebaseAdmin.db.collection('managers').where('databaseId', '==', databaseId).get(),
    appDataRef.get(),
  ]);
  const existingById = new Map(accountsSnapshot.docs.map((snapshot) => [snapshot.data()?.id, snapshot.data()]));
  const existingManagerIds = new Set(managersSnapshot.docs.map((snapshot) => snapshot.data()?.id));
  const appDataDocument = appDataSnapshot.exists ? appDataSnapshot.data() : null;
  const data = appDataDocument?.data && typeof appDataDocument.data === 'object' ? appDataDocument.data : {};
  const legacyRecords = applyLegacySharedPins([
    ...(Array.isArray(data.customStaffList) ? data.customStaffList : []),
    ...(Array.isArray(data.staffList) ? data.staffList : []),
  ], data.authSettings);

  await migrateAccessRecords(firebaseAdmin, databaseId, legacyRecords, new Set(existingById.keys()), existingManagerIds);

  const refreshedAccountsSnapshot = await firebaseAdmin.db
    .collection('staffAccounts')
    .where('databaseId', '==', databaseId)
    .get();

  if (appDataSnapshot.exists && legacyRecords.some((record) => record?.staffCode || record?.managerPin)) {
    await appDataRef.set({
      data: {
        ...data,
        customStaffList: stripCredentialFields(data.customStaffList),
        staffList: stripCredentialFields(data.staffList),
        authSettings: {
          ...(data.authSettings && typeof data.authSettings === 'object' ? data.authSettings : {}),
          staffPin: null,
          managementPin: null,
        },
      },
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  }

  return refreshedAccountsSnapshot.docs.map((snapshot) => normalizeStaffRecord(snapshot.data())).filter(Boolean);
};

const migrateSingleShopLegacyAccess = async (firebaseAdmin, databaseId) => {
  const restaurantsSnapshot = await firebaseAdmin.db.collection('restaurants').limit(2).get();
  if (restaurantsSnapshot.size !== 1) return false;

  const restaurantSnapshot = restaurantsSnapshot.docs[0];
  const restaurantDatabaseId = String(restaurantSnapshot.data()?.databaseId || restaurantSnapshot.id || '').trim();
  if (restaurantDatabaseId !== databaseId) return false;

  const [staffSnapshot, managersSnapshot, appDataSnapshot] = await Promise.all([
    firebaseAdmin.db.collection('staffAccounts').limit(100).get(),
    firebaseAdmin.db.collection('managers').limit(100).get(),
    firebaseAdmin.db.collection('appData').limit(20).get(),
  ]);
  const targetStaffIds = new Set(
    staffSnapshot.docs
      .filter((snapshot) => snapshot.data()?.databaseId === databaseId)
      .map((snapshot) => snapshot.data()?.id),
  );
  const targetManagerIds = new Set(
    managersSnapshot.docs
      .filter((snapshot) => snapshot.data()?.databaseId === databaseId)
      .map((snapshot) => snapshot.data()?.id),
  );
  let migratedCount = await migrateAccessRecords(
    firebaseAdmin,
    databaseId,
    [
      ...managersSnapshot.docs.map((snapshot) => snapshot.data()),
      ...staffSnapshot.docs.map((snapshot) => snapshot.data()),
    ],
    targetStaffIds,
    targetManagerIds,
  );

  for (const sourceSnapshot of appDataSnapshot.docs) {
    const sourceDocument = sourceSnapshot.data();
    const sourceData = sourceDocument?.data && typeof sourceDocument.data === 'object' ? sourceDocument.data : {};
    const sourceRecords = applyLegacySharedPins([
      ...(Array.isArray(sourceData.customStaffList) ? sourceData.customStaffList : []),
      ...(Array.isArray(sourceData.staffList) ? sourceData.staffList : []),
    ], sourceData.authSettings);
    const copiedCount = await migrateAccessRecords(
      firebaseAdmin,
      databaseId,
      sourceRecords,
      targetStaffIds,
      targetManagerIds,
    );
    migratedCount += copiedCount;

    if (copiedCount > 0) {
      await sourceSnapshot.ref.set({
        data: {
          ...sourceData,
          customStaffList: stripCredentialFields(sourceData.customStaffList),
          staffList: stripCredentialFields(sourceData.staffList),
          authSettings: {
            ...(sourceData.authSettings && typeof sourceData.authSettings === 'object' ? sourceData.authSettings : {}),
            staffPin: null,
            managementPin: null,
          },
        },
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    }
  }

  return migratedCount > 0;
};

const loadManagerDirectory = async (firebaseAdmin, databaseId) => {
  const snapshot = await firebaseAdmin.db
    .collection('managers')
    .where('databaseId', '==', databaseId)
    .get();

  return snapshot.docs.map((documentSnapshot) => {
    const manager = documentSnapshot.data();
    const id = String(manager?.id || '').trim();
    const name = String(manager?.name || '').trim();

    if (!id || !name || manager?.removed === true || manager?.active === false) {
      return null;
    }

    return {
      id,
      name,
      role: 'Manager',
      roleKey: 'manager',
      staffSection: 'management',
      active: true,
    };
  }).filter(Boolean);
};

const authenticateFirebaseRequest = async (request) => {
  const databaseId = getRequestDatabaseId(request);
  const idToken = String(getHeaderValue(request, 'x-wasteshift-firebase-token') || '').trim();

  if (!databaseId || !idToken) return null;

  const decodedToken = await verifyFirebaseIdToken(idToken);
  return { databaseId, uid: decodedToken.uid };
};

export default async function handler(request, response) {
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) {
    sendJson(response, 405, { ok: false, message: 'Use GET, POST, or DELETE.' });
    return;
  }

  const firebaseAdmin = getFirebaseAdmin();
  if (!firebaseAdmin) {
    sendJson(response, 503, { ok: false, code: 'firebase_access_not_configured', message: 'Firebase Admin access is not configured on the server.' });
    return;
  }

  let identity;
  try {
    identity = await authenticateFirebaseRequest(request);
  } catch {
    identity = null;
  }

  if (!identity) {
    sendJson(response, 401, { ok: false, code: 'firebase_token_invalid', message: 'Sign in again and retry.' });
    return;
  }

  try {
    if (request.method === 'DELETE') {
      await deleteAccessSession(firebaseAdmin, identity.databaseId, identity.uid);
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === 'GET' && String(request.query?.action || '') === 'directory') {
      let [staffRecords, managerRecords] = await Promise.all([
        migrateLegacyStaffAccounts(firebaseAdmin, identity.databaseId),
        loadManagerDirectory(firebaseAdmin, identity.databaseId),
      ]);
      if (staffRecords.length === 0 && managerRecords.length === 0) {
        const migrated = await migrateSingleShopLegacyAccess(firebaseAdmin, identity.databaseId);
        if (migrated) {
          [staffRecords, managerRecords] = await Promise.all([
            migrateLegacyStaffAccounts(firebaseAdmin, identity.databaseId),
            loadManagerDirectory(firebaseAdmin, identity.databaseId),
          ]);
        }
      }
      sendJson(response, 200, {
        ok: true,
        staff: [...managerRecords, ...staffRecords]
          .map(({ staffCode: _staffCode, managerPin: _managerPin, ...record }) => record),
      });
      return;
    }

    if (request.method === 'GET') {
      const session = await loadValidAccessSession(firebaseAdmin, identity.databaseId, identity.uid);
      if (!session) {
        sendJson(response, 401, { ok: false, code: 'access_session_expired', message: 'Your restaurant session has expired.' });
        return;
      }

      sendJson(response, 200, { ok: true, session });
      return;
    }

    const body = await readJsonBody(request);
    const staffId = String(body?.staffId || '').trim();
    const pin = String(body?.pin || '').trim();
    if (!staffId || !/^\d{4,8}$/.test(pin)) {
      sendJson(response, 400, { ok: false, message: 'Choose a staff profile and enter its PIN.' });
      return;
    }

    const attemptIdentity = {
      databaseId: identity.databaseId,
      uid: identity.uid,
      accountType: 'staff',
      accountId: staffId,
    };
    const attemptStatus = await checkPinAttemptAllowed(firebaseAdmin, attemptIdentity);
    if (!attemptStatus.allowed) {
      response.setHeader('retry-after', String(attemptStatus.retryAfterSeconds));
      sendJson(response, 429, {
        ok: false,
        code: 'staff_pin_locked',
        message: 'Too many PIN attempts. Wait a few minutes and try again.',
      });
      return;
    }

    const records = await migrateLegacyStaffAccounts(firebaseAdmin, identity.databaseId);
    const staff = records.find((record) => record.id === staffId);

    if (!staff || !verifyPinRecord(pin, staff.staffCode)) {
      await recordPinFailure(firebaseAdmin, attemptIdentity);
      sendJson(response, 403, { ok: false, code: 'staff_pin_rejected', message: 'Staff profile or PIN was not accepted.' });
      return;
    }

    await clearPinFailures(firebaseAdmin, attemptIdentity);
    const session = await createAccessSession(firebaseAdmin, {
      databaseId: identity.databaseId,
      uid: identity.uid,
      staffId: staff.id,
      staffName: staff.name,
      roleKey: staff.roleKey,
    });
    sendJson(response, 200, { ok: true, session });
  } catch (error) {
    console.error('Staff access request failed.', error);
    sendJson(response, 503, { ok: false, code: 'staff_access_unavailable', message: 'Staff access is temporarily unavailable. Please try again.' });
  }
}
