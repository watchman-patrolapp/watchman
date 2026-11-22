import { assertEquals } from 'jsr:@std/assert@1';
import {
  buildAccountMediaPurgePlan,
  chunk,
  isChatMediaPath,
  isOwnAvatarName,
  objectPathFor,
  runAccountMediaPurge,
  splitCityHubPostMedia,
} from './accountMediaPurge.ts';

const U = '11111111-1111-1111-1111-111111111111';
const BASE = 'https://x.supabase.co/storage/v1/object';

Deno.test('objectPathFor reads public and signed URLs and bare paths', () => {
  assertEquals(objectPathFor(`${BASE}/public/chat-media/images/img-1.jpg`, 'chat-media'), 'images/img-1.jpg');
  assertEquals(objectPathFor(`${BASE}/sign/city-hub-photos/p1/img_1.jpg?token=abc`, 'city-hub-photos'), 'p1/img_1.jpg');
  assertEquals(objectPathFor('p1/img_1.jpg', 'city-hub-photos'), null);
  assertEquals(objectPathFor('p1/img_1.jpg', 'city-hub-photos', true), 'p1/img_1.jpg');
  assertEquals(objectPathFor('city-hub-photos/p1/a.jpg', 'city-hub-photos', true), 'p1/a.jpg');
  // Never resolves into another bucket (incident photos stay).
  assertEquals(objectPathFor(`${BASE}/public/incident-photos/i1/a.jpg`, 'city-hub-photos', true), null);
  assertEquals(objectPathFor('incident-photos/i1/a.jpg', 'city-hub-photos', true), null);
  assertEquals(objectPathFor('https://lh3.googleusercontent.com/a.jpg', 'avatars'), null);
  assertEquals(objectPathFor('../etc/passwd', 'avatars', true), null);
  assertEquals(objectPathFor(null, 'avatars'), null);
});

Deno.test('avatar and chat path guards', () => {
  assertEquals(isOwnAvatarName(`${U}-1700000000000.jpg`, U), true);
  assertEquals(isOwnAvatarName(`22222222-2222-2222-2222-222222222222-1.jpg`, U), false);
  assertEquals(isOwnAvatarName(`folder/${U}-1.jpg`, U), false);
  assertEquals(isChatMediaPath('images/img-1.jpg'), true);
  assertEquals(isChatMediaPath('voice/voice-1.webm'), true);
  assertEquals(isChatMediaPath('other/x.jpg'), false);
});

Deno.test('general post media keeps incident-photo copies', () => {
  const post = {
    id: 'p1',
    photo_urls: ['p1/img_1.jpg', 'p1/copy_2.jpg', `${BASE}/public/incident-photos/i1/a.jpg`],
    document_attachments: [{ url: 'p1/pdf_1.pdf', name: 'a.pdf' }, 'p1/pdf_2.pdf'],
  };
  const out = splitCityHubPostMedia(post, new Set(['p1/copy_2.jpg']));
  assertEquals(out.remove, ['p1/img_1.jpg', 'p1/pdf_1.pdf', 'p1/pdf_2.pdf']);
  assertEquals(out.keepPhotos, ['p1/copy_2.jpg']);
  assertEquals(out.keepDocuments, []);
});

Deno.test('chunk splits into batches', () => {
  assertEquals(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assertEquals(chunk([], 2), []);
});

// Minimal fake of the supabase-js query/storage surface used by the purge.
function fakeAdmin(tables: Record<string, Record<string, unknown>[]>, files: Record<string, string[]>, opts: { failRemove?: string } = {}) {
  const removed: Record<string, string[]> = {};
  const updates: { table: string; values: unknown; filters: [string, unknown][] }[] = [];
  function query(table: string) {
    const filters: [string, string, unknown][] = [];
    let updateValues: unknown = null;
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push(['eq', c, v]), q),
      in: (c: string, v: unknown) => (filters.push(['in', c, v]), q),
      not: (c: string) => (filters.push(['notnull', c, null]), q),
      order: () => q,
      range: () => q,
      update: (v: unknown) => ((updateValues = v), q),
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => {
        if (updateValues) {
          updates.push({ table, values: updateValues, filters: filters.map(([, c, v]) => [c, v]) });
          return Promise.resolve({ error: null }).then(res);
        }
        return Promise.resolve({ data: rows(), error: null }).then(res);
      },
    };
    function rows() {
      return (tables[table] || []).filter((r) =>
        filters.every(([op, c, v]) =>
          op === 'eq' ? r[c] === v : op === 'in' ? (v as unknown[]).includes(r[c]) : r[c] != null
        )
      );
    }
    return q;
  }
  return {
    removed,
    updates,
    from: query,
    storage: {
      from: (bucket: string) => ({
        list: (folder: string, o: { search?: string }) => {
          const all = (files[bucket] || []).filter((p) => (folder ? p.startsWith(`${folder}/`) : !p.includes('/')));
          const names = all.map((p) => (folder ? p.slice(folder.length + 1) : p)).filter((n) => !n.includes('/'));
          const hit = o?.search ? names.filter((n) => n.startsWith(o.search!)) : names;
          return Promise.resolve({ data: hit.map((name) => ({ name, id: 'x' })), error: null });
        },
        remove: (paths: string[]) => {
          if (opts.failRemove === bucket) return Promise.resolve({ error: { message: 'boom' } });
          (removed[bucket] ||= []).push(...paths);
          return Promise.resolve({ error: null });
        },
      }),
    },
  };
}

