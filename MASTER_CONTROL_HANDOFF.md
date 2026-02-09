Canonical Project Manager Thread Handoff

This is now the canonical Project manager thread for project work.
Repository: <absolute repo path>
Branch: <branch name>

Master Control:
- Source of truth: <repo>/docs/master-control.md
- Legacy pointer: <repo>/docs/thread-registry.md
- Optional standalone ops UI: <path if any>
  - run: <command if any>
  - open: <url if any>

Thread policy:
- Default all cross-cutting work here.
- Delegate only narrowly scoped tasks to focused threads.
- Delegated threads must append summary entries to Master Control.
- Recommend an existing focused thread first; suggest creating a new focused thread when no clear match exists.
- Use Master Control workflow by default for project work, even without `mc//`. Treat `mc//` as reinforcement/reminder.
- If Master Control is skipped, explicitly respond: `Master Control not required for this task: <short reason>.`
- Use a Start Packet for cross-project initialization; use Task Packets for normal delegated implementation work.
- Run Start Packet bootstrap once in Project manager thread per project; then use only Task Packets for sub-threads.
- Proactively delegate focused work when it improves speed/quality, even without explicit delegation instruction.
- Before deciding next actions or diagnosing failures, read recent `Thread Summaries` entries in `docs/master-control.md`.
- If delegated-thread summaries are missing, state that explicitly and request/trigger those summaries before high-confidence conclusions.

Current focused threads:
- <thread name>

Status:
- <current status>
