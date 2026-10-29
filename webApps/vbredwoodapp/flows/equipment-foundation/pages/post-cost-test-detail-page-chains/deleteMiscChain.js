define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /*
   * Remove a DRAFT miscellaneous charge. The control carries its key in
   * id="miscdel-<rowKey>".
   *
   * A POSTED charge is never removable — the delete affordance is not rendered
   * for one, the guard below refuses it, and the endpoint answers 409. Three
   * layers because deleting posted money is unrecoverable from this screen;
   * correcting it is the reverse → credit → repost path the week rows use.
   */
  class deleteMiscChain extends ActionChain {
    async run(context, { event }) {
      const { $page } = context;

      let el = event && event.target;
      while (el && !(el.id && el.id.indexOf('miscdel-') === 0)) { el = el.parentElement; }
      if (!el) return;
      const rowKey = el.id.replace('miscdel-', '');

      const all = $page.variables.rowsAll || [];
      const victim = all.find(function (r) { return r.kind === 'misc' && r.rowKey === rowKey; });
      if (!victim || victim.status === 'POSTED' || !victim.miscId) return;

      // Read the equipment name off the group row before the refresh rebuilds
      // everything — the misc row itself only carries its groupKey.
      const grp = all.find(function (r) { return r.kind === 'group' && r.groupKey === victim.groupKey; });
      const equipName = (grp && grp.label) ? grp.label : 'this equipment';

      // Clear any banner left over from an earlier post, or a stale "Posted 1 charge"
      // message sits above a table that no longer contains it.
      $page.variables.postError = '';
      $page.variables.postSuccess = '';

      let resp;
      try {
        resp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/deleteMiscTransactionById',
          uriParams: { id: Number(victim.miscId) }
        });
      } catch (e) {
        console.error('[deleteMisc] error:', e && e.message);
      }

      if (!resp || !resp.ok) {
        $page.variables.postError = 'Could not delete that charge'
          + (resp && resp.status ? ' (HTTP ' + resp.status + ')' : '')
          + '. It is still on the request.';
        return;
      }

      // Re-read instead of splicing locally, so the equipment total, the misc
      // header count and the header chips all come back from one source.
      try {
        await Actions.callChain(context, { chain: 'vbEnterChain' });
      } catch (e) {
        console.warn('[deleteMisc] refresh chain failed:', e && e.message);
      }

      // Say what was removed. The row is now a real database record, not page state,
      // and a mis-click deletes it for good — so a row silently vanishing is not
      // acceptable feedback. Naming the amount also makes a wrong deletion obvious
      // immediately, while re-entering it is still trivial.
      await Actions.fireNotificationEvent(context, {
        summary: 'Charge removed',
        message: (victim.expenditureType || 'Charge') + ' · $'
               + Number(victim.cost || 0).toLocaleString() + ' removed from '
               + equipName + '.',
        type: 'confirmation'
      });
    }
  }

  return deleteMiscChain;
});
