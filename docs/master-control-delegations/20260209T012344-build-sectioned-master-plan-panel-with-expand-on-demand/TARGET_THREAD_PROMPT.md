# Delegation Package

Package ID: 20260209T012344-build-sectioned-master-plan-panel-with-expand-on-demand
Title: Build sectioned master plan panel with expand on demand
Target thread: Master Control UI

## Hard Problem Context
Master plan must be front-and-center but should not force full-plan reads. UI needs section index view with explicit expand controls.

## Task Prompt
Implement planning-first UI that shows Master Plan section index (titles + short summaries + status) as primary panel, with explicit expand/collapse to load section details only when needed. Keep Starter Packet visible but secondary. Add unread feedback/proposal indicator and filters so PM can select relevant sections before reading details.

## Suggested Model For This Thread
- Model: gpt-5-nano
- Effort: low
- Why: Narrow and well-scoped task where fast iteration is enough.

## Done Criteria
Default UI shows section summaries only; detail loads on explicit expand; starter packet remains accessible; unread/filter UI visible and usable.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T012344-build-sectioned-master-plan-panel-with-expand-on-demand`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T012344-build-sectioned-master-plan-panel-with-expand-on-demand/package.json`
- No assets were attached to this package.

## Required Return Update To Project Manager
Append summary in docs/master-control.md with UI behavior, files changed, and integration assumptions.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Master Control UI
  Task: Build sectioned master plan panel with expand on demand
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
