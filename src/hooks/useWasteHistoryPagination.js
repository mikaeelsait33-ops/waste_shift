import { useCallback, useRef, useState } from 'react';
import { loadFirestoreWasteEntryPage } from '../services/firestoreMenuItems';

const EMPTY_PAGE = { cursor: null, hasMore: false, loading: false };

export const useWasteHistoryPagination = ({ enabled, onAppendEntries }) => {
  const [pageStatus, setPageStatus] = useState(EMPTY_PAGE);
  const loadingRef = useRef(false);

  const loadInitialPage = useCallback(async (options = {}) => {
    if (!enabled) {
      setPageStatus(EMPTY_PAGE);
      return { entries: [], cursor: null, hasMore: false };
    }

    const page = await loadFirestoreWasteEntryPage(options);
    setPageStatus({ cursor: page.cursor, hasMore: page.hasMore, loading: false });
    return page;
  }, [enabled]);

  const loadOlderPage = useCallback(async () => {
    if (!enabled || loadingRef.current || !pageStatus.hasMore) {
      return { ok: false };
    }

    loadingRef.current = true;
    setPageStatus((current) => ({ ...current, loading: true }));

    try {
      const page = await loadFirestoreWasteEntryPage({ cursor: pageStatus.cursor });
      onAppendEntries(page.entries);
      setPageStatus({ cursor: page.cursor, hasMore: page.hasMore, loading: false });
      return { ok: true, loadedCount: page.entries.length };
    } catch (error) {
      setPageStatus((current) => ({ ...current, loading: false }));
      return { ok: false, message: error?.message || 'Could not load older waste entries.' };
    } finally {
      loadingRef.current = false;
    }
  }, [enabled, onAppendEntries, pageStatus.cursor, pageStatus.hasMore]);

  return {
    hasMore: pageStatus.hasMore,
    isLoading: pageStatus.loading,
    loadInitialPage,
    loadOlderPage,
  };
};
