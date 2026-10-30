define([
  'vb/action/actionChain',
  'resources/js/phoneLink',
  'resources/js/qrcode-generator',
], (ActionChain, phoneLink, qrcode) => {
  'use strict';

  // The toolbar's QR code: EquipRite Mobile on your phone (resources/js/phoneLink.js).
  //   toggle   opens or closes the panel (the other popups close); opening reads where a phone can open the app
  //   pick     the other way onto the phone (VBCS, or this PC over Wi-Fi), by key
  //   copy     the address, to send to yourself
  //   setup    in the desktop app: its "EquipRite on your phone" window, where the address is set up
  const EMPTY = { loading: false, options: [], sel: '', url: '', img: '', note: '', copied: false, desktop: false };

  class phoneChain extends ActionChain {
    async run(context, { action, key }) {
      const { $page, $application } = context;
      const v = $page.variables;
      const desktop = typeof window !== 'undefined' && !!(window.erpDesktop && window.erpDesktop.isDesktop);
      if (action === 'setup') {
        if (desktop && typeof window.erpDesktop.openPhone === 'function') await window.erpDesktop.openPhone();
        v.phoneOpen = false;
        return;
      }
      if (action === 'copy') {
        try { await navigator.clipboard.writeText(v.phone.url); } catch (e) { /* the address is on screen to copy by hand */ }
        v.phone = Object.assign({}, v.phone, { copied: true });
        setTimeout(() => { if (v.phone && v.phone.copied) v.phone = Object.assign({}, v.phone, { copied: false }); }, 1500);
        return;
      }
      if (action === 'pick') {
        const opt = (v.phone.options || []).filter((o) => o.key === key)[0];
        if (opt) v.phone = Object.assign({}, v.phone, { sel: opt.key, url: opt.url, img: phoneLink.image(qrcode, opt.url), copied: false });
        return;
      }
      v.phoneOpen = !v.phoneOpen;
      v.bellOpen = false;
      v.profileOpen = false;
      v.cartOpen = false;
      v.tabMenuOpen = false;
      v.showResults = false;
      if (!v.phoneOpen) return;
      const sel = v.phone && v.phone.sel;
      v.phone = Object.assign({}, EMPTY, { loading: true, desktop });
      let local = null;
      if (desktop) {
        try {
          const res = await fetch('/__phone', { credentials: 'same-origin' });
          local = res.ok ? await res.json() : null;
        } catch (e) {
          local = null;
        }
      }
      const options = phoneLink.options($application.variables.appUrls, local);
      const opt = options.filter((o) => o.key === sel)[0] || options[0];
      v.phone = Object.assign({}, EMPTY, {
        desktop, options,
        sel: opt ? opt.key : '',
        url: opt ? opt.url : '',
        img: opt ? phoneLink.image(qrcode, opt.url) : '',
        note: opt ? '' : (desktop
          ? 'Set it up once: paste EquipRite\'s VBCS address, or let a phone on this PC\'s Wi-Fi connect.'
          : 'EquipRite Mobile\'s address is not known here. Open EquipRite from VBCS to get its code.'),
      });
    }
  }

  return phoneChain;
});
