define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/costPosting',
  'resources/js/shellBus',
], (ActionChain, Actions, costPosting, bus) => {
  'use strict';

  /*
   * Post the ticked weeks and charges to Fusion PPM: New EquipRite's Post costs postSelectedChain, step for step
   * (resources/js/costPosting.js post, which makes New's calls in New's order):
   *
   *   1 RECORD  each ticked postable week (not posted, not reversed): ONE ledger call, createPostedWeek, or
   *             createPostedWeekSplit for a week with a saved split of 2+ projects; the body is New's ledgerBody. The
   *             ticked charges: ONE postMiscTransactions { ids } (all or nothing)
   *   2 SEND    only if something was recorded: the OIC flow for the request (postCostToFusion.post: project URL, then
   *             v1 on a 404). A failure here is not a lost post (the next post sends it) and is said as a warning
   *   3 read the record again: New's loadPreviewChain then listChain (loadRecordChain reread 'post'); the cards follow
   *
   * New's guards, kept: only the confirmation can post (it says exactly what will be written and sent), a second click
   * while posting does nothing, a role that may only look cannot post, a posted / reversed / not-yet-ended week is never
   * sent, a split that is not saved or sits on a PR line posts whole, and the ledger's unique keys make a re-post benign.
   * Next adds: one post at a time per request (costPosting.claim), the lines just recorded are posted on screen at once
   * (so nothing is sent twice if the read fails), each line's progress and result in words, and the tab asks before it
   * is closed while posting (bus.guard).
   *
   *   step 'go'     post (from the confirmation; anywhere else it only opens it, as New's Post outside the review)
   *   step 'close'  close the confirmation or the result (never while posting)
   */
  class postChain extends ActionChain {
    async run(context, { step }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      if (step === 'close') {
        if (!v.isPosting) v.panel = '';
        return;
      }
      if (v.isPosting || v.readOnly) return;
      if (v.panel !== 'post' || !v.post || v.post.step !== 'ask') {
        if (fns.selection(v.rowsAll).items) {
          v.post = { step: 'ask' };
          v.panel = 'post';
        } else {
          v.panel = '';
        }
        return;
      }
      const cur = Object.assign({}, v.row || {});
      const all = v.rowsAll || [];
      const toPost = fns.weeksToPost(all);
      const selMisc = fns.miscToPost(all);
      if (!toPost.length && !selMisc.length) return;
      if (!costPosting.claim(cur.requestNumber)) return;

      const tabId = 'cost:' + (v.id ? v.id : v.number);
      v.isPosting = true;
      v.postError = '';
      v.postNote = '';
      v.post = { step: 'posting', lines: [], charges: null, fusion: {} };
      bus.guard(tabId, 'Costs of ' + (cur.requestNumber || 'this request') + ' are being posted to Fusion PPM; closing the tab now could leave them half sent.');
      let res = null;
      try {
        res = await costPosting.post(context, Actions, {
          rows: all,
          row: cur,
          onProgress: (p) => { v.post = Object.assign({ step: 'posting' }, p); },
        });
        const done = { step: 'done', lines: res.lines, charges: res.charges, fusion: res.fusion, summary: res.summary, tone: res.tone };
        if (res.recorded) {
          const marked = costPosting.markPosted(v.rowsAll || all, res);
          v.rowsAll = marked;
          v.post = Object.assign({}, done, { rereading: true });
          await Actions.callChain(context, { chain: 'loadRecordChain', params: { refresh: true, reread: 'post' } });
          costPosting.announce(cur.requestNumber);
        }
        v.post = done;
        v.result = { summary: res.summary, tone: res.tone, lines: res.lines, charges: res.charges, fusion: res.fusion, number: cur.requestNumber };
        if (res.tone === 'error') v.postError = res.summary;
        bus.toast(res.summary, res.tone === 'ok' ? 'info' : (res.tone === 'warn' ? 'warning' : 'error'));
      } catch (e) {
        console.error('[postChain] failed', e);
        v.post = { step: 'done', lines: res ? res.lines : [], charges: null, fusion: {}, summary: 'The post stopped: ' + ((e && e.message) || e) + '. Read the costs again before posting.', tone: 'error' };
        v.postError = v.post.summary;
      } finally {
        try { v.isPosting = false; } catch (e2) { /* page left */ }
        bus.guard(tabId, null);
        costPosting.release(cur.requestNumber);
      }
    }
  }

  return postChain;
});
