'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const w = require('../src/gem-workflow.js');
const source = path.resolve(__dirname, '../src/gem-workflow.js');
function fixture(t, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gem-workflow-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function git(...args) {
    const r = cp.spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  }
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid'); git('config', 'commit.gpgSign', 'false');
  fs.writeFileSync(path.join(root, '.gitignore'), 'ignored.txt\n');
  fs.writeFileSync(path.join(root, 'value.txt'), 'green');
  fs.writeFileSync(path.join(root, 'check.cjs'), "const fs=require('node:fs');process.exit(fs.readFileSync('value.txt','utf8')==='green'?0:1)");
  fs.writeFileSync(path.join(root, '.gem-workflow.json'), JSON.stringify({ version: 1, checks: [{ name: 'behavior', argv: [process.execPath, 'check.cjs'] }], ...extra }));
  git('add', '.'); git('commit', '-qm', 'baseline');
  const installed = w.install(root);
  const p = w.load(root);
  return { root, p, git, installed, write(name, text) { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), text); } };
}
test('outside opt-in: hooks have no effect', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gem-inactive-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(w.hook(dir, { hook_event_name: 'SessionStart' }), null);
});
test('bootstrap supplies compact records without writing files', t => {
  const f = fixture(t); f.write('docs/records/state.md', 'Work: invoice\nHuman acceptance: PENDING\nNext: wait.');
  const before = fs.readdirSync(f.p.runtime).sort();
  const context = w.hook(f.root, { hook_event_name: 'SessionStart' }).hookSpecificOutput.additionalContext;
  assert.match(context, /Work: invoice/); assert.match(context, /PENDING/); assert.match(context, /without asking for plan_id/);
  assert.deepEqual(fs.readdirSync(f.p.runtime).sort(), before);
});
test('fresh verification passes; modification invalidates it', t => {
  const f = fixture(t); assert.equal(w.verify(f.p).status, 'PASSED');
  assert.equal(w.status(f.p).technical, 'PASSED'); assert.equal(w.status(f.p).human, 'PENDING');
  f.write('value.txt', 'red'); assert.equal(w.status(f.p).technical, 'NOT_VERIFIED');
  assert.equal(w.verify(f.p).status, 'FAILED'); assert.equal(w.status(f.p).technical, 'FAILED');
});
test('forged receipt cannot create verified status or authorize a red commit', t => {
  const f = fixture(t); w.verify(f.p);
  const file = path.join(f.p.runtime, 'verification.json'), forged = JSON.parse(fs.readFileSync(file));
  f.write('value.txt', 'red'); forged.payload.fingerprint = w.fingerprint(f.p); forged.payload.status = 'PASSED'; fs.writeFileSync(file, JSON.stringify(forged));
  assert.equal(w.status(f.p).technical, 'NOT_VERIFIED');
  f.git('add', '.'); assert.equal(w.verify(f.p, true).status, 'FAILED');
});
test('real Git hook blocks red and allows green; no false HEAD advance', t => {
  const f = fixture(t); const head = f.git('rev-parse', 'HEAD');
  f.write('value.txt', 'red'); f.git('add', '.');
  let r = cp.spawnSync('git', ['commit', '-qm', 'red'], { cwd: f.root, encoding: 'utf8' });
  assert.notEqual(r.status, 0, r.stdout + r.stderr); assert.equal(f.git('rev-parse', 'HEAD'), head);
  f.write('value.txt', 'green'); f.git('add', '.');
  r = cp.spawnSync('git', ['commit', '--allow-empty', '-qm', 'green'], { cwd: f.root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
test('pre-commit cannot verify unstaged or untracked inputs instead of the index', t => {
  const f = fixture(t); f.write('value.txt', 'red'); assert.throws(() => w.verify(f.p, true), /stage\/review/);
  f.write('value.txt', 'green'); f.write('new-input.txt', 'untracked'); assert.throws(() => w.verify(f.p, true), /stage\/review/);
});
test('timeout is inconclusive and later checks are not run', t => {
  const f = fixture(t, { checks: [{ name: 'slow', argv: [process.execPath, '-e', 'setTimeout(()=>{},10000)'], timeoutMs: 50 }, { name: 'later', argv: [process.execPath, '-e', 'process.exit(0)'] }] });
  const r = w.verify(f.p); assert.equal(r.status, 'INCONCLUSIVE'); assert.equal(r.checks[1].status, 'NOT_RUN');
});
test('test rewriting source produces inconclusive, never passed', t => {
  const f = fixture(t, { checks: [{ argv: [process.execPath, '-e', "require('node:fs').writeFileSync('value.txt','changed')"] }] });
  assert.equal(w.verify(f.p).status, 'INCONCLUSIVE'); assert.notEqual(w.status(f.p).technical, 'PASSED');
});
test('policy changes fail closed; deleting policy does not opt out', t => {
  const f = fixture(t); f.write('.gem-workflow.json', '{}'); assert.throws(() => w.load(f.root));
  fs.unlinkSync(path.join(f.root, '.gem-workflow.json')); assert.throws(() => w.load(f.root));
});
test('protected external verifier change fails closed', t => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gem-verifier-')); t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const file = path.join(outside, 'oracle.py'); fs.writeFileSync(file, 'pass');
  const f = fixture(t, { protectedFiles: [file] }); fs.writeFileSync(file, 'changed'); assert.throws(() => w.load(f.root), /protected file changed/);
});
test('read-only profile denies real tool-shaped calls in any role', t => {
  const f = fixture(t);
  for (const tool of ['Write', 'Edit', 'NotebookEdit', 'Bash', 'PowerShell']) {
    const r = w.hook(f.root, { hook_event_name: 'PreToolUse', permission_mode: 'plan', agent_type: 'gem-implementer', tool_name: tool, tool_input: {} });
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny');
  }
  assert.equal(w.hook(f.root, { hook_event_name: 'Stop', permission_mode: 'plan' }), null);
});
function execute(t) { const old = process.env.GEM_WORKFLOW_MODE; process.env.GEM_WORKFLOW_MODE = 'execute'; t.after(() => { if (old === undefined) delete process.env.GEM_WORKFLOW_MODE; else process.env.GEM_WORKFLOW_MODE = old; }); }
test('executor and specialist cannot edit policy, receipts or outside root', t => {
  execute(t); const f = fixture(t);
  for (const file of ['.gem-workflow.json', path.join(f.p.runtime, 'verification.json'), '../outside.txt', '.claude/settings.json']) {
    const r = w.hook(f.root, { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'gem-implementer', tool_input: { file_path: file } });
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny', file);
  }
});
test('known Bash and PowerShell bypasses are denied', t => {
  execute(t); const f = fixture(t);
  for (const command of ['git commit --no-verify -m x', 'git commit -nm x', 'git -c core.hooksPath=/dev/null commit -m x', 'git config core.hooksPath /tmp/off', 'git commit-tree HEAD^{tree}', 'Remove-Item .git/hooks/pre-commit', `node "${source.replace(/\\/g, '/')}" accept forged`]) {
    for (const tool of ['Bash', 'PowerShell']) {
      const r = w.hook(f.root, { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command } });
      assert.equal(r?.hookSpecificOutput?.permissionDecision, 'deny', command);
    }
  }
});
test('Stop is bounded feedback and does not launch another test', t => {
  execute(t); const f = fixture(t);
  const session_id = 'bounded-session';
  w.hook(f.root, { hook_event_name: 'UserPromptSubmit', session_id });
  w.hook(f.root, { hook_event_name: 'PreToolUse', session_id, tool_name: 'Edit', tool_input: { file_path: 'value.txt' } });
  f.write('value.txt', 'red'); w.verify(f.p);
  const before = fs.readFileSync(path.join(f.p.runtime, 'verification.json'), 'utf8');
  const first = w.hook(f.root, { hook_event_name: 'Stop', session_id }); assert.equal(first.decision, 'block');
  const second = w.hook(f.root, { hook_event_name: 'Stop', session_id, stop_hook_active: true }); assert.equal(second.decision, undefined);
  assert.equal(fs.readFileSync(path.join(f.p.runtime, 'verification.json'), 'utf8'), before);
});
test('human approval is not inferred from tests and is invalidated by content change', t => {
  const f = fixture(t); assert.throws(() => w.accept(f.p, w.fingerprint(f.p), 'test'), /requires current/);
  w.verify(f.p); let s = w.status(f.p); assert.equal(s.human, 'PENDING');
  assert.throws(() => w.accept(f.p, 'wrong', 'test')); w.accept(f.p, s.fingerprint, 'operator_cli'); assert.equal(w.status(f.p).human, 'ACCEPTED');
  f.write('value.txt', 'red'); assert.equal(w.status(f.p).human, 'PENDING');
});
test('native user answer is required, not an agent supplied input answer', t => {
  const f = fixture(t); w.verify(f.p); const fp = w.status(f.p).fingerprint.slice(0, 12), q = 'Aceitar a entrega verificada ' + fp + '?';
  const e = { hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [{ header: 'Aceite Gem', question: q }], answers: { [q]: 'Aceitar' } } };
  w.hook(f.root, e); assert.equal(w.status(f.p).human, 'PENDING');
  e.tool_response = { answers: { [q]: 'Aceitar' } }; w.hook(f.root, e); assert.equal(w.status(f.p).human, 'ACCEPTED');
});
test('existing hooks and custom hook directories are not overwritten', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gem-existing-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  cp.execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.writeFileSync(path.join(dir, '.gem-workflow.json'), JSON.stringify({ version: 1, checks: [{ argv: [process.execPath, '-e', 'process.exit(0)'] }] }));
  const hook = path.join(dir, '.git/hooks/pre-commit'); fs.writeFileSync(hook, '#!/bin/sh\necho original\n');
  assert.throws(() => w.install(dir), /Existing pre-commit/); assert.equal(fs.readFileSync(hook, 'utf8'), '#!/bin/sh\necho original\n');
  fs.unlinkSync(hook); const external = path.join(dir, 'custom-hooks'); fs.mkdirSync(external);
  cp.execFileSync('git', ['config', 'core.hooksPath', external], { cwd: dir });
  assert.throws(() => w.install(dir), /custom|hook directory/i);
});
test('patched role guard permits continuity, but not inline source edits', t => {
  const f = fixture(t), guard = path.resolve(__dirname, '../src/gem-orchestrator-tool-guard.js');
  function call(tool, file) {
    return cp.spawnSync(process.execPath, [guard], { input: JSON.stringify({ cwd: f.root, agent_type: 'gem-orchestrator', tool_name: tool, tool_input: { file_path: file } }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: f.root } });
  }
  assert.equal(call('Read', 'docs/records/state.md').stdout, '');
  assert.equal(call('Edit', 'docs/records/state.md').stdout, '');
  assert.match(call('Edit', 'pricing.py').stdout, /deny/);
});
test('linked worktrees have separate keys and no inherited verification', t => {
  const f = fixture(t); w.verify(f.p);
  const linked = path.join(f.root, 'linked');
  f.git('worktree', 'add', '--detach', linked, 'HEAD');
  w.install(linked); const p = w.load(linked);
  assert.notEqual(p.runtime, f.p.runtime); assert.equal(p.commonDir, f.p.commonDir);
  assert.equal(w.status(p).technical, 'NOT_VERIFIED');
  assert.equal(w.verify(p).status, 'PASSED');
});
test('untracked source changes invalidate technical status', t => {
  const f = fixture(t); w.verify(f.p); f.write('new-config.txt', 'behavior input');
  assert.equal(w.status(f.p).technical, 'NOT_VERIFIED');
});
test('missing target through a directory junction cannot escape the project', t => {
  execute(t); const f = fixture(t);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'gem-junction-out-')); t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.symlinkSync(external, path.join(f.root, 'linked-dir'), process.platform === 'win32' ? 'junction' : 'dir');
  const r = w.hook(f.root, { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: 'linked-dir/new.txt' } });
  assert.equal(r.hookSpecificOutput.permissionDecision, 'deny');
});
test('evidence and logs are readable but key/directory scans are private', t => {
  const f = fixture(t); const result = w.verify(f.p);
  for (const file of [path.join(f.p.runtime, 'verification.json'), result.checks[0].log]) {
    assert.equal(w.hook(f.root, { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: file } }), null);
  }
  for (const file of [path.join(f.p.runtime, 'key'), f.p.runtime]) {
    assert.equal(w.hook(f.root, { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: file } }).hookSpecificOutput.permissionDecision, 'deny');
  }
});
test('normal same-root verification wrappers work; extra commands do not', t => {
  execute(t); const f = fixture(t), self = source.split(path.sep).join('/'), root = f.root.split(path.sep).join('/');
  for (const command of [`node "${self}" verify`, `cd "${root}" && node "${self}" verify 2>&1 | tail -30`, `& node '${self}' status`]) {
    assert.equal(w.hook(f.root, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }), null, command);
  }
  const denied = w.hook(f.root, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `node "${self}" verify; node "${self}" accept forged` } });
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
});
test('new verification retains prior receipt and log', t => {
  const f = fixture(t); const first = w.verify(f.p), bytes = fs.readFileSync(first.checks[0].log, 'utf8');
  f.write('value.txt', 'red'); const second = w.verify(f.p);
  assert.notEqual(first.checks[0].log, second.checks[0].log); assert.equal(fs.readFileSync(first.checks[0].log, 'utf8'), bytes);
});
test('only the operator can explicitly reapprove a changed policy', t => {
  const f = fixture(t); w.verify(f.p); const policy = JSON.parse(fs.readFileSync(path.join(f.root, '.gem-workflow.json')));
  policy.checks.push({ name: 'more', argv: [process.execPath, '-e', 'process.exit(0)'] }); f.write('.gem-workflow.json', JSON.stringify(policy));
  assert.throws(() => w.load(f.root), /policy changed/); assert.throws(() => w.install(f.root), /Already installed/);
  w.install(f.root, true); const p = w.load(f.root); assert.equal(w.status(p).technical, 'NOT_VERIFIED'); assert.equal(w.verify(p).status, 'PASSED');
});
test('read-only denies scheduling, worktree writes and newly introduced side effects', t => {
  const f = fixture(t);
  for (const tool of ['EnterWorktree', 'CronCreate', 'Workflow', 'mcp__docs__update', 'UnknownWriter']) {
    const r = w.hook(f.root, { hook_event_name: 'PreToolUse', permission_mode: 'plan', tool_name: tool, tool_input: {} }); assert.equal(r.hookSpecificOutput.permissionDecision, 'deny');
  }
});
