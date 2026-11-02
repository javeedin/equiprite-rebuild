define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/shellBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  // Opens the request another screen handed over (Requests: "Open in Picking & shipping"), once the list has loaded,
  // so it is plain to see: the stage, yard and search are cleared and its section unfolded (whatever was chosen
  // before would hide it), it opens beside the list, and its row is scrolled to and flashes. A note above the list
  // says it came from there, and what else on it waits for Confirm. A request that is not in the yard's queue yet
  // (its pieces have their unit but are not confirmed, so there is no transfer order) gets a note that says so, and
  // where to confirm it, instead of a toast that is easily missed.
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
          tone: 'wait', id: String(what.id || ''), number, confirm,
          title: (number || 'That request') + ' is not in the yard\'s queue yet',
          text: confirm
            ? 'Its ' + pieces(confirm) + ' with the unit assigned ' + (confirm === 1 ? 'waits' : 'wait') + ' for the Equipment Manager to confirm for picking: '
              + 'Confirm Request, in Old EquipRite\'s request detail, creates the transfer order in Fusion. Then ' + (confirm === 1 ? 'it shows' : 'they show') + ' here, to release and pick.'
            : 'Nothing on it waits at the yard now. Open the request to see where each piece is.',
        };
        return;
      }
      const id = String(rec.eqrEquipmentRequestId);
      v.stage = 'all';
      v.yard = 'all';
      v.text = '';
      const search = document.getElementById('ydSearch');
      if (search) search.value = '';
      const item = (v.items || []).filter((it) => String(it.id) === id)[0];
      if (item && v.collapsed && v.collapsed[item.section]) v.collapsed = Object.assign({}, v.collapsed, { [item.section]: false });
      await Actions.callChain(context, { chain: 'applyChain' });
      if (String(v.openId) !== id) {
        await Actions.callChain(context, { chain: 'openWorkChain', params: { id, keepBanner: false } });
      }
      v.handed = {
        tone: 'ok', id, number: rec.requestNumber, confirm,
        title: rec.requestNumber + ', from Requests',
        text: 'Highlighted in the list and open beside it.'
          + (confirm ? ' Not here yet: ' + confirm + ' more ' + (confirm === 1 ? 'piece' : 'pieces') + ' on it, with the unit assigned, waiting for Confirm (the transfer order).' : ''),
      };
      v.flashId = id;
      setTimeout(() => {
        const row = document.querySelector('.nx-yd-row[data-id="' + id + '"]');
        if (row && row.scrollIntoView) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 60);
      await new Promise((r) => setTimeout(r, 2600));
      if (v.flashId === id) v.flashId = '';
    }
  }

  return focusChain;
});
