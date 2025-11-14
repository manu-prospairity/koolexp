import Fastify, { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import { promises as fsp } from 'fs';
import path from 'path';
import crypto from 'crypto';

import { ServiceConfig } from './config';

type PublishedPage = {
  id: string;
  path: string;
  locale: string;
  title: string;
  components: unknown;
  seo?: unknown;
};

type PublishedRelease = {
  id: string;
  status: string;
  pages: PublishedPage[];
  promotedAt?: string;
  rolledBackAt?: string;
};

const readReleaseIndex = async (config: ServiceConfig): Promise<string | null> => {
  const indexPath = path.join(config.DATA_DIR, 'delivery', 'index.json');
  try {
    const payload = await fsp.readFile(indexPath, 'utf-8');
    const parsed = JSON.parse(payload) as { activeReleaseId?: string };
    return parsed.activeReleaseId ?? null;
  } catch {
    return null;
  }
};

const readReleaseFromDelivery = async (
  config: ServiceConfig,
  releaseId: string
): Promise<PublishedRelease | null> => {
  const releasesDir = path.join(config.DATA_DIR, 'delivery', 'releases');
  const filePath = path.join(releasesDir, `${releaseId}.json`);
  try {
    const payload = await fsp.readFile(filePath, 'utf-8');
    return JSON.parse(payload) as PublishedRelease;
  } catch {
    return null;
  }
};

const resolveRelease = async (
  config: ServiceConfig,
  releaseId?: string
): Promise<PublishedRelease | null> => {
  if (releaseId) {
    return readReleaseFromDelivery(config, releaseId);
  }
  const activeId = await readReleaseIndex(config);
  if (!activeId) {
    return null;
  }
  return readReleaseFromDelivery(config, activeId);
};

const listAvailableReleases = async (config: ServiceConfig) => {
  const releasesDir = path.join(config.DATA_DIR, 'delivery', 'releases');
  try {
    const files = await fsp.readdir(releasesDir);
    const releases = await Promise.all(
      files
        .filter((file) => file.endsWith('.json'))
        .map(async (file) => {
          const payload = await fsp.readFile(path.join(releasesDir, file), 'utf-8');
          const release = JSON.parse(payload) as PublishedRelease;
          return {
            id: release.id,
            status: release.status,
            promotedAt: release.promotedAt,
            rolledBackAt: release.rolledBackAt,
            pageCount: release.pages.length
          };
        })
    );
    return releases.sort((a, b) => (b.promotedAt ?? '').localeCompare(a.promotedAt ?? ''));
  } catch {
    return [];
  }
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

  app.get('/v1/delivery/pages/by-path', async (request, reply) => {
    const { path: pagePath, locale, releaseId } = request.query as {
      path?: string;
      locale?: string;
      releaseId?: string;
    };
    if (!pagePath || !locale) {
      reply.badRequest('path and locale query params are required');
      return;
    }

    const release = await resolveRelease(config, releaseId);
    if (!release) {
      reply.notFound('No promoted release found');
      return;
    }

    const page = release.pages.find((p) => p.path === pagePath && p.locale === locale);
    if (!page) {
      reply.notFound('Page not found in release snapshot');
      return;
    }

    return {
      ...page,
      releaseId: release.id,
      status: release.status
    };
  });

  app.get('/v1/delivery/releases', async () => listAvailableReleases(config));

  return app;
};
