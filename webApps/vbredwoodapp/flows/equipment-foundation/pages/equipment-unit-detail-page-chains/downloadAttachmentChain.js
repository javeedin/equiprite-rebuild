define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Download one attachment under its original file name.
  //
  // Mints a fresh common-service access URL for row.commonDocId, fetches the
  // bytes from OCI and saves them through a blob link - the only way to set
  // the file name, because OCI serves the object with no Content-Disposition.
  // The bucket answers CORS with *. This fetch goes to objectstorage, NOT to a
  // VB backend, so the proxy rewrite that breaks native fetch elsewhere in
  // this app does not apply. If it fails anyway, open the URL instead - the
  // user still gets the file, just not the name.
  class downloadAttachmentChain extends ActionChain {
    async run(context, { id }) {
      const { $page } = context;
      const all = ($page.variables.attRows || []).concat($page.variables.attInheritedRows || []);
      const row = all.find(r => r.id === id);
      if (!row) return;

      let url;
      try {
        const response = await Actions.callRest(context, {
          endpoint: 'commonService/getCommonDocumentAccessUrl',
          uriParams: { docId: Number(row.commonDocId) }
        });
        if (!response.ok || !response.body || !response.body.url) {
          throw new Error('Could not download the file (HTTP ' + response.status + ').');
        }
        url = response.body.url;
      } catch (e) {
        $page.variables.attNotice = { type: 'error', text: e.message };
        return;
      }

      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        const href = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = href;
        a.download = row.fileName || (row.name + '.' + String(row.fileType || '').toLowerCase());
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 30000);
      } catch (e) {
        console.warn('[downloadAttachmentChain] blob download failed, opening instead', e);
        window.open(url, '_blank', 'noopener');
      }
    }
  }

  return downloadAttachmentChain;
});
