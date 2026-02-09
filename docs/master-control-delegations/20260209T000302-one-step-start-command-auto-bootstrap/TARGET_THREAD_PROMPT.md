# Delegation Package

Package ID: 20260209T000302-one-step-start-command-auto-bootstrap
Title: One-Step Start Command Auto-Bootstrap
Target thread: Thread Lifecycle Rules

## Hard Problem Context
Current Master Control UI/onboarding is too complex for operators. User expects a single start command pasted into a thread to make that thread fetch prompt from Master Control and perform any required bootstrap/setup automatically.

## Task Prompt
Design and implement a one-step start-command flow: when a Task Packet is pasted into a sub-thread, that thread should be able to execute setup automatically with no manual bootstrap decisions from the user. Remove operator-facing bootstrap complexity from the primary path and make setup deterministic and safe for existing repos.

## Suggested Model For This Thread
- Model: gpt-5-mini
- Effort: medium
- Why: Workflow-critical UX behavior requiring careful flow design and validation.

## Done Criteria
A thread can start from one pasted packet/command and handle setup itself; no extra bootstrap UI steps required for normal usage.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T000302-one-step-start-command-auto-bootstrap`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T000302-one-step-start-command-auto-bootstrap/package.json`
- No assets were attached to this package.

## Required Return Update To Project Manager
Append summary with exact behavior changes, command format, and user-flow before/after.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Thread Lifecycle Rules
  Task: One-Step Start Command Auto-Bootstrap
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
