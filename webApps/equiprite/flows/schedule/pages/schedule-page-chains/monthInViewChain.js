define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // The user scrolled the timeline: the band's month follows (raised by the page module as scheduleMonthInView).
  class monthInViewChain extends ActionChain {
    async run(context, { month }) {
      const { $page } = context;
      if (/^\d{4}-\d{2}$/.test(String(month || ''))) {
        $page.variables.viewMonth = String(month);
      }
    }
  }

  return monthInViewChain;
});
