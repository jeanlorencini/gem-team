'use strict';
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const script=path.join(__dirname,'gem-orchestrator-tool-guard.js');
const cases=[
  ['root shell','gem-orchestrator',null,'Bash',{},true],
  ['root search','gem-orchestrator',null,'Grep',{},true],
  ['root source edit','gem-orchestrator',null,'Edit',{file_path:'file.js'},true],
  ['root external fetch','gem-orchestrator',null,'WebFetch',{},true],
  ['delegate','gem-orchestrator',null,'Agent',{subagent_type:'gem-researcher'},false],
  ['plan write','gem-orchestrator',null,'Write',{file_path:'docs/plan/demo/plan.yaml'},false],
  ['config read','gem-orchestrator',null,'Read',{file_path:'.gem-team.yaml'},false],
  ['other doc','gem-orchestrator',null,'Read',{file_path:'README.md'},true],
  ['researcher','gem-researcher','id1','Bash',{},false],
  ['implementer','gem-implementer','id2','Edit',{file_path:'file.js'},false],
  ['debugger','gem-debugger','id3','Grep',{},false],
  ['normal session',null,null,'Bash',{},false],
];
let passed=0;
for(const [name,agent_type,agent_id,tool_name,tool_input,deny] of cases){
  const input=JSON.stringify({hook_event_name:'PreToolUse',cwd:process.cwd(),agent_type,agent_id,tool_name,tool_input});
  const r=cp.spawnSync(process.execPath,[script],{input,encoding:'utf8',timeout:4000});
  assert.equal(r.status,0,name);
  const actual=Boolean(r.stdout)&&JSON.parse(r.stdout).hookSpecificOutput.permissionDecision==='deny';
  assert.equal(actual,deny,name);
  passed++;
  console.log('PASS '+name);
}
const bad=cp.spawnSync(process.execPath,[script],{input:'invalid',encoding:'utf8',timeout:4000});
assert.equal(bad.status,2);
console.log('PASS malformed input');
console.log('TOTAL '+(passed+1));
