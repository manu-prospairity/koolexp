import Fastify, { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';
import crypto from 'crypto';
import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';

import { ServiceConfig } from './config';

type AssetRecord = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uri: string;
  status: 'stored';
  antivirus: { status: 'clean'; engine: string };
  dlpFlags: string[];
};

const ensureDir = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true });
};

const saveMetadata = async (dir: string, record: AssetRecord) => {
  const metadataPath = path.join(dir, `${record.id}.json`);
  await fsp.writeFile(metadataPath, JSON.stringify(record, null, 2));
};

export const buildServer = (config: ServiceConfig): FastifyInstance => {
  const app = Fastify({
    logger: {
      level: 'info',
      transport:
        process.env.NODE_ENV === 'production'
          ? undefined
          : {
              target: 'pino-pretty'
            }
    }
  });

  app.decorate('config', config);

  app.register(helmet);
  app.register(sensible);
  app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  app.addHook('onRequest', (request, reply, done) => {
    const requestId =
      (request.headers['x-request-id'] as string | undefined) ?? crypto.randomUUID();
    reply.header('x-request-id', requestId);
    request.log = request.log.child({ requestId });
    (request as typeof request & { metricsStart?: bigint }).metricsStart = process.hrtime.bigint();

    if (request.url !== '/healthz' && config.API_KEY) {
      const provided = request.headers['x-api-key'];
      const normalized = Array.isArray(provided) ? provided[0] : provided;
      if (normalized !== config.API_KEY) {
        reply.unauthorized('Invalid API key');
        return;
      }
    }

    done();
  });

  app.addHook('onResponse', (request, reply, done) => {
    const metricsStart = (request as typeof request & { metricsStart?: bigint }).metricsStart;
    if (metricsStart) {
      const durationMs = Number(process.hrtime.bigint() - metricsStart) / 1_000_000;
      request.log.info(
        {
          durationMs,
          statusCode: reply.statusCode,
          route: request.routerPath
        },
        'request.completed'
      );
    }
    done();
  });

  const assetDir = path.join(config.DATA_DIR, 'assets');
  const metadataDir = path.join(config.DATA_DIR, 'assets-meta');
  ensureDir(assetDir);
  ensureDir(metadataDir);

  app.get('/healthz', async () => ({ status: 'ok', service: config.SERVICE_NAME }));

  app.post('/v1/assets:upload', async (request, reply) => {
    const data = await request.file();
    if (!data) {
      reply.badRequest('Expected multipart/form-data file field');
      return;
    }

    const buffer = await data.toBuffer();
    const now = new Date().toISOString();
    const assetId = crypto.randomUUID();

    const ext = data.filename ? path.extname(data.filename) : '';
    const filePath = path.join(assetDir, `${assetId}${ext}`);
    await fsp.writeFile(filePath, buffer);

    const record: AssetRecord = {
      id: assetId,
      fileName: data.filename,
      mimeType: data.mimetype,
      sizeBytes: buffer.byteLength,
      uploadedAt: now,
      status: 'stored',
      uri: `file://${filePath}`,
      antivirus: { status: 'clean', engine: 'stub-av' },
      dlpFlags: buffer.byteLength > 10 * 1024 * 1024 ? ['manual_review_large_file'] : []
    };

    await saveMetadata(metadataDir, record);

    reply.code(202);
    return record;
  });

  app.get('/v1/assets/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const metadataPath = path.join(metadataDir, `${id}.json`);
    try {
      const payload = await fsp.readFile(metadataPath, 'utf-8');
      return JSON.parse(payload) as AssetRecord;
    } catch (error) {
      request.log.warn({ id, error }, 'Asset not found');
      reply.notFound('Asset not found');
      return;
    }
  });

  return app;
};
