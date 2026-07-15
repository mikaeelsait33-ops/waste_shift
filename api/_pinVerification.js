import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const createPinRecord = (pin) => {
  const normalizedPin = String(pin || '').trim();
  if (!/^\d{4,8}$/.test(normalizedPin)) return null;

  const salt = randomBytes(18).toString('base64url');
  return {
    algorithm: 'sha256-salt-v1',
    salt,
    hash: createHash('sha256').update(`${salt}:${normalizedPin}`).digest('base64'),
  };
};

export const verifyPinRecord = (pin, record) => {
  const normalizedPin = String(pin || '').trim();

  if (
    !/^\d{4,8}$/.test(normalizedPin)
    || record?.algorithm !== 'sha256-salt-v1'
    || typeof record?.salt !== 'string'
    || typeof record?.hash !== 'string'
  ) {
    return false;
  }

  const actual = Buffer.from(createHash('sha256')
    .update(`${record.salt}:${normalizedPin}`)
    .digest('base64'));
  const expected = Buffer.from(record.hash);

  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

export const isPinRecord = (record) => (
  record?.algorithm === 'sha256-salt-v1'
  && typeof record?.salt === 'string'
  && typeof record?.hash === 'string'
);
