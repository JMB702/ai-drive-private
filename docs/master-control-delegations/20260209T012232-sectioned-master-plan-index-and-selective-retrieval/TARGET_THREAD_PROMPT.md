# Delegation Package

Package ID: 20260209T012232-sectioned-master-plan-index-and-selective-retrieval
Title: Sectioned master plan index and selective retrieval
Target thread: Plan Section Indexing

## Hard Problem Context
Project manager should not load whole master plan by default. Need sectioned plan with explicit titles and selective read/expand behavior.

## Task Prompt
Implement section-based master plan model: each section has stable id, title, short summary, detail body, owner thread, status, and last-updated metadata. Add endpoints and storage access patterns for list (summary-only), detail-by-section, and selective update. Ensure PM default read path returns only section headers/summaries + unread proposal signals, with explicit expand for detail.

## Suggested Model For This Thread
- Model: gpt-5-nano
- Effort: low
- Why: Narrow and well-scoped task where fast iteration is enough.

## Done Criteria
Section index + selective retrieval works without full-plan load; schema documented and integrated into PM workflow.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T012232-sectioned-master-plan-index-and-selective-retrieval`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260209T012232-sectioned-master-plan-index-and-selective-retrieval/package.json`
- No assets were attached to this package.

## Required Return Update To Project Manager
Append summary to docs/master-control.md with schema and retrieval behavior details.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Plan Section Indexing
  Task: Sectioned master plan index and selective retrieval
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
