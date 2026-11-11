import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeNativeSession } from '../nativeSessionMerge.js';

const stored = JSON.stringify({
  access_token: 'old-access',
  refresh_token: 'old-refresh',
  expires_at: 1000,
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: 'user-1', email: 'pat@example.com' },
});

const native = {
  accessToken: 'new-access',
  refreshToken: 'new-refresh',
  expiresAt: 5000,
  userId: 'user-1',
};

test('a newer native session replaces the tokens and keeps the rest', () => {
  const merged = JSON.parse(mergeNativeSession(stored, native, 4000));
  assert.equal(merged.access_token, 'new-access');
  assert.equal(merged.refresh_token, 'new-refresh');
  assert.equal(merged.expires_at, 5000);
  assert.equal(merged.expires_in, 1000);
  assert.equal(merged.token_type, 'bearer');
  assert.equal(merged.user.email, 'pat@example.com');
});

test('an older or equal native session is ignored', () => {
  assert.equal(mergeNativeSession(stored, { ...native, expiresAt: 900 }), null);
  assert.equal(mergeNativeSession(stored, { ...native, expiresAt: 1000 }), null);
});

test('a different user is ignored', () => {
  assert.equal(mergeNativeSession(stored, { ...native, userId: 'user-2' }), null);
});

test('bad JSON or an incomplete native session returns null', () => {
  assert.equal(mergeNativeSession('not json', native), null);
  assert.equal(mergeNativeSession('', native), null);
  assert.equal(mergeNativeSession('null', native), null);
  assert.equal(mergeNativeSession(stored, null), null);
  assert.equal(mergeNativeSession(stored, { ...native, refreshToken: '' }), null);
});
