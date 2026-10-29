define(['resources/js/customerPortal'], (portal) => {
  'use strict';

  // Customer portal home (wireframe: Portal home; replaces customer-dashboard). What needs the customer first, then
  // the figures, their latest requests with a parcel-style tracker, and what is on their sites now.

  /** First name, capitalised, from the identity fields (priya.raman@x → Priya). */
  function firstName(user) {
    const fields = ['fullName', 'displayName', 'name', 'login', 'userName', 'username', 'preferred_username', 'email'];
    let raw = '';
    for (let i = 0; i < fields.length && !raw; i++) {
      const v = user && user[fields[i]];
      if (v && typeof v === 'string' && v.trim()) raw = v.trim();
    }
    const word = raw.split('@')[0].split(/[\s._-]+/).filter((p) => /[a-z]/i.test(p))[0] || '';
    return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : '';
  }

  class PageModule {
    /** "Good morning, Priya" by the hour; "Welcome" without a name. */
    greeting(user, now) {
      const h = (now && typeof now.getHours === 'function' ? now : new Date()).getHours();
      const part = h < 12 ? 'Good morning' : (h < 18 ? 'Good afternoon' : 'Good evening');
      const n = firstName(user);
      return n ? part + ', ' + n : 'Welcome';
    }

    /** Staff using the portal for customers (the "acting on behalf" banner). */
    actsForCustomers(map, loaded) { return portal.actsForCustomers(map, loaded); }

    statusText(s) { return portal.statusText(s); }
    statusClass(s) { return portal.statusClass(s); }
    dateRange(a, b) { return portal.dateRange(a, b); }
    money(n) { return portal.money(n); }
    day(v) { return portal.day(v, true); }

    /** The mini tracker of a list row (header status only). */
    steps(status, info) { return portal.trackSteps(status, [], info || {}); }

    /** "3 requests · 1 waiting for you" under the title. */
    summary(kpis, todoCount, loading) {
      if (loading) return 'Loading your requests…';
      const k = kpis || {};
      const parts = [(k.active || 0) + (k.active === 1 ? ' active request' : ' active requests')];
      parts.push(todoCount ? todoCount + (todoCount === 1 ? ' thing needs you' : ' things need you') : 'nothing needs you right now');
      return parts.join(' · ');
    }

    /** Requests with equipment on site, most items first: [{ id, requestNumber, count, endDate, customerName }]. */
    onSite(requests, deployedById) {
      const by = deployedById || {};
      return (Array.isArray(requests) ? requests : [])
        .filter((r) => Number(by[r.id] || 0) > 0)
        .map((r) => ({ id: r.id, requestNumber: r.requestNumber, count: Number(by[r.id]), endDate: r.endDate, customerName: r.customerName }))
        .sort((a, b) => b.count - a.count);
    }
  }

  return PageModule;
});