Deno.test('plan + run deletes personal media only and never incident photos', async () => {
  const admin = fakeAdmin(
    {
      users: [{ id: U, avatar_url: `${BASE}/public/avatars/${U}-2.jpg` }],
      chat_messages: [
        { id: 'm1', sender_id: U, media_url: `${BASE}/public/chat-media/images/img-1.jpg` },
        { id: 'm2', sender_id: U, media_url: `${BASE}/public/chat-media/voice/voice-1.webm` },
        { id: 'm3', sender_id: 'other', media_url: `${BASE}/public/chat-media/images/img-9.jpg` },
      ],
      city_hub_posts: [
        { id: 'p1', created_by_user_id: U, type: 'general', photo_urls: ['p1/img_1.jpg', 'p1/copy_1.jpg'], document_attachments: [] },
        { id: 'p2', created_by_user_id: U, type: 'suspect_alert', photo_urls: ['p2/img_1.jpg'], document_attachments: [] },
      ],
      city_hub_media_copies: [{ post_id: 'p1', dest_path: 'p1/copy_1.jpg', source_bucket: 'incident-photos' }],
      local_service_listings: [{ id: 'l1', owner_user_id: U, organization_id: 'o1', photo_paths: ['o1/services/l1/1_0.jpg', 'o1/needs/n1/x.jpg'] }],
    },
    {
      avatars: [`${U}-1.jpg`, `${U}-2.jpg`, 'someone-else-1.jpg'],
      'city-hub-photos': ['p1/img_1.jpg', 'p1/copy_1.jpg', 'p1/stray.jpg', 'p2/img_1.jpg'],
      'community-media': ['o1/services/l1/1_0.jpg', 'o1/services/l1/2_1.jpg', 'o1/needs/n1/x.jpg'],
      'incident-photos': ['i1/a.jpg'],
    }
  );
  const plan = await buildAccountMediaPurgePlan(admin, U, 'test');
  const res = await runAccountMediaPurge(admin, plan, 'test');
  assertEquals(admin.removed['avatars']?.sort(), [`${U}-1.jpg`, `${U}-2.jpg`]);
  assertEquals(admin.removed['chat-media']?.sort(), ['images/img-1.jpg', 'voice/voice-1.webm']);
  assertEquals(admin.removed['city-hub-photos']?.sort(), ['p1/img_1.jpg', 'p1/stray.jpg']);
  assertEquals(admin.removed['community-media']?.sort(), ['o1/services/l1/1_0.jpg', 'o1/services/l1/2_1.jpg']);
  assertEquals(admin.removed['incident-photos'], undefined);
  assertEquals(res.postsCleared, 1);
  assertEquals(admin.updates[0].values, { photo_urls: ['p1/copy_1.jpg'], document_attachments: [] });
});

Deno.test('a storage failure is logged and never throws', async () => {
  const admin = fakeAdmin({ users: [{ id: U, avatar_url: null }] }, { avatars: [`${U}-1.jpg`] }, { failRemove: 'avatars' });
  const plan = await buildAccountMediaPurgePlan(admin, U, 'test');
  const res = await runAccountMediaPurge(admin, plan, 'test');
  assertEquals(res.failed['avatars'], 1);
});

Deno.test('a broken client during planning yields an empty plan, not an error', async () => {
  const broken = { from: () => { throw new Error('down'); }, storage: { from: () => { throw new Error('down'); } } };
  const plan = await buildAccountMediaPurgePlan(broken, U, 'test');
  assertEquals(plan.objects, {});
  const res = await runAccountMediaPurge(broken, { userId: U, objects: { avatars: ['a'] }, cityHubPosts: [] }, 'test');
  assertEquals(res.failed['avatars'], 1);
});
