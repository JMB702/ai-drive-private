# Delegation Package

Package ID: 20260209T012723-enforce-summary-required-completion-gating
Title: Enforce summary-required completion gating
Target thread: Thread Lifecycle Rules

## Hard Problem Context
Completed delegated tasks are missing required Master Control summary entries, breaking visibility and PM decision quality.

## Task Prompt
Implement policy and tooling changes so delegated tasks cannot be considered complete without a summary entry in docs/master-control.md. Update fixed instructions, task packet template language, and any compliance checks so missing summaries are flagged as failed completion. Add explicit recovery workflow for backfilling summaries when missing.

## Suggested Model For This Thread
- Model: gpt-5-nano
- Effort: low
- Why: Narrow and well-scoped task where fast iteration is enough.

## Done Criteria
1) Rules explicitly define completion = implementation + summary posted. 2) Missing summary is surfaced as non-compliant. 3) Recovery/backfill process is documented and actionable.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T012723-enforce-summary-required-completion-gating`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T012723-enforce-summary-required-completion-gating/package.json`
- No assets were attached to this package.

## Required Return Update To Project Manager
Append summary to docs/master-control.md with policy updates, files changed, and remaining edge cases.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Thread Lifecycle Rules
  Task: Enforce summary-required completion gating
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
