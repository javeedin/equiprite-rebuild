define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/mobileBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  // What a screen asked for (mobileBus), a tap on the tab bar, or the connection changing:
  //   go          show a tab (only one this role has)
  //   focus       show a tab on one request (a deep link): bus.focus
  //   toast       a toast over the tab bar
  //   badge       the count on a tab's icon
  //   connection  online / offline
  const SCROLLED = {};

  class shellRequestChain extends ActionChain {
    async run(context, { request, action, tab, id, number, online }) {
      const v = context.$page.variables;
      const r = request || { action, tab, online };
      if (r.action === 'go') {
        if (!(v.tabBar || []).some((t) => t.id === r.tab) || r.tab === v.currentTab) return;
        // Each tab keeps its place: where the page was scrolled to comes back with the tab.
        SCROLLED[v.currentTab] = typeof window !== 'undefined' ? window.scrollY : 0;
        v.currentTab = r.tab;
        if (typeof window !== 'undefined') {
          const y = SCROLLED[r.tab] || 0;
          window.requestAnimationFrame(() => window.scrollTo(0, y));
        }
        return;
      }
      if (r.action === 'focus') {
        bus.focus(r.tab, { id: id ? Number(id) : undefined, number: number || '' });
        return;
      }
      if (r.action === 'toast') {
        await Actions.callChain(context, { chain: 'toastChain', params: { message: r.message, tone: r.tone } });
        return;
      }
      if (r.action === 'badge') {
        v.badges = Object.assign({}, v.badges, { [r.tab]: Number(r.count) || 0 });
        return;
      }
      if (r.action === 'connection') {
        v.online = r.online === true || r.online === 'true';
        await Actions.callChain(context, { chain: 'toastChain', params: {
          message: v.online ? 'Back online.' : 'No connection: what you see may be out of date, and nothing can be sent until it is back.',
          tone: v.online ? 'info' : 'warning' } });
      }
    }
  }

  return shellRequestChain;
});
