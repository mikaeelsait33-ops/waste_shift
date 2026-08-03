import { useEffect, useState } from 'react';
import { loadStaffDirectory, validateRestaurantSession } from '../services/staffSession';

export const useRestaurantAccess = ({
  firebaseConfigured,
  restaurantReady,
  authSession,
  onSessionRejected,
}) => {
  const [staffDirectory, setStaffDirectory] = useState([]);
  const [directoryLoaded, setDirectoryLoaded] = useState(!firebaseConfigured || !restaurantReady);
  const [directoryStatus, setDirectoryStatus] = useState(() => (
    firebaseConfigured && restaurantReady ? 'loading' : 'ready'
  ));
  const [sessionValidationStatus, setSessionValidationStatus] = useState(() => (
    firebaseConfigured && authSession ? 'checking' : 'ready'
  ));

  useEffect(() => {
    if (!firebaseConfigured || !restaurantReady) {
      setDirectoryLoaded(true);
      setDirectoryStatus('ready');
      return undefined;
    }

    let isCancelled = false;
    let refreshInFlight = false;
    const refreshDirectory = async ({ showLoading = false } = {}) => {
      if (refreshInFlight) return;
      refreshInFlight = true;
      if (showLoading) {
        setDirectoryLoaded(false);
        setDirectoryStatus('loading');
      }

      try {
        const result = await loadStaffDirectory();
        if (isCancelled) return;
        if (result.ok && Array.isArray(result.staff)) {
          setStaffDirectory(result.staff);
          setDirectoryStatus('ready');
        } else {
          setDirectoryStatus('error');
        }
        setDirectoryLoaded(true);
      } catch {
        if (!isCancelled) {
          setDirectoryStatus('error');
          setDirectoryLoaded(true);
        }
      } finally {
        refreshInFlight = false;
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshDirectory();
      }
    };

    refreshDirectory({ showLoading: true });
    const intervalId = window.setInterval(refreshDirectory, 45 * 1000);
    window.addEventListener('focus', refreshDirectory);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshDirectory);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [firebaseConfigured, restaurantReady]);

  useEffect(() => {
    if (!firebaseConfigured || !authSession) {
      setSessionValidationStatus('ready');
      return undefined;
    }

    let isCancelled = false;
    setSessionValidationStatus('checking');

    validateRestaurantSession().then((result) => {
      if (isCancelled) return;
      const serverSession = result?.session;
      const localRole = String(authSession?.roleKey || '').trim().toLowerCase();
      const serverRole = String(serverSession?.roleKey || '').trim().toLowerCase();
      const sessionMatches = result.ok
        && serverSession
        && String(serverSession.databaseId || '') === String(authSession.databaseId || '')
        && String(serverSession.staffId || '') === String(authSession.staffId || '')
        && serverRole === localRole;

      if (!sessionMatches) {
        onSessionRejected?.({
          ...result,
          ok: false,
          message: result?.message || 'Your saved restaurant access no longer matches the server session.',
        });
      }
      setSessionValidationStatus('ready');
    });

    return () => {
      isCancelled = true;
    };
  }, [authSession, firebaseConfigured, onSessionRejected]);

  return {
    directoryLoaded,
    directoryStatus,
    sessionValidationStatus,
    staffDirectory,
  };
};
