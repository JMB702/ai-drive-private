# Delegation Package

Package ID: 20260209T005536-resolve-blank-starter-packet-in-live-ui
Title: Resolve blank starter packet in live UI
Target thread: Master Control UI

## Hard Problem Context
User still sees no copyable content in Project Manager Starter Packet field in the live UI.

## Task Prompt
Diagnose and fix why Project Manager Starter Packet appears blank in the browser UI even when backend endpoint may return startPacket. Include robust client-side loading and render guarantees: populate on initial load, repopulate on target repo path change, and never fail silently. If startPacket is missing/empty, show a prominent visible warning with remediation text. Keep copy interaction obvious and confirm success visibly when Copy Starter Packet is clicked.

## Suggested Model For This Thread
- Model: gpt-5-mini
- Effort: medium
- Why: Moderate implementation scope with some reasoning depth.

## Done Criteria
1) Starter packet text is visible and copyable in live UI. 2) Copy click gives clear confirmation feedback. 3) Missing payload path shows prominent warning instead of blank field. 4) Add concise root-cause note in summary.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T005536-resolve-blank-starter-packet-in-live-ui`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T005536-resolve-blank-starter-packet-in-live-ui/package.json`
- No assets were attached to this package.

## Required Return Update To Project Manager
Append summary to docs/master-control.md with repro path, root cause, files changed, verification steps, and open items.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Master Control UI
  Task: Resolve blank starter packet in live UI
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
