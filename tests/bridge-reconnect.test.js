const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fixture() {
  const boot = {hidden:false}, panel = {hidden:true, loads:0};
  Object.defineProperty(panel, 'src', {set(value){this.url=value;this.loads++;}});
  const intervals=[], calls=[];
  let online=false;
  const context={document:{getElementById:id=>id==='boot'?boot:panel},
    window:{RIXU_CONNECTION:{url:'http://127.0.0.1:48163',token:'fixture',extension:'C:/fixture'},
      __adobe_cep__:{evalScript(_script,callback){callback(JSON.stringify({ok:true,version:'26.2'}));}}},
    setInterval:callback=>intervals.push(callback),encodeURIComponent,
    fetch:async(url)=>{calls.push(url);if(!online)throw Error('Failed to fetch');return {ok:true,json:async()=>url.includes('/bridge/poll')?null:{ok:true}};}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../panel/bridge.js'),'utf8'),context);
  return {boot,panel,calls,intervals,setOnline(value){online=value;}};
}
const flush=()=>new Promise(setImmediate);

test('CEP waits for the companion before loading its page, then registers and recovers',async()=>{
  const f=fixture();await flush();
  assert.equal(f.panel.loads,0);assert.equal(f.panel.hidden,true);
  assert.match(f.boot.textContent,/Starting the RIXU background service/);
  f.setOnline(true);f.intervals[0]();await flush();
  assert.equal(f.panel.loads,1);assert.equal(f.panel.hidden,false);assert.equal(f.boot.hidden,true);
  assert.equal(f.calls.filter(url=>url.endsWith('/bridge/hello')).length,2);
});

test('CEP reloads the companion page and registers again after a running service stops',async()=>{
  const f=fixture();await flush();f.setOnline(true);f.intervals[0]();await flush();
  assert.equal(f.panel.loads,1);
  f.setOnline(false);f.intervals[0]();await flush();
  assert.equal(f.panel.hidden,true);assert.equal(f.boot.hidden,false);
  f.setOnline(true);f.intervals[0]();await flush();
  assert.equal(f.panel.loads,2);assert.equal(f.panel.hidden,false);assert.equal(f.boot.hidden,true);
  assert.equal(f.calls.filter(url=>url.endsWith('/bridge/hello')).length,3);
});
