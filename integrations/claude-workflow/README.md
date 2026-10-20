# One conversation, independently checked delivery

Optional Claude Code integration for Gem Team. Ask questions, investigate, and authorize implementation in the same normal session. Gem retains its existing specialist selection, proportional planning, model routing, and retry limits. This helper is **not an orchestrator or an OS sandbox**.

APM installs the agent definitions; it does **not** activate this runtime integration. Other hosts keep using Gem without these Claude-specific hooks.

## What it adds

| Boundary | Behavior |
| --- | --- |
| Recovery | SessionStart supplies compact project records, Git state, and current signed verification status; no full transcript |
| Permissions | Normal mode defers ordinary actions to existing native permissions; it never returns a blanket allow |
| Readonly | Explicit `GEM_WORKFLOW_MODE=readonly` and native plan mode remain restrictive; `execute` is an optional compatibility alias, not a prerequisite |
| Request scope | UserPromptSubmit resets only that session's activity marker; generated async notifications preserve the current request |
| Verification | A managed Git pre-commit hook runs approved checks on every commit attempt, not cached PASS claims |
| Acceptance | Required human acceptance is separate from technical PASS and tied to the exact current fingerprint |

Without operator opt-in for a Git project, the hooks do nothing. Merely adding a policy file does not approve it.

## 1. Register the helper once

Requirements: Node.js 22+ and Git; Claude Code for conversational hooks. Development checks use Node.js 26+. The interactive behavior was exercised on Windows with Claude Code 2.1.304; do not infer certification of other hosts or future event formats.

Install Gem's agent definitions from the same reviewed revision first. From this checkout, review `src/gem-workflow.js` and your existing Claude settings. The following PowerShell example copies the helper **only if absent**, then merges its hooks with backup. It does not overwrite any agent, model, environment, permission hook, or notification configuration.

```powershell
$addon = (Resolve-Path 'integrations/claude-workflow').Path
$base = Join-Path $HOME '.claude'
$helper = Join-Path $base 'hooks/gem-workflow.js'
New-Item -ItemType Directory -Force (Split-Path $helper) | Out-Null
if (!(Test-Path $helper)) {
    Copy-Item (Join-Path $addon 'src/gem-workflow.js') $helper
}
$settings = Join-Path $base 'settings.json'
if (!(Test-Path $settings)) {
    '{}' | Set-Content -Encoding utf8 $settings
}
# Review both the installed and replacement helper before approving this hash.
$reviewedHash = (Get-FileHash -Algorithm SHA256 $helper).Hash.ToLowerInvariant()
node (Join-Path $addon 'install-global.cjs') --upgrade $reviewedHash
```

The updater requires an existing helper and settings file, checks the reviewed hash, saves both originals in a timestamped backup, and merges only missing hook entries. It deliberately excludes the original evaluation installer, which depended on a machine-specific agent snapshot. Save the returned backup path.

Advanced operators can print the required JSON with `node src/gem-workflow.js settings` and explicitly merge it instead. Do not replace unrelated settings with this fragment.

`src/gem-orchestrator-tool-guard.js` is a compatibility example for installations already using a separate main-role guard. It is tested but **not automatically registered**. Review its fixed `docs/records` path rules before adopting it with customized record locations.

## 2. Approve checks once per project

In the target Git project, create `.gem-workflow.json` with real project-specific checks. Review every executable and argument; this is trusted operator configuration, not model output.

```json
{
  "version": 1,
  "records": "docs/records",
  "humanAcceptance": true,
  "checks": [
    { "name": "tests", "argv": ["node", "--test"], "timeoutMs": 60000 }
  ],
  "protectedFiles": []
}
```

```powershell
node "$HOME/.claude/hooks/gem-workflow.js" install
claude --agent gem-orchestrator
```

No consultation/execution profile choice is required before the conversation. Optional readonly can be set explicitly through the operator's environment/settings; do not infer readonly from an investigative question alone.

The project installer refuses unmanaged existing pre-commit hooks and custom hook directories rather than overwriting them. Integrate with their owner explicitly. Review a changed policy/protected verifier before operator-only `install --reapprove`; prior approval is archived. Never let the agent approve its own changed checks.

