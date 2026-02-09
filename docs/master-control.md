# Master Control

Purpose: lightweight routing memory for project threads.

Use at the start of every prompt:
1. Check `Thread Map`.
2. Run Master Control workflow by default for project work, even when `mc//` is not present.
3. Read recent entries in `Thread Summaries` before deciding next actions.
4. Route work to `Project manager` unless the request is narrowly scoped.
5. If delegating to another thread, follow `Thread Routing Rules`.
6. Include the `Summary Return Rule`.

## MC Trigger Rule
1. `mc//` is a reinforcement/reminder trigger for Master Control behavior, not the only trigger.
2. Master Control should still be used by default without `mc//` for project execution and delegation workflows.
3. If Master Control is intentionally not used, explicitly acknowledge it in the response using:
   `Master Control not required for this task: <short reason>.`
4. Treat non-use as an exception, not the default.

## Thread Map
- `Project manager` (canonical coordinator thread)
  - Cross-cutting decisions, API+web issues, integration, release readiness.
- `Folders`
  - Folder/project structure, moves, ordering, folder-specific UX.
- `Image Grids`
  - Grid layout, sort/view modes, selection and rendering in grids.
- `Generate Panel`
  - Prompt/model controls, submit UX, generation form behavior.
- `Add notification read-all button`
  - Notification read state and bulk notification actions.
- `Fix dual Gemini and nano generation`
  - Provider/model reliability for Gemini + Nano flows.
- `Investigate missing graphics`
  - Missing previews/assets/rendering diagnostics.
- `Master Control Ops QA`
  - End-to-end verification of standalone ops tooling and routing workflows.
- `Master Control UI`
  - Master Control frontend layout, readability, controls, and overall UX clarity.
- `Delegation Prompt Quality`
  - Prompt clarity, context completeness, and delegation instruction quality.
- `Model Recommendation Tuning`
  - Calibration of auto model suggestions for thread packages.
- `Asset Handoff Reliability`
  - Validation of attached file/screenshot handoff in delegation packages.
- `Thread Lifecycle Rules`
  - Enforcement and refinement of known/unknown thread creation policy.
- `Orchestration Compliance Harness`
  - Packet-first orchestration compliance checks and replayable handoff failure harness coverage.
- `Old Main project thread`
  - Historical context only, not canonical.

## Summary Return Rule
When delegating to another thread, append this instruction:
`At completion, post a short summary in Master Control -> Thread Summaries.`

Required summary format (max 6 lines):
- `Date: YYYY-MM-DD`
- `Thread: <name>`
- `Task: <one line>`
- `Outcome: <one line>`
- `Files: <up to 5 key paths or 'none'>`
- `Open items: <one line or 'none'>`

## Summary Intake Rule
1. Before answering project-management questions or diagnosing failures, read the latest relevant `Thread Summaries` entries.
2. Treat missing summary entries from delegated threads as a visibility gap and state that explicitly.
3. If summary coverage is incomplete, request/trigger the missing thread summaries before claiming confidence on root cause.

## Delegation Packet Rules
1. Project manager provides `Paste into thread: <thread name>` outside the packet.
2. Task Packet body must not include the destination thread field.
3. Task Packet body should only contain tool-access/start instructions and return-summary requirement.
4. Model + effort guidance belongs outside the packet copy block.
5. Multi-packet dispatch is allowed only for parallel-safe tasks that can run independently and target different threads.

## Start Packet Rules
1. Start Packet is only for initializing Master Control in a new or existing project.
2. Start Packet is different from Task Packet and must not be used for normal delegated implementation tasks.
3. Start Packet must instruct the target thread to run terminal/bootstrap setup itself.
4. After setup, normal work uses Task Packets for focused delegation.
5. Bootstrap should be run once in the Project manager thread per project context; sub-threads should not run bootstrap.

## Thread Routing Rules
1. Recommend an existing focused thread first when there is a clear match.
2. If no focused thread clearly matches, suggest creating a new focused thread with a concrete name and scope.
3. UI/UX or visual layout work for Master Control should default to `Master Control UI`.
4. `Thread Lifecycle Rules` is for policy/routing governance, not primary UI implementation.
5. Project manager should proactively delegate focused work when beneficial, even if the user did not explicitly request delegation.

## Thread Summaries
Primary cross-thread state log. Read relevant recent entries first.

- Date: 2026-02-08
  Thread: Project manager
  Task: Initialize thread routing memory.
  Outcome: Added Master Control with thread map and summary protocol.
  Files: docs/master-control.md
  Open items: none
