import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeStatusBarOptions } from '../statusBarAppearance.js';

test('dark mode uses light status-bar icons and the dark page color', () => {
  assert.deepEqual(nativeStatusBarOptions(true), {
    overlay: true,
    backgroundColor: '#0f1f1c',
    style: 'DARK',
  });
});

test('light mode uses dark status-bar icons and the light page color', () => {
  assert.deepEqual(nativeStatusBarOptions(false), {
    overlay: true,
    backgroundColor: '#f5f3ef',
    style: 'LIGHT',
  });
});
