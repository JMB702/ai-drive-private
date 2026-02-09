# Delegation Package

Package ID: 20260208T232557-mc-optimization-routing-trigger-and-thread-lifecycle-policy
Title: MC Optimization: Routing Trigger and Thread Lifecycle Policy
Target thread: Thread Lifecycle Rules

## Hard Problem Context
Main thread needs explicit, lightweight trigger control and deterministic handling for unknown/new thread targets.

## Task Prompt
Formalize routing rules around the MC trigger phrase, known-thread detection, and thread creation suggestion behavior. Propose policy text and enforcement checks.

## Suggested Model For This Thread
- Model: gpt-5-nano
- Why: Narrow and well-scoped task where fast iteration is enough.

## Done Criteria
Rule set draft covering trigger semantics, routing decisions, and thread creation policy.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260208T232557-mc-optimization-routing-trigger-and-thread-lifecycle-policy`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260208T232557-mc-optimization-routing-trigger-and-thread-lifecycle-policy/package.json`
- No assets were attached to this package.

## Required Return Update To Main Thread
Append summary with final rule proposal and implementation impacts.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Thread Lifecycle Rules
  Task: MC Optimization: Routing Trigger and Thread Lifecycle Policy
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
