# Delegation Package

Package ID: 20260209T010421-make-starter-packet-reliably-visible-and-copyable-in-ui
Title: Make starter packet reliably visible and copyable in UI
Target thread: Master Control UI

## Hard Problem Context
User needs to open Master Control Ops in any project, immediately see a non-blank Project Manager Starter Packet, copy it, and paste it into a new project thread. Current behavior is blank in the UI for user.

## Task Prompt
Implement robust UI behavior for Project Manager Starter Packet so it is never silently blank when backend has data. Ensure packet is populated on initial load and after target repo path changes. Add explicit visible error/warning state if packet payload is empty/missing and include remediation text. Ensure Copy Starter Packet provides unmistakable success confirmation visible to user. Keep starter packet section prominent and first-class for new-project onboarding.

## Suggested Model For This Thread
- Model: gpt-5-mini
- Effort: medium
- Why: Moderate implementation scope with some reasoning depth.

## Done Criteria
1) Starter packet textarea shows non-empty content on initial load. 2) Copy Starter Packet gives clear visible confirmation. 3) Missing payload shows prominent warning with remediation. 4) User can copy-paste into another project thread and start setup. 5) Append summary to master control.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T010421-make-starter-packet-reliably-visible-and-copyable-in-ui`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T010421-make-starter-packet-reliably-visible-and-copyable-in-ui/package.json`
- No assets were attached to this package.

## Required Return Update To Project Manager
Append summary in docs/master-control.md including root cause, exact UI/API fix, files changed, verification steps, and open items.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Master Control UI
  Task: Make starter packet reliably visible and copyable in UI
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
