# Delegation Package

Package ID: 20260209T004904-fix-empty-starter-packet-field-in-ops-ui
Title: Fix empty starter packet field in Ops UI
Target thread: Master Control UI

## Hard Problem Context
User reports that the Project Manager Starter Packet field is empty in the live UI, even though the backend appears to support startPacket. This likely indicates a UI load-path/state issue (startup load, projectRoot scoping, stale render path, or error handling).

## Task Prompt
Investigate and fix why Starter Packet textarea can appear empty in Master Control Ops UI. Reproduce on localhost:4210, validate network/API payloads and client state transitions, and patch UI behavior so starter packet is reliably populated on initial load and after target repo changes. Add guardrails: if startPacket is missing, show explicit visible error and fallback action instead of silent empty field. Keep packet copy workflow prominent.

## Suggested Model For This Thread
- Model: gpt-5
- Effort: high
- Why: High complexity or cross-cutting work. Use the strongest reasoning model.

## Done Criteria
1) Starter packet consistently displays non-empty content when API returns startPacket. 2) Empty/missing payloads produce a clear visible warning with remediation step. 3) Copy Starter Packet works after page load without manual workaround. 4) Summary entry appended in master control.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T004904-fix-empty-starter-packet-field-in-ops-ui`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T004904-fix-empty-starter-packet-field-in-ops-ui/package.json`
- No assets were attached to this package.

## Required Return Update To Project Manager
Append summary to docs/master-control.md with reproduction, root cause, fix, changed files, and any residual edge cases.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Master Control UI
  Task: Fix empty starter packet field in Ops UI
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
