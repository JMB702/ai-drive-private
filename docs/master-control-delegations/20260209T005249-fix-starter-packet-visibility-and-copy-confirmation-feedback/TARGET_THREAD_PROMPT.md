# Delegation Package

Package ID: 20260209T005249-fix-starter-packet-visibility-and-copy-confirmation-feedback
Title: Fix starter packet visibility and copy confirmation feedback
Target thread: Master Control UI

## Hard Problem Context
User cannot see starter packet text in the UI and copy action lacks clear confirmation feedback. This blocks new-project onboarding flow.

## Task Prompt
Investigate and fix Master Control Ops UI so the Project Manager Starter Packet field reliably shows non-empty content after load and target path changes. Add explicit user-visible copy confirmation feedback when 'Copy Starter Packet' is clicked (persistent enough to notice and not easily missed). Ensure fallback warning appears if starter packet payload is empty, with remediation text.

## Suggested Model For This Thread
- Model: gpt-5
- Effort: high
- Why: High complexity or cross-cutting work. Use the strongest reasoning model.

## Done Criteria
1) Starter packet text reliably visible when API has startPacket. 2) Copy Starter Packet gives clear confirmation feedback. 3) Empty payload path shows visible warning and remediation. 4) No regression to bootstrap command copy.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T005249-fix-starter-packet-visibility-and-copy-confirmation-feedback`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T005249-fix-starter-packet-visibility-and-copy-confirmation-feedback/package.json`
- No assets were attached to this package.

## Required Return Update To Project Manager
Append summary to docs/master-control.md with root cause, fix, files changed, and remaining risks.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Master Control UI
  Task: Fix starter packet visibility and copy confirmation feedback
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
