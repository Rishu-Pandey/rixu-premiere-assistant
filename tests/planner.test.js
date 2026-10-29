const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createPlanner}=require('../src/planner');
const schemas=require('../src/planner-schemas');
const schema={type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false};

function fixture(t,timeoutMs=3000){
  const tempRoot=path.resolve(os.tmpdir()),folder=fs.mkdtempSync(path.join(tempRoot,'rixu-planner-test-'));
  const script=path.join(folder,'fixture.js');
  fs.writeFileSync(script,`
    const fs=require('node:fs');let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{
      if(input.includes('HANG_FIXTURE'))return setInterval(()=>{},1000);
      if(input.includes('FAIL_FIXTURE')){console.error('fixture failure');process.exitCode=7;return;}
      const args=process.argv.slice(2),result={ok:true};
      if(args[0]==='exec'){
        if(!args.includes('read-only')||!args.includes('--ignore-user-config')||!args.includes('shell_tool')||!args.includes('multi_agent'))throw Error('Unsafe Codex invocation');
        fs.writeFileSync(args[args.indexOf('--output-last-message')+1],input.includes('BAD_JSON_FIXTURE')?'invalid':JSON.stringify(result));
      }else{
        if(args[args.indexOf('--tools')+1]!==''||!args.includes('--safe-mode')||!args.includes('--strict-mcp-config'))throw Error('Unsafe Claude invocation');
        if(args.includes('--input-format')&&!JSON.parse(input).message.content.some(c=>c.type==='image'))throw Error('Image stdin payload missing');
        console.log(JSON.stringify(input.includes('ERROR_ENVELOPE_FIXTURE')?{is_error:true,result:'fixture error'}:{type:'result',structured_output:result}));
      }
    });
  `);
  t.after(()=>{if(path.resolve(folder).startsWith(tempRoot+path.sep))fs.rmSync(folder,{recursive:true,force:true});});
  const planner=createPlanner({runtime:folder,timeoutMs,resolve:()=>({command:process.execPath,prefix:[script]})});
  return {planner,folder};
}

test('Both CLI adapters return structured data using stdin with restricted tool configuration',async t=>{
  const {planner}=fixture(t);
  for(const provider of ['codex','claude']){
    planner.configure({provider});
    assert.deepEqual(await planner.request([{role:'user',content:'literal `text`; $(no-command) & "quoted"\nहिंदी'}],schema),{ok:true});
  }
});

test('CLI preferences survive restart without persisting API credentials',t=>{
  const {planner,folder}=fixture(t);
  planner.configure({provider:'claude',model:'test-model',key:'test-only-secret'});
  const saved=fs.readFileSync(path.join(folder,'planner.json'),'utf8');
  assert.ok(!saved.includes('test-only-secret'));
  const restored=createPlanner({runtime:folder,resolve:()=>({command:process.execPath,prefix:[]})});
  assert.equal(restored.status().provider,'claude');assert.equal(restored.status().model,'test-model');
  assert.equal(restored.status().verified,null);
});

test('Both CLI adapters accept preview images without enabling file or shell tools',async t=>{
  const {planner,folder}=fixture(t),image=path.join(folder,'test-only.jpg');fs.writeFileSync(image,Buffer.from([255,216,255,217]));
  for(const provider of ['codex','claude']){planner.configure({provider});assert.deepEqual(await planner.request([{role:'user',content:'Classify the supplied test frame.'}],schema,{images:[image]}),{ok:true});}
});

test('Malformed CLI data and error envelopes never become usable editing plans',async t=>{
  const {planner}=fixture(t);
  planner.configure({provider:'codex'});
  await assert.rejects(planner.request([{role:'user',content:'BAD_JSON_FIXTURE'}],schema),SyntaxError);
  planner.configure({provider:'claude'});
  await assert.rejects(planner.request([{role:'user',content:'ERROR_ENVELOPE_FIXTURE'}],schema),/reported an error/);
  await assert.rejects(planner.request([{role:'user',content:'FAIL_FIXTURE'}],schema),/exit 7/);
  assert.equal(planner.status().busy,false);
});

test('A timed-out CLI request is terminated and overlapping requests are rejected',async t=>{
  const {planner}=fixture(t,250);planner.configure({provider:'codex'});
  const pending=planner.request([{role:'user',content:'HANG_FIXTURE'}],schema);
  await assert.rejects(planner.request([{role:'user',content:'second'}],schema),/already working/);
  assert.throws(()=>planner.configure({provider:'claude'}),/active planner/);
  await assert.rejects(pending,/timed out/);assert.equal(planner.status().busy,false);
});

test('Connection checks record successful verification without running editing jobs',async t=>{
  const {planner}=fixture(t);planner.configure({provider:'claude'});
  assert.equal((await planner.test()).verified.provider,'claude');
  planner.configure({provider:'off'});assert.equal(planner.status().verified,null);
  await assert.rejects(planner.test(),/AI_PLANNER_REQUIRED/);
  assert.throws(()=>planner.configure({provider:'http',baseUrl:'http://untrusted.example/v1',model:'fixture'}),/HTTPS/);
  assert.equal(schemas.design.additionalProperties,false);
});
