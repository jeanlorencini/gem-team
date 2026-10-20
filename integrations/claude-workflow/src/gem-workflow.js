'use strict';
// Local workflow integration, not a sandbox. Commit checks never trust cached receipts.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const SELF = fs.realpathSync(__filename);
const POLICY = '.gem-workflow.json';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const slash = value => value.replace(/\\/g, '/');
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
function inside(base, file) {
  const rel = path.relative(base, file);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
function project(cwd) {
  let root = fs.realpathSync(cwd);
  for (;;) {
    const dot = path.join(root, '.git');
    if (fs.existsSync(dot)) {
      const gitDir = fs.statSync(dot).isDirectory() ? dot : path.resolve(root, fs.readFileSync(dot, 'utf8').trim().replace(/^gitdir:\s*/, ''));
      const commonFile = path.join(gitDir, 'commondir');
      const commonDir = fs.existsSync(commonFile) ? path.resolve(gitDir, fs.readFileSync(commonFile, 'utf8').trim()) : gitDir;
      return { root, gitDir, commonDir, runtime: path.join(gitDir, 'gem-workflow') };
    }
    const parent = path.dirname(root);
    if (parent === root) return null;
    root = parent;
  }
}
function git(p, args, allowed = [0]) {
  const r = cp.spawnSync('git', args, { cwd: p.root, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
  if (r.error || !allowed.includes(r.status)) throw Error('git ' + args.join(' ') + ': ' + (r.error?.message || r.stderr));
  return r.stdout;
}
function validatePolicy(p) {
  const policy = json(path.join(p.root, POLICY));
  if (policy.version !== 1 || !Array.isArray(policy.checks) || !policy.checks.length) throw Error('Policy needs version=1 and at least one check.');
  for (const c of policy.checks) {
    if (!Array.isArray(c.argv) || !c.argv.length || c.argv.some(x => typeof x !== 'string' || !x)) throw Error('Each check needs a nonempty argv array.');
    if (c.timeoutMs !== undefined && (!Number.isInteger(c.timeoutMs) || c.timeoutMs < 1 || c.timeoutMs > 300000)) throw Error('Invalid check timeout.');
  }
  return policy;
}
function load(cwd) {
  const p = project(cwd);
  if (!p || !fs.existsSync(path.join(p.runtime, 'approval.json'))) return null;
  p.approval = json(path.join(p.runtime, 'approval.json'));
  p.policy = validatePolicy(p);
  if (digest(fs.readFileSync(path.join(p.root, POLICY))) !== p.approval.policyHash) throw Error('BLOCKED: policy changed; operator must approve it again.');
  for (const [file, hash] of Object.entries(p.approval.protectedHashes)) {
    if (!fs.existsSync(file) || digest(fs.readFileSync(file)) !== hash) throw Error('BLOCKED: protected file changed: ' + file);
  }
  p.key = fs.readFileSync(path.join(p.runtime, 'key'));
  return p;
}
function sign(p, payload) {
  return { payload, mac: crypto.createHmac('sha256', p.key).update(JSON.stringify(payload)).digest('hex') };
}
function record(p, name, payload) { atomic(path.join(p.runtime, name + '.json'), sign(p, payload)); }
function readRecord(p, name) {
  try {
    const obj = json(path.join(p.runtime, name + '.json'));
    const expected = sign(p, obj.payload).mac;
    if (typeof obj.mac !== 'string' || obj.mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(obj.mac), Buffer.from(expected))) return null;
    return obj.payload;
  } catch { return null; }
}
function fingerprint(p) {
  const names = [...new Set(git(p, ['ls-files', '-c', '-o', '--exclude-standard', '-z']).split('\0').filter(Boolean))].sort();
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify({ root: slash(p.root).toLowerCase(), policy: p.approval.policyHash, protected: p.approval.protectedHashes, implementation: digest(fs.readFileSync(SELF)) }));
  for (const name of names) {
    const file = path.join(p.root, name);
    hash.update('\0' + name + '\0');
    if (!fs.existsSync(file)) { hash.update('MISSING'); continue; }
    if (fs.lstatSync(file).isSymbolicLink()) throw Error('Symlink in verification scope; explicit support required: ' + name);
    if (!fs.statSync(file).isFile()) throw Error('Unsupported verification input: ' + name);
    hash.update(digest(fs.readFileSync(file)));
  }
  return hash.digest('hex');
}
function status(p) {
  const current = fingerprint(p), receipt = readRecord(p, 'verification');
  const valid = receipt && receipt.fingerprint === current && receipt.policyHash === p.approval.policyHash;
  const acceptance = readRecord(p, 'acceptance');
  return {
    technical: valid ? receipt.status : 'NOT_VERIFIED', fingerprint: current,
    human: p.policy.humanAcceptance === false ? 'NOT_REQUIRED' : valid && receipt.status === 'PASSED' && acceptance?.fingerprint === current ? 'ACCEPTED' : 'PENDING',
    checks: valid ? receipt.checks.map(c => ({ name: c.name, status: c.status, exit: c.exit, log: c.log })) : [],
    receipt: slash(path.join(p.runtime, 'verification.json')),
  };
}
function verify(p, forCommit = false) {
  if (forCommit) {
    if (git(p, ['diff', '--name-only']).trim() || git(p, ['ls-files', '--others', '--exclude-standard']).trim()) throw Error('BLOCKED: stage/review all delivery files first; partial or untracked content is not supported for commit verification.');
  }
  const before = fingerprint(p), checks = [];
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID().slice(0, 8);
  const runDir = path.join(p.runtime, 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  let failed = false;
  for (let i = 0; i < p.policy.checks.length; i++) {
    const c = p.policy.checks[i], name = c.name || 'check-' + (i + 1);
    if (failed) { checks.push({ name, status: 'NOT_RUN', exit: null }); continue; }
    const started = Date.now();
    const r = cp.spawnSync(c.argv[0], c.argv.slice(1), {
      cwd: p.root, encoding: 'utf8', timeout: c.timeoutMs || 60000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', GIT_OPTIONAL_LOCKS: '0' },
    });
    const log = path.join(runDir, 'check-' + i + '.log');
    fs.writeFileSync(log, (r.stdout || '') + (r.stderr || '') + (r.error ? '\n' + r.error.message : ''));
    const result = r.error || r.signal || r.status === null ? 'INCONCLUSIVE' : r.status === 0 ? 'PASSED' : 'FAILED';
    checks.push({ name, argv: c.argv, status: result, exit: r.status, elapsedMs: Date.now() - started, log: slash(log) });
    failed = result !== 'PASSED';
  }
  let result = checks.some(c => c.status === 'INCONCLUSIVE') ? 'INCONCLUSIVE' : failed ? 'FAILED' : 'PASSED';
  const after = fingerprint(p);
  if (before !== after) result = 'INCONCLUSIVE';
  // A check that rewrites the index cannot authorize a different staged version either.
  if (forCommit && git(p, ['diff', '--name-only']).trim()) result = 'INCONCLUSIVE';
  const payload = { root: slash(p.root), policyHash: p.approval.policyHash, fingerprint: before, status: result, checkedAt: new Date().toISOString(), contentUnchanged: before === after, checks };
  record(p, 'runs/' + runId + '/receipt', payload);
  record(p, 'verification', payload);
  return payload;
}
function readonly(event) {
  const mode = process.env.GEM_WORKFLOW_MODE;
  if (mode && !['normal', 'execute', 'readonly'].includes(mode)) throw Error('Unknown GEM_WORKFLOW_MODE; expected normal, execute or readonly.');
  return event.permission_mode === 'plan' || mode === 'readonly';
}
function requestRecord(event) {
  return typeof event.session_id === 'string' && event.session_id ? 'requests/' + digest(event.session_id) : null;
}
function resetRequest(cwd, event) {
  // Claude also submits its generated async notification envelopes through this event.
  if (typeof event.prompt === 'string' && /^(?:(?:Another Claude session sent a message:\r?\n)?<agent-message\b|<task-notification>)/.test(event.prompt)) return null;
  const p = project(cwd), name = requestRecord(event);
  if (p && name && fs.existsSync(path.join(p.runtime, 'approval.json'))) fs.rmSync(path.join(p.runtime, name + '.json'), { force: true });
  return null;
}
function deny(reason) { return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Gem workflow: ' + reason } }; }
function protectedTarget(p, file, reading) {
  let resolved = path.resolve(p.root, file);
  const missing = [];
  while (!fs.existsSync(resolved) && path.dirname(resolved) !== resolved) {
    missing.unshift(path.basename(resolved)); resolved = path.dirname(resolved);
  }
  resolved = path.resolve(fs.realpathSync(resolved), ...missing);
  if (inside(p.runtime, resolved)) {
    // Evidence is inspectable; only the local signing key and recursive directory reads are private.
    if (!reading || same(resolved, path.join(p.runtime, 'key'))) return true;
    return !fs.existsSync(resolved) || fs.statSync(resolved).isDirectory();
  }
  if (reading) return false;
  return !inside(p.root, resolved) || same(resolved, path.join(p.root, POLICY)) || inside(path.join(p.root, '.claude'), resolved) || inside(path.join(p.commonDir, 'hooks'), resolved) || Object.keys(p.approval.protectedHashes).some(x => same(x, resolved));
}
function preTool(p, e) {
  const tool = String(e.tool_name || ''), input = e.tool_input || {};
  const terminal = /^(Bash|PowerShell)$/.test(tool), editing = /^(Write|Edit|NotebookEdit)$/.test(tool);
  const readOnlyTools = new Set(['Read', 'Glob', 'Grep', 'Agent', 'Task', 'ToolSearch', 'ListAgents', 'AskUserQuestion', 'TaskList', 'TaskGet', 'TaskOutput', 'ReportFindings', 'SubagentHandback', 'WebSearch', 'WebFetch']);
  if (readonly(e) && !readOnlyTools.has(tool)) return deny('read-only profile: no editing, terminals, scheduling, worktree changes or unclassified side effects. Change mode explicitly as operator.');
  const file = input.file_path || input.path || input.notebook_path;
  if (typeof file === 'string' && protectedTarget(p, file, !editing)) return deny('protected/out-of-scope path. Operator approval required.');
  if (terminal) {
    const cmd = String(input.command || '');
    const escape = value => slash(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefix = '(?:cd\\s+["\']?' + escape(p.root) + '["\']?\\s*&&\\s*)?';
    const node = '(?:node(?:\\.exe)?|["\']?' + escape(process.execPath) + '["\']?)';
    const ownVerify = new RegExp('^\\s*' + prefix + '(?:&\\s*)?' + node + '\\s+["\']?' + escape(SELF) + '["\']?\\s+(?:verify|status)(?:\\s+2>&1)?(?:\\s*\\|\\s*tail\\s+-[0-9]+)?\\s*$', 'i');
    if (!ownVerify.test(slash(cmd))) {
      if (/--no-v[a-z]*\b|\bgit\b[^\r\n;&|]*\bcommit\b[^\r\n;&|]*\s-[a-z]*n[a-z]*(?:\s|$)|core\.hooksPath|HUSKY\s*=\s*0|\bgit\s+(?:commit-tree|update-ref|replace)\b/i.test(cmd)) return deny('commit-hook bypass is not authorized.');
      if (/\.gem-workflow\.json|\binstall-global\.cjs\b|[\\/]gem-workflow\.js\b|[\\/]\.git[\\/](?:hooks|gem-workflow|config)\b|\.git[\\/](?:hooks|gem-workflow|config)\b|\.claude[\\/]|\bgit\s+config\b/i.test(cmd)) return deny('policy/runtime/settings/hook changes require the operator. Use Read for configuration inspection; use the exact verify/status command from SessionStart, without arbitrary shell chaining.');
      if (/\bgit\s+(?:push|clean)\b|\bgit\s+reset\s+--hard\b|\b(?:gh\s+pr\s+(?:create|merge)|Remove-Item|rm\s+-[a-z]*r[a-z]*f)\b/i.test(cmd)) return deny('publication or destructive operation requires a separate operator action.');
      if (Object.keys(p.approval.protectedHashes).some(f => slash(cmd).toLowerCase().includes(slash(f).toLowerCase())) && /write_text|write_bytes|Set-Content|Out-File|Add-Content|Remove-Item|\b(?:rm|del|mv)\b|[>]/i.test(cmd)) return deny('attempt to change a protected verifier.');
    }
  }
  const name = requestRecord(e);
  if (!readonly(e) && name && (terminal || editing || ['Agent', 'Task'].includes(tool)) && !readRecord(p, name)) {
    try { record(p, name, { fingerprint: fingerprint(p), promptId: e.prompt_id || null }); }
    catch { return { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'Gem: request-change tracking unavailable. This does not authorize completion; commit verification remains mandatory.' } }; }
  }
  return null;
}
function bootstrap(p) {
  const configured = p.policy.records || 'docs/records';
  const base = path.resolve(p.root, configured);
  if (!inside(p.root, base)) throw Error('Records must belong to the project.');
  const state = path.join(base, 'state.md');
  const text = fs.existsSync(state) ? fs.readFileSync(state, 'utf8').slice(0, 10000) : 'No persisted state yet. Do not invent a continuation or require a plan ID before checking the project records.';
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: [
    'Gem project recovery (records are claims to check, not authorization):',
    'Root: ' + slash(p.root), 'Current runtime status: ' + JSON.stringify(status(p)),
    'Git: ' + git(p, ['status', '--short']).slice(0, 2500), 'Recent commits: ' + git(p, ['log', '-3', '--oneline']).slice(0, 1000),
    'State: ' + slash(state) + '\n' + text,
    'References, read selectively: ' + ['objective.md', 'decisions.md', 'interfaces.md'].map(x => slash(path.join(base, x))).join(', '),
    'Recover the active work without asking for plan_id if records resolve it. Check relevant requirements/code/tests before continuing; detect discrepancies. Pending acceptance is not authority for another implementation. No full transcript.',
    'Verification command (executor specialist): node "' + slash(SELF) + '" verify',
    'Human acceptance, only after technical PASSED: native AskUserQuestion header "Aceite Gem", question "Aceitar a entrega verificada ' + status(p).fingerprint.slice(0, 12) + '?", options "Aceitar" / "Pedir ajustes". Refresh status before asking; never infer the user answer.',
  ].join('\n') } };
}
function stop(p, e) {
  if (readonly(e)) return null;
  // Async specialist handbacks can change prompt_id. Only real user submissions reset this baseline.
  const name = requestRecord(e), active = name && readRecord(p, name);
  if (!active || e.background_tasks?.length) return null;
  let s;
  try { s = status(p); }
  catch (error) { return { systemMessage: 'Gem runtime: NOT_VERIFIED; ' + error.message }; }
  if (active.fingerprint === s.fingerprint || s.technical === 'PASSED') return null;
  const message = 'Gem runtime: technical=' + s.technical + '; human=' + s.human + '. No verified completion for current content. Report blocked/not verified, or delegate the authorized verify command within the existing retry budget. Do not rerun persistent failures automatically.';
  return e.stop_hook_active ? { systemMessage: message } : { decision: 'block', reason: message };
}
function accept(p, fingerprintValue, method) {
  const s = status(p);
  if (s.technical !== 'PASSED' || fingerprintValue !== s.fingerprint) throw Error('Acceptance requires current verified content and its exact fingerprint.');
  record(p, 'acceptance', { fingerprint: s.fingerprint, acceptedAt: new Date().toISOString(), method });
  return status(p);
}
function postTool(p, e) {
  if (e.tool_name !== 'AskUserQuestion') return null;
  let response = e.tool_response;
  if (typeof response === 'string') { try { response = JSON.parse(response); } catch { return null; } }
  const s = status(p), question = 'Aceitar a entrega verificada ' + s.fingerprint.slice(0, 12) + '?';
  if (s.technical === 'PASSED' && e.tool_input?.questions?.some(q => q.header === 'Aceite Gem' && q.question === question) && response?.answers?.[question] === 'Aceitar') accept(p, s.fingerprint, 'native_AskUserQuestion');
  return null;
}
function hook(cwd, event) {
  if (event.hook_event_name === 'UserPromptSubmit') return resetRequest(cwd, event);
  const p = load(cwd);
  if (!p) return null;
  if (event.hook_event_name === 'SessionStart') return bootstrap(p);
  if (event.hook_event_name === 'PreToolUse') return preTool(p, event);
  if (event.hook_event_name === 'Stop') return stop(p, event);
  if (event.hook_event_name === 'PostToolUse') return postTool(p, event);
  return null;
}
function hookSettings(script = SELF) {
  const command = 'node "' + slash(script) + '" hook';
  const entry = matcher => ({ matcher, hooks: [{ type: 'command', command, timeout: 15 }] });
  return { hooks: { SessionStart: [entry('^(startup|resume|clear|compact|fork)$')], UserPromptSubmit: [entry('*')], PreToolUse: [entry('*')], Stop: [entry('*')], PostToolUse: [entry('AskUserQuestion')] } };
}
function install(cwd, reapprove = false) {
  const p = project(cwd);
  if (!p) throw Error('A Git worktree is required.');
  const policy = validatePolicy(p);
  const hookDir = git(p, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks']).trim();
  if (!same(hookDir, path.join(p.commonDir, 'hooks'))) throw Error('Custom hook directory: integrate with its manager explicitly; nothing overwritten.');
  const file = path.join(hookDir, 'pre-commit');
  if (fs.existsSync(file) && !fs.readFileSync(file, 'utf8').includes('# gem-workflow-managed')) throw Error('Existing pre-commit hook: integrate explicitly with its owner; nothing overwritten.');
  const approvedFile = path.join(p.runtime, 'approval.json');
  if (fs.existsSync(approvedFile)) {
    if (!reapprove) throw Error('Already installed. Operator must explicitly install --reapprove after reviewing a changed policy.');
    fs.copyFileSync(approvedFile, path.join(p.runtime, 'approval-before-' + Date.now() + '.json'));
  }
  const protectedHashes = {};
  for (const relative of policy.protectedFiles || []) {
    const f = path.resolve(p.root, relative);
    protectedHashes[f] = digest(fs.readFileSync(f));
  }
  fs.mkdirSync(p.runtime, { recursive: true });
  fs.mkdirSync(hookDir, { recursive: true });
  if (!fs.existsSync(path.join(p.runtime, 'key'))) fs.writeFileSync(path.join(p.runtime, 'key'), crypto.randomBytes(32), { mode: 0o600 });
  atomic(path.join(p.runtime, 'approval.json'), { version: 1, policyHash: digest(fs.readFileSync(path.join(p.root, POLICY))), protectedHashes });
  const shellPath = slash(SELF).replace(/'/g, "'\"'\"'");
  fs.writeFileSync(file, "#!/bin/sh\n# gem-workflow-managed\nnode '" + shellPath + "' pre-commit\n", { mode: 0o755 });
  return { root: slash(p.root), gitHook: slash(file), claudeSettings: hookSettings() };
}
module.exports = { project, load, status, verify, hook, install, hookSettings, accept, fingerprint };
if (require.main === module) {
  const command = process.argv[2];
  try {
    if (command === 'hook') {
      const input = fs.readFileSync(0, 'utf8');
      const event = JSON.parse(input);
      const output = hook(event.cwd || process.cwd(), event);
      if (output) console.log(JSON.stringify(output));
    } else if (command === 'install') console.log(JSON.stringify(install(process.cwd(), process.argv[3] === '--reapprove'), null, 2));
    else if (command === 'settings') console.log(JSON.stringify(hookSettings(), null, 2));
    else {
      const p = load(process.cwd());
      if (!p) throw Error('Project not opted in; run install as operator first.');
      if (command === 'verify' || command === 'pre-commit') {
        const result = verify(p, command === 'pre-commit');
        console.log(JSON.stringify(result, null, 2));
        if (result.status !== 'PASSED') process.exitCode = 1;
      } else if (command === 'status') console.log(JSON.stringify(status(p), null, 2));
      else if (command === 'accept') console.log(JSON.stringify(accept(p, process.argv[3], 'operator_cli'), null, 2));
      else throw Error('Usage: gem-workflow.js install|settings|verify|pre-commit|status|accept FINGERPRINT|hook');
    }
  } catch (error) {
    console.error('Gem workflow BLOCKED: ' + error.message);
    process.exitCode = command === 'hook' ? 2 : 1;
  }
}