## 3. Verify, then obtain real acceptance

`verify` runs the approved commands; `status` only inspects current evidence:

```powershell
node "$HOME/.claude/hooks/gem-workflow.js" verify
node "$HOME/.claude/hooks/gem-workflow.js" status
```

The bootstrap tells the executor which exact verification command is allowed. A failing check stops the remaining checks; timeout is INCONCLUSIVE. Delivery claims in Markdown do not override the signed runtime receipt. Changes to project content, policy, protected inputs, or the helper itself invalidate stale evidence.

When required, the bootstrap supplies the exact native AskUserQuestion acceptance protocol. Only an actual tool response for the verified fingerprint records acceptance. The alternative `accept FULL_FINGERPRINT` command is operator-only, never a model action. Pending acceptance does not authorize another feature.

## Backup and rollback

```powershell
node integrations/claude-workflow/install-global.cjs --rollback 'PATH_FROM_UPGRADE_OUTPUT'
```

Rollback restores the previous helper and removes only the hook entries added by that upgrade, preserving unrelated later settings changes. It refuses to overwrite a helper modified again afterward. A first registration rollback retains the copied helper because opted-in Git projects may reference it. The updater accepts only its `integration-upgrade` backup manifests; local evaluation-specific manifests are intentionally unsupported.

Before deleting/moving a helper, inspect all project hooks pointing to its absolute path. To disable one project, remove only its `# gem-workflow-managed` pre-commit hook and archive that worktree's `.git/gem-workflow/approval.json` as operator. Preserve evidence as needed; do not delete another hook manager's files. Global rollback alone does not uninstall project Git hooks.

## Boundaries and limitations

- Records are project-owned `objective.md`, `decisions.md`, `interfaces.md`, and `state.md`. Questions alone do not create delivery records. Recovery does not grant authority to repair unexpected user changes.
- Stop is auxiliary: it avoids loops and background handoff interruptions, but cannot universally prevent false prose, interrupts, or API failures. The Git gate is separate.
- The request reset matches observed native notification envelopes, not natural-language intent. Future Claude event changes may require compatibility updates; this does not affect Git verification.
- Commit verification rejects partial staging and untracked delivery inputs. Unsupported symlinks/gitlinks fail closed. Ignored files are outside the fingerprint unless independently protected.
- Checks must not rewrite verification inputs. Fingerprint-changing checks are INCONCLUSIVE. Keep generated caches ignored, and do not write a whole-tree fingerprint into a file included in that fingerprint.
- Direct protected writes and common bypass commands are refused. This is not a guarantee against arbitrary scripts, a compromised account, manual shell operations, or access to the local signing key with the user's OS privileges.
- Native Auto mode may approve actions without prompting. Existing native permission configuration remains authoritative; the custom permission executable is not audited here.
- APM updates or higher-priority project agents can replace customized definitions. Recheck the installed version rather than assuming a global customization always wins.

## Validation and review

See [port validation](VALIDATION.md) for exact results and the existing documentation-site dependency blocker.

From the repository root:

```powershell
node --test integrations/claude-workflow/tests/*.test.js
```

The portable suite has 36 tests, including real temporary Git repositories, red/green commit attempts, stale/forged evidence, timeout, readonly, request/session separation, async handbacks, hook merging, upgrade, and rollback. Tests only use temporary homes and projects. No model calls are required.

The earlier local suite had 37 tests: two tests exercised its snapshot-bound initial installer/rollback and are not presented as portable tests. One new portable test exercises first registration and rollback through the public CLI without an agent snapshot. The core helper and role guard are copied unchanged from that validated implementation. Interactive validation covered a continuous question → read-only diagnosis → authorized repair → question flow, real red commit and bypass refusals, and a separate installed session launched with only `claude --agent gem-orchestrator`. A real backup was cloned/restored in isolation. Private logs, transcripts, snapshots, machine settings, and receipts are deliberately not published.

Review the orchestrator delta separately from runtime enforcement: the instructions preserve the normal fast path and specialist selection; only the hooks/Git enforce the measured runtime restrictions. Rollback of instructions is independent of runtime hook rollback.
