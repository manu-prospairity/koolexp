# Bank Digital Experience Platform — MVP Workspace

This monorepo scaffolds the initial services for the banking Digital Experience Platform (DXP) MVP. It is organised as Node.js/TypeScript workspaces so each service can be developed, tested, and deployed independently while sharing lint/build tooling.

## Structure

```
bank-dxp/
  package.json         # workspace + shared tooling
  tsconfig.base.json   # shared TypeScript configuration
  data/                # local storage for releases/assets (file-based bucket)
  services/
    authoring-api/
    asset-service/
    publication-service/
    delivery-api/
```

Each service ships with:
- Fastify HTTP server
- Typed configuration via Zod
- Basic health endpoint (`GET /healthz`)
- Service-specific placeholder routes to be expanded in the MVP build

## Getting Started

```bash
cd bank-dxp
npm install
# For Prisma: set DATABASE_URL, then
npx prisma generate --schema services/authoring-api/prisma/schema.prisma
npx prisma migrate dev --schema services/authoring-api/prisma/schema.prisma --name init
npm run dev --workspace=services/authoring-api
```

Swap the workspace value to run other services. Add `-- --watch` if you want file watching via `tsx`.

### Demo Flow

With all four services running locally:

```bash
npm run demo \
  AUTHORING_URL=http://localhost:4101 \
  PUBLICATION_URL=http://localhost:4103 \
  DELIVERY_URL=http://localhost:4104
```

The script creates a draft page, requests a release, promotes it, and fetches the published content via the delivery API.

## Release Lifecycle

- Authoring API now persists release metadata and snapshots the included pages, exposing `GET /v1/releases`, `GET /v1/releases/:id`, and `POST /v1/releases/:id/retry` for auditing or retrying submissions.
- Publication service provides list/search capabilities on `/v1/releases` and stores every release plus its promoted snapshots on disk via a dedicated release store. Delivery API can read a specific `releaseId` or fall back to the latest promoted snapshot.

## Security & Observability

- All services accept an optional `API_KEY`. When set, every request (except `GET /healthz`) must include the `x-api-key` header and responses echo an `x-request-id` to correlate logs.
- Basic latency logging is emitted per request to aid troubleshooting.

## Testing & CI

- Publication service ships node:test coverage for the release store (`npm run test --workspace=services/publication-service`).
- A GitHub Actions workflow (`.github/workflows/ci.yml`) runs linting and the workspace test suite on every push or pull request.

## Next Steps

1. Flesh out domain models (PostgreSQL migrations, Prisma/Drizzle/Knex per architectural decision).
2. Implement end-to-end draft → publish flow by wiring Publication + Delivery services (filesystem storage currently simulates object store).
3. Add CI workflows (lint/test) and container build recipes.
4. Layer in observability exporters (OTel) and security controls (auth middleware, request validation).
