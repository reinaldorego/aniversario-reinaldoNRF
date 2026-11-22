import { createHash } from 'node:crypto';
import { DRIVE_SCOPE, createTokenEnvelope } from '../src/drive-auth.mjs';

// Explicitly invented fixtures. Never use environment credentials, ADC or a network transport.
export const OAUTH_NOW = Date.parse('2026-11-26T12:00:00Z');
export const FAKE_CREDENTIALS = { client_id: 'synthetic-desktop.apps.googleusercontent.com', client_secret: 'SYNTHETIC-NOT-A-CLIENT-SECRET' };
export const fakeTokens = (extra = {}) => ({ access_token: 'SYNTHETIC-NOT-AN-ACCESS-TOKEN', refresh_token: 'SYNTHETIC-NOT-A-REFRESH-TOKEN',
  expiry_date: OAUTH_NOW + 3600000, scope: DRIVE_SCOPE, token_type: 'Bearer', ...extra });

export class MemoryTokenStore {
  constructor(envelope = null) { this.value = structuredClone(envelope); this.saves = 0; this.removes = 0; this.checks = 0; }
  async ready() { this.checks++; return { exists: Boolean(this.value) }; }
  async load() {
    if (!this.value) { const { DriveError } = await import('../src/drive-token-store.mjs'); throw new DriveError('OAUTH_AUTHORIZATION_REQUIRED'); }
    return structuredClone(this.value);
  }
  async save(value) { this.value = structuredClone(value); this.saves++; }
  async remove() { this.removes++; this.value = null; }
}
export function fakeEnvelope(extraTokens = {}) {
  const envelope = createTokenEnvelope(fakeTokens(), FAKE_CREDENTIALS, OAUTH_NOW);
  Object.assign(envelope.tokens, extraTokens); return envelope;
}
export class FakeOAuth {
  constructor() { this.exchanges = []; this.refreshes = 0; this.revocations = []; this.result = fakeTokens(); this.credentials = {}; }
  async generateCodeVerifierAsync() {
    const codeVerifier = 'synthetic-verifier-'.repeat(4);
    return { codeVerifier, codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url') };
  }
  generateAuthUrl(options) {
    this.options = options;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for (const [key, value] of Object.entries({ ...options, scope: options.scope.join(' '), client_id: FAKE_CREDENTIALS.client_id })) url.searchParams.set(key, value);
    return url.href;
  }
  async getToken(options) { this.exchanges.push(options); if (this.failure) throw this.failure; return { tokens: this.result }; }
  setCredentials(tokens) { this.credentials = { ...tokens }; }
  async refreshAccessToken() {
    this.refreshes++; if (this.failure) throw this.failure;
    return { credentials: { ...this.credentials, access_token: 'SYNTHETIC-REFRESHED-NOT-REAL', expiry_date: OAUTH_NOW + 7200000 } };
  }
  async revokeToken(token) { this.revocations.push(token); if (this.failure) throw this.failure; return { data: {} }; }
}
export function oauthHarness({ envelope = null } = {}) {
  const store = new MemoryTokenStore(envelope), auth = new FakeOAuth();
  const state = { store, auth, closed: 0, opened: 0, callbacks: 0, sdk: { oauth: () => auth }, now: () => OAUTH_NOW, credentials: FAKE_CREDENTIALS };
  state.callbackFactory = async options => {
    state.callbacks++; state.callbackState = options.state;
    return { redirectUri: 'http://127.0.0.1:34567/oauth2/callback', code: Promise.resolve('SYNTHETIC-NOT-AN-OAUTH-CODE'), close: async () => { state.closed++; } };
  };
  state.browser = async url => { state.opened++; state.browserUrl = url; };
  return state;
}
export function providerFailure(status, error = 'synthetic_error') {
  return Object.assign(new Error('SYNTHETIC-PRIVATE-PROVIDER-DETAIL'), {
    response: { status, data: { error, error_description: 'SYNTHETIC-PRIVATE-DESCRIPTION' } },
    config: { headers: { authorization: 'SYNTHETIC-PRIVATE-HEADER' }, url: 'https://example.invalid/?code=SYNTHETIC-PRIVATE' }
  });
}
