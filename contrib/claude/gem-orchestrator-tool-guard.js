'use strict';
const path=require('node:path');
let input='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{input+=chunk;});
process.stdin.on('end',()=>{
  try {
    const e=JSON.parse(input);
    if(!/(^|:)gem-orchestrator$/.test(String(e.agent_type||'')) || e.agent_id) return;
    const tool=String(e.tool_name||'');
    if(['Agent','AskUserQuestion','ToolSearch','TaskCreate','TaskUpdate','TaskList','TaskGet','TaskOutput'].includes(tool)) return;
    const p=e.tool_input&&(e.tool_input.file_path||e.tool_input.path);
    const root=path.resolve(String(process.env.CLAUDE_PROJECT_DIR||e.cwd||'.'));
    const rel=typeof p==='string' ? path.relative(root,path.resolve(root,p)).replace(/\\/g,'/'):'';
    const inside=!!rel&&!rel.startsWith('../')&&rel!=='..'&&!path.isAbsolute(rel);
    if(inside && tool==='Read' && rel==='.gem-team.yaml') return;
    if(inside && ['Read','Write','Edit'].includes(tool) && /^docs\/plan\/[a-z0-9-]+\/plan\.yaml$/.test(rel)) return;
    process.stdout.write(JSON.stringify({hookSpecificOutput:{
      hookEventName:'PreToolUse',
      permissionDecision:'deny',
      permissionDecisionReason:'Gem Team: main gem-orchestrator must delegate research and implementation via Agent(gem-researcher or another Gem specialist). Do not execute specialist tools inline.'
    }}));
  } catch (err) {process.stderr.write('Gem Team guard failed to parse input.');process.exitCode=2;}
});