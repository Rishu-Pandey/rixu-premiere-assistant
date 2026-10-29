const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
function fixture(online=false) {
  const calls=[];let time=60000,healthy=online;
  const window={RIXU_CONNECTION:{url:'http://127.0.0.1:48163',powershell:'C:/Windows/powershell.exe',launcher:'C:/RIXU with spaces/scripts/start.ps1'},cep:{process:{createProcess(...args){calls.push(args);return {err:0,data:123};}}}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'panel/launcher.js'),'utf8'),{window,Date:{now:()=>time},fetch:async()=>{if(!healthy)throw Error('offline');return {ok:true,json:async()=>({service:'rixu-premiere-assistant'})};}});
  return {window,calls,setHealthy(value){healthy=value;},advance(){time+=31000;}};
}
test('Premiere launcher starts an offline companion silently with distinct arguments and throttles retries',async()=>{
  const f=fixture();await Promise.all([f.window.RIXU_START_SERVICE(),f.window.RIXU_START_SERVICE()]);
  assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0],['C:/Windows/powershell.exe','-NoProfile','-WindowStyle','Hidden','-File','C:/RIXU with spaces/scripts/start.ps1']);
  await f.window.RIXU_START_SERVICE();assert.equal(f.calls.length,1);
  f.advance();await f.window.RIXU_START_SERVICE();assert.equal(f.calls.length,2);
});
test('Premiere launcher reuses a healthy companion and can restart after a later outage',async()=>{
  const f=fixture(true);await f.window.RIXU_START_SERVICE();assert.equal(f.calls.length,0);
  f.setHealthy(false);await f.window.RIXU_START_SERVICE();assert.equal(f.calls.length,1);
  f.setHealthy(true);await f.window.RIXU_START_SERVICE();assert.equal(f.calls.length,1);
});
test('Invisible Premiere launcher starts on application activation and installation removes the login shortcut',()=>{
  const xml=fs.readFileSync(path.join(root,'panel/CSXS/manifest.xml'),'utf8');
  assert.match(xml,/<Extension Id="com\.rixu\.premiere\.launcher"><DispatchInfo>[\s\S]*?<AutoVisible>false<\/AutoVisible>[\s\S]*?<Event>com\.adobe\.csxs\.events\.ApplicationActivate<\/Event>[\s\S]*?<Type>Custom<\/Type>/);
  const installer=fs.readFileSync(path.join(root,'scripts/install.ps1'),'utf8');
  assert.ok(!installer.includes('register-startup.ps1'));assert.ok(installer.includes('Remove-Item -LiteralPath $rixuStartupLink'));
  assert.ok(!fs.existsSync(path.join(root,'scripts/register-startup.ps1')));
});
