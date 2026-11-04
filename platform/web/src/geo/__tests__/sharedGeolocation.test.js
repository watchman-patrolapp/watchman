import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedGeolocation } from '../sharedGeolocation.js';

function fakeGeo() {
  let nextId = 1;
  const watches = new Map();
  let currentCalls = 0;
  return {
    watches,
    get currentCalls() {
      return currentCalls;
    },
    watchPosition(success, error, options) {
      const id = nextId++;
      watches.set(id, { success, error, options });
      return id;
    },
    clearWatch(id) {
      watches.delete(id);
    },
    getCurrentPosition(success, error, options) {
      currentCalls += 1;
      watches.set(`current-${currentCalls}`, { success, error, options, current: true });
    },
  };
}

function source(geo, { hidden = () => false } = {}) {
  return createSharedGeolocation({
    watchPosition: geo.watchPosition,
    clearWatch: geo.clearWatch,
    getCurrentPosition: geo.getCurrentPosition,
    isHidden: hidden,
    supported: true,
    getBannerOptions: () => ({ enableHighAccuracy: false, maximumAge: 120000, timeout: 30000 }),
    getPatrolOptions: () => ({ enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }),
  });
}

function liveWatches(geo) {
  return [...geo.watches.values()].filter((entry) => !entry.current);
}

test('banner and patrol share one watch and patrol wins accuracy', () => {
  const geo = fakeGeo();
  const src = source(geo);
  const banner = src.acquire({ purpose: 'banner' });
  assert.equal(src.getWatchCount(), 1);
  assert.equal(liveWatches(geo).length, 1);
  assert.equal(liveWatches(geo)[0].options.enableHighAccuracy, false);
  assert.equal(geo.currentCalls, 0);

  const patrol = src.acquire({ purpose: 'patrol' });
  assert.equal(src.getWatchCount(), 1);
  assert.equal(liveWatches(geo).length, 1);
  assert.equal(src.getMode(), 'patrol');
  assert.equal(liveWatches(geo)[0].options.enableHighAccuracy, true);
  assert.equal(geo.currentCalls, 1);

  patrol();
  assert.equal(src.getWatchCount(), 1);
  assert.equal(src.getMode(), 'banner');
  assert.equal(liveWatches(geo)[0].options.enableHighAccuracy, false);

  banner();
  assert.equal(src.getWatchCount(), 0);
  assert.equal(liveWatches(geo).length, 0);
});

test('two banner consumers refcount a single watch', () => {
  const geo = fakeGeo();
  const src = source(geo);
  const a = src.acquire({ purpose: 'banner' });
  const b = src.acquire({ purpose: 'banner' });
  assert.equal(liveWatches(geo).length, 1);
  a();
  a();
  assert.equal(src.getWatchCount(), 1);
  b();
  assert.equal(src.getWatchCount(), 0);
});

test('hidden tab stops the banner watch and keeps a patrol watch', () => {
  let hidden = false;
  const geo = fakeGeo();
  const src = source(geo, { hidden: () => hidden });
  src.acquire({ purpose: 'banner' });
  hidden = true;
  src.onVisibilityChange();
  assert.equal(src.getWatchCount(), 0);
  assert.equal(src.getMode(), 'idle');

  hidden = false;
  src.onVisibilityChange();
  assert.equal(src.getWatchCount(), 1);
  assert.equal(src.getMode(), 'banner');

  src.acquire({ purpose: 'patrol' });
  hidden = true;
  src.onVisibilityChange();
  assert.equal(src.getWatchCount(), 1);
  assert.equal(src.getMode(), 'patrol');
});

test('one position is fanned out and a throwing listener does not block the other', () => {
  const geo = fakeGeo();
  const src = source(geo);
  const seen = [];
  src.acquire({
    purpose: 'banner',
    onPosition() {
      throw new Error('banner failed');
    },
  });
  src.acquire({
    purpose: 'patrol',
    onPosition(position) {
      seen.push(position.coords.latitude);
    },
  });
  liveWatches(geo)[0].success({ coords: { latitude: -33.9, longitude: 25.5 } });
  assert.deepEqual(seen, [-33.9]);
  assert.deepEqual(src.getLastLocation(), { lat: -33.9, lng: 25.5 });
});
