define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/rateCompare',
], (ActionChain, Actions, RC) => {
  'use strict';

  // What is compared: pick or unpick a schedule (toggle, remove; at most rateCompare.MAX), make one the base (base), or
  // change how they are compared (opt: mode, period, text, onlyDiff, days, hours, qty). Then linesChain compares again.
  const NUMBERS = ['days', 'hours', 'qty'];

  class pickChain extends ActionChain {
    async run(context, { act, field, value }) {
      const v = context.$page.variables;
      const picked = JSON.parse(JSON.stringify(v.picked || [])).map(String);
      if (act === 'toggle' || act === 'remove') {
        if (act === 'remove' && picked.indexOf(String(value)) === -1) return;
        v.picked = RC.toggle(picked, value);
      } else if (act === 'base') {
        v.picked = RC.makeBase(picked, value);
      } else if (act === 'opt') {
        const opts = JSON.parse(JSON.stringify(v.opts || {}));
        if (NUMBERS.indexOf(field) !== -1) opts[field] = value === '' || value == null ? '' : Math.max(field === 'qty' ? 1 : 0, Number(value) || 0);
        else if (field === 'onlyDiff') opts.onlyDiff = value === true || value === 'true';
        else opts[field] = value == null ? '' : String(value);
        if (field === 'mode') opts.period = '';
        v.opts = opts;
      } else {
        return;
      }
      await Actions.callChain(context, { chain: 'linesChain' });
    }
  }

  return pickChain;
});
