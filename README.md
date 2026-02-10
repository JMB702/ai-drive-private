# AI Drive Platform

Monorepo for a Google Drive-style file platform with built-in image/video generation.

## Workspaces
- `apps/api`: Fastify API (`/v1` namespace)
- `apps/web`: Next.js web client
- `packages/shared`: Shared contracts and domain types
- `packages/sdk`: Shared API client for web/mobile/plugin
- `plugins/premiere`: Adobe Premiere Pro plugin scaffold
- `mobile`: Mobile app scaffold
- `infra/terraform`: AWS infrastructure baseline
- `docs`: API docs

## Quick start
1. Install Node.js 20+.
2. Copy env template: `cp .env.example .env`.
3. Fill keys in `.env` (for Gemini: `GEMINI_API_KEY=...`).
4. Install dependencies: `npm install`.
5. Build shared packages: `npm run -w @aidrive/shared build && npm run -w @aidrive/sdk build`.
6. Run API: `npm run dev`.
7. Run tests: `npm test`.

## Implemented foundations
- Workspace/team roles and effective permissions
- Drive assets/folders with search, move, copy, soft delete/restore
- Upload init/complete flow with signed URL abstraction
- Asset version lineage graph
- Generation job API with pluggable provider adapters
- Billing ledger + credit reservation/finalization/refund + overage
- Moderation state transitions and report/review endpoints
- Audit events and SSE job status stream
- Unit tests for permission, lineage, billing, moderation
- Integration tests for route behavior

## Notes
- Runtime store persists to disk (`AIDRIVE_DATA_DIR`, default `apps/api/.data` locally).
- SQL schema for Postgres is in `apps/api/src/db/schema.sql`.
- Provider integrations are adapter-based; Gemini can call API when key is configured.

## Always-on hosting
- To run AI Drive on an always-on cloud host (so it stays available when your laptop is off), use `docs/always-on-deploy.md`.
- This deployment keeps generated assets/history on a persistent volume mounted at `/data`.
- Fastest no-VM path: `docs/render-deploy.md` (Render Blueprint via `render.yaml`).
- One-time migration helper for existing local data: `npm run migrate:remote-data`.
