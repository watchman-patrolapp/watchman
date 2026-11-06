import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageType } from '../constants.js';
import {
  findExistingMessageIndexForRealtime,
  localDateTimeParts,
  summarizeMessageForReply,
} from '../chatMessageMerge.js';
import { parseChatLocationPosition } from '../chatLocation.js';
import {
  buildCompiledIncidentInsert,
  compiledReportValidationError,
} from '../compiledIncidentReport.js';

test('localDateTimeParts uses local calendar fields', () => {
  const parts = localDateTimeParts(new Date(2026, 5, 1, 7, 4));
  assert.deepEqual(parts, { date: '2026-06-01', time: '07:04' });
});

test('summarizeMessageForReply labels non-text bubbles', () => {
  assert.equal(summarizeMessageForReply(null), '');
  assert.equal(summarizeMessageForReply({ text: '  hi  ' }), 'hi');
  assert.equal(summarizeMessageForReply({ type: MessageType.IMAGE }), '[Image]');
  assert.equal(summarizeMessageForReply({ type: MessageType.VOICE }), '[Voice note]');
  assert.equal(summarizeMessageForReply({ type: MessageType.LOCATION }), '[Location]');
  assert.equal(summarizeMessageForReply({ type: 'other' }), '[Message]');
});

test('realtime merge prefers id, then client id, then a nearby optimistic row', () => {
  const prev = [
    { id: 'server-a', localId: 'old', sender_id: 'u1' },
    { localId: 'client-b', sender_id: 'u2', id: 'pending' },
    {
      localId: 'opt-text',
      sender_id: 'u1',
      type: MessageType.TEXT,
      text: 'hello',
      localTimestamp: '2026-06-01T12:00:00Z',
    },
    {
      localId: 'opt-loc',
      sender_id: 'u1',
      type: MessageType.LOCATION,
      location_lat: -33.9,
      location_lng: 25.5,
      localTimestamp: '2026-06-01T12:00:00Z',
    },
  ];

  assert.equal(
    findExistingMessageIndexForRealtime(prev, { id: 'server-a', sender_id: 'other' }),
    0
  );
  assert.equal(
    findExistingMessageIndexForRealtime(prev, {
      id: 'server-b',
      client_message_id: 'client-b',
      sender_id: 'u2',
    }),
    1
  );
  assert.equal(
    findExistingMessageIndexForRealtime(prev, {
      id: 'server-c',
      sender_id: 'u1',
      type: MessageType.TEXT,
      text: 'hello',
      created_at: '2026-06-01T12:01:00Z',
    }),
    2
  );
  assert.equal(
    findExistingMessageIndexForRealtime(prev, {
      id: 'server-d',
      sender_id: 'u1',
      type: MessageType.LOCATION,
      location_lat: -33.9,
      location_lng: 25.500000001,
      created_at: '2026-06-01T12:00:10Z',
    }),
    3
  );
  assert.equal(
    findExistingMessageIndexForRealtime(prev, {
      id: 'server-e',
      sender_id: 'u1',
      type: MessageType.TEXT,
      text: 'different',
      created_at: '2026-06-01T12:00:10Z',
    }),
    -1
  );
  assert.equal(
    findExistingMessageIndexForRealtime(prev, {
      id: 'server-f',
      sender_id: 'u1',
      type: MessageType.LOCATION,
      location_lat: 0,
      location_lng: 0,
      created_at: '2026-06-01T12:00:10Z',
    }),
    -1
  );
});

test('parseChatLocationPosition accepts the three position shapes', () => {
  assert.deepEqual(parseChatLocationPosition({ coords: { latitude: 1, longitude: 2 } }), {
    ok: true,
    lat: 1,
    lng: 2,
  });
  assert.deepEqual(parseChatLocationPosition({ lat: '3', lng: '4' }), { ok: true, lat: 3, lng: 4 });
  assert.deepEqual(parseChatLocationPosition({ latitude: 5, longitude: 6 }), { ok: true, lat: 5, lng: 6 });
  assert.equal(parseChatLocationPosition(null).reason, 'format');
  assert.equal(parseChatLocationPosition({ lat: 'nope', lng: 1 }).reason, 'coordinates');
});

test('compiled incident report validation and insert body', () => {
  assert.equal(compiledReportValidationError({ type: 'Theft', location: '', description: '' }), 'Please add a description');
  assert.equal(
    compiledReportValidationError({ type: 'Theft', location: '   ', description: 'saw it' }),
    'Add a location in the text field or drop a pin on the map'
  );
  // Number(null) is 0, so an explicit null pin is treated as coordinates 0,0.
  assert.equal(
    compiledReportValidationError({ type: 'Theft', location: '   ', description: 'saw it', pinLat: null, pinLng: null }),
    null
  );
  assert.equal(compiledReportValidationError({ type: '', location: 'Main rd', description: 'saw it' }), 'Please choose an incident type');
  assert.equal(compiledReportValidationError({ type: 'Theft', location: 'Main rd', description: 'saw it' }), null);

  const now = new Date('2026-06-01T10:00:00Z');
  const row = buildCompiledIncidentInsert(
    {
      type: 'Theft',
      location: 'Main rd',
      description: 'saw it',
      incidentDate: '2026-06-01',
      incidentTime: '09:05',
      pinLat: -33.9123456,
      pinLng: 25.5123456,
      suspectName: '  ',
    },
    { userId: 'user-1', submittedByName: 'Ada', organizationId: 'org-1', now }
  );
  assert.equal(row.status, 'pending');
  assert.equal(row.submitted_by, 'user-1');
  assert.equal(row.submitted_by_name, 'Ada');
  assert.equal(row.organization_id, 'org-1');
  assert.equal(row.suspect_name, null);
  assert.equal(row.submitted_at, now.toISOString());
  assert.match(row.description, /Pinned coordinates: -33.912346, 25.512346/);
  assert.match(row.description, /Incident occurred \(local\): 2026-06-01 09:05/);
  assert.equal(row.location, 'Main rd');
});
