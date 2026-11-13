define([], function () {
  'use strict';

  // The clock of the animated flow (Flows explained → Watch the flow): ticks every few seconds while it plays. The page
  // module listens (onTick → its playTick event → the chain moves to the next step); the chain starts and stops it.
  var timer = null, listener = null, every = 2800;
  return {
    onTick: function (fn) { listener = fn; },
    start: function (ms) { this.stop(); every = ms || every; timer = setInterval(function () { if (listener) listener(); }, every); },
    stop: function () { if (timer) clearInterval(timer); timer = null; },
    running: function () { return !!timer; }
  };
});
