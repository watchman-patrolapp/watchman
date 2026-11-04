import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatRealtimeHub } from '../chatRealtime.js';

function harness() {
  const opened = [];
  const hub = createChatRealtimeHub({
    openChannel(spec) {
      const record = { ...spec, closed: false };
      opened.push(record);
      return {
        close() {
          record.closed = true;
        },
      };
    },
  });
  return { hub, opened };
}

const ORG = 'org-1';
const scope = () => ({ organizationId: ORG, includeUnscoped: false });

test('five dashboard subscribers share one filtered channel', () => {
  const { hub, opened } = harness();
  const seen = { patrol: 0, resident: 0, all: 0 };
  const releases = [
    hub.subscribe(() => seen.patrol++, { rooms: ['patrol'], getScope: scope }),
    hub.subscribe(() => seen.patrol++, { rooms: ['patrol'], getScope: scope }),
    hub.subscribe(() => seen.resident++, { rooms: ['resident'], getScope: scope }),
    hub.subscribe(() => seen.resident++, { rooms: ['resident'], getScope: scope }),
    hub.subscribe(() => seen.all++, { getScope: scope }),
  ];

  assert.equal(hub.getSubscriberCount(), 5);
  assert.equal(hub.getChannelCount(), 1);
  const live = opened.filter((channel) => !channel.closed);
  assert.equal(live.length, 1);
  assert.equal(live[0].filter, 'visibility=in.(patrol,resident)');
  assert.equal(live[0].topic, 'chat-messages-visibility-patrol-resident');
  assert.ok(opened.some((channel) => channel.closed && channel.filter === 'visibility=eq.patrol'));

  live[0].onInsert({ id: 'p', visibility: 'patrol', organization_id: ORG, sender_id: 'other' });
  assert.deepEqual(seen, { patrol: 2, resident: 0, all: 1 });

  live[0].onInsert({ id: 'r', visibility: 'resident', organization_id: ORG, sender_id: 'other' });
  assert.deepEqual(seen, { patrol: 2, resident: 2, all: 2 });

  live[0].onInsert({ id: 'x', visibility: 'patrol', organization_id: 'other-org' });
  assert.deepEqual(seen, { patrol: 2, resident: 2, all: 2 });

  for (const release of releases) release();
  assert.equal(hub.getChannelCount(), 1);
  hub.flush();
  assert.equal(hub.getChannelCount(), 0);
  assert.equal(live[0].closed, true);
});

test('refcount keeps the channel until the last subscriber flushes', () => {
  const { hub, opened } = harness();
  const a = hub.subscribe(() => {}, { rooms: ['resident'], scope: { organizationId: ORG } });
  const b = hub.subscribe(() => {}, { rooms: ['resident'], scope: { organizationId: ORG } });
  assert.equal(hub.getChannelCount(), 1);
  assert.equal(opened[0].filter, 'visibility=eq.resident');
  a();
  assert.equal(hub.getChannelCount(), 1);
  assert.equal(opened[0].closed, false);
  b();
  assert.equal(hub.getChannelCount(), 1);
  hub.flush();
  assert.equal(hub.getChannelCount(), 0);
  assert.equal(opened[0].closed, true);
});

test('replacing the room set retargets the server filter without stacking channels', () => {
  const { hub, opened } = harness();
  const patrol = hub.subscribe(() => {}, { rooms: ['patrol'] });
  const resident = hub.subscribe(() => {}, { rooms: ['resident'] });
  assert.equal(hub.getChannelCount(), 1);
  assert.equal(hub.getChannels()[0].filter, 'visibility=in.(patrol,resident)');
  resident();
  assert.equal(hub.getChannelCount(), 1);
  assert.equal(hub.getChannels()[0].filter, 'visibility=eq.patrol');
  assert.equal(opened[0].closed, true);
  patrol();
  hub.flush();
  assert.equal(hub.getChannelCount(), 0);
});

test('unsubscribe then resubscribe before flush does not close the channel', () => {
  const { hub, opened } = harness();
  const first = hub.subscribe(() => {}, { rooms: ['patrol'] });
  first();
  hub.subscribe(() => {}, { rooms: ['patrol'] });
  hub.flush();
  assert.equal(hub.getChannelCount(), 1);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].closed, false);
});

test('a throwing subscriber does not block the rest', () => {
  const { hub, opened } = harness();
  const seen = [];
  hub.subscribe(() => {
    throw new Error('boom');
  }, { rooms: ['patrol'], scope: { organizationId: ORG } });
  hub.subscribe((message) => seen.push(message.id), { rooms: ['patrol'], scope: { organizationId: ORG } });
  opened[0].onInsert({ id: 'ok', visibility: 'patrol', organization_id: ORG });
  assert.deepEqual(seen, ['ok']);
});

test('double unsubscribe is a no-op', () => {
  const { hub } = harness();
  const release = hub.subscribe(() => {}, { rooms: ['patrol'] });
  release();
  release();
  hub.flush();
  assert.equal(hub.getChannelCount(), 0);
  assert.equal(hub.getSubscriberCount(), 0);
});

test('includeUnscoped keeps null organisation rows and drops other orgs', () => {
  const { hub, opened } = harness();
  const seen = [];
  hub.subscribe((message) => seen.push(message.id), {
    rooms: ['resident'],
    getScope: () => ({ organizationId: ORG, includeUnscoped: true }),
  });
  opened[0].onInsert({ id: 'null-org', visibility: 'resident', organization_id: null });
  opened[0].onInsert({ id: 'mine', visibility: 'resident', organization_id: ORG });
  opened[0].onInsert({ id: 'theirs', visibility: 'resident', organization_id: 'else' });
  assert.deepEqual(seen, ['null-org', 'mine']);
});

test('missing visibility is treated as patrol for room fan-out', () => {
  const { hub, opened } = harness();
  const seen = [];
  hub.subscribe((message) => seen.push(message.id), {
    rooms: ['patrol'],
    scope: { organizationId: ORG },
  });
  opened[0].onInsert({ id: 'legacy', organization_id: ORG });
  opened[0].onInsert({ id: 'resident', visibility: 'resident', organization_id: ORG });
  assert.deepEqual(seen, ['legacy']);
});
