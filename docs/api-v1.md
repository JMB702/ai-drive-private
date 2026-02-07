# API v1 Overview

Base URL: `/v1`
Auth (dev): pass `x-user-id` header.

## Core endpoints
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/token/refresh`
- `GET /auth/oauth/:provider/callback`

- `GET /workspaces`
- `POST /workspaces`
- `GET /workspaces/:workspaceId/members`
- `PUT /workspaces/:workspaceId/members/:userId`

- `POST /drive/folders`
- `GET /drive/folders/:workspaceId`
- `POST /drive/assets`
- `GET /drive/assets/:workspaceId?q=&tag=`
- `POST /drive/uploads/init`
- `POST /drive/uploads/complete`
- `POST /drive/assets/:assetId/move`
- `POST /drive/assets/:assetId/copy`
- `DELETE /drive/assets/:assetId`
- `POST /drive/assets/:assetId/restore`

- `GET /versions/:assetId`
- `POST /versions`
- `POST /versions/:versionId/promote`

- `POST /generation/jobs`
- `GET /generation/jobs/:workspaceId`
- `POST /generation/jobs/:jobId/cancel`
- `POST /generation/jobs/:jobId/retry`
- `GET /realtime/jobs/stream` (SSE)

- `POST /sharing/invite`
- `POST /sharing/links`
- `POST /sharing/links/:linkId/revoke`

- `POST /permissions/grants`
- `POST /permissions/check`

- `GET /billing/:workspaceId/balance`
- `GET /billing/:workspaceId/usage`
- `POST /billing/top-up`
- `POST /billing/overage`

- `POST /moderation/report`
- `POST /moderation/review`
- `GET /moderation/:workspaceId/events`

- `POST /audit/events`
- `GET /audit/:workspaceId/events`
