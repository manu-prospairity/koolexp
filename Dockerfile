FROM node:20-slim AS base

WORKDIR /app

COPY package*.json ./
COPY tsconfig.base.json ./
COPY services ./services
COPY scripts ./scripts
COPY data ./data

RUN npm ci
RUN npx prisma generate --schema services/authoring-api/prisma/schema.prisma

ARG SERVICE_PATH
ENV SERVICE_PATH=${SERVICE_PATH}
RUN test -n "$SERVICE_PATH" || (echo "SERVICE_PATH build arg is required" && exit 1)
RUN npm run build --workspace=$SERVICE_PATH

CMD ["sh", "-c", "npm run start --workspace=$SERVICE_PATH"]
