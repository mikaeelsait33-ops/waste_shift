export const DEFAULT_PAGE_SIZE = 25;
export const MAX_DASHBOARD_ROWS = 12;

const toSafeInteger = (value, fallback) => {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

export const clampListLimit = (value, {
  fallback = DEFAULT_PAGE_SIZE,
  min = DEFAULT_PAGE_SIZE,
  max = 500,
} = {}) => {
  const number = toSafeInteger(value, fallback);
  return Math.min(Math.max(number, min), max);
};

export const getVisiblePage = (records, {
  limit = DEFAULT_PAGE_SIZE,
  fallbackLimit = DEFAULT_PAGE_SIZE,
} = {}) => {
  const safeRecords = Array.isArray(records) ? records : [];
  const safeLimit = clampListLimit(limit, { fallback: fallbackLimit, min: fallbackLimit });
  const visibleRecords = safeRecords.slice(0, safeLimit);

  return {
    records: visibleRecords,
    visibleCount: visibleRecords.length,
    totalCount: safeRecords.length,
    hasMore: visibleRecords.length < safeRecords.length,
    nextLimit: clampListLimit(safeLimit + fallbackLimit, {
      fallback: fallbackLimit,
      min: fallbackLimit,
      max: Math.max(safeRecords.length, fallbackLimit),
    }),
  };
};

export const limitDashboardRows = (rows, limit = MAX_DASHBOARD_ROWS) => (
  (Array.isArray(rows) ? rows : []).slice(0, clampListLimit(limit, {
    fallback: MAX_DASHBOARD_ROWS,
    min: 1,
    max: 50,
  }))
);
