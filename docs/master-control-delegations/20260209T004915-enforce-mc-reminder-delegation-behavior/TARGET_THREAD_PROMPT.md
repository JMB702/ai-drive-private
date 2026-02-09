# Delegation Package

Package ID: 20260209T004915-enforce-mc-reminder-delegation-behavior
Title: Enforce mc reminder delegation behavior
Target thread: Thread Lifecycle Rules

## Hard Problem Context
Project manager handled tasks directly despite mc reminder intent. Need explicit enforcement and visible guardrails so focused work emits Task Packets instead of direct execution in PM thread.

## Task Prompt
Implement and document enforcement rules so Project manager defaults to delegation for focused implementation work. Add clear guardrails in Master Control rules and operator instructions: when a focused task is detected, create packet-first output; when skipped, explicit exception line must appear. Validate with at least one reproducible scenario.

## Suggested Model For This Thread
- Model: gpt-5-nano
- Effort: low
- Why: Narrow and well-scoped task where fast iteration is enough.

## Done Criteria
Rules are explicit, packet-first behavior is documented and test scenario proves expected output pattern.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T004915-enforce-mc-reminder-delegation-behavior`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T004915-enforce-mc-reminder-delegation-behavior/package.json`
- No assets were attached to this package.

## Required Return Update To Project Manager
Append summary to docs/master-control.md with enforcement changes and validation result.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Thread Lifecycle Rules
  Task: Enforce mc reminder delegation behavior
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
