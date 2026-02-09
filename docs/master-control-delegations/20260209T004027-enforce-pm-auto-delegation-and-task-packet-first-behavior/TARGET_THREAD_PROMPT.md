# Delegation Package

Package ID: 20260209T004027-enforce-pm-auto-delegation-and-task-packet-first-behavior
Title: Enforce PM auto-delegation and task-packet-first behavior
Target thread: Project Manager Delegation Enforcement

## Hard Problem Context
Project manager handled a focused UI task directly when it should have delegated via Master Control task packet flow. We need deterministic behavior so PM defaults to packet-first delegation for focused work and explicitly suggests creating a new thread when no existing thread clearly matches.

## Task Prompt
Implement enforcement so Project manager behavior is task-packet-first for focused implementation requests. Add policy checks and UX/ops support so when a focused task is detected, PM creates a delegation package and outputs a compact Task Packet. If no focused thread matches, recommend creating a new thread and reflect that clearly in operator instructions. Add/adjust docs and any lightweight validations so this behavior is stable.

## Suggested Model For This Thread
- Model: gpt-5
- Effort: high
- Why: High complexity or cross-cutting work. Use the strongest reasoning model.

## Done Criteria
1) Rules clearly state packet-first delegation for focused tasks. 2) Unknown focused areas produce explicit 'create new thread' recommendation. 3) Output format remains compact: destination/model guidance outside packet, packet body tool-access only. 4) Verification steps included.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T004027-enforce-pm-auto-delegation-and-task-packet-first-behavior`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T004027-enforce-pm-auto-delegation-and-task-packet-first-behavior/package.json`
- No assets were attached to this package.

## Required Return Update To Project Manager
Append summary in docs/master-control.md with task, outcome, changed files, and any open items.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Project Manager Delegation Enforcement
  Task: Enforce PM auto-delegation and task-packet-first behavior
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
