import { OAuth2Client } from 'google-auth-library';

const ALLOWED_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export function createGoogleIdTokenVerifier({ clientId }) {
  const client = new OAuth2Client(clientId);

  return async function verifyGoogleIdToken(credential) {
    if (typeof credential !== 'string' || !credential.trim()) {
      throw new Error('Google credential is required.');
    }

    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: clientId
    });
    const payload = ticket.getPayload();

    if (!payload) {
      throw new Error('Google token payload is missing.');
    }

    if (!ALLOWED_ISSUERS.has(payload.iss)) {
      throw new Error('Google token issuer is invalid.');
    }

    if (!payload.sub || typeof payload.sub !== 'string') {
      throw new Error('Google token subject is missing.');
    }

    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) {
      throw new Error('Google token is expired.');
    }

    return {
      sub: payload.sub,
      ...(typeof payload.name === 'string' && payload.name.trim() ? { name: payload.name.trim() } : {}),
      ...(typeof payload.picture === 'string' && payload.picture.trim()
        ? { picture: payload.picture.trim() }
        : {})
    };
  };
}

