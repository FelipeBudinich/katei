import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from 'node:crypto';

const BOARD_SECRET_CIPHER_ALGORITHM = 'aes-256-gcm';
const BOARD_SECRET_PAYLOAD_VERSION = 'v1';
const BOARD_SECRET_IV_BYTES = 12;

export function encryptBoardSecret(plaintext, config) {
  const normalizedPlaintext = normalizeRequiredSecret(plaintext, 'Board secret plaintext is required.');
  const key = deriveBoardSecretKey(config);
  const iv = randomBytes(BOARD_SECRET_IV_BYTES);
  const cipher = createCipheriv(BOARD_SECRET_CIPHER_ALGORITHM, key, iv);
  const encryptedBytes = Buffer.concat([
    cipher.update(normalizedPlaintext, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return [
    BOARD_SECRET_PAYLOAD_VERSION,
    encodeBoardSecretSegment(iv),
    encodeBoardSecretSegment(authTag),
    encodeBoardSecretSegment(encryptedBytes)
  ].join('.');
}

export function decryptBoardSecret(payload, config) {
  const normalizedPayload = normalizeRequiredSecret(payload, 'Encrypted board secret payload is required.');
  const segments = normalizedPayload.split('.');

  if (segments.length !== 4 || segments[0] !== BOARD_SECRET_PAYLOAD_VERSION) {
    throw new Error('Encrypted board secret payload is invalid.');
  }

  const key = deriveBoardSecretKey(config);
  const decipher = createDecipheriv(
    BOARD_SECRET_CIPHER_ALGORITHM,
    key,
    decodeBoardSecretSegment(segments[1])
  );
  decipher.setAuthTag(decodeBoardSecretSegment(segments[2]));

  const decryptedBytes = Buffer.concat([
    decipher.update(decodeBoardSecretSegment(segments[3])),
    decipher.final()
  ]);

  return decryptedBytes.toString('utf8');
}

function deriveBoardSecretKey(config) {
  const normalizedKey = normalizeRequiredSecret(
    config?.boardSecretEncryptionKey,
    'Board secret encryption key is required.'
  );

  return createHash('sha256')
    .update(normalizedKey, 'utf8')
    .digest();
}

function normalizeRequiredSecret(value, errorMessage) {
  const normalizedValue = typeof value === 'string' ? value.trim() : '';

  if (!normalizedValue) {
    throw new Error(errorMessage);
  }

  return normalizedValue;
}

function encodeBoardSecretSegment(buffer) {
  return buffer.toString('base64url');
}

function decodeBoardSecretSegment(value) {
  try {
    return Buffer.from(value, 'base64url');
  } catch (error) {
    throw new Error('Encrypted board secret payload is invalid.');
  }
}
