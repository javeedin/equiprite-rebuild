define([
  'require',
  'vb/action/actionChain',
], (localRequire, ActionChain) => {
  'use strict';

  // The pick slip: make, print, download, close. Making it is New's PrintPickSlipChain: resources/js/pickSlip (copied
  // unchanged; jsPDF from the CDN, loaded only now) over the workspace's lines, so only released pieces print, in
  // walking order by subinventory and locator; the header names the single ticked transfer order. A document only:
  // nothing is read or written, and a slip that cannot be made says so and changes nothing else.
  const loadPickSlip = () => new Promise((resolve, reject) => localRequire(['resources/js/pickSlip'], resolve, reject));

  class pickSlipChain extends ActionChain {
    async run(context, { action }) {
      const { $page } = context;
      const v = $page.variables;
      if (action === 'print') {
        if (!$page.functions.printSlip()) v.banner = { type: 'warning', text: 'The pick slip could not be printed from here: download it and print the file.' };
        return;
      }
      if (action === 'download') { $page.functions.downloadSlip(v.slip.url, v.slip.fileName); return; }
      if (action === 'close') {
        if (v.slip.url) { try { URL.revokeObjectURL(v.slip.url); } catch (e) { /* already gone */ } }
        v.slip = { url: '', fileName: '', docNumber: '', rows: 0 };
        return;
      }
      if (v.busy) return;
      const request = v.work.req || {};
      const lines = Array.isArray(v.work.lines) ? v.work.lines : [];
      v.busy = 'slip';
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
      } catch (e) {
        console.error('[pickSlipChain] generation failed:', e);
        v.banner = { type: 'warning', text: 'The pick slip could not be made (' + ((e && e.message) || 'its PDF library did not load') + '). Nothing else changed: try again.' };
      } finally {
        v.busy = '';
      }
    }
  }

  return pickSlipChain;
});
