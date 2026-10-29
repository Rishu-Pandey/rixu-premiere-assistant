(function () {
  function start() { window.RIXU_START_SERVICE().catch(function (error) { console.error('RIXU startup:', error.message); }); }
  start();
  setInterval(start, 15000);
}());
