import Fastify, { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import crypto from 'crypto';

import { ServiceConfig } from './config';
import { JournalReleaseStore, StoredReleaseStatus } from './storage/journalReleaseStore';

const ensureDir = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true });
};

const pageEntrySchema = z.object({
  id: z.string(),
  path: z.string(),
  locale: z.string(),
  title: z.string(),
  components: z.array(z.record(z.any())).default([]),
  seo: z.record(z.any()).optional()
});

const createReleaseSchema = z.object({
  name: z.string().optional(),
  notes: z.string().optional(),
  pages: z.array(pageEntrySchema).nonempty()
});

const listReleaseQuerySchema = z.object({
  status: z.enum(['created', 'promoted', 'rolledback']).optional(),
  q: z.string().min(1).optional()
});

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

  const deliveryDir = path.join(config.DATA_DIR, 'delivery');
  const storeDir = path.join(config.DATA_DIR, 'release-store');
  ensureDir(storeDir);
  ensureDir(deliveryDir);
  ensureDir(path.join(deliveryDir, 'releases'));

  const releaseStore = new JournalReleaseStore(path.join(storeDir, 'releases.json'), deliveryDir);

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

  app.get('/healthz', async () => ({ status: 'ok', service: config.SERVICE_NAME }));

  app.post('/v1/releases', async (request, reply) => {
    const payload = createReleaseSchema.parse(request.body);
    const release = await releaseStore.create(payload);
    reply.code(202).send(release);
  });

  app.get('/v1/releases', async (request) => {
    const query = listReleaseQuerySchema.parse(request.query);
    return releaseStore.list({ status: query.status as StoredReleaseStatus | undefined, search: query.q });
  });

  app.get('/v1/releases/summary', async () => releaseStore.summary());

  app.get('/v1/releases/active', async (request, reply) => {
    const { releaseId } = request.query as { releaseId?: string };
    const release = await releaseStore.getDeliverySnapshot(releaseId);
    if (!release) {
      reply.notFound('No promoted release found');
      return;
    }
    return release;
  });

  app.get('/v1/releases/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const release = await releaseStore.read(id);
      return release;
    } catch (error) {
      request.log.warn({ id, error }, 'Release not found');
      reply.notFound('Release not found');
      return;
    }
  });

  app.post('/v1/releases/:id/promote', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const promoted = await releaseStore.promote(id);
      return promoted;
    } catch (error) {
      request.log.error({ id, error }, 'Failed to promote release');
      reply.notFound('Release not found');
      return;
    }
  });

  app.post('/v1/releases/:id/rollback', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const rolledBack = await releaseStore.rollback(id);
      return rolledBack;
    } catch (error) {
      request.log.error({ id, error }, 'Failed to rollback release');
      reply.notFound('Release not found');
      return;
    }
  });

  return app;
};
