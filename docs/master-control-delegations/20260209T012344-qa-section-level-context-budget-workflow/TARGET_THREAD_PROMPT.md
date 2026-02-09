# Delegation Package

Package ID: 20260209T012344-qa-section-level-context-budget-workflow
Title: QA section-level context budget workflow
Target thread: Master Control Ops QA

## Hard Problem Context
Need proof that PM can work from section summaries first and only expand relevant sections, preventing context overload.

## Task Prompt
Create and run QA scenarios for context-budget workflow: 1) PM opens plan index only, 2) PM filters unread proposals, 3) PM expands only relevant section(s), 4) PM acts without loading full plan. Verify starter packet remains copyable and visible. Capture pass/fail and any regressions.

## Suggested Model For This Thread
- Model: gpt-5-nano
- Effort: low
- Why: Narrow and well-scoped task where fast iteration is enough.

## Done Criteria
QA evidence shows section-summary-first workflow works and reduces full-plan loading; issues logged with repro.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T012344-qa-section-level-context-budget-workflow`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T012344-qa-section-level-context-budget-workflow/package.json`
- No assets were attached to this package.

## Required Return Update To Project Manager
Append summary in docs/master-control.md with scenario results and residual risks.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Master Control Ops QA
  Task: QA section-level context budget workflow
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
