define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // One field changed (on blur). Mutate the live variable in place — NOT clone-and-reassign — so two edits in quick
  // succession can't each clone a stale copy and clobber the other (a real read-modify-write race), and so the input
  // keeps focus. VBCS returns the stored reference from a variable getter (which is why applyChain clones before it
  // mutates rows), so the change persists and is read back whole at save/format time. Programmatic changes that must
  // re-render (add/remove a line, open a meeting, a formatted/dictated result) reassign in actChain.
  class setChain extends ActionChain {
    async run(context, { scope, field, value, lineId }) {
      const v = context.$page.variables;
      if (scope === 'header') {
        if (field === 'attendees') { v.attendeesText = value; v.meeting.attendees = String(value || '').split(',').map((s) => s.trim()).filter(Boolean); }
        else v.meeting[field] = value;
        v.dirty = true;
      } else if (scope === 'line') {
        const l = (v.meeting.lines || []).filter((x) => x.id === lineId)[0];
        if (l) {
          if (field === 'jiraKey') { l.jiraKey = String(value || '').trim().toUpperCase(); l.generic = !l.jiraKey; }
          else l[field] = value;
        }
        v.dirty = true;
      } else if (scope === 'settings') { v.settingsForm[field] = value; }
      else if (scope === 'ai') { const f = Object.assign({}, v.aiForm); f[field] = value; v.aiForm = f; } // reassign so the model list of values follows the provider
      else if (scope === 'email') { v.email[field] = value; }
      else if (scope === 'ui') { v[field] = value; }
    }
  }
  return setChain;
});
