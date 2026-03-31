import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSessionPayload,
  createSignedSessionCookieValue,
  getViewerFromSessionPayload,
  verifySignedSessionCookieValue
} from '../src/auth/session_cookie.js';

const secret = 'test-session-secret';

test('verifySignedSessionCookieValue returns the viewer payload for a valid signed cookie', () => {
  const payload = createSessionPayload(
    {
      sub: 'sub_123',
      email: 'tester@example.com',
      name: 'Tester',
      picture: 'https://example.com/avatar.png'
    },
    300,
    new Date('2026-03-28T12:00:00Z')
  );
  const signedValue = createSignedSessionCookieValue(payload, secret);
  const verifiedPayload = verifySignedSessionCookieValue(signedValue, secret, new Date('2026-03-28T12:02:00Z'));

  assert.deepEqual(getViewerFromSessionPayload(verifiedPayload), {
    sub: 'sub_123',
    email: 'tester@example.com',
    name: 'Tester',
    picture: 'https://example.com/avatar.png'
  });
});

test('verifySignedSessionCookieValue rejects tampered signed cookies', () => {
  const payload = createSessionPayload({ sub: 'sub_123' }, 300, new Date('2026-03-28T12:00:00Z'));
  const signedValue = createSignedSessionCookieValue(payload, secret);
  const tamperedValue = `${signedValue}tampered`;

  assert.equal(verifySignedSessionCookieValue(tamperedValue, secret), null);
});

test('verifySignedSessionCookieValue rejects expired signed cookies', () => {
  const payload = createSessionPayload({ sub: 'sub_123' }, 60, new Date('2026-03-28T12:00:00Z'));
  const signedValue = createSignedSessionCookieValue(payload, secret);

  assert.equal(verifySignedSessionCookieValue(signedValue, secret, new Date('2026-03-28T12:02:00Z')), null);
});
