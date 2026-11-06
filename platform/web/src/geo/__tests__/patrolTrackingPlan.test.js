import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQueuedPoint,
  classifyInsertResult,
  createPatrolLocationQueue,
  dropQueuedPointsForUser,
  enqueuePoint,
  insertBodyFromPoint,
  parseQueue,
  pluginLocationToPosition,
  runPatrolPermissionFlow,
} from '../patrolTrackingPlan.js';

test('web stays foreground and does not ask for background permission', async () => {
  let backgroundCalls = 0;
  const plan = await runPatrolPermissionFlow({
    platform: 'web',
    readStatus: async () => {
      throw new Error('should not read native status');
    },
    requestBackground: async () => {
      backgroundCalls += 1;
      return { background: 'granted' };
    },
  });
  assert.equal(plan.mode, 'foreground');
  assert.equal(backgroundCalls, 0);
  assert.equal(plan.message, undefined);
});

test('foreground denial stops tracking without a raw error', async () => {
  const plan = await runPatrolPermissionFlow({
    platform: 'android',
    readStatus: async () => ({ sdkInt: 34, foreground: 'denied', background: 'denied', notifications: 'denied' }),
    askForeground: async () => true,
    requestForeground: async () => ({ foreground: 'denied' }),
    requestBackground: async () => {
      throw new Error('ACCESS_BACKGROUND_LOCATION boom');
    },
  });
  assert.equal(plan.mode, 'denied');
  assert.equal(plan.message.includes('boom'), false);
  assert.match(plan.message, /system settings/i);
});

test('declining the background explanation does not request Allow all the time', async () => {
  let backgroundCalls = 0;
  const plan = await runPatrolPermissionFlow({
    platform: 'android',
    readStatus: async () => ({
      sdkInt: 34,
      foreground: 'granted',
      background: 'denied',
      notifications: 'granted',
    }),
    askDisclosure: async () => false,
    requestBackground: async () => {
      backgroundCalls += 1;
      return { background: 'granted' };
    },
  });
  assert.equal(plan.mode, 'foreground');
  assert.equal(backgroundCalls, 0);
  assert.match(plan.message, /Allow all the time/);
});

test('Allow all the time plus notifications selects the background service', async () => {
  const calls = [];
  const plan = await runPatrolPermissionFlow({
    platform: 'android',
    readStatus: async () => ({
      sdkInt: 34,
      foreground: 'denied',
      background: 'denied',
      notifications: 'denied',
    }),
    askForeground: async () => {
      calls.push('explain-foreground');
      return true;
    },
    requestForeground: async () => {
      calls.push('foreground');
      return { foreground: 'granted' };
    },
    askDisclosure: async () => {
      calls.push('explain-background');
      return true;
    },
    requestBackground: async () => {
      calls.push('background');
      return { background: 'granted' };
    },
    requestNotifications: async () => {
      calls.push('notifications');
      return { notifications: 'granted' };
    },
    askBattery: async () => {
      calls.push('battery');
      return true;
    },
    isIgnoringBattery: async () => false,
    requestBatteryExemption: async () => {
      calls.push('exemption');
    },
  });
  assert.equal(plan.mode, 'background');
  assert.deepEqual(calls, [
    'explain-foreground',
    'foreground',
    'explain-background',
    'background',
    'notifications',
    'battery',
    'exemption',
  ]);
});

test('notification denial falls back to foreground tracking', async () => {
  const plan = await runPatrolPermissionFlow({
    platform: 'android',
    readStatus: async () => ({
      sdkInt: 34,
      foreground: 'granted',
      background: 'granted',
      notifications: 'denied',
    }),
    askDisclosure: async () => true,
    requestBackground: async () => ({ background: 'granted' }),
    requestNotifications: async () => ({ notifications: 'denied' }),
    isIgnoringBattery: async () => true,
  });
  assert.equal(plan.mode, 'foreground');
  assert.match(plan.message, /notification/i);
});

test('a plugin failure becomes a friendly foreground fallback', async () => {
  const plan = await runPatrolPermissionFlow({
    platform: 'android',
    readStatus: async () => {
      throw new Error('Service not running.');
    },
  });
  assert.equal(plan.mode, 'foreground');
  assert.equal(plan.message.includes('Service not running'), false);
});

