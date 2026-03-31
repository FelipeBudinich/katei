import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleIdTokenVerifier } from '../src/auth/verify_google_id_token.js';

test('createGoogleIdTokenVerifier normalizes the verified viewer email from the Google token payload', async () => {
  const verifyIdTokenCalls = [];
  const verifier = createGoogleIdTokenVerifier({
    clientId: 'client-id',
    oauthClient: {
      async verifyIdToken(options) {
        verifyIdTokenCalls.push(options);
        return {
          getPayload() {
            return {
              iss: 'https://accounts.google.com',
              sub: 'sub_123',
              email: 'tester@example.com',
              email_verified: true,
              name: 'Tester',
              picture: 'https://example.com/avatar.png',
              exp: Math.floor(Date.now() / 1000) + 60
            };
          }
        };
      }
    }
  });

  const viewer = await verifier('valid-token');

  assert.deepEqual(verifyIdTokenCalls, [
    {
      idToken: 'valid-token',
      audience: 'client-id'
    }
  ]);
  assert.deepEqual(viewer, {
    sub: 'sub_123',
    email: 'tester@example.com',
    name: 'Tester',
    picture: 'https://example.com/avatar.png'
  });
});

test('createGoogleIdTokenVerifier omits unverified email from the normalized viewer', async () => {
  const verifier = createGoogleIdTokenVerifier({
    clientId: 'client-id',
    oauthClient: {
      async verifyIdToken() {
        return {
          getPayload() {
            return {
              iss: 'accounts.google.com',
              sub: 'sub_456',
              email: 'tester@example.com',
              email_verified: false,
              exp: Math.floor(Date.now() / 1000) + 60
            };
          }
        };
      }
    }
  });

  const viewer = await verifier('valid-token');

  assert.deepEqual(viewer, {
    sub: 'sub_456'
  });
});
