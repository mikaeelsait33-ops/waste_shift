import { firestoreIsConfigured, getFirestoreRuntimeInfo } from '../services/firestoreMenuItems';

export const SERVER_DATABASE_ENDPOINT = '/api/database';
export const FIRESTORE_RUNTIME_INFO = getFirestoreRuntimeInfo();
export const FIRESTORE_CONFIGURED = (
  import.meta.env.VITE_WASTESHIFT_E2E !== 'true' && firestoreIsConfigured()
);
