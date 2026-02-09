# Delegation Package

Package ID: 20260209T012906-qa-verify-section-first-context-budget-and-summary-gating
Title: QA verify section-first context budget and summary gating
Target thread: Master Control Ops QA

## Hard Problem Context
Need confirmation that PM can operate from section summaries without full-plan load and that completion-without-summary is treated as non-compliant.

## Task Prompt
After UI + lifecycle rule changes land, run QA scenarios: 1) master plan default view shows section summaries only, 2) detail loads only on explicit expand, 3) starter packet still copyable, 4) tasks without summary are flagged as not complete per updated rules. Capture pass/fail with repro steps and evidence.

## Suggested Model For This Thread
- Model: gpt-5-nano
- Effort: low
- Why: Narrow and well-scoped task where fast iteration is enough.

## Done Criteria
QA evidence confirms section-first behavior and summary-gating behavior, with any regressions documented.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T012906-qa-verify-section-first-context-budget-and-summary-gating`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T012906-qa-verify-section-first-context-budget-and-summary-gating/package.json`
- No assets were attached to this package.

## Required Return Update To Project Manager
Append summary to docs/master-control.md with results, evidence, and open issues.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Master Control Ops QA
  Task: QA verify section-first context budget and summary gating
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
