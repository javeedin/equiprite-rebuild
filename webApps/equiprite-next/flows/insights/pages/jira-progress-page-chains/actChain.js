define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraProgress',
  'resources/js/shellBus',
], (ActionChain, Actions, JP, bus) => {
  'use strict';

  // Daily progress: the window (7, 14, 30, 60 days: read again), working days only, a day shown (a column, or the day
  // before / after), a story opened in Jira stories (its drawer), the window or the day copied as text.
  const copy = async (text) => {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* fall back */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  };
  let said = null;
  class actChain extends ActionChain {
    async run(context, { act, key, value }) {
      const v = context.$page.variables;
      const shown = () => ((v.prog && v.prog.days) || []).filter((d) => !v.workOnly || !d.weekend);
      if (act === 'days') {
        const n = Number(key) || 14;
        if (n === v.days && v.prog && !v.custom) return;
        v.days = n;
        v.custom = false;
        await Actions.callChain(context, { chain: 'loadChain' });
        return;
      }
      // From – To: a day picked in either box; From alone runs to today; read once both are days
      if (act === 'date') {
        const day = /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
        if (!day) return;
        const today = JP.dayKey(Date.now());
        if (key === 'from') v.from = day; else v.to = day > today ? today : day;
        if (!v.to) v.to = today;
        if (v.from > v.to) { const x = v.from; v.from = v.to; v.to = x; }
        const span = Math.round((JP.parseDay(v.to) - JP.parseDay(v.from)) / 86400000) + 1;
        if (span > JP.MAX_SPAN) { v.error = 'Choose at most ' + JP.MAX_SPAN + ' days (about three months): the chart shows a column a day.'; return; }
        v.error = '';
        v.custom = true;
        await Actions.callChain(context, { chain: 'loadChain' });
        return;
      }
      if (act === 'clearDates') {
        v.custom = false;
        await Actions.callChain(context, { chain: 'loadChain' });
        return;
      }
      if (act === 'work') {
        v.workOnly = !v.workOnly;
        const l = shown();
        if (l.length && !l.some((d) => d.key === v.sel)) v.sel = l[l.length - 1].key;
        return;
      }
      if (act === 'day') { if (v.sel !== String(key || '')) v.move = ''; v.sel = String(key || ''); return; }
      // a status movement of the day: its stories shown (again: hidden)
      if (act === 'move') { v.move = !key || v.move === key ? '' : String(key); return; }
      if (act === 'prev' || act === 'next') {
        const l = shown();
        const i = l.findIndex((d) => d.key === v.sel);
        const j = i === -1 ? l.length - 1 : i + (act === 'prev' ? -1 : 1);
        if (l[j]) { v.sel = l[j].key; v.move = ''; }
        return;
      }
      if (act === 'open' && key) { bus.focus('jira', { key: String(key) }); return; }
      if (act === 'copyAll' || act === 'copyDay') {
        if (!v.prog) return;
        const day = v.prog.days.filter((d) => d.key === v.sel)[0] || v.prog.days[v.prog.days.length - 1];
        const text = act === 'copyAll' ? JP.periodText(v.prog, JP.PROJECT, Object.assign((v.stuck || []).slice(), { more: !!v.stuckMore })) : JP.dayText(day, JP.PROJECT);
        const ok = await copy(text);
        v.copied = ok ? (act === 'copyAll' ? 'Copied: ' + JP.windowText(v.prog) + ', as text — paste it into a chat or an email.' : 'Copied: ' + day.long + ', as text.') : 'Could not copy here: select the text in the table instead.';
        if (said) clearTimeout(said);
        said = setTimeout(() => { v.copied = ''; }, 6000);
      }
    }
  }
  return actChain;
});
