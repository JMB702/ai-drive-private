# Delegation Package

Package ID: 20260209T012854-enforce-completion-requires-summary-entry
Title: Enforce completion requires summary entry
Target thread: Thread Lifecycle Rules

## Hard Problem Context
Tasks appear completed without summary entries, breaking PM visibility and control.

## Task Prompt
Codify and enforce rule: delegated task is not complete until required summary is appended in docs/master-control.md. Update fixed instructions and packet/routing rules to mark missing summary as non-compliant completion. Add a concise backfill protocol for missing summaries and a checklist PM can run before considering a task done.

## Suggested Model For This Thread
- Model: gpt-5-nano
- Effort: low
- Why: Narrow and well-scoped task where fast iteration is enough.

## Done Criteria
Rules updated, non-compliant state defined, backfill protocol documented, PM checklist added. Summary appended.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T012854-enforce-completion-requires-summary-entry`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T012854-enforce-completion-requires-summary-entry/package.json`
- No assets were attached to this package.

## Required Return Update To Project Manager
Append summary to docs/master-control.md with policy changes and enforcement checklist.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Thread Lifecycle Rules
  Task: Enforce completion requires summary entry
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
