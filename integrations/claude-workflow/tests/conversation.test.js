'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), cp = require('node:child_process');
const w = require('../src/gem-workflow.js');
function setup(t) {
  const old = process.env.GEM_WORKFLOW_MODE; delete process.env.GEM_WORKFLOW_MODE;
  t.after(() => { if (old === undefined) delete process.env.GEM_WORKFLOW_MODE; else process.env.GEM_WORKFLOW_MODE = old; });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gem-conversation-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = args => cp.execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git(['init','-q']);git(['config','user.name','Test']);git(['config','user.email','test@example.invalid']);git(['config','commit.gpgSign','false']);
  fs.writeFileSync(path.join(root,'value.txt'),'green');
  fs.writeFileSync(path.join(root,'.gem-workflow.json'),JSON.stringify({version:1,checks:[{argv:[process.execPath,'-e',"process.exit(require('node:fs').readFileSync('value.txt','utf8')==='green'?0:1)"]}]}));
  git(['add','.']);git(['commit','-qm','baseline']);w.install(root);
  const call = (event, extra={}) => w.hook(root,{hook_event_name:event,session_id:'session-A',prompt_id:'user-1',permission_mode:'auto',...extra});
  return {root,p:w.load(root),call,write:value=>fs.writeFileSync(path.join(root,'value.txt'),value)};
}
test('normal is the default and defers permission rather than auto-approving',t=>{
  const f=setup(t);
  for(const tool of ['Write','Edit','Bash','PowerShell']) assert.equal(f.call('PreToolUse',{tool_name:tool,tool_input:tool==='Bash'||tool==='PowerShell'?{command:'git status --short'}:{file_path:'value.txt'}}),null);
});
test('explicit readonly and native plan remain enforced; execute stays compatible',t=>{
  const f=setup(t);
  process.env.GEM_WORKFLOW_MODE='readonly';assert.equal(f.call('PreToolUse',{tool_name:'Write',tool_input:{file_path:'value.txt'}}).hookSpecificOutput.permissionDecision,'deny');
  process.env.GEM_WORKFLOW_MODE='execute';assert.equal(f.call('PreToolUse',{tool_name:'Write',tool_input:{file_path:'value.txt'}}),null);
  assert.equal(f.call('PreToolUse',{permission_mode:'plan',tool_name:'Bash',tool_input:{command:'echo x'}}).hookSpecificOutput.permissionDecision,'deny');
  process.env.GEM_WORKFLOW_MODE='typo';assert.throws(()=>f.call('PreToolUse',{tool_name:'Read',tool_input:{file_path:'value.txt'}}),/Unknown GEM_WORKFLOW_MODE/);
});
test('new question does not inherit the previous failed request or legacy active.json',t=>{
  const f=setup(t);f.call('UserPromptSubmit');f.call('PreToolUse',{tool_name:'Edit',tool_input:{file_path:'value.txt'}});
  const requests=path.join(f.p.runtime,'requests');fs.copyFileSync(path.join(requests,fs.readdirSync(requests)[0]),path.join(f.p.runtime,'active.json'));
  f.write('red');assert.equal(w.verify(f.p).status,'FAILED');assert.equal(f.call('Stop').decision,'block');
  const receipt=fs.readFileSync(path.join(f.p.runtime,'verification.json'),'utf8');
  f.call('UserPromptSubmit',{prompt_id:'user-2'});assert.equal(f.call('Stop',{prompt_id:'user-2'}),null);
  f.call('PreToolUse',{prompt_id:'user-2',tool_name:'Bash',tool_input:{command:'git status --short'}});
  assert.equal(f.call('Stop',{prompt_id:'user-2'}),null);
  assert.equal(fs.readFileSync(path.join(f.p.runtime,'verification.json'),'utf8'),receipt);assert(fs.existsSync(path.join(f.p.runtime,'active.json')));
});
test('async specialist handback changing prompt_id stays in the current user request',t=>{
  const f=setup(t);f.call('UserPromptSubmit');f.call('PreToolUse',{tool_name:'Agent',tool_input:{}});
  f.write('red');assert.equal(f.call('Stop',{background_tasks:[{status:'running'}]}),null);
  for (const prompt of ['<agent-message from="worker">\n[Subagent hand-back] completed</agent-message>', 'Another Claude session sent a message:\n<agent-message from="worker">completed</agent-message>', '<task-notification>completed</task-notification>']) {
    f.call('UserPromptSubmit',{prompt_id:'internal-handback',prompt});
    assert.equal(f.call('Stop',{prompt_id:'internal-handback'}).decision,'block');
  }
  assert.equal(f.call('Stop',{session_id:'session-B',prompt_id:'other'}),null);
});
test('a read-only investigation by a specialist does not demand verification',t=>{
  const f=setup(t);f.call('UserPromptSubmit');f.call('PreToolUse',{tool_name:'Agent',tool_input:{}});
  assert.equal(f.call('Stop',{prompt_id:'handback'}),null);assert(!fs.existsSync(path.join(f.p.runtime,'verification.json')));
});
test('normal mode still denies policy changes and hook bypasses',t=>{
  const f=setup(t);
  assert.equal(f.call('PreToolUse',{tool_name:'Write',tool_input:{file_path:'.gem-workflow.json'}}).hookSpecificOutput.permissionDecision,'deny');
  assert.equal(f.call('PreToolUse',{tool_name:'Bash',tool_input:{command:'git commit --no-verify -m x'}}).hookSpecificOutput.permissionDecision,'deny');
});
test('request reset does not hash unsupported inputs or block a question',t=>{
  const f=setup(t);fs.mkdirSync(path.join(f.root,'nested'));
  const git=args=>cp.execFileSync('git',args,{cwd:f.root,encoding:'utf8'}).trim();
  git(['update-index','--add','--cacheinfo','160000,'+git(['rev-parse','HEAD'])+',nested']);
  assert.equal(f.call('UserPromptSubmit'),null);assert.equal(f.call('Stop'),null);
  const result=f.call('PreToolUse',{tool_name:'Agent',tool_input:{}});
  assert.equal(result.hookSpecificOutput.permissionDecision,undefined);assert.match(result.hookSpecificOutput.additionalContext,/tracking unavailable/);
});
