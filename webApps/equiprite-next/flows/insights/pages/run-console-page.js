define([], () => {
  'use strict';

  // Run console: binding helpers. The log itself is drawn by resources/js/runConsoleView.js (not bound line by line). No `this`.
  const FILTERS = [['', 'All'], ['build', 'Build'], ['server', 'Server'], ['app', 'App'], ['errors', 'Errors']];
  class PageModule {
    filters(f) { return FILTERS.map((x) => ({ id: x[0], label: x[1], cls: 'nx-chip nx-chip--sm' + (x[0] === (f || '') ? ' nx-chip--on' : '') })); }
    logClass(f) { return 'nx-rc-log' + (f ? ' rc-f-' + f : ''); }
    whoText(s) {
      if (!s) return 'Reading…';
      return s.signedInAs ? 'The app runs as ' + s.signedInAs : 'Not signed in to EquipRite: the app runs anonymous — pages that need access stay hidden';
    }
    whoClass(s) { return 'nx-rc-who' + (s && !s.signedInAs ? ' nx-rc-who--anon' : ''); }
    wsText(s) { return !s ? '' : (s.workspace ? 'Workspace ' + s.workspace : 'No workspace set up'); }
    buildText(s) {
      if (!s) return '';
      if (s.building) return 'Building…';
      return s.built ? 'Built ' + new Date(s.builtAt).toLocaleTimeString() : 'Not built yet';
    }
    windowText(s) { return !s ? '' : (s.window ? 'Window open: ' + String(s.window).replace(/^https?:\/\/[^/]+/, '') : 'Window closed'); }
    busyLabel(busy, text) { return busy ? 'Running: ' + text + '…' : ''; }
  }
  return PageModule;
});
