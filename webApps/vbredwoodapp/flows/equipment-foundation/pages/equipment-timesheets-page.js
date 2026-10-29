define([], () => {
  'use strict';

  const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  class PageModule {
    formatWeekLabel(startStr, endStr) {
      if (!startStr || !endStr) return '';
      const s = new Date(startStr + 'T00:00:00Z');
      const e = new Date(endStr   + 'T00:00:00Z');
      const sm = MONTH_SHORT[s.getUTCMonth()];
      const em = MONTH_SHORT[e.getUTCMonth()];
      const sy = s.getUTCFullYear();
      const ey = e.getUTCFullYear();
      const label = sm === em && sy === ey
        ? sm + ' ' + s.getUTCDate() + ' – ' + e.getUTCDate() + ', ' + ey
        : sm + ' ' + s.getUTCDate() + ' – ' + em + ' ' + e.getUTCDate() + ', ' + ey;
      return label;
    }

    formatCurrency(value) {
      if (value == null) return '—';
      return '$' + Number(value).toLocaleString();
    }
  }

  return PageModule;
});
