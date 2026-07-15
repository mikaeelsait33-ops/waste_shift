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
  const [sessionValidationStatus, setSessionValidationStatus] = useState(() => (
    firebaseConfigured && authSession ? 'checking' : 'ready'
  ));

  useEffect(() => {
    if (!firebaseConfigured || !restaurantReady) {
      setDirectoryLoaded(true);
      return undefined;
    }

    let isCancelled = false;
    setDirectoryLoaded(false);

    loadStaffDirectory().then((result) => {
      if (isCancelled) return;
      setStaffDirectory(result.ok && Array.isArray(result.staff) ? result.staff : []);
      setDirectoryLoaded(true);
    });

    return () => {
      isCancelled = true;
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
    sessionValidationStatus,
    staffDirectory,
  };
};
