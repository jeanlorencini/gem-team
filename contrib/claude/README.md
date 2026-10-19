# Optional Claude Code tool guard for gem-orchestrator

This optional policy uses the official Claude Code PreToolUse hook.
It blocks direct research/implementation tools in the main
gem-orchestrator session, while preserving access for subagents.

Requirements: Claude Code >= 2.1.295, Node.js on PATH, Gem Team agents
installed separately using APM, and a session started with
claude --agent gem-orchestrator.

## Windows opt-in installation

From this repository checkout:

    powershell -File .\contrib\claude\install-guard.ps1 -ProjectRoot "C:\path\to\project"

The installer copies the JavaScript hook into the target project
.claude/hooks folder and merges .claude/settings.local.json.
It backs up previous settings and hook files outside the project,
under the user's .claude/backups folder. Re-running the script should
update the hook without duplicating its configured entry.

This feature is not part of APM installation. The current apm.yml
package includes only .apm/agents and .apm/skills. Run the
installer separately for each Claude Code project.

## Test

    node contrib/claude/test-guard.js

The tests verify decision semantics; they do not run language models.
Smoke test research, implementation, and diagnosis on a temporary
fixture after updating Claude Code.

## Limitations

- Blocking direct tools does not force the model to delegate when it
  chooses to reply without tools.
- The policy applies only to the main session named gem-orchestrator.
- All tool calls run the lightweight Node hook, including subagent
  calls. Benchmark overhead where relevant.
- The installed local settings contain machine-specific paths. Do
  not commit settings.local.json to a public repository.
- The installed hook uses onFailure:block and timeout:10 seconds.
  These settings require Claude Code 2.1.295 or newer.

## Updates from upstream

Keep the fork default main branch synced with mubaidr/gem-team.
Keep this contribution on feature/claude-code-orchestrator-guard,
and periodically merge or rebase upstream main into that branch.
Upstream updates do not automatically reinstall APM packages
or update a guard already copied into a project.
