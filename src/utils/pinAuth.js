const PIN_ALGORITHM = 'sha256-salt-v1';

export const DEFAULT_AUTH_SETTINGS = {
  staffPin: null,
  managementPin: null,
  updatedAt: '',
  pinPresetVersion: '',
};

const isPlainObject = (value) => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const getCryptoApi = () => {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error('Secure PIN hashing is not available in this browser.');
  }

  return globalThis.crypto;
};

const bytesToBase64 = (bytes) => {
  if (typeof btoa === 'function') {
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  throw new Error('Base64 encoding is not available in this browser.');
};

const createRandomSalt = () => {
  const bytes = new Uint8Array(16);
  getCryptoApi().getRandomValues(bytes);
  return bytesToBase64(bytes);
};

const hashPin = async (pin, salt) => {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await getCryptoApi().subtle.digest('SHA-256', data);
  return bytesToBase64(new Uint8Array(digest));
};

export const normalizePin = (pin) => String(pin || '').trim();

export const validatePin = (pin) => {
  const normalizedPin = normalizePin(pin);

  if (!/^\d{4,8}$/.test(normalizedPin)) {
    return 'Use a 4 to 8 digit PIN.';
  }

  return '';
};

export const createRandomPin = (length = 6) => {
  const safeLength = Math.max(4, Math.min(8, Number(length) || 6));
  const min = 10 ** (safeLength - 1);
  const range = (10 ** safeLength) - min;
  const values = new Uint32Array(1);

  getCryptoApi().getRandomValues(values);
  return String(min + (values[0] % range));
};

export const createPinRecord = async (pin) => {
  const normalizedPin = normalizePin(pin);
  const validationError = validatePin(normalizedPin);

  if (validationError) {
    throw new Error(validationError);
  }

  const salt = createRandomSalt();
  const now = new Date().toISOString();

  return {
    algorithm: PIN_ALGORITHM,
    salt,
    hash: await hashPin(normalizedPin, salt),
    createdAt: now,
    updatedAt: now,
  };
};

export const verifyPin = async (pin, record) => {
  if (!isPlainObject(record) || record.algorithm !== PIN_ALGORITHM || !record.salt || !record.hash) {
    return false;
  }

  const normalizedPin = normalizePin(pin);

  if (validatePin(normalizedPin)) {
    return false;
  }

  return (await hashPin(normalizedPin, record.salt)) === record.hash;
};

export const sanitizePinRecord = (record) => (
    isPlainObject(record)
    && record.algorithm === PIN_ALGORITHM
    && typeof record.salt === 'string'
    && typeof record.hash === 'string'
      ? {
        algorithm: record.algorithm,
        salt: record.salt,
        hash: record.hash,
        createdAt: String(record.createdAt || ''),
        updatedAt: String(record.updatedAt || ''),
      }
      : null
  );

export const sanitizeAuthSettings = (settings) => {
  if (!isPlainObject(settings)) {
    return DEFAULT_AUTH_SETTINGS;
  }

  return {
    staffPin: sanitizePinRecord(settings.staffPin),
    managementPin: sanitizePinRecord(settings.managementPin),
    updatedAt: String(settings.updatedAt || ''),
    pinPresetVersion: String(settings.pinPresetVersion || ''),
  };
};

export const authPinsAreConfigured = (settings) => (
  Boolean(settings?.managementPin?.hash)
);
