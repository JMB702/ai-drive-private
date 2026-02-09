# Delegation Package

Package ID: 20260209T012059-promote-master-plan-to-front-center-ui-with-feedback-inbox
Title: Promote master plan to front-center UI with feedback inbox
Target thread: Master Control UI

## Hard Problem Context
UI should be planning-first: master plan front and center, starter packet still visible but secondary, and unread feedback/proposal intake so PM does not manually prompt checks.

## Task Prompt
Redesign Master Control Ops layout to prioritize Master Plan at top-center (primary panel), keep Project Manager Starter Packet prominent but secondary, and add a Feedback/Proposals inbox panel with unread counts + filters (thread/status/date). Integrate with governance APIs for plan read/update and proposal intake/review where available; if API contract is pending, wire placeholder adapters with clear TODO boundaries. Ensure responsive layout and obvious PM workflow: review unread -> decide -> update plan.

## Suggested Model For This Thread
- Model: gpt-5-mini
- Effort: medium
- Why: Moderate implementation scope with some reasoning depth.

## Done Criteria
Master Plan section is visually primary, Starter Packet remains easy to copy, feedback/proposal inbox is visible with unread indicator/filtering UI, and PM flow is intuitive on desktop/mobile.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T012059-promote-master-plan-to-front-center-ui-with-feedback-inbox`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T012059-promote-master-plan-to-front-center-ui-with-feedback-inbox/package.json`
- No assets were attached to this package.

## Required Return Update To Project Manager
Append summary to docs/master-control.md with UI changes, integration assumptions, and follow-ups for QA.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Master Control UI
  Task: Promote master plan to front-center UI with feedback inbox
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
