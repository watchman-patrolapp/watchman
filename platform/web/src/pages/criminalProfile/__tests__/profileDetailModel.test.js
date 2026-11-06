import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProfileUpdatePayload,
  excludeAlreadyLinkedProfiles,
  getPriorityColor,
  getRiskColor,
  getStatusColor,
  linkedIncidentHeading,
  profileDeleteErrorHint,
} from '../profileDetailModel.js';

test('risk, priority, and status badge classes', () => {
  assert.equal(getRiskColor('critical'), 'bg-red-600 text-white');
  assert.equal(getRiskColor('HIGH'), 'bg-orange-500 text-white');
  assert.equal(getRiskColor('medium'), 'bg-yellow-500 text-black');
  assert.equal(getRiskColor('low'), 'bg-green-500 text-white');
  assert.equal(getRiskColor(undefined), 'bg-gray-500 text-white');

  assert.equal(getPriorityColor('immediate'), 'bg-red-700 text-white');
  assert.equal(getPriorityColor('Urgent'), 'bg-red-500 text-white');
  assert.equal(getPriorityColor('priority'), 'bg-orange-500 text-white');
  assert.equal(getPriorityColor('routine'), 'bg-blue-500 text-white');
  assert.equal(getPriorityColor(''), 'bg-gray-500 text-white');

  assert.equal(getStatusColor('active'), 'bg-green-500 text-white');
  assert.equal(getStatusColor('wanted'), 'bg-red-600 text-white');
  assert.equal(getStatusColor('incarcerated'), 'bg-gray-700 text-white');
  assert.equal(getStatusColor('deceased'), 'bg-black text-white');
  assert.equal(getStatusColor('cleared'), 'bg-gray-500 text-white');
  assert.equal(getStatusColor('inactive'), 'bg-gray-500 text-white');
  assert.equal(getStatusColor(null), 'bg-gray-500 text-white');
});

test('buildProfileUpdatePayload keeps the editor whitelist and maps inactive to cleared', () => {
  const payload = buildProfileUpdatePayload({
    primary_name: 'Ada',
    status: 'inactive',
    risk_level: 'high',
    not_a_column: 'drop me',
    sightings_log: [],
  });

  assert.equal(payload.primary_name, 'Ada');
  assert.equal(payload.status, 'cleared');
  assert.equal(payload.risk_level, 'high');
  assert.equal('not_a_column' in payload, false);
  assert.deepEqual(payload.sightings_log, []);
  assert.equal(payload.last_seen_at, null);
  assert.equal(payload.last_seen_location, null);
  assert.equal(payload.last_seen_coordinates, null);
});

test('buildProfileUpdatePayload mirrors the newest sighting onto legacy last-seen fields', () => {
  const payload = buildProfileUpdatePayload({
    primary_name: 'Ada',
    sightings_log: [
      {
        id: 'older',
        seen_at: '2026-01-01T08:00:00Z',
        location: 'Old road',
        lat: 1,
        lng: 2,
      },
      {
        id: 'newer',
        seen_at: '2026-06-01T18:00:00Z',
        location: 'Park entrance',
        lat: -33.9,
        lng: 25.5,
      },
    ],
  });

  assert.equal(payload.sightings_log.length, 2);
  assert.equal(payload.last_seen_location, 'Park entrance');
  assert.equal(payload.last_seen_coordinates, '(-33.9,25.5)');
  assert.equal(payload.last_seen_at, '2026-06-01T18:00:00Z');
});

test('profileDeleteErrorHint only expands foreign-key failures', () => {
  assert.equal(profileDeleteErrorHint('permission denied'), '');
  assert.match(profileDeleteErrorHint('violates foreign key constraint'), /ON DELETE SET NULL/);
  assert.match(profileDeleteErrorHint('error 23503'), /ON DELETE SET NULL/);
  assert.equal(profileDeleteErrorHint(''), '');
});

test('excludeAlreadyLinkedProfiles drops profiles already on the draft', () => {
  const rows = [
    { id: 'a', primary_name: 'A' },
    { id: 'b', primary_name: 'B' },
    { id: 'c', primary_name: 'C' },
  ];
  const draft = [
    { other_profile_id: 'a' },
    { associate_profile_id: 'c' },
  ];
  assert.deepEqual(
    excludeAlreadyLinkedProfiles(rows, draft).map((row) => row.id),
    ['b']
  );
  assert.deepEqual(excludeAlreadyLinkedProfiles(null, []), []);
});

test('linkedIncidentHeading prefers type, then a trimmed description, then a fallback', () => {
  assert.equal(linkedIncidentHeading({ type: ' Theft ' }), 'Theft');
  assert.equal(linkedIncidentHeading({ type: '   ', description: 'Short note' }), 'Short note');
  const long = 'x'.repeat(80);
  assert.equal(linkedIncidentHeading({ description: long }), `${'x'.repeat(72)}…`);
  assert.equal(linkedIncidentHeading({}), 'Incident');
  assert.equal(linkedIncidentHeading(null), 'Incident');
});