test('insert row matches the patrol_locations path and hides timestamp until replay', () => {
  const point = buildQueuedPoint({
    id: '11111111-1111-4111-8111-111111111111',
    patrolId: '22222222-2222-4222-8222-222222222222',
    userId: '22222222-2222-4222-8222-222222222222',
    coords: { latitude: -34.1, longitude: 18.4, accuracy: 5, altitude: 12, speed: 1.5 },
    organizationId: '33333333-3333-4333-8333-333333333333',
    recordedAt: '2026-11-06T12:00:00.000Z',
  });
  const live = insertBodyFromPoint(point, { includeTimestamp: false });
  assert.deepEqual(Object.keys(live).sort(), [
    'accuracy',
    'altitude',
    'id',
    'latitude',
    'longitude',
    'organization_id',
    'patrol_id',
    'speed',
    'user_id',
  ]);
  assert.equal(live.timestamp, undefined);
  const replay = insertBodyFromPoint(point, { includeTimestamp: true });
  assert.equal(replay.timestamp, '2026-11-06T12:00:00.000Z');
});

test('queue is idempotent and flush drops saved and duplicate points', async () => {
  const point = buildQueuedPoint({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    patrolId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    coords: { latitude: 1, longitude: 2, accuracy: 3, altitude: null, speed: null },
    organizationId: null,
    recordedAt: '2026-11-06T12:00:00.000Z',
  });
  assert.equal(enqueuePoint(enqueuePoint([], point), point).length, 1);
  assert.equal(parseQueue('not-json').length, 0);

  let stored = [];
  const inserted = [];
  const queue = createPatrolLocationQueue({
    load: async () => stored,
    save: async (next) => {
      stored = next;
    },
    insertRow: async (item) => {
      inserted.push(item.id);
      if (item.id.endsWith('1')) return 'retry';
      if (item.id.endsWith('2')) return 'duplicate';
      return 'sent';
    },
  });
  const keep = { ...point, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' };
  const dup = { ...point, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' };
  const sent = { ...point, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3' };
  await queue.enqueue(keep);
  await queue.enqueue(keep);
  await queue.enqueue(dup);
  await queue.enqueue(sent);
  assert.equal(stored.length, 3);
  const result = await queue.flush();
  assert.equal(result.sent, 2);
  assert.equal(result.kept, 1);
  assert.equal(stored[0].id, keep.id);
  assert.deepEqual(inserted, [keep.id, dup.id, sent.id]);
});

test('sign-out drops only that patroller’s unsent points', async () => {
  const mine = buildQueuedPoint({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    patrolId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    userId: 'user-a',
    coords: { latitude: 1, longitude: 2 },
  });
  const other = buildQueuedPoint({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    patrolId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    userId: 'user-b',
    coords: { latitude: 3, longitude: 4 },
  });
  assert.deepEqual(dropQueuedPointsForUser([mine, other], 'user-a'), [other]);
  let stored = [mine, other];
  const queue = createPatrolLocationQueue({
    load: async () => stored,
    save: async (next) => {
      stored = next;
    },
    insertRow: async () => 'sent',
  });
  await queue.clearUser('user-a');
  assert.deepEqual(stored, [other]);
});

test('duplicate key and HTTP 409 count as success', () => {
  assert.equal(classifyInsertResult({ ok: true }), 'sent');
  assert.equal(classifyInsertResult({ ok: false, code: '23505' }), 'duplicate');
  assert.equal(classifyInsertResult({ ok: false, status: 409, message: 'duplicate key value' }), 'duplicate');
  assert.equal(classifyInsertResult({ ok: false, status: 500, message: 'timeout' }), 'retry');
  assert.equal(classifyInsertResult({ ok: false, status: 401 }), 'retry');
  assert.equal(classifyInsertResult({ ok: false, code: '23503' }), 'drop');
  assert.equal(classifyInsertResult({ ok: false, status: 400 }), 'drop');
});

test('plugin location maps onto the geolocation fix shape', () => {
  const position = pluginLocationToPosition({
    latitude: -33.9,
    longitude: 18.4,
    accuracy: 8,
    altitude: 10,
    bearing: 90,
    speed: 2,
    time: 1_700_000_000_000,
  });
  assert.equal(position.coords.latitude, -33.9);
  assert.equal(position.coords.heading, 90);
  assert.equal(position.coords.speed, 2);
  assert.equal(position.timestamp, 1_700_000_000_000);
});
