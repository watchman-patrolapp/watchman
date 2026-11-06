import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_CLOSE_EXTENSION_SECONDS,
  PATROL_MAX_ELAPSED_MS,
  PATROL_WARNING_SECONDS,
  formatPatrolClock,
  formatPatrolElapsed,
  playThrottled,
} from '../patrolTiming.js';

test('patrol warning is 2h and auto-end is 2.5h from the start', () => {
  assert.equal(PATROL_WARNING_SECONDS, 2 * 60 * 60);
  assert.equal(AUTO_CLOSE_EXTENSION_SECONDS, 30 * 60);
  assert.equal(PATROL_MAX_ELAPSED_MS, (2.5 * 60 * 60) * 1000);
});

test('formatPatrolClock and formatPatrolElapsed', () => {
  assert.equal(formatPatrolClock(0), '00:00:00');
  assert.equal(formatPatrolElapsed(0), '0h 0m');
  assert.equal(formatPatrolClock(3661), '01:01:01');
  assert.equal(formatPatrolElapsed(3661), '1h 1m');
  assert.equal(formatPatrolClock(PATROL_WARNING_SECONDS), '02:00:00');
  assert.equal(formatPatrolElapsed(PATROL_MAX_ELAPSED_MS / 1000), '2h 30m');
});

test('playThrottled allows one call per key inside a second', () => {
  const key = `patrol-timing-${Date.now()}`;
  let calls = 0;
  const fn = () => { calls += 1; };
  playThrottled(key, fn, 1_000);
  playThrottled(key, fn, 1_500);
  playThrottled(key, fn, 2_000);
  playThrottled(key, fn, 2_001);
  assert.equal(calls, 2);
});
