# Master Control Ops

Standalone lightweight UI for:
- Editing `docs/master-control.md`
- Editing `MASTER_CONTROL_HANDOFF.md` (Project manager prompt)
- Appending thread summary entries
- Creating delegation packages for focused threads (prompt + assets + copy/paste command)
- Browsing and editing existing sub-thread prompts
- Switching active project root for strict per-project isolation
- Copying a bootstrap command for initializing Master Control in another repo

This keeps operational thread-routing tooling separate from the product web app.

## Run
From:
- `/Users/jeffburt/Documents/AI Project/tools/master-control-ops`

Commands:
```bash
npm run dev
```

Open:
- `http://localhost:4210`

## Orchestration Compliance Harness
Run deterministic packet-first compliance checks (live API + replay failures):

```bash
npm run harness:orchestration-compliance
```

What it validates:
- focused-thread delegation returns packet-first `taskPacket`/`dispatchPrompt`
- Task Packet policy fields are present (start/fetch/package API/action/summary/begin)
- packet body does not leak destination thread
- metadata update keeps packet-first behavior intact
- replay failure cases produce expected violation IDs from `harness/replay-cases.json`

## Optional env vars
- `PORT` (default `4210`)
- `MASTER_CONTROL_PATH` (absolute or relative path to `master-control.md`)
- `MASTER_PROMPT_PATH` (absolute or relative path to the master handoff prompt file)
- `MASTER_CONTROL_BOOTSTRAP_SCRIPT` (absolute path to `install-master-control.sh`)

All API endpoints accept `?projectRoot=/absolute/path/to/repo` to scope reads/writes to one project.

## API
- `GET /api/master-control` read file
- `PUT /api/master-control` save full markdown body:
  - `{ "content": "..." }`
- `POST /api/master-control` append summary body:
  - `{ "thread": "...", "task": "...", "outcome": "...", "files": "...", "openItems": "..." }`

- `GET /api/master-prompt` read Project manager prompt file
- `PUT /api/master-prompt` save Project manager prompt body:
  - `{ "content": "..." }`
- `GET /api/bootstrap-command` generate copy-ready bootstrap command:
  - optional query: `targetRepoPath=/absolute/path/to/target/repo`
  - response includes existing-project-safe command with quoted paths
  - response includes `startPacket` (Project manager starter packet that routes to Master Control Ops first, then runs terminal/bootstrap setup from tool instructions)

- `POST /api/delegation-package` create delegation package:
  - `{ "title": "...", "targetThread": "...", "problem": "...", "fullPrompt": "...", "doneCriteria": "...", "reportBack": "...", "suggestedModel": "...", "modelReason": "...", "suggestedEffort": "low|medium|high|extra-high", "assets": [{ "name": "...", "type": "...", "dataBase64": "..." }] }`
  - response includes `threadSuggestion`:
    - `recommendationType`: `exact` | `use-existing` | `reroute` | `create-new`
    - `recommendedThread`: suggested existing or proposed new thread name
    - `shouldCreate: true` only when no close existing thread match is found
    - `message` with guidance to use an existing thread or create a new one before dispatch
  - response includes `modelSuggestion` (`model`, `uiModel`, `effort`, `reason`, `source`)
  - response includes `operatorInstructions` (outside-copy guidance including paste destination thread + model + effort)
  - response includes `taskPacket`/`dispatchPrompt` (paste-ready tool-linked packet for a sub thread to fetch latest prompt and start immediately)
  - `copyCommand` now points to `TASK_PACKET.md` for direct thread handoff
- `POST /api/delegation-packages/bulk` create multiple task packets in one request:
  - `{ "items": [{ "title": "...", "targetThread": "...", "problem": "...", "fullPrompt": "...", "doneCriteria": "...", "reportBack": "...", "parallelSafe": true }] }`
  - strict parallel validation:
    - requires at least 2 items
    - each item must set `parallelSafe: true`
    - one package per target thread (no duplicate target thread in the same batch)
  - response includes `created[]` with `copyCommand` per package and `dispatchCommands` as newline-separated commands

- `GET /api/delegation-packages` list delegation packages
- `GET /api/delegation-packages/:id` load one package (metadata + full prompt)
  - includes `taskPacket`/`dispatchPrompt` (paste-ready tool-linked packet for immediate execution in sub thread)
  - includes `operatorInstructions` (paste destination + recommended model + low/medium/high/extra-high guidance)
- `PUT /api/delegation-packages/:id/prompt` save one package prompt:
  - `{ "content": "..." }`
- `PUT /api/delegation-packages/:id/metadata` save package metadata and optional prompt regeneration:
  - `{ "title": "...", "targetThread": "...", "problem": "...", "fullPrompt": "...", "doneCriteria": "...", "reportBack": "...", "suggestedModel": "...", "modelReason": "...", "suggestedEffort": "low|medium|high|extra-high", "regeneratePrompt": true|false }`

Delegation packages are written to:
- `docs/master-control-delegations/<package-id>/`
  - `TARGET_THREAD_PROMPT.md`
  - `TASK_PACKET.md`
  - `package.json`
  - `assets/*` (if attached)
