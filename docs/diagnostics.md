# Diagnostics

## Overview

AI Drive now records structured diagnostics for critical paths and aggregates repeated failures into incidents.

- Event sink: local NDJSON files (no third-party telemetry in this phase).
- Incident index: local JSON file with `OPEN`, `ACKED`, `RESOLVED` states.
- Notification Center only surfaces high-signal incidents (critical or repeated).

## Storage

Diagnostics files are written under `${AIDRIVE_DATA_DIR}/diagnostics` (or `apps/api/.data/diagnostics` when `AIDRIVE_DATA_DIR` is not set):

- `events-YYYY-MM-DD.ndjson`
- `incidents.json`

Retention:

- Daily event files rotate by date.
- Files and incident metadata older than 30 days are pruned.

## Event Model

`DiagnosticEvent` fields:

- `id`
- `ts`
- `severity` (`INFO | WARN | HIGH | CRITICAL`)
- `category` (`GENERATION | PROVIDER | PROXY | PERSISTENCE | REALTIME | CLIENT | SUPERVISOR | IMAGE_PROXY | SYSTEM`)
- `component`
- `eventName`
- `message`
- `workspaceId`
- `requestId`
- `traceId`
- `fingerprint`
- `context`

Fingerprint input is derived from:

- component
- category
- normalized error code/status
- normalized route
- normalized model

## Incident Model

`DiagnosticIncident` fields:

- `id`
- `fingerprint`
- `status` (`OPEN | ACKED | RESOLVED`)
- `severity`
- `causeStatus` (`KNOWN | UNKNOWN`)
- `title`
- `firstSeen`
- `lastSeen`
- `count`
- `latestEventId`

Aggregation behavior:

- `CRITICAL` and `HIGH` events open incidents immediately.
- `WARN` events open incidents only when the same fingerprint repeats at least 3 times within 5 minutes for timeout/rate-limit/network/proxy/fallback patterns.
- New events merge into existing `OPEN`/`ACKED` incidents by fingerprint.

## Redaction Policy

Diagnostics are redacted by default:

- Prompts and negative prompts are never stored raw.
- Prompt content is represented as hashes/length metadata.
- Reference image payloads are reduced to counts and total bytes.
- Secrets, API keys, auth headers, cookies, and token-like strings are scrubbed.
- Upstream/raw strings are truncated to a safe limit.

Allowed request settings include:

- `model`
- `type`
- `aspectRatio`
- `resolution`
- `quality`
- client request ID

## API Endpoints

All diagnostics routes require `OWNER` or `ADMIN` role (demo-mode `user_demo` is allowed when no membership records exist).

- `GET /v1/diagnostics/incidents`
- `GET /v1/diagnostics/incidents/:incidentId`
- `POST /v1/diagnostics/incidents/:incidentId/ack`
- `POST /v1/diagnostics/incidents/:incidentId/resolve`
- `GET /v1/diagnostics/incidents/:incidentId/packet`
- `GET /v1/diagnostics/incidents/:incidentId/prompts`
- `POST /v1/diagnostics/incidents/:incidentId/agent-report`
- `GET /v1/diagnostics/events`
- `POST /v1/diagnostics/ingest` (client/proxy/supervisor sink)

## Operator Workflow

1. Open Notification Center and review `SYSTEM_INCIDENT` entries.
2. Use **Copy incident packet** for full context, or copy **triage/fix/verify** prompts for targeted agent runs.
3. After using a tool, click **Helpful** or **Needs improvement** on the incident notification.
4. If improvement is needed, add a short suggestion when prompted.
5. Review packet `toolUsageFeedback` section for per-tool usage/helpfulness/improvement summary.
6. Acknowledge (`ack`) while investigation is in progress.
7. Resolve (`resolve`) after validation/fix.
8. Query raw events when root cause remains unknown.

Incident packet output includes:

- incident metadata
- severity breakdown
- cause status (`KNOWN`/`UNKNOWN`)
- timeline summary with route/model/status/latency hints
- embedded agent prompts (`triage`, `fix`, `verify`) plus suggested file hotspots
- `toolUsageFeedback` summary (used, helpful, needsImprovement, latest suggestion)

Structured incident prompts:

- `GET /v1/diagnostics/incidents/:incidentId/prompts`
- returns `hotspots` and three prompts to automate troubleshooting:
  - `triage`: determine root cause or explicit unknowns
  - `fix`: implement minimal, instrumented repair
  - `verify`: prove fix + diagnostics quality
- prompts now instruct agents to submit their `DIAGNOSTICS_TOOL_USAGE` block to:
  - `POST /v1/diagnostics/incidents/:incidentId/agent-report`
  - this route parses usage/helpfulness/improvement lines and records:
    - `diagnostics.tool.used`
    - `diagnostics.tool.feedback`
  - policy:
    - if improvement is small and does not require large context expansion, agent should implement it immediately (`autoImproved=true`)
    - if improvement requires too much context window, agent should continue the main task and submit deferred note (`deferred=true`, `deferNote=...`)
