import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import { FileReleaseStore } from '../fileReleaseStore';

const createStore = async () => {
  const baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'release-store-'));
  const releasesDir = path.join(baseDir, 'releases');
  const deliveryDir = path.join(baseDir, 'delivery');
  await fsp.mkdir(releasesDir, { recursive: true });
  await fsp.mkdir(deliveryDir, { recursive: true });
  const store = new FileReleaseStore(releasesDir, deliveryDir);
  return { store, baseDir, releasesDir, deliveryDir };
};

const samplePage = {
  id: 'page-1',
  path: '/demo',
  locale: 'en-AU',
  title: 'Demo',
  components: [],
  seo: { canonical: 'demo' }
};

test('creates and lists releases', async (t) => {
  const { store, baseDir } = await createStore();
  t.after(async () => fsp.rm(baseDir, { recursive: true, force: true }));

  await store.create({ name: 'demo', notes: 'first', pages: [samplePage] });
  const releases = await store.list();

  assert.equal(releases.length, 1);
  assert.equal(releases[0].name, 'demo');
  assert.equal(releases[0].status, 'created');
});

test('promoting a release writes delivery snapshot', async (t) => {
  const { store, baseDir, deliveryDir } = await createStore();
  t.after(async () => fsp.rm(baseDir, { recursive: true, force: true }));

  const release = await store.create({ pages: [samplePage] });
  const promoted = await store.promote(release.id);

  assert.equal(promoted.status, 'promoted');
  assert.ok(promoted.promotedAt);

  const deliveryReleasesDir = path.join(deliveryDir, 'releases');
  const snapshotPath = path.join(deliveryReleasesDir, `${release.id}.json`);
  const snapshot = JSON.parse(await fsp.readFile(snapshotPath, 'utf-8'));
  assert.equal(snapshot.id, release.id);
});

test('rollback updates release status', async (t) => {
  const { store, baseDir } = await createStore();
  t.after(async () => fsp.rm(baseDir, { recursive: true, force: true }));

  const release = await store.create({ pages: [samplePage] });
  const rolledBack = await store.rollback(release.id);
  assert.equal(rolledBack.status, 'rolledback');
  assert.ok(rolledBack.rolledBackAt);
});
