# Delegation Package

Package ID: 20260209T000714-one-step-start-command-and-auto-setup-ux
Title: One-Step Start Command and Auto-Setup UX
Target thread: Thread Lifecycle Rules

## Hard Problem Context
Current Master Control UI exposes bootstrap complexity. Operator should paste one start command in a sub thread and that thread should self-bootstrap and start work without extra user setup steps.

## Task Prompt
Implement a one-step handoff flow: Task Packet should be enough for a sub thread to fetch its prompt from Master Control Ops and execute setup automatically (including any needed project bootstrap checks) with no extra operator decisions. Remove or de-emphasize bootstrap-heavy UI from primary path and keep advanced setup behind secondary controls.

## Suggested Model For This Thread
- Model: gpt-5
- Effort: high
- Why: Workflow-critical UX and behavior changes with cross-cutting impact.

## Done Criteria
User can copy/paste one command/packet into a sub thread and that thread starts immediately, handling setup itself. UI no longer blocks operator with bootstrap complexity for normal use.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T000714-one-step-start-command-and-auto-setup-ux`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T000714-one-step-start-command-and-auto-setup-ux/package.json`
- No assets were attached to this package.

## Required Return Update To Project Manager
Append summary with before/after flow, exact start command behavior, and verification evidence.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Thread Lifecycle Rules
  Task: One-Step Start Command and Auto-Setup UX
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
