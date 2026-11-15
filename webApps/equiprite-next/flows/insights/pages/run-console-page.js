define([], () => {
  'use strict';

  // Run console: binding helpers. The log itself is drawn by resources/js/runConsoleView.js (not bound line by line). No `this`.
  const FILTERS = [['', 'All'], ['build', 'Build'], ['server', 'Server'], ['app', 'App'], ['errors', 'Errors']];
  // RT_EQP_TIME_APPROVER → Time approver
  const roleLabel = (r) => { const t = String(r || '').replace(/^RT_EQP_/, '').toLowerCase().split('_').join(' '); return t.charAt(0).toUpperCase() + t.slice(1); };
  class PageModule {
    filters(f) { return FILTERS.map((x) => ({ id: x[0], label: x[1], cls: 'nx-chip nx-chip--sm' + (x[0] === (f || '') ? ' nx-chip--on' : '') })); }
    logClass(f) { return 'nx-rc-log' + (f ? ' rc-f-' + f : ''); }
    whoText(s) {
      if (!s) return 'Reading…';
      if (!s.signedInAs) return 'The app runs anonymous — pages that need access stay hidden: choose who it runs as below';
      return 'The app runs as ' + s.signedInAs + (s.roles ? ' · ' + s.roles.map(roleLabel).join(', ') : ' · roles from Fusion') + (s.by === 'run-as' ? ' (Run as)' : ' (the EquipRite sign-in)');
    }
    whoClass(s) { return 'nx-rc-who' + (s && (!s.signedInAs || s.noAccess) ? ' nx-rc-who--anon' : ''); }
    // Run as: the roles the app knows, each a chip (on when chosen)
    roleChips(s, chosen) { return ((s && s.knownRoles) || []).map((r) => ({ id: r, label: roleLabel(r), cls: 'nx-chip nx-chip--sm' + ((chosen || []).indexOf(r) !== -1 ? ' nx-chip--on' : '') })); }
    noAccessText(s) { return !s || !s.noAccess ? '' : 'The app said "You don\'t have access" — it ran as ' + s.noAccess.as + '. Choose a user and a role below, then Apply: the app\'s window reloads.'; }
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
