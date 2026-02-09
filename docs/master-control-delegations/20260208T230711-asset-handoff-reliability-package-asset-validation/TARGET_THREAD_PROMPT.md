# Delegation Package

Package ID: 20260208T230711-asset-handoff-reliability-package-asset-validation
Title: Asset Handoff Reliability - Package Asset Validation
Target thread: Asset Handoff Reliability

## Hard Problem Context
Delegation packages must consistently preserve attached assets and keep paths usable by target threads.

## Task Prompt
Validate asset handoff behavior for delegation packages: create packages with attached files, verify asset paths are emitted in prompts, and confirm target-thread workflow can consume them without manual fixing.

## Suggested Model For This Thread
- Model: gpt-5-nano
- Why: Narrow and well-scoped task where fast iteration is enough.

## Done Criteria
Verified asset flow or exact failure points with reproduction steps.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260208T230711-asset-handoff-reliability-package-asset-validation`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260208T230711-asset-handoff-reliability-package-asset-validation/package.json`
- No assets were attached to this package.

## Required Return Update To Main Thread
Append summary with asset handoff reliability status and required fixes.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Asset Handoff Reliability
  Task: Asset Handoff Reliability - Package Asset Validation
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
