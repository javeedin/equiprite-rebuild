define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // View / open / close one attachment in the dialog's detail view.
  //
  //   action 'view'    switch to the detail view and mint an access URL for the
  //                    preview (PDF in an iframe, image inline, else facts only)
  //   action 'newtab'  open the file in a new browser tab
  //   action 'close'   back to the list
  //
  // The row is looked up in the page's own attachments AND, on a serial page,
  // in the master's (attInheritedRows) - both can be viewed.
  //
  // The URL is a common-service PAR for row.commonDocId, valid 15 minutes,
  // minted per view and never stored. OCI serves it with the file's content
  // type and no Content-Disposition, so a PDF renders inline. 'newtab' calls
  // window.open with no await in front of it when the URL is fresh, so the
  // popup blocker lets it through; an older URL is re-minted first.
  const REMINT_AFTER_MS = 10 * 60 * 1000;

  async function mintUrl(context, commonDocId) {
    const response = await Actions.callRest(context, {
      endpoint: 'commonService/getCommonDocumentAccessUrl',
      uriParams: { docId: Number(commonDocId) }
    });
    if (!response.ok || !response.body || !response.body.url) {
      throw new Error('Could not open the file (HTTP ' + response.status + ').');
    }
    return response.body.url;
  }

  class viewAttachmentChain extends ActionChain {
    async run(context, { id, action }) {
      const { $page } = context;

      if (action === 'close') {
        $page.variables.attViewer = {};
        $page.variables.attMode = 'list';
        return;
      }

      if (action === 'newtab') {
        const v = $page.variables.attViewer || {};
        if (!v.row) return;
        let url = v.url;
        if (!url || !v.mintedAt || (Date.now() - v.mintedAt) > REMINT_AFTER_MS) {
          try {
            url = await mintUrl(context, v.row.commonDocId);
            $page.variables.attViewer = Object.assign({}, v, { url: url, mintedAt: Date.now() });
          } catch (e) {
            $page.variables.attNotice = { type: 'error', text: e.message };
            return;
          }
        }
        window.open(url, '_blank', 'noopener');
        return;
      }

      const all = ($page.variables.attRows || []).concat($page.variables.attInheritedRows || []);
      const row = all.find(r => r.id === id);
      if (!row) return;

      $page.variables.attNotice = {};
      $page.variables.attViewer = { row: row, loading: true };
      $page.variables.attMode = 'detail';
      try {
        const url = await mintUrl(context, row.commonDocId);
        $page.variables.attViewer = { row: row, url: url, mintedAt: Date.now(), loading: false };
      } catch (e) {
        console.error('[viewAttachmentChain]', e);
        $page.variables.attViewer = { row: row, loading: false, error: e.message };
      }
    }
  }

  return viewAttachmentChain;
});
