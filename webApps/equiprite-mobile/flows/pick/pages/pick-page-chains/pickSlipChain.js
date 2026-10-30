define([
  'require',
  'vb/action/actionChain',
  'resources/js/mobileBus',
], (localRequire, ActionChain, bus) => {
  'use strict';

  // The pick slip: make, share, download, close. Making it is Next's pickSlipChain (New's PrintPickSlipChain):
  // resources/js/pickSlip (jsPDF, an app-flow.json requirejs path, loaded only now) over the pick list's lines, so only
  // released pieces print, in walking order by subinventory and locator; the header names the single ticked transfer
  // order. A document only: nothing is read or written, and a slip that cannot be made says so and changes nothing else.
  // On a phone the slip goes to the share sheet (print, mail, a chat) where the phone can hand over a file, else it
  // downloads. Shown only where Next shows it (SHIPPING_DOCUMENTS_ENABLED, and something released), and not from a copy
  // saved on the phone (it would read like the current one).
  const loadPickSlip = () => new Promise((resolve, reject) => localRequire(['resources/js/pickSlip'], resolve, reject));

  class pickSlipChain extends ActionChain {
    async run(context, { action }) {
      const { $page } = context;
      const v = $page.variables;
      if (action === 'download') {
        if ($page.functions.downloadSlip(v.slip.url, v.slip.fileName)) bus.toast('Pick slip ' + v.slip.docNumber + ' downloaded.', 'info');
        return;
      }
      if (action === 'share') {
        const r = await $page.functions.shareSlip(v.slip.url, v.slip.fileName, 'Pick slip ' + v.slip.docNumber);
        if (!r.ok && !r.cancelled && $page.functions.downloadSlip(v.slip.url, v.slip.fileName)) {
          bus.toast('This phone could not share it: the pick slip was downloaded instead.', 'info');
        }
        return;
      }
      if (action === 'close') {
        if (v.slip.url) { try { URL.revokeObjectURL(v.slip.url); } catch (e) { /* already gone */ } }
        v.slip = { url: '', fileName: '', docNumber: '', rows: 0 };
        v.sheet = '';
        return;
      }
      if (v.busy) return;
      if (!v.can.slip || !v.check.released) return;
      if (v.workSaved) {
        v.banner = { type: 'warning', text: 'The pick slip is made from a fresh read of the request: refresh it with a connection first.' };
        return;
      }
      const request = v.work.req || {};
      const lines = Array.isArray(v.work.lines) ? v.work.lines : [];
      v.busy = 'slip';
      let made = false;
      try {
        const pickSlip = await loadPickSlip();
        const selectedTO = (v.work.tos || []).filter((t) => String(t.value) === String(v.selectedTOId))[0] || null;
        const model = pickSlip.buildModel({
          requestNumber: request.requestNumber,
          toNumber: selectedTO ? selectedTO.orderNumber : '',
          yard: [...new Set(lines.map((l) => l.yard).filter((y) => y != null && String(y).trim() !== ''))].join(', '),
          project: request.party,
          neededByDate: request.start,
        }, lines, new Date());
        const pdf = pickSlip.buildPickSlipPdf(model);
        if (v.slip.url) { try { URL.revokeObjectURL(v.slip.url); } catch (e) { /* already gone */ } }
        v.slip = { url: pickSlip.toBlobUrl(pdf.base64), fileName: pdf.fileName, docNumber: pdf.docNumber, rows: pdf.rowCount };
        made = true;
      } catch (e) {
        console.error('[pickSlipChain] generation failed:', e);
        v.banner = { type: 'warning', text: 'The pick slip could not be made (' + ((e && e.message) || 'its PDF library did not load') + '). Nothing else changed: try again.' };
      } finally {
        v.busy = '';
      }
      if (made) v.sheet = 'slip';
    }
  }

  return pickSlipChain;
});
