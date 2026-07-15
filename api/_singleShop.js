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

export const loadCanonicalRestaurant = async (firebaseAdmin) => {
  const restaurantsSnapshot = await firebaseAdmin.db
    .collection('restaurants')
    .where('setupCompleted', '==', true)
    .limit(20)
    .get();

  if (restaurantsSnapshot.empty) return null;

  const [appDataSnapshot, managersSnapshot, staffSnapshot] = await Promise.all([
    firebaseAdmin.db.collection('appData').limit(50).get(),
    firebaseAdmin.db.collection('managers').limit(100).get(),
    firebaseAdmin.db.collection('staffAccounts').limit(100).get(),
  ]);
  const candidates = await Promise.all(restaurantsSnapshot.docs.map(async (documentSnapshot) => {
    const profile = documentSnapshot.data();
    const databaseId = toSafeString(profile?.databaseId || documentSnapshot.id);
    const [menuSnapshot, wasteSnapshot, invoiceSnapshot] = await Promise.all([
      firebaseAdmin.db.collection('menuItems').where('databaseId', '==', databaseId).limit(1).get(),
      firebaseAdmin.db.collection('wasteEntries').where('databaseId', '==', databaseId).limit(1).get(),
      firebaseAdmin.db.collection('invoices').where('databaseId', '==', databaseId).limit(1).get(),
    ]);
    const hasAppData = hasDatabaseRecord(appDataSnapshot, databaseId, [
      `${databaseId}__main`,
      databaseId,
    ]);
    const hasManager = hasDatabaseRecord(managersSnapshot, databaseId);
    const hasStaff = hasDatabaseRecord(staffSnapshot, databaseId);
    const score = (hasAppData ? 500 : 0)
      + (hasManager ? 400 : 0)
      + (hasStaff ? 150 : 0)
      + (!wasteSnapshot.empty ? 120 : 0)
      + (!invoiceSnapshot.empty ? 100 : 0)
      + (!menuSnapshot.empty ? 80 : 0);

    return {
      databaseId,
      profile,
      score,
      updatedAtMs: Math.max(
        toTime(profile?.updatedAtServer),
        toTime(profile?.updatedAt),
        toTime(profile?.setupCompletedAt),
        toTime(profile?.createdAt),
      ),
    };
  }));
  candidates.sort((left, right) => (
    right.score - left.score
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
