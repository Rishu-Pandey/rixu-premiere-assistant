(function () {
  'use strict';
  var cfg = window.RIXU_CONNECTION, boot = document.getElementById('boot'), panel = document.getElementById('panel');
  if (!cfg || !window.__adobe_cep__) { boot.textContent = 'Open this extension in Premiere. Run scripts/install.ps1 to install it.'; return; }
  var busy = false, loaded = false, hostVersion = '', session='cep-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  var hostPath=cfg.extension.replace(/\\/g,'/')+'/host.jsx';
  function call(route, options) { options = options || {}; options.headers = { 'Content-Type': 'application/json', 'X-RIXU-Token': cfg.token }; return fetch(cfg.url+route, options).then(function(r){if(!r.ok)throw new Error('Companion unavailable');return r.json();}); }
  function evalHost(script) { return new Promise(function(resolve,reject){window.__adobe_cep__.evalScript(script,function(result){var value;try{value=JSON.parse(result);}catch(e){reject(new Error(String(result).slice(0,700)));return;}if(value.error)reject(new Error(value.error));else resolve(value);});}); }
  function initialize() {
    var host = cfg.extension.replace(/\\/g,'/')+'/host.jsx', json2=cfg.extension.replace(/\\/g,'/')+'/json2.js';
    var script = '(function(){try{if(typeof JSON==="undefined")$.evalFile('+JSON.stringify(json2)+');$.evalFile('+JSON.stringify(host)+');return JSON.stringify({ok:true,version:app.version});}catch(e){return "{\\"error\\":\\"Host loading failed\\"}";}})()';
    return evalHost(script).then(function(info){hostVersion=info.version; return call('/bridge/hello',{method:'POST',body:JSON.stringify({kind:'cep',version:info.version,session:session})});}).then(function(){loaded=true;});
  }
  function poll() {
    if(busy)return;
    busy=true;
    (loaded ? Promise.resolve() : initialize()).then(function(){
      return call('/bridge/poll?kind=cep');
    }).then(function(job){
      if(panel.hidden){panel.src=cfg.url+'/?token='+encodeURIComponent(cfg.token);panel.hidden=false;}
      boot.hidden=true;
      if(!job)return;
      return evalHost('(function(){try{$.evalFile('+JSON.stringify(hostPath)+');return $.global.RIXU.dispatch('+JSON.stringify(JSON.stringify(job))+');}catch(e){return JSON.stringify({error:String(e),line:e.line});}})()').then(function(result){return call('/bridge/result',{method:'POST',body:JSON.stringify({id:job.id,result:result})});},function(error){return call('/bridge/result',{method:'POST',body:JSON.stringify({id:job.id,error:error.message})});});
    }).catch(function(error){loaded=false;panel.hidden=true;boot.hidden=false;boot.textContent='Starting the RIXU background service. Retrying automatically. ('+error.message+')';if(window.RIXU_START_SERVICE)return window.RIXU_START_SERVICE().catch(function(startError){boot.textContent=startError.message+' You can also run Start RIXU.cmd.';});}).then(function(){busy=false;});
  }
  setInterval(poll,500);poll();
  setInterval(function(){if(loaded)call('/bridge/hello',{method:'POST',body:JSON.stringify({kind:'cep',version:hostVersion,session:session})}).then(function(){boot.hidden=true;}).catch(function(){});},3000);
}());
