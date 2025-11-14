import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import { buildServer } from './server';
import { ServiceConfig } from './config';

const createConfig = async (): Promise<{ config: ServiceConfig; cleanup: () => Promise<void> }> => {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'asset-service-'));
  const config: ServiceConfig = {
    PORT: 0,
    HOST: '0.0.0.0',
    SERVICE_NAME: 'asset-service',
    DATA_DIR: dataDir,
    API_KEY: undefined
  };
  return {
    config,
    cleanup: () => fsp.rm(dataDir, { recursive: true, force: true })
  };
};

test('uploads and retrieves asset metadata', async (t) => {
  const { config, cleanup } = await createConfig();
  t.after(cleanup);

  const app = buildServer(config);
  await app.ready();
  t.after(async () => app.close());

  const boundary = '----asset-upload';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(
      'Content-Disposition: form-data; name="file"; filename="demo.txt"\r\nContent-Type: text/plain\r\n\r\n'
    ),
    Buffer.from('hello world'),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  const uploadResponse = await app.inject({
    method: 'POST',
    url: '/v1/assets:upload',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`
    },
    payload: body
  });

  assert.equal(uploadResponse.statusCode, 202);
  const record = uploadResponse.json<{ id: string; fileName: string }>();
  assert.equal(record.fileName, 'demo.txt');

  const fetchResponse = await app.inject({
    method: 'GET',
    url: `/v1/assets/${record.id}`
  });

  assert.equal(fetchResponse.statusCode, 200);
  const metadata = fetchResponse.json<{ id: string; sizeBytes: number }>();
  assert.equal(metadata.id, record.id);
  assert.equal(metadata.sizeBytes, 11);
});
