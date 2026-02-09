# Delegation Package

Package ID: 20260208T234426-project-isolated-bootstrap-command-ux
Title: Project-Isolated Bootstrap Command UX
Target thread: Thread Lifecycle Rules

## Hard Problem Context
Need safe multi-project usage without cross-project data mixing, plus a prominent copyable command in the ops UI that initializes Master Control in new or existing projects.

## Task Prompt
Implement a packet-first onboarding flow for any repo: (1) strict per-project isolation so package/task data cannot mix across projects, (2) a prominent UI section with a copy button for a bootstrap command users can run in a target repo to initialize Master Control, and (3) an existing-project-safe bootstrap path. Ensure generated command is ready to paste and includes quoted paths for spaces.

## Suggested Model For This Thread
- Model: gpt-5-nano
- Why: Narrow and well-scoped task where fast iteration is enough.

## Done Criteria
User can copy one prominent command from UI, run it in another repo, and get isolated Master Control setup with no data bleed from current project.

## Required Inputs
- Master Control source of truth: `/Users/jeffburt/Documents/AI Project/docs/master-control.md`
- Package directory: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260208T234426-project-isolated-bootstrap-command-ux`
- Package metadata: `/Users/jeffburt/Documents/AI Project/docs/master-control-delegations/20260208T234426-project-isolated-bootstrap-command-ux/package.json`
- No assets were attached to this package.

## Required Return Update To Main Thread
Append summary with implementation details, UX location of command, and verification results for project isolation.

Always append a summary in Master Control after completion. Use this summary structure:
- Date: YYYY-MM-DD
  Thread: Thread Lifecycle Rules
  Task: Project-Isolated Bootstrap Command UX
  Outcome: <what changed and what passed>
  Files: <comma-separated file paths>
  Open items: <remaining risks/follow-ups or none>

If the task cannot be completed, still append a summary with blockers and a recommended next action.