- Date: 2026-02-08
  Thread: Project manager
  Task: Terminal smoke test of delegation workflow with new focused threads
  Outcome: Created delegation packages for 5 new threads, validated prompt structure/model section, updated Thread Map, and confirmed known-thread detection clears warnings.
  Files: docs/master-control.md, docs/master-control-delegations/*
  Open items: Model heuristic currently biases to gpt-5-nano for these prompts; tune thresholds if needed.
- Date: 2026-02-08
  Thread: Project manager
  Task: Fix delegation handoff so sub-thread starts immediately
  Outcome: Added dispatchPrompt generation and produced dispatch-ready files for 5 active threads to paste directly into sub threads.
  Files: tools/master-control-ops/server.mjs, tools/master-control-ops/README.md, docs/master-control-delegations/dispatch-ready/*
  Open items: Optionally tune model auto-selection thresholds.
- Date: 2026-02-08
  Thread: Project manager
  Task: Create MC optimization Task Packets for focused threads
  Outcome: Created new Task Packets for 5 focused threads and generated a packet index with paste commands for immediate dispatch.
  Files: docs/master-control-delegations/*, TASK_PACKET_INDEX_2026-02-08T23-25-57.md
  Open items: Awaiting thread execution results; then iterate on packet template and model heuristics.
- Date: 2026-02-08
  Thread: Project manager
  Task: Define optimization priorities for MC workflow and produce Task Packets
  Outcome: Prioritized packet-first handoff, model heuristic tuning, and routing policy enforcement; generated fresh Task Packets and a single index file for dispatch.
  Files: tools/master-control-ops/server.mjs, tools/master-control-ops/README.md, docs/master-control-delegations/TASK_PACKET_INDEX_2026-02-08T23-25-57.md
  Open items: Need sub-thread results to validate and iterate thresholds/template.
- Date: 2026-02-08
  Thread: Project manager
  Task: Switch Task Packet format to tool-linked fetch flow
  Outcome: Updated Task Packets to contain tool access + package API instructions instead of embedded full prompt and created a new packet for Thread Lifecycle Rules.
  Files: tools/master-control-ops/server.mjs, tools/master-control-ops/README.md, docs/master-control-delegations/20260208T234133-mc-trigger-and-packet-first-delegation-enforcement/*
  Open items: Need end-to-end user confirmation that paste + submit starts sub-thread work as expected.
- Date: 2026-02-08
  Thread: Thread Lifecycle Rules
  Task: Project-Isolated Bootstrap Command UX
  Outcome: Added strict project-root scoping to Master Control Ops APIs/UI, added a prominent Bootstrap Another Repo copy-command section with existing-project-safe command generation, and verified package/task isolation across two separate project roots.
  Files: tools/master-control-ops/server.mjs, tools/master-control-ops/README.md, /Users/jeffburt/Documents/Coding Projects/Master Control/scripts/install-master-control.sh, /Users/jeffburt/Documents/Coding Projects/Master Control/README.md, docs/master-control.md
  Open items: none
- Date: 2026-02-08
  Thread: Project manager
  Task: Compact Task Packet + outside-copy model/effort instructions
  Outcome: Reduced Task Packet size and added separate operatorInstructions with model + low/medium/high/extra-high guidance in create/detail/update flows and UI fields.
  Files: tools/master-control-ops/server.mjs, tools/master-control-ops/README.md
  Open items: User confirmation in sub-thread execution flow.
- Date: 2026-02-08
  Thread: Project manager
  Task: Make Task Packets minimal and switch wording to Project manager
  Outcome: Task Packet now only directs sub thread to Master Control tool for prompt retrieval; added separate operator instructions for model/effort and updated wording from main thread to Project manager in active tool UI/text.
  Files: tools/master-control-ops/server.mjs, docs/master-control.md, tools/master-control-ops/README.md
  Open items: Confirm packet size is acceptable for your workflow.
- Date: 2026-02-09
  Thread: Thread Lifecycle Rules
  Task: mc-minimal-packet-check
  Outcome: Completed minimal packet sanity check; prompt fetch succeeded from scoped Package API, package files/metadata were present and consistent, and thread suggestion resolved as known (non-blocking).
  Files: /Users/jeffburt/Documents/AI Project/docs/master-control.md
  Open items: none
- Date: 2026-02-09
  Thread: Project manager
  Task: Add UI-focused routing and explicit existing-vs-new thread recommendation policy
  Outcome: Added `Master Control UI` thread and formalized routing rules to recommend existing focused threads first, otherwise suggest creating a new one.
  Files: docs/master-control.md
  Open items: none
- Date: 2026-02-09
  Thread: Project manager
  Task: Add parallel multi-packet delegation flow
  Outcome: Added bulk package API + UI for creating multiple Task Packets in one action with strict parallel validation (parallelSafe=true and one target thread per item).
  Files: tools/master-control-ops/server.mjs, tools/master-control-ops/README.md, docs/master-control.md
  Open items: none
- Date: 2026-02-09
  Thread: Project manager
  Task: Enforce mc// acknowledgement behavior when MC is skipped
  Outcome: Added explicit MC trigger policy requiring default MC usage for `mc//` prompts and mandatory explicit acknowledgement with reason when MC is not required.
  Files: docs/master-control.md, MASTER_CONTROL_HANDOFF.md, AGENTS.md
  Open items: none
- Date: 2026-02-09
  Thread: Project manager
  Task: Add dedicated Start Packet for cross-project Master Control initialization
  Outcome: Added prominent UI start-packet copy block and API support so target threads can paste one packet that instructs them to run all terminal/bootstrap steps themselves.
  Files: tools/master-control-ops/server.mjs, tools/master-control-ops/README.md, docs/master-control.md
  Open items: none
- Date: 2026-02-09
  Thread: Project manager
  Task: Make Master Control automatic without requiring mc// and enforce proactive delegation
  Outcome: Updated policy so Master Control is default for project work regardless of trigger, with `mc//` as reinforcement and proactive delegation expected when useful.
  Files: docs/master-control.md, MASTER_CONTROL_HANDOFF.md, AGENTS.md
  Open items: none
- Date: 2026-02-09
  Thread: Project manager
  Task: Make Starter Packet prominent and MC-first for new-project handoff
  Outcome: Updated Ops UI to prioritize copying a Project manager Starter Packet and updated packet text to route into Master Control Ops first, then execute backend/bootstrap setup from tool instructions.
  Files: tools/master-control-ops/server.mjs, tools/master-control-ops/README.md, docs/master-control.md
  Open items: none
- Date: 2026-02-09
  Thread: Project manager
  Task: Enforce mandatory summary-intake step in fixed instructions
  Outcome: Updated fixed rules so Project manager must read recent thread summaries before decisions, explicitly call out missing summaries, and avoid high-confidence root-cause claims without summary coverage.
  Files: docs/master-control.md, MASTER_CONTROL_HANDOFF.md, AGENTS.md
  Open items: none
- Date: 2026-02-09
  Thread: Orchestration Compliance Harness
  Task: Packet-first orchestration compliance harness
  Outcome: Added deterministic packet policy checks, live API harness validation for focused requests, and replay failure fixtures; harness run passed all compliance checks.
  Files: tools/master-control-ops/harness/packet-policy.mjs, tools/master-control-ops/harness/replay-cases.json, tools/master-control-ops/scripts/orchestration-compliance-harness.mjs, tools/master-control-ops/package.json, tools/master-control-ops/README.md, docs/master-control.md
  Open items: none
- Date: 2026-02-09
  Thread: Master Control UI
  Task: Make starter packet reliably visible and copyable in UI
  Outcome: Root cause (starter packet state had no user-facing status and never reloaded when target repo changed, leaving the textarea blank) addressed by wiring target-path refresh events, adding a strong status/warning area, and surfacing copy confirmation so API payloads now render as soon as they arrive with remediation guidance when missing; validated on localhost:4210 that initial load + target repo edits show non-empty packet content and copy action produces visible feedback.
  Files: tools/master-control-ops/server.mjs, docs/master-control.md
  Open items: none
- Date: 2026-02-09
  Thread: Master Control UI
  Task: Restore Master Control Ops UI reachability on localhost:4210
  Outcome: Fixed a startup-breaking JavaScript parse error in the inlined UI script (template literals inside the server HTML template) by converting messages to string concatenation; restarted Ops server and verified both UI and package API return HTTP 200.
  Files: tools/master-control-ops/server.mjs, docs/master-control.md
  Open items: none
- Date: 2026-02-09
  Thread: Master Control Ops QA
  Task: Verify starter packet UI onboarding path
  Outcome: Used a helper script mirroring Ops API logic to confirm the starter packet is populated on load, updates when targeting /tmp/mc-target, and mirrors the copy feedback messaging from `copyStarterPacket`; the same helper shows the bootstrap endpoint errors when the installer is missing.
  Files: docs/master-control.md
  Open items: tools/master-control-ops/server.mjs currently throws `SyntaxError: Unexpected identifier 'Starter'` when starting, preventing the Ops UI from running locally for a live copy-flow check.
- Date: 2026-02-09
  Thread: Project manager
  Task: Make Task Packet copy the default sub-thread handoff path
  Outcome: Updated Ops UI/API so create, selected, and parallel flows surface/copy Task Packet content (with command copy demoted to optional terminal helper), preventing pbcopy command paste from being mistaken as runnable task input.
  Files: tools/master-control-ops/server.mjs, docs/master-control.md
  Open items: none
