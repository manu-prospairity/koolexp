import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import { buildServer } from './server';
import { ServiceConfig } from './config';

const createDeliveryDir = async () => {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'delivery-api-'));
  const releasesDir = path.join(dataDir, 'delivery', 'releases');
  await fsp.mkdir(releasesDir, { recursive: true });
  return { dataDir, releasesDir };
};

test('serves page from promoted release snapshot', async (t) => {
  const { dataDir, releasesDir } = await createDeliveryDir();
  t.after(() => fsp.rm(dataDir, { recursive: true, force: true }));

  const release = {
    id: 'rel-1',
    status: 'promoted',
    promotedAt: new Date().toISOString(),
    pages: [
      {
        id: 'page-1',
        path: '/demo',
        locale: 'en-AU',
        title: 'Demo',
        components: [{ componentKey: 'hero', props: {} }]
      }
    ]
  };

  await fsp.writeFile(path.join(releasesDir, `${release.id}.json`), JSON.stringify(release, null, 2));
  await fsp.writeFile(
    path.join(dataDir, 'delivery', 'index.json'),
    JSON.stringify({ activeReleaseId: release.id })
  );

  const config: ServiceConfig = {
    PORT: 0,
    HOST: '0.0.0.0',
    SERVICE_NAME: 'delivery-api',
    DATA_DIR: dataDir,
    API_KEY: undefined
  };

  const app = buildServer(config);
  await app.ready();
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/v1/delivery/pages/by-path',
    query: { path: '/demo', locale: 'en-AU' }
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json<{ title: string; releaseId: string }>();
  assert.equal(payload.title, 'Demo');
  assert.equal(payload.releaseId, 'rel-1');

  const releasesResponse = await app.inject({ method: 'GET', url: '/v1/delivery/releases' });
  assert.equal(releasesResponse.statusCode, 200);
  const releases = releasesResponse.json<Array<{ id: string }>>();
  assert.equal(releases.length, 1);
});
