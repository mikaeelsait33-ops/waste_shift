export const getWasteEntrySyncStatus = (entry) => (
  entry?.syncStatus || (entry?.status === 'logged' ? 'local' : entry?.status || 'local')
);

export const wasteEntryNeedsCostReview = (entry) => (
  ['needs_item_price', 'needs_ingredient_costs'].includes(String(entry?.costStatus || ''))
);

export const createTodayShiftSummary = (items, now = new Date()) => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayItems = (Array.isArray(items) ? items : []).filter((item) => {
    const dateValue = String(item?.date || '');
    const parts = dateValue.split('/');
    const itemDate = parts.length === 3
      ? new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]))
      : new Date(dateValue);

    itemDate.setHours(0, 0, 0, 0);
    return itemDate.getTime() === today.getTime();
  });
  const topReasons = Object.entries(todayItems.reduce((acc, item) => {
    const reason = item?.reason || 'Unknown';
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {}))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([reason, count]) => ({ reason, count }));

  return {
    todayItems,
    entryCount: todayItems.length,
    pendingSyncCount: todayItems.filter((item) => ['pending', 'failed'].includes(getWasteEntrySyncStatus(item))).length,
    costReviewCount: todayItems.filter(wasteEntryNeedsCostReview).length,
    latestEntries: [...todayItems]
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 5),
    topReasons,
  };
};

