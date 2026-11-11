import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCarPatrolPayload,
  createDistanceAccumulator,
  listenForCarChanges,
  startGpsForCarCheckIn,
  syncCarPatrolState,
} from '../carPatrolSync.js';

test('startGpsForCarCheckIn starts GPS only for patrol_started with an active patrol', async () => {
  const started = [];
  const deps = {
    userId: 'u1',
    fetchMine: async () => ({ user_id: 'u1' }),
    startGps: (args) => started.push(args),
  };
  assert.equal(await startGpsForCarCheckIn('patrol_started', deps), 'started');
  assert.deepEqual(started, [{ patrolId: 'u1', userId: 'u1' }]);

  assert.equal(await startGpsForCarCheckIn('patrol_ended', deps), 'ignored');
  assert.equal(await startGpsForCarCheckIn('patrol_started', { ...deps, userId: null }), 'ignored');
  assert.equal(await startGpsForCarCheckIn('patrol_started', { ...deps, fetchMine: async () => null }), 'no_patrol');
  assert.equal(started.length, 1);

  const originalDebug = console.debug;
  console.debug = () => {};
  try {
    const failing = {
      ...deps,
      fetchMine: async () => {
        throw new Error('boom');
      },
    };
    assert.equal(await startGpsForCarCheckIn('patrol_started', failing), 'failed');
  } finally {
    console.debug = originalDebug;
  }
});

// One degree of latitude is 111194.93 m with the 6371 km radius used by distanceMeters.
const DEG_PER_METER = 1 / 111194.93;

test('accumulator has no 50-point cap: 200 fixes 20 m apart sum to about 3.98 km', () => {
  const acc = createDistanceAccumulator();
  acc.reset('start-1');
  for (let i = 0; i < 200; i += 1) {
    acc.add(-30 + i * 20 * DEG_PER_METER, 30, 10, i * 5000);
  }
  assert.ok(Math.abs(acc.km - 3.98) < 0.02, `km was ${acc.km}`);
});

test('accumulator ignores poor accuracy, jitter and teleports', () => {
  const acc = createDistanceAccumulator();
  acc.add(-30, 30, 10, 0);

  acc.add(-30 + 100 * DEG_PER_METER, 30, 120, 10_000); // accuracy worse than 75 m
  assert.equal(acc.km, 0);

  acc.add(-30 + 3 * DEG_PER_METER, 30, 10, 20_000); // under 5 m of movement
  assert.equal(acc.km, 0);

  acc.add(-30 + 500 * DEG_PER_METER, 30, 10, 30_000); // 500 m in 10 s = 180 km/h, kept
  assert.ok(Math.abs(acc.km - 0.5) < 0.005);

  const before = acc.km;
  acc.add(-29, 30, 10, 31_000); // about 111 km in 1 s: a teleport
  assert.equal(acc.km, before);

  // After a teleport the anchor moved, so the next normal step counts.
  acc.add(-29 + 100 * DEG_PER_METER, 30, 10, 51_000);
  assert.ok(Math.abs(acc.km - (before + 0.1)) < 0.005);
});

test('accumulator ignores invalid coordinates', () => {
  const acc = createDistanceAccumulator();
  acc.add(NaN, 30, 5, 0);
  acc.add(-30, 200, 5, 0);
  acc.add(-30, 30, 5, 1000);
  acc.add(-30 + 50 * DEG_PER_METER, 30, 5, 11_000);
  assert.ok(Math.abs(acc.km - 0.05) < 0.002);
});

test('accumulator reset clears distance and anchor', () => {
  const acc = createDistanceAccumulator();
  acc.add(-30, 30, 5, 0);
  acc.add(-30 + 100 * DEG_PER_METER, 30, 5, 20_000);
  assert.ok(acc.km > 0.09);
  acc.reset('start-2');
  assert.equal(acc.km, 0);
  assert.equal(acc.startKey, 'start-2');
  acc.add(-20, 20, 5, 0); // new anchor, no distance from the old patrol
  assert.equal(acc.km, 0);
});

