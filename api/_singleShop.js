const toSafeString = (value) => String(value || '').trim();

const toTime = (value) => {
  if (value?.toDate) return value.toDate().getTime();
  const time = new Date(String(value || '')).getTime();
  return Number.isFinite(time) ? time : 0;
};

const hasDatabaseRecord = (snapshot, databaseId, expectedDocIds = []) => (
  snapshot.docs.some((documentSnapshot) => (
    expectedDocIds.includes(documentSnapshot.id)
    || toSafeString(documentSnapshot.data()?.databaseId) === databaseId
  ))
);

const recordUpdatedAt = (data) => Math.max(
  toTime(data?.updatedAtServer),
  toTime(data?.updatedAtClient),
  toTime(data?.updatedAt),
  toTime(data?.exportedAt),
  toTime(data?.firestoreSavedAt),
  toTime(data?.createdAtServer),
  toTime(data?.createdAt),
  toTime(data?.scannedAt),
  toTime(data?.invoiceDate),
  toTime(data?.timestamp),
);

const databaseRecordSignal = (snapshot, databaseId, expectedDocIds = []) => {
  const docs = snapshot.docs.filter((documentSnapshot) => (
    expectedDocIds.includes(documentSnapshot.id)
    || toSafeString(documentSnapshot.data()?.databaseId) === databaseId
  ));

  return {
    has: docs.length > 0,
    count: docs.length,
    updatedAtMs: Math.max(0, ...docs.map((documentSnapshot) => recordUpdatedAt(documentSnapshot.data()))),
  };
};

const readCollectionSignal = async (firebaseAdmin, collectionName, databaseId) => {
  try {
    const snapshot = await firebaseAdmin.db
      .collection(collectionName)
      .where('databaseId', '==', databaseId)
      .limit(20)
      .get();

    return {
      has: !snapshot.empty,
      count: snapshot.size,
      updatedAtMs: Math.max(0, ...snapshot.docs.map((documentSnapshot) => recordUpdatedAt(documentSnapshot.data()))),
    };
  } catch (error) {
    console.warn(`Could not score ${collectionName} for single-shop discovery.`, error);
    return { has: false, count: 0, updatedAtMs: 0 };
  }
};

export const loadCanonicalRestaurant = async (firebaseAdmin) => {
  const restaurantsSnapshot = await firebaseAdmin.db
    .collection('restaurants')
    .where('setupCompleted', '==', true)
    .limit(20)
    .get();

  if (restaurantsSnapshot.empty) return null;

  const [appDataSnapshot, managersSnapshot, staffSnapshot] = await Promise.all([
    firebaseAdmin.db.collection('appData').limit(200).get(),
    firebaseAdmin.db.collection('managers').limit(200).get(),
    firebaseAdmin.db.collection('staffAccounts').limit(200).get(),
  ]);
  const candidates = await Promise.all(restaurantsSnapshot.docs.map(async (documentSnapshot) => {
    const profile = documentSnapshot.data();
    const databaseId = toSafeString(profile?.databaseId || documentSnapshot.id);
    const [
      menuSignal,
      wasteSignal,
      invoiceSignal,
      ingredientSignal,
      stockSignal,
      stockMovementSignal,
    ] = await Promise.all([
      readCollectionSignal(firebaseAdmin, 'menuItems', databaseId),
      readCollectionSignal(firebaseAdmin, 'wasteEntries', databaseId),
      readCollectionSignal(firebaseAdmin, 'invoices', databaseId),
      readCollectionSignal(firebaseAdmin, 'ingredients', databaseId),
      readCollectionSignal(firebaseAdmin, 'stockLevels', databaseId),
      readCollectionSignal(firebaseAdmin, 'stockMovements', databaseId),
    ]);
    const appDataSignal = databaseRecordSignal(appDataSnapshot, databaseId, [
      `${databaseId}__main`,
      databaseId,
    ]);
    const managerSignal = databaseRecordSignal(managersSnapshot, databaseId);
    const staffSignal = databaseRecordSignal(staffSnapshot, databaseId);
    const hasAppData = appDataSignal.has;
    const hasManager = hasDatabaseRecord(managersSnapshot, databaseId);
    const hasStaff = hasDatabaseRecord(staffSnapshot, databaseId);
    const operationalRecordCount = invoiceSignal.count
      + wasteSignal.count
      + menuSignal.count
      + ingredientSignal.count
      + stockSignal.count
      + stockMovementSignal.count;
    const score = (invoiceSignal.count * 900)
      + (wasteSignal.count * 500)
      + (menuSignal.count * 220)
      + (ingredientSignal.count * 140)
      + (stockMovementSignal.count * 90)
      + (stockSignal.count * 70)
      + (hasManager ? 420 : 0)
      + (hasStaff ? 160 : 0)
      + (hasAppData ? 240 : 0)
      + (managerSignal.count * 20)
      + (staffSignal.count * 10)
      + (appDataSignal.count * 10);

    return {
      databaseId,
      profile,
      score,
      operationalRecordCount,
      updatedAtMs: Math.max(
        toTime(profile?.updatedAtServer),
        toTime(profile?.updatedAt),
        toTime(profile?.setupCompletedAt),
        toTime(profile?.createdAt),
        appDataSignal.updatedAtMs,
        managerSignal.updatedAtMs,
        staffSignal.updatedAtMs,
        menuSignal.updatedAtMs,
        wasteSignal.updatedAtMs,
        invoiceSignal.updatedAtMs,
        ingredientSignal.updatedAtMs,
        stockSignal.updatedAtMs,
        stockMovementSignal.updatedAtMs,
      ),
    };
  }));
  candidates.sort((left, right) => (
    right.score - left.score
    || right.operationalRecordCount - left.operationalRecordCount
    || right.updatedAtMs - left.updatedAtMs
    || left.databaseId.localeCompare(right.databaseId)
  ));

  return {
    ...candidates[0],
    completedProfileCount: restaurantsSnapshot.size,
  };
};

export const createSafeRestaurantResponse = (candidate) => {
  const profile = candidate?.profile || {};
  return candidate ? {
    databaseId: candidate.databaseId,
    restaurantName: toSafeString(profile.restaurantName || profile.name),
    branchName: toSafeString(profile.branchName || profile.locationName),
    currency: toSafeString(profile.currency) || 'ZAR',
    timezone: toSafeString(profile.timezone) || 'Africa/Johannesburg',
    setupCompleted: profile.setupCompleted === true,
    setupCompletedAt: toSafeString(profile.setupCompletedAt),
    createdAt: toSafeString(profile.createdAt),
    updatedAt: toSafeString(profile.updatedAt),
  } : null;
};
