# Delegation Package

Package ID: 20260209T004709-verify-starter-packet-ui-and-onboarding-flow
Title: Verify starter packet UI and onboarding flow
Target thread: Master Control Ops QA

## Hard Problem Context
Need to verify that the Project Manager Starter Packet is prominently visible, copyable, and directs a new project thread to Master Control Ops first, then backend bootstrap setup.

## Task Prompt
Validate the Starter Packet UX and behavior end-to-end. Confirm the UI shows a prominent starter packet copy field/button, API returns startPacket, and packet content explicitly routes to Master Control Ops first and includes backend/setup bootstrap instructions. Report any regressions and propose fixes.

## Suggested Model For This Thread
- Model: gpt-5-nano
- Effort: low
- Why: Narrow and well-scoped task where fast iteration is enough.

## Done Criteria
UI and API checks pass with exact expected text and copy flow; issues documented with concrete repro steps if any.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T004709-verify-starter-packet-ui-and-onboarding-flow`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T004709-verify-starter-packet-ui-and-onboarding-flow/package.json`
- No assets were attached to this package.

## Required Return Update To Project Manager
Append summary entry to docs/master-control.md with pass/fail and any follow-up fixes.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Master Control Ops QA
  Task: Verify starter packet UI and onboarding flow
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
