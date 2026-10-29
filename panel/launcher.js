(function () {
  'use strict';
  var pending = null, lastAttempt = 0;
  window.RIXU_START_SERVICE = function () {
    if (pending) return pending;
    var cfg = window.RIXU_CONNECTION;
    if (!cfg) return Promise.resolve();
    pending = fetch(cfg.url + '/health').then(function (response) {
      if (!response.ok) throw new Error('Companion not ready');
      return response.json();
    }).then(function (health) {
      if (health.service !== 'rixu-premiere-assistant') throw new Error('Unexpected local service');
    }).catch(function () {
      if (Date.now() - lastAttempt < 30000) return;
      if (!cfg.launcher || !cfg.powershell || !window.cep || !window.cep.process) {
        throw new Error('Reinstall RIXU to enable automatic launch.');
      }
      lastAttempt = Date.now();
      var result = window.cep.process.createProcess(cfg.powershell, '-NoProfile', '-WindowStyle', 'Hidden', '-File', cfg.launcher);
      if (result.err !== 0) throw new Error('Could not start companion (' + result.err + ').');
    }).then(function () { pending = null; }, function (error) { pending = null; throw error; });
    return pending;
  };
}());