test('buildCarPatrolPayload: active, inactive and bad coordinates', () => {
  const startTime = new Date('2026-11-11T19:04:00Z');
  const payload = buildCarPatrolPayload({
    activePatrol: { user_id: 'u1' },
    startTime,
    location: { lat: -30.1, lng: 30.2, accuracy: 12, timestamp: '2026-11-11T19:10:00.000Z' },
    distanceKm: 1.2345,
    userId: 'u1',
  });
  assert.deepEqual(payload, {
    active: true,
    userId: 'u1',
    startTime: startTime.getTime(),
    sessionDistanceKm: 1.23,
    latitude: -30.1,
    longitude: 30.2,
    accuracy: 12,
    recordedAt: Date.parse('2026-11-11T19:10:00.000Z'),
  });

  assert.deepEqual(
    buildCarPatrolPayload({ activePatrol: null, startTime: null, location: null, distanceKm: 0, userId: 'u1' }),
    { active: false, userId: 'u1' }
  );

  const noFix = buildCarPatrolPayload({
    activePatrol: { user_id: 'u1' },
    startTime,
    location: { lat: 999, lng: 0 },
    distanceKm: 0,
    userId: 'u1',
  });
  assert.equal(noFix.latitude, undefined);
  assert.equal(noFix.active, true);
});

function harness() {
  const calls = [];
  const clock = { t: 1_000_000 };
  return {
    calls,
    clock,
    deps: {
      isAndroidNative: true,
      plugin: { syncPatrolState: async (p) => calls.push(p) },
      now: () => clock.t,
      state: { lastSentAt: 0, lastActive: undefined, lastStartTime: undefined },
      throttleMs: 10_000,
    },
  };
}

const ACTIVE = { active: true, userId: 'u1', startTime: 111, sessionDistanceKm: 0 };

test('syncCarPatrolState throttles to one call per 10 s', async () => {
  const { calls, clock, deps } = harness();
  assert.equal(await syncCarPatrolState(ACTIVE, deps), 'synced');
  clock.t += 3000;
  assert.equal(await syncCarPatrolState({ ...ACTIVE, sessionDistanceKm: 1 }, deps), 'throttled');
  clock.t += 7000;
  assert.equal(await syncCarPatrolState({ ...ACTIVE, sessionDistanceKm: 2 }, deps), 'synced');
  assert.equal(calls.length, 2);
});

test('syncCarPatrolState sends a change of active or startTime immediately', async () => {
  const { calls, clock, deps } = harness();
  await syncCarPatrolState(ACTIVE, deps);
  clock.t += 100;
  assert.equal(await syncCarPatrolState({ ...ACTIVE, startTime: 222 }, deps), 'synced');
  clock.t += 100;
  assert.equal(await syncCarPatrolState({ active: false, userId: 'u1' }, deps), 'synced');
  clock.t += 100;
  assert.equal(await syncCarPatrolState({ active: false, userId: 'u1' }, deps), 'throttled');
  clock.t += 100;
  assert.equal(await syncCarPatrolState(ACTIVE, deps), 'synced');
  assert.equal(calls.length, 4);
});

test('syncCarPatrolState is skipped off Android and never rejects', async () => {
  const { calls, deps } = harness();
  assert.equal(await syncCarPatrolState(ACTIVE, { ...deps, isAndroidNative: false }), 'skipped');
  assert.equal(calls.length, 0);

  const failing = {
    ...deps,
    plugin: {
      syncPatrolState: async () => {
        throw new Error('boom');
      },
    },
  };
  const originalDebug = console.debug;
  console.debug = () => {};
  try {
    assert.equal(await syncCarPatrolState(ACTIVE, failing), 'failed');
  } finally {
    console.debug = originalDebug;
  }
});

test('listenForCarChanges is a no-op off Android and removes its listener on cleanup', async () => {
  assert.equal(typeof listenForCarChanges(() => {}, { isAndroidNative: false }), 'function');

  let handler = null;
  let removed = 0;
  const plugin = {
    addListener: async (name, fn) => {
      assert.equal(name, 'carStateChanged');
      handler = fn;
      return { remove: () => { removed += 1; } };
    },
  };
  const seen = [];
  const stop = listenForCarChanges((reason) => seen.push(reason), { isAndroidNative: true, plugin });
  await new Promise((resolve) => setImmediate(resolve));
  handler({ reason: 'patrol_ended' });
  assert.deepEqual(seen, ['patrol_ended']);
  stop();
  assert.equal(removed, 1);
});
