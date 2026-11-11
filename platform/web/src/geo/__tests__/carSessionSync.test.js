import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCarSessionPayload,
  isAndroidNativePlatform,
  syncCarSessionFromAuth,
} from '../carSessionSync.js';

const ENV = { supabaseUrl: 'https://example.supabase.co', anonKey: 'anon-key' };

const SESSION = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_at: 1900000000,
  user: {
    id: 'user-1',
    email: 'pat@example.com',
    user_metadata: { full_name: 'Pat Roller' },
  },
};

function fakePlugin({ syncFails = false, clearFails = false } = {}) {
  const calls = { sync: [], clear: 0 };
  return {
    calls,
    async syncSession(payload) {
      calls.sync.push(payload);
      if (syncFails) throw new Error('SESSION_STORE_FAILED');
    },
    async clearSession() {
      calls.clear += 1;
      if (clearFails) throw new Error('SESSION_STORE_FAILED');
    },
  };
}

function deps(plugin, overrides = {}) {
  return { isAndroidNative: true, plugin, ...ENV, ...overrides };
}

const capacitor = (native, platform) => ({
  isNativePlatform: () => native,
  getPlatform: () => platform,
});

test('isAndroidNativePlatform is true only for native android', () => {
  assert.equal(isAndroidNativePlatform(capacitor(false, 'web')), false);
  assert.equal(isAndroidNativePlatform(capacitor(true, 'ios')), false);
  assert.equal(isAndroidNativePlatform(capacitor(false, 'android')), false);
  assert.equal(isAndroidNativePlatform(capacitor(true, 'android')), true);
});

test('buildCarSessionPayload maps the Supabase session', () => {
  assert.deepEqual(buildCarSessionPayload(SESSION, ENV), {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: 1900000000,
    userId: 'user-1',
    supabaseUrl: ENV.supabaseUrl,
    anonKey: ENV.anonKey,
    email: 'pat@example.com',
    userName: 'Pat Roller',
    organizationId: null,
  });
});

test('buildCarSessionPayload falls back to name and tolerates missing optional fields', () => {
  const payload = buildCarSessionPayload(
    {
      access_token: 'a',
      user: { id: 'u', user_metadata: { full_name: '  ', name: 'Sam' } },
    },
    ENV
  );
  assert.equal(payload.userName, 'Sam');
  assert.equal(payload.email, null);
  assert.equal(payload.expiresAt, 0);
  assert.equal(payload.refreshToken, '');
});

test('buildCarSessionPayload returns null without a token or user id', () => {
  assert.equal(buildCarSessionPayload(null, ENV), null);
  assert.equal(buildCarSessionPayload({ user: SESSION.user }, ENV), null);
  assert.equal(buildCarSessionPayload({ access_token: 'a', user: {} }, ENV), null);
});

test('non-android platforms never call the plugin', async () => {
  const plugin = fakePlugin();
  const result = await syncCarSessionFromAuth('SIGNED_IN', SESSION, deps(plugin, { isAndroidNative: false }));
  await syncCarSessionFromAuth('SIGNED_OUT', null, deps(plugin, { isAndroidNative: false }));
  assert.equal(result, 'skipped');
  assert.equal(plugin.calls.sync.length, 0);
  assert.equal(plugin.calls.clear, 0);
});

for (const event of ['SIGNED_IN', 'TOKEN_REFRESHED', 'INITIAL_SESSION']) {
  test(`${event} with a session syncs the mapped payload`, async () => {
    const plugin = fakePlugin();
    const result = await syncCarSessionFromAuth(event, SESSION, deps(plugin));
    assert.equal(result, 'synced');
    assert.equal(plugin.calls.clear, 0);
    assert.deepEqual(plugin.calls.sync, [buildCarSessionPayload(SESSION, ENV)]);
  });
}

test('SIGNED_OUT clears even if a stale session is passed', async () => {
  const plugin = fakePlugin();
  const result = await syncCarSessionFromAuth('SIGNED_OUT', SESSION, deps(plugin));
  assert.equal(result, 'cleared');
  assert.equal(plugin.calls.clear, 1);
  assert.equal(plugin.calls.sync.length, 0);
});

test('a missing session clears and does not sync', async () => {
  const plugin = fakePlugin();
  assert.equal(await syncCarSessionFromAuth('INITIAL_SESSION', null, deps(plugin)), 'cleared');
  assert.equal(plugin.calls.clear, 1);
  assert.equal(plugin.calls.sync.length, 0);
});

test('plugin failures are swallowed', async () => {
  const originalDebug = console.debug;
  console.debug = () => {};
  try {
    const syncing = fakePlugin({ syncFails: true });
    assert.equal(await syncCarSessionFromAuth('SIGNED_IN', SESSION, deps(syncing)), 'failed');
    const clearing = fakePlugin({ clearFails: true });
    assert.equal(await syncCarSessionFromAuth('SIGNED_OUT', null, deps(clearing)), 'failed');
  } finally {
    console.debug = originalDebug;
  }
});
