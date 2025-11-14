import Fastify, { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import { fetch } from 'undici';
import { ZodError, z } from 'zod';
import { Prisma } from '@prisma/client';
import crypto from 'crypto';

import { ServiceConfig } from './config';
import prismaPlugin from './plugins/prisma';

const pageStatuses = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] as const;
const fragmentStatuses = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] as const;

const componentSchema = z.object({
  componentKey: z.string(),
  region: z.string().optional(),
  props: z.record(z.any()).optional()
});

const createPageSchema = z.object({
  path: z.string().min(1),
  title: z.string().min(1),
  template: z.string().min(1),
  locale: z.string().min(2),
  components: z.array(componentSchema).default([]),
  seo: z.record(z.any()).optional(),
  publishAt: z.coerce.date().optional()
});

const createFragmentSchema = z.object({
  model: z.string().min(1),
  locale: z.string().min(2),
  fields: z.record(z.any()),
  status: z.enum(fragmentStatuses).default('DRAFT'),
  version: z.number().int().min(1).default(1)
});

const releaseRequestSchema = z.object({
  pageIds: z.array(z.string().uuid()).min(1),
  name: z.string().optional(),
  notes: z.string().optional()
});

const releaseListQuerySchema = z.object({
  status: z.enum(['QUEUED', 'SUBMITTED', 'FAILED']).optional(),
  limit: z.coerce.number().min(1).max(50).default(20)
});

const fragmentListQuerySchema = z.object({
  model: z.string().optional(),
  locale: z.string().optional(),
  status: z.enum(fragmentStatuses).optional(),
  limit: z.coerce.number().min(1).max(50).default(20)
});

const updateFragmentSchema = z.object({
  fields: z.record(z.any()).optional(),
  status: z.enum(fragmentStatuses).optional(),
  version: z.number().int().min(1).optional()
});

const scheduleSchema = z.object({
  startAt: z.coerce.date().nullable().optional(),
  endAt: z.coerce.date().nullable().optional()
});

const workflowEventSchema = z.object({
  actor: z.string().min(1),
  action: z.string().min(1),
  notes: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  status: z.enum(pageStatuses).optional()
});

const fragmentWorkflowEventSchema = z.object({
  actor: z.string().min(1),
  action: z.string().min(1),
  notes: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  status: z.enum(fragmentStatuses).optional()
});

const approvalEntitySchema = z.object({
  entityType: z.enum(['PAGE', 'FRAGMENT']),
  entityId: z.string().uuid(),
  requestedBy: z.string().min(1),
  notes: z.string().optional()
});

const approvalDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  decidedBy: z.string().min(1),
  notes: z.string().optional()
});

const approvalListQuerySchema = z.object({
  entityType: z.enum(['PAGE', 'FRAGMENT']).optional(),
  entityId: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  limit: z.coerce.number().min(1).max(50).default(20)
});

const workflowListQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(50).default(20)
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

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send({ message: 'Validation failed', issues: error.issues });
      return;
    }
    request.log.error(error);
    reply.status(500).send({ message: 'Internal Server Error' });
  });

  app.register(helmet);
  app.register(sensible);
  app.register(prismaPlugin);

  app.addHook('onRequest', (request, reply, done) => {
    const headerKey = 'x-api-key';
    const requestId =
      (request.headers['x-request-id'] as string | undefined) ?? crypto.randomUUID();
    reply.header('x-request-id', requestId);
    request.log = request.log.child({ requestId });
    (request as typeof request & { metricsStart?: bigint }).metricsStart = process.hrtime.bigint();

    if (request.url === '/healthz') {
      done();
      return;
    }

    if (config.API_KEY) {
      const provided = request.headers[headerKey];
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

  app.post('/v1/pages', async (request, reply) => {
    const payload = createPageSchema.parse(request.body);

    const page = await app.prisma.page.create({
      data: {
        path: payload.path,
        title: payload.title,
        template: payload.template,
        locale: payload.locale,
        components: payload.components,
        seo: payload.seo,
        publishAt: payload.publishAt,
        status: 'DRAFT'
      }
    });

    reply.code(201);
    return page;
  });

  app.get('/v1/pages/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const page = await app.prisma.page.findUnique({ where: { id } });

    if (!page) {
      reply.notFound('Page not found');
      return;
    }

    return page;
  });

  app.get('/v1/pages', async (request, reply) => {
    const { path, locale } = request.query as { path?: string; locale?: string };
    if (path) {
      const page = await app.prisma.page.findFirst({
        where: { path, ...(locale ? { locale } : {}) }
      });
      if (!page) {
        reply.notFound('Page not found');
        return;
      }
      return page;
    }

    const pages = await app.prisma.page.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 20
    });
    return pages;
  });

  app.get('/v1/pages/:id/schedule', async (request, reply) => {
    const { id } = request.params as { id: string };
    const schedule = await app.prisma.pageSchedule.findUnique({ where: { pageId: id } });
    if (!schedule) {
      reply.notFound('Schedule not found for page');
      return;
    }
    return schedule;
  });

  app.put('/v1/pages/:id/schedule', async (request, reply) => {
    const { id } = request.params as { id: string };
    const payload = scheduleSchema.parse(request.body);

    const page = await app.prisma.page.findUnique({ where: { id } });
    if (!page) {
      reply.notFound('Page not found');
      return;
    }

    const schedule = await app.prisma.pageSchedule.upsert({
      where: { pageId: id },
      create: {
        pageId: id,
        startAt: payload.startAt ?? null,
        endAt: payload.endAt ?? null
      },
      update: {
        startAt: payload.startAt ?? null,
        endAt: payload.endAt ?? null
      }
    });

    reply.code(200).send(schedule);
  });

  app.get('/v1/pages/:id/workflow-events', async (request) => {
    const { id } = request.params as { id: string };
    const query = workflowListQuerySchema.parse(request.query);
    return app.prisma.pageWorkflowEvent.findMany({
      where: { pageId: id },
      orderBy: { createdAt: 'desc' },
      take: query.limit
    });
  });

  app.post('/v1/pages/:id/workflow-events', async (request, reply) => {
    const { id } = request.params as { id: string };
    const payload = workflowEventSchema.parse(request.body);

    const page = await app.prisma.page.findUnique({ where: { id } });
    if (!page) {
      reply.notFound('Page not found');
      return;
    }

    if (payload.status && payload.status !== page.status) {
      await app.prisma.page.update({
        where: { id },
        data: { status: payload.status }
      });
    }

    const event = await recordPageWorkflow(id, {
      actor: payload.actor,
      action: payload.action,
      notes: payload.notes,
      metadata: payload.metadata as Prisma.InputJsonValue | undefined
    });

    reply.code(201).send(event);
  });

  app.post('/v1/fragments', async (request, reply) => {
    const payload = createFragmentSchema.parse(request.body);
    const fragment = await app.prisma.contentFragment.create({ data: payload });
    reply.code(201);
    return fragment;
  });

  app.get('/v1/fragments', async (request) => {
    const query = fragmentListQuerySchema.parse(request.query);
    return app.prisma.contentFragment.findMany({
      where: {
        ...(query.model ? { model: query.model } : {}),
        ...(query.locale ? { locale: query.locale } : {}),
        ...(query.status ? { status: query.status } : {})
      },
      orderBy: { updatedAt: 'desc' },
      take: query.limit
    });
  });

  app.get('/v1/fragments/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const fragment = await app.prisma.contentFragment.findUnique({ where: { id } });
    if (!fragment) {
      reply.notFound('Fragment not found');
      return;
    }
    return fragment;
  });

  app.patch('/v1/fragments/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const payload = updateFragmentSchema.parse(request.body);

    try {
      const updated = await app.prisma.contentFragment.update({
        where: { id },
        data: {
          ...(payload.fields ? { fields: payload.fields as Prisma.InputJsonValue } : {}),
          ...(payload.status ? { status: payload.status } : {}),
          ...(payload.version ? { version: payload.version } : {})
        }
      });

      if (payload.status) {
        await recordFragmentWorkflow(id, {
          actor: 'system',
          action: `status:${payload.status}`,
          notes: 'Status updated via API'
        });
      }

      return updated;
    } catch (error) {
      request.log.error({ err: error, fragmentId: id }, 'Failed to update fragment');
      reply.notFound('Fragment not found');
    }
  });

  app.get('/v1/fragments/:id/workflow-events', async (request) => {
    const { id } = request.params as { id: string };
    const query = workflowListQuerySchema.parse(request.query);
    return app.prisma.fragmentWorkflowEvent.findMany({
      where: { fragmentId: id },
      orderBy: { createdAt: 'desc' },
      take: query.limit
    });
  });

  app.post('/v1/fragments/:id/workflow-events', async (request, reply) => {
    const { id } = request.params as { id: string };
    const payload = fragmentWorkflowEventSchema.parse(request.body);
    const fragment = await app.prisma.contentFragment.findUnique({ where: { id } });
    if (!fragment) {
      reply.notFound('Fragment not found');
      return;
    }

    if (payload.status && payload.status !== fragment.status) {
      await app.prisma.contentFragment.update({
        where: { id },
        data: { status: payload.status }
      });
    }

    const event = await recordFragmentWorkflow(id, {
      actor: payload.actor,
      action: payload.action,
      notes: payload.notes,
      metadata: payload.metadata as Prisma.InputJsonValue | undefined
    });

    reply.code(201).send(event);
  });

  const fetchReleaseWithPages = async (releaseId: string) =>
    app.prisma.release.findUnique({
      where: { id: releaseId },
      include: { pages: { orderBy: { sortOrder: 'asc' } } }
    });

  const recordPageWorkflow = async (pageId: string, data: Omit<Prisma.PageWorkflowEventCreateInput, 'page'>) =>
    app.prisma.pageWorkflowEvent.create({
      data: {
        pageId,
        actor: data.actor,
        action: data.action,
        notes: data.notes,
        metadata: data.metadata
      }
    });

  const recordFragmentWorkflow = async (
    fragmentId: string,
    data: Omit<Prisma.FragmentWorkflowEventCreateInput, 'fragment'>
  ) =>
    app.prisma.fragmentWorkflowEvent.create({
      data: {
        fragmentId,
        actor: data.actor,
        action: data.action,
        notes: data.notes,
        metadata: data.metadata
      }
    });

  const ensureEntityExists = async (entityType: 'PAGE' | 'FRAGMENT', entityId: string) => {
    if (entityType === 'PAGE') {
      return app.prisma.page.findUnique({ where: { id: entityId } });
    }
    return app.prisma.contentFragment.findUnique({ where: { id: entityId } });
  };

  const submitReleaseToPublication = async (releaseId: string) => {
    const release = await fetchReleaseWithPages(releaseId);
    if (!release) {
      app.log.warn({ releaseId }, 'Release disappeared before submission');
      throw new Error('Release disappeared before submission');
    }

    const payload = {
      name: release.name,
      notes: release.notes,
      pages: release.pages.map((page) => ({
        id: page.pageId,
        path: page.path,
        locale: page.locale,
        title: page.title,
        components: page.components,
        seo: page.seo ?? undefined
      }))
    };

    try {
      const response = await fetch(`${config.PUBLICATION_SERVICE_URL}/v1/releases`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.PUBLICATION_SERVICE_API_KEY
            ? { 'x-api-key': config.PUBLICATION_SERVICE_API_KEY }
            : {})
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Publication service rejected release: ${errorText}`);
      }

      const publicationRelease = (await response.json()) as { id: string; pages?: unknown };
      await app.prisma.release.update({
        where: { id: releaseId },
        data: {
          status: 'SUBMITTED',
          publicationId: publicationRelease.id,
          errorMessage: null,
          lastSubmittedAt: new Date()
        }
      });
      return publicationRelease;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to submit release to publication';
      await app.prisma.release.update({
        where: { id: releaseId },
        data: {
          status: 'FAILED',
          errorMessage: message,
          lastSubmittedAt: new Date()
        }
      });
      throw error;
    }
  };

  app.post('/v1/releases', async (request, reply) => {
    const payload = releaseRequestSchema.parse(request.body);

    const pages = await app.prisma.page.findMany({
      where: { id: { in: payload.pageIds } }
    });

    if (pages.length !== payload.pageIds.length) {
      const missing = payload.pageIds.filter((id) => !pages.find((page) => page.id === id));
      reply.badRequest(`Page IDs not found: ${missing.join(', ')}`);
      return;
    }

    const orderedPages = payload.pageIds
      .map((id) => pages.find((page) => page.id === id))
      .filter(Boolean);

    const release = await app.prisma.$transaction(async (tx) => {
      const createdRelease = await tx.release.create({
        data: {
          name: payload.name,
          notes: payload.notes,
          status: 'QUEUED'
        }
      });

      await tx.releasePage.createMany({
        data: orderedPages.map((page, index) => ({
          releaseId: createdRelease.id,
          pageId: page!.id,
          sortOrder: index,
          path: page!.path,
          locale: page!.locale,
          title: page!.title,
          components: page!.components as Prisma.InputJsonValue,
          seo: (page!.seo ?? undefined) as Prisma.InputJsonValue | undefined
        }))
      });

      return createdRelease;
    });

    try {
      const publicationRelease = await submitReleaseToPublication(release.id);
      const releaseWithPages = await fetchReleaseWithPages(release.id);
      if (!releaseWithPages) {
        reply.internalServerError('Release persisted but could not be loaded');
        return;
      }
      reply.code(202).send({
        authoringReleaseId: release.id,
        ...publicationRelease,
        pages: publicationRelease.pages ?? releaseWithPages.pages
      });
    } catch (error) {
      app.log.error({ err: error, releaseId: release.id }, 'Release submission failed');
      reply.internalServerError('Failed to submit release to publication');
    }
  });

  app.get('/v1/releases', async (request) => {
    const query = releaseListQuerySchema.parse(request.query);

    const releases = await app.prisma.release.findMany({
      where: query.status ? { status: query.status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      select: {
        id: true,
        name: true,
        notes: true,
        status: true,
        publicationId: true,
        lastSubmittedAt: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { pages: true } }
      }
    });

    return releases.map(({ _count, ...release }) => ({
      ...release,
      pageCount: _count.pages
    }));
  });

  app.get('/v1/releases/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const release = await fetchReleaseWithPages(id);
    if (!release) {
      reply.notFound('Release not found');
      return;
    }
    return release;
  });

  app.post('/v1/releases/:id/retry', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await app.prisma.release.findUnique({ where: { id } });
    if (!existing) {
      reply.notFound('Release not found');
      return;
    }

    const updated = await app.prisma.release.update({
      where: { id },
      data: { status: 'QUEUED', errorMessage: null }
    });

    try {
      const publicationRelease = await submitReleaseToPublication(id);
      const refreshed = await fetchReleaseWithPages(id);
      reply
        .code(202)
        .send(
          publicationRelease
            ? { authoringReleaseId: id, ...publicationRelease }
            : refreshed ?? updated
        );
    } catch (error) {
      app.log.error({ err: error, releaseId: id }, 'Release retry submission failed');
      reply.internalServerError('Failed to resubmit release');
    }
  });

  app.post('/v1/approvals', async (request, reply) => {
    const payload = approvalEntitySchema.parse(request.body);
    const entity = await ensureEntityExists(payload.entityType, payload.entityId);
    if (!entity) {
      reply.notFound(`${payload.entityType} not found`);
      return;
    }

    const approval = await app.prisma.approvalRequest.create({
      data: {
        entityType: payload.entityType,
        entityId: payload.entityId,
        requestedBy: payload.requestedBy,
        notes: payload.notes
      }
    });

    if (payload.entityType === 'PAGE') {
      await recordPageWorkflow(payload.entityId, {
        actor: payload.requestedBy,
        action: 'approval:requested',
        notes: payload.notes
      });
    } else {
      await recordFragmentWorkflow(payload.entityId, {
        actor: payload.requestedBy,
        action: 'approval:requested',
        notes: payload.notes
      });
    }

    reply.code(201).send(approval);
  });

  app.get('/v1/approvals', async (request) => {
    const query = approvalListQuerySchema.parse(request.query);
    return app.prisma.approvalRequest.findMany({
      where: {
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.status ? { status: query.status } : {})
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit
    });
  });

  app.post('/v1/approvals/:id/decision', async (request, reply) => {
    const { id } = request.params as { id: string };
    const payload = approvalDecisionSchema.parse(request.body);

    const approval = await app.prisma.approvalRequest.findUnique({ where: { id } });
    if (!approval) {
      reply.notFound('Approval not found');
      return;
    }

    if (approval.status !== 'PENDING') {
      reply.conflict('Approval already decided');
      return;
    }

    const updated = await app.prisma.approvalRequest.update({
      where: { id },
      data: {
        status: payload.decision,
        decidedBy: payload.decidedBy,
        decidedAt: new Date(),
        notes: payload.notes ?? approval.notes
      }
    });

    const workflowNotes = payload.notes ?? undefined;

    if (approval.entityType === 'PAGE') {
      const nextStatus = payload.decision === 'APPROVED' ? 'APPROVED' : 'IN_REVIEW';
      await app.prisma.page.update({
        where: { id: approval.entityId },
        data: { status: nextStatus }
      });
      await recordPageWorkflow(approval.entityId, {
        actor: payload.decidedBy,
        action: `approval:${payload.decision.toLowerCase()}`,
        notes: workflowNotes
      });
    } else {
      const nextStatus = payload.decision === 'APPROVED' ? 'APPROVED' : 'IN_REVIEW';
      await app.prisma.contentFragment.update({
        where: { id: approval.entityId },
        data: { status: nextStatus }
      });
      await recordFragmentWorkflow(approval.entityId, {
        actor: payload.decidedBy,
        action: `approval:${payload.decision.toLowerCase()}`,
        notes: workflowNotes
      });
    }

    reply.code(200).send(updated);
  });

  return app;
};
