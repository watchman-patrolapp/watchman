import test from 'node:test';
import assert from 'node:assert/strict';
import { coordsColumns, isMissingCoordColumnError } from '../incidentCoords.js';

test('coordsColumns maps a valid fix', () => {
  assert.deepEqual(coordsColumns({ latitude: -30.5, longitude: 30.25, accuracy: 12.34 }), {
    latitude: -30.5,
    longitude: 30.25,
    location_accuracy: 12.3,
  });
});

test('coordsColumns keeps a fix without accuracy', () => {
  assert.deepEqual(coordsColumns({ latitude: 1, longitude: 2 }), {
    latitude: 1,
    longitude: 2,
    location_accuracy: null,
  });
});

test('coordsColumns returns {} for missing, non-finite or out-of-range values', () => {
  assert.deepEqual(coordsColumns(null), {});
  assert.deepEqual(coordsColumns(undefined), {});
  assert.deepEqual(coordsColumns({}), {});
  assert.deepEqual(coordsColumns({ latitude: null, longitude: 5 }), {});
  assert.deepEqual(coordsColumns({ latitude: NaN, longitude: 5 }), {});
  assert.deepEqual(coordsColumns({ latitude: 'abc', longitude: 5 }), {});
  assert.deepEqual(coordsColumns({ latitude: 91, longitude: 5 }), {});
  assert.deepEqual(coordsColumns({ latitude: 5, longitude: -181 }), {});
});

test('isMissingCoordColumnError matches Postgres and PostgREST column errors', () => {
  assert.equal(isMissingCoordColumnError({ code: '42703', message: 'x' }), true);
  assert.equal(isMissingCoordColumnError({ code: 'PGRST204', message: 'x' }), true);
  assert.equal(
    isMissingCoordColumnError({ message: "Could not find the 'latitude' column of 'incidents' in the schema cache" }),
    true
  );
  assert.equal(isMissingCoordColumnError({ message: 'column "longitude" of relation "incidents" does not exist' }), true);
});

test('isMissingCoordColumnError ignores unrelated errors', () => {
  assert.equal(isMissingCoordColumnError(null), false);
  assert.equal(isMissingCoordColumnError({ code: '23505', message: 'duplicate key' }), false);
  assert.equal(isMissingCoordColumnError({ message: 'permission denied for table incidents' }), false);
});
