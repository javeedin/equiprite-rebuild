define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/shellBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  // Opens the request another screen handed over (Requests' "Open in Picking & shipping", the request's tab), once the
  // list has loaded: its dialog opens in front, with the yard's steps and its pieces, and Back to the screen it came
  // from. Behind it the stage, yard and search are cleared and its section unfolded, so when the dialog closes the list
  // shows the request (scrolled to, flashing). A request that is not in the yard's queue yet (its pieces have their unit
  // but are not confirmed, so there is no transfer order) gets a note above the list that says so, with Confirm for
  // picking (confirmChain) for the Equipment Manager, instead of a toast that is easily missed.
  class focusChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      for (let i = 0; i < 600 && v.isLoading; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const what = bus.takeFocus('picking');
      if (!what) return;
      const number = what.number || '';
      const confirm = Number(what.confirm) || 0;
      const pieces = (n) => n + (n === 1 ? ' piece' : ' pieces');
      const rec = (v.records || []).filter((r) => (what.id && String(r.eqrEquipmentRequestId) === String(what.id))
        || (number && r.requestNumber === number))[0];
      if (!rec) {
        v.handed = {
          tone: 'wait', id: String(what.id || ''), number, confirm, end: what.end || '',
          title: (number || 'That request') + ' is not in the yard\'s queue yet',
          text: confirm
            ? 'Its ' + pieces(confirm) + ' with the unit assigned ' + (confirm === 1 ? 'waits' : 'wait') + ' to be confirmed for picking: confirming asks Fusion for '
              + 'the transfer order. Then ' + (confirm === 1 ? 'it shows' : 'they show') + ' here, to release and pick.'
            : 'Nothing on it waits at the yard now. Open the request to see where each piece is.',
        };
        return;
      }
      const id = String(rec.id || rec.eqrEquipmentRequestId);
      v.handed = { tone: '' };
      v.stage = 'all';
      v.yard = 'all';
      v.text = '';
      const search = document.getElementById('ydSearch');
      if (search) search.value = '';
      const item = (v.items || []).filter((it) => String(it.id) === id)[0];
      if (item && v.collapsed && v.collapsed[item.section]) v.collapsed = Object.assign({}, v.collapsed, { [item.section]: false });
      await Actions.callChain(context, { chain: 'applyChain' });
      v.from = what.from && what.from.label ? { label: String(what.from.label), open: what.from.open || null } : { label: '' };
      // Always read afresh, even when it is the one already open: what is on screen is then this request, as it is now.
      await Actions.callChain(context, { chain: 'openWorkChain', params: { id, keepBanner: false } });
    }
  }

  return focusChain;
});
