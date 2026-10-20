# Port validation

## Scope

This branch ports the previously exercised workflow integration onto the fork's `25a9b6e` baseline. The original orchestrator definition matched the evaluated baseline exactly, so its reviewed recovery/evidence delta was applied without changing specialist selection, risk tiers, or model routing.

The helper and optional role guard are byte-identical to the evaluated implementation at port time. Only the portable updater/rollback paths are included; the snapshot-dependent evaluation installer is excluded. There are no personal settings, logs, transcripts, receipts, backups, or evaluation fixtures in this port.

## Checks

| Check | Result |
| --- | --- |
| Portable runtime tests, Windows / Node.js 26.12.0 | 36 passed, 0 failed |
| `apm run check`, APM 0.34.0 | Passed: marketplace, package dry run/version checks, policy audit |
| Source comparison | Core helper and role guard unchanged from the exercised candidate |
| First registration | Public CLI tested against a temporary home, preserving prior hooks/settings and restoring from its real generated backup |
| Git gate | Tests exercise real temporary red/green commit attempts and verify HEAD does not advance on rejection |
| Privacy review | No local absolute paths, private session IDs, credentials, logs, or machine configuration copied |
| Doc-site dependency installation | Blocked by the baseline lockfile; see below |

The earlier interactive evaluation exercised normal questions, read-only diagnosis, authorized implementation, subsequent questions, real negative commit/bypass attempts, fresh-session recovery, an actual in-conversation human decision, and installed startup with only `claude --agent gem-orchestrator`. These are scoped observations, not certification of arbitrary hosts/models or a universal sandbox. Raw private evaluation material is intentionally not uploaded.

## Existing documentation-site blocker

With Node.js 26, the unchanged `docs/src/package.json` and `package-lock.json` fail `npm ci` with EUSAGE (missing lock entries including `cac@6.7.14` and `oxc-parser@0.155.0`). Both files match the fork baseline; no dependency or application changes were made. Consequently the documentation site's lint, typecheck, and production build could not be executed through its locked setup. Do not interpret the runtime/APM passes as a passing frontend build.

The published documentation changes are Markdown only. Repairing the existing dependency lock is a separate work unit, not bundled with workflow permissions/recovery.

## Reproduce

```sh
node --test integrations/claude-workflow/tests/*.test.js
apm run check
```

Run Node 26 through a normal native executable on Windows. The npm `node` package's temporary Unix shim can be selected incorrectly by Git Bash pre-commit hooks; that environment error is not a passing or failing verdict on the native Node implementation. The recorded Node 26 run used an actual `node.exe` on PATH, not the broken shim.

No additional model sessions are needed to run these checks. The runtime is opt-in and not automatically installed by the package checks.
