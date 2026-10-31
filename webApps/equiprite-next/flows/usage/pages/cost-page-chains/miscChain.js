define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/shellBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  // Charges, as New's Post costs miscChain keeps them:
  //   save    checks exactly the fields unprocessedProjectCosts needs, then POST createMiscTransaction (DRAFT, line id in
  //           the body, item date as a full instant) and reads the preview again (New's loadPreviewChain) so the charge
  //           renders from the database, ticked; nothing is sent to Fusion here, it is posted with the weeks
  //   delete  only a DRAFT charge, never a POSTED one (corrected by reversal instead); then reads again and names what
  //           was removed
  class miscChain extends ActionChain {
    async run(context, { action, field, value, key }) {
      const { $page } = context;
      const v = $page.variables;
      if (action === 'field') {
        if (!field) return;
        const draft = Object.assign({}, (v.misc && v.misc.draft) || {});
        draft[field] = field === 'quantity' || field === 'rawCost'
          ? (value === '' || value == null ? null : Number(value))
          : (value == null ? '' : String(value));
        v.misc = Object.assign({}, v.misc, { draft, error: '' });
        return;
      }
      if (action === 'delete') {
        await this.remove(context, key);
        return;
      }
      if (action !== 'save' || v.isSavingMisc || v.readOnly) return;

      const d = (v.misc && v.misc.draft) || {};
      const line = (v.misc && v.misc.line) || {};
      const problems = [];
      if (!d.expenditureType) problems.push('an expenditure type');
      if (!d.expenditureOrg) problems.push('an expenditure organization');
      if (!d.expItemDate) problems.push('an expenditure item date');
      if (!(Number(d.quantity) > 0)) problems.push('a quantity greater than zero');
      if (!(Number(d.rawCost) > 0)) problems.push('an amount greater than zero');
      if (problems.length) {
        v.misc = Object.assign({}, v.misc, { error: 'Enter ' + problems.join(', ') + '.' });
        return;
      }
      if (!line.requestLineId) {
        v.misc = Object.assign({}, v.misc, { error: 'This equipment has no request line on screen, so the charge cannot be attached to anything. Reload the page and try again.' });
        return;
      }
      v.isSavingMisc = true;
      let resp;
      try {
        resp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/createMiscTransaction',
          body: {
            requestLineId: Number(line.requestLineId),
            expenditureType: d.expenditureType,
            expenditureOrg: d.expenditureOrg,
            expenditureItemDate: String(d.expItemDate).slice(0, 10) + 'T00:00:00Z',
            quantity: Number(d.quantity),
            rawCost: Number(d.rawCost),
            currencyCode: d.currency || 'USD',
            comments: d.comments || '',
            status: 'DRAFT',
          },
        });
      } catch (e) {
        console.error('[miscChain] createMiscTransaction error:', e && e.message);
      }
      v.isSavingMisc = false;
      if (!resp || !resp.ok) {
        v.misc = Object.assign({}, v.misc, { error: 'Could not save the charge' + (resp && resp.status ? ' (HTTP ' + resp.status + ')' : '') + '.' });
        return;
      }
      v.panel = '';
      await Actions.callChain(context, { chain: 'loadRecordChain', params: { refresh: true, reread: 'preview' } });
      bus.toast(d.expenditureType + ' · $' + Number(d.rawCost).toLocaleString() + ' charge saved against ' + (line.equipmentName || 'this equipment')
        + '. It is a draft, ticked to post with the weeks.', 'info');
    }

    async remove(context, key) {
      const { $page } = context;
      const v = $page.variables;
      if (v.readOnly || v.isPosting) return;
      const all = v.rowsAll || [];
      const victim = all.find((r) => r.kind === 'misc' && r.rowKey === key);
      if (!victim || victim.status === 'POSTED' || !victim.miscId) return;
      const grp = all.find((r) => r.kind === 'group' && r.groupKey === victim.groupKey);
      const equipName = grp && grp.label ? grp.label : 'this equipment';
      // read now: the rows are replaced by the read that follows
      const what = (victim.expenditureType || 'Charge') + ' · $' + Number(victim.cost || 0).toLocaleString();
      v.postError = '';
      v.postNote = '';
      let resp;
      try {
        resp = await Actions.callRest(context, { endpoint: 'eqp-v1/deleteMiscTransactionById', uriParams: { id: Number(victim.miscId) } });
      } catch (e) {
        console.error('[miscChain] delete error:', e && e.message);
      }
      if (!resp || !resp.ok) {
        v.postError = 'Could not delete that charge' + (resp && resp.status ? ' (HTTP ' + resp.status + ')' : '') + '. It is still on the request.';
        return;
      }
      await Actions.callChain(context, { chain: 'loadRecordChain', params: { refresh: true, reread: 'preview' } });
      bus.toast(what + ' removed from ' + equipName + '.', 'info');
    }
  }

  return miscChain;
});
