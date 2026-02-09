# Delegation Package

Package ID: 20260209T010421-verify-starter-packet-ui-onboarding-path
Title: Verify starter packet UI onboarding path
Target thread: Master Control Ops QA

## Hard Problem Context
Need independent verification that starter packet is visible/copyable and onboarding works from UI without workarounds.

## Task Prompt
Run end-to-end QA for starter packet flow in Master Control Ops. Validate initial page load shows non-empty starter packet, copy button yields clear confirmation feedback, and packet can be pasted into a new project thread to initiate setup instructions. Test target repo path change behavior and missing-payload behavior. Document exact pass/fail evidence.

## Suggested Model For This Thread
- Model: gpt-5-nano
- Effort: low
- Why: Narrow and well-scoped task where fast iteration is enough.

## Done Criteria
QA checklist pass/fail with reproduction steps and evidence; summary appended.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T010421-verify-starter-packet-ui-onboarding-path`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T010421-verify-starter-packet-ui-onboarding-path/package.json`
- No assets were attached to this package.

## Required Return Update To Project Manager
Append summary in docs/master-control.md with verification result and remaining issues.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Master Control Ops QA
  Task: Verify starter packet UI onboarding path
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
