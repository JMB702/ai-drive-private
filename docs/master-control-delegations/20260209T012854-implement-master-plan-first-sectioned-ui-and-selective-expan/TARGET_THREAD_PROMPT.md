# Delegation Package

Package ID: 20260209T012854-implement-master-plan-first-sectioned-ui-and-selective-expan
Title: Implement master-plan-first sectioned UI and selective expand
Target thread: Master Control UI

## Hard Problem Context
Need the UI to be planning-first with context-safe reading. PM should see section summaries first and expand only relevant sections.

## Task Prompt
Implement a Master Plan primary panel in Master Control Ops. The panel must default to section index view: section title, one-line summary, status, owner, last updated, unread recommendation count. Add explicit expand control per section to load detailed content on demand only. Keep Project Manager Starter Packet visible but secondary. Add visible copy confirmation for starter packet if not already obvious. Completion is not done until summary is appended to docs/master-control.md.

## Suggested Model For This Thread
- Model: gpt-5-mini
- Effort: medium
- Why: Moderate implementation scope with some reasoning depth.

## Done Criteria
Master Plan is front-center. Default view is section summaries/index only. Detail loads only on explicit expand. Starter packet remains copyable and secondary. Summary appended.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T012854-implement-master-plan-first-sectioned-ui-and-selective-expan`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T012854-implement-master-plan-first-sectioned-ui-and-selective-expan/package.json`
- No assets were attached to this package.

## Required Return Update To Project Manager
Append summary to docs/master-control.md with files changed, UI behavior, and any integration gaps.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Master Control UI
  Task: Implement master-plan-first sectioned UI and selective expand
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
