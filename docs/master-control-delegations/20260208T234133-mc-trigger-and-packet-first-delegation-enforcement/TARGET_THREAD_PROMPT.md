# Delegation Package

Package ID: 20260208T234133-mc-trigger-and-packet-first-delegation-enforcement
Title: MC Trigger and Packet-First Delegation Enforcement
Target thread: Thread Lifecycle Rules

## Hard Problem Context
Main thread must treat mc// as explicit master-control routing trigger and always output paste-ready tool-linked Task Packets for sub-thread work.

## Task Prompt
Define and verify operational rules for mc// trigger handling and packet-first delegation flow. Ensure this rule is explicit: when input begins with mc//, main thread generates a focused sub-thread prompt, stores it in Master Control Ops, and returns a Task Packet text that instructs sub-thread to fetch prompt from tool and start immediately.

## Suggested Model For This Thread
- Model: gpt-5-nano
- Why: Narrow and well-scoped task where fast iteration is enough.

## Done Criteria
Clear rule set + verification checklist + identified enforcement points in current workflow.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260208T234133-mc-trigger-and-packet-first-delegation-enforcement`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260208T234133-mc-trigger-and-packet-first-delegation-enforcement/package.json`
- No assets were attached to this package.

## Required Return Update To Main Thread
Append summary with final policy text and any implementation deltas needed.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Thread Lifecycle Rules
  Task: MC Trigger and Packet-First Delegation Enforcement
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
