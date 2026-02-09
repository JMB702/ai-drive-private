# Delegation Package

Package ID: 20260209T012344-define-sectioned-master-plan-schema-and-selective-retrieval-
Title: Define sectioned master plan schema and selective retrieval API
Target thread: Master Plan Governance

## Hard Problem Context
Project manager must avoid loading the full master plan each turn. Need section-level plan model and retrieval paths that default to summary/index and expand only on demand.

## Task Prompt
Design and implement sectioned master plan backend contract: section ids, titles, summaries, details, status, owner thread, updated metadata. Add APIs for section index (summary-only), section detail by id, targeted section update, and proposal linkage. Enforce default PM read path = index only. Include unread proposal counters and filters to keep context usage low.

## Suggested Model For This Thread
- Model: gpt-5-nano
- Effort: low
- Why: Narrow and well-scoped task where fast iteration is enough.

## Done Criteria
Sectioned schema/API works and PM can retrieve index without full plan body; detail expands only on explicit section request.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T012344-define-sectioned-master-plan-schema-and-selective-retrieval-`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T012344-define-sectioned-master-plan-schema-and-selective-retrieval-/package.json`
- No assets were attached to this package.

## Required Return Update To Project Manager
Append summary in docs/master-control.md with API schema, endpoints, and context-budget behavior details.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Master Plan Governance
  Task: Define sectioned master plan schema and selective retrieval API
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
