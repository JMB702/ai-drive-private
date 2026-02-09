# Delegation Package

Package ID: 20260209T012047-master-plan-governance-and-feedback-intake-workflow
Title: Master plan governance and feedback intake workflow
Target thread: Master Plan Governance

## Hard Problem Context
Master Control needs a planning-first workflow: a persistent master plan created from first completed Codex plan, editable by Project manager, and a sub-thread recommendation mechanism that does not force full-context ingestion.

## Task Prompt
Implement backend/state workflow for Master Plan + Plan Change Proposals + Decision Log. Requirements: 1) Master plan storage with versioning and last-updated metadata, 2) API to set initial plan from first completed plan and update by Project manager, 3) sub-thread proposal endpoint for recommended plan changes (pending by default), 4) Project manager approve/reject endpoint that appends a decision log entry and updates plan version on approve, 5) unread feedback/proposal counts and query filters so PM can consume only relevant items. Keep payloads compact and explicit.

## Suggested Model For This Thread
- Model: gpt-5-mini
- Effort: medium
- Why: Moderate implementation scope with some reasoning depth.

## Done Criteria
APIs and persistence implemented with clear schema, proposal lifecycle works end-to-end (submit -> pending -> approve/reject), and PM can fetch filtered unread items without loading full history.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T012047-master-plan-governance-and-feedback-intake-workflow`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T012047-master-plan-governance-and-feedback-intake-workflow/package.json`
- No assets were attached to this package.

## Required Return Update To Project Manager
Append summary to docs/master-control.md with schema/API contract, files changed, and integration notes for UI thread.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Master Plan Governance
  Task: Master plan governance and feedback intake workflow
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
