FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/sdk/package.json packages/sdk/package.json

RUN npm ci

COPY . .

RUN npm run build:prod

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV WEB_PORT=3000
ENV API_PORT=4100
ENV AIDRIVE_DATA_DIR=/data

COPY --from=builder /app /app

RUN mkdir -p /data

EXPOSE 3000

CMD ["node", "scripts/prod-supervisor.mjs"]

