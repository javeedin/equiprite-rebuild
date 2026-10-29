define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /*
   * Save a miscellaneous charge against one equipment line.
   *
   * Writes a DRAFT row to EQR_LINE_MISC_TXN via POST
   * /request-lines/{id}/misc-transactions, then re-reads the page so the charge
   * renders from the DB exactly as it will after a refresh. There is no local
   * echo of the saved row: the server owns the id, the status and the stored
   * values, and a client-side copy is how the two drift apart.
   *
   * The charge is NOT sent to Fusion here, and posting it later does not send it
   * either — /misc-transactions/post flips STATUS to POSTED in our DB, matching
   * what postSelectedChain does for rental weeks. See
   * misc-transactions/BACKEND_HANDOFF_misc_transactions.md §0.
   */
  class saveMiscChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const d    = $page.variables.miscDraft || {};
      const line = $page.variables.miscDrawerLine || {};

      // ── validate ───────────────────────────────────────────────────────────
      // Exactly the fields unprocessedProjectCosts needs from the user. Everything
      // else in the payload is derived: project/task/BU from the page, transaction
      // source/document/entry from BU config, batch + reference generated.
      const problems = [];
      if (!d.expenditureType)          problems.push('an expenditure type');
      if (!d.expenditureOrg)           problems.push('an expenditure organization');
      if (!d.expItemDate)              problems.push('an expenditure item date');
      if (!(Number(d.quantity) > 0))   problems.push('a quantity greater than zero');
      if (!(Number(d.rawCost) > 0))    problems.push('an amount greater than zero');

      if (problems.length) {
        $page.variables.miscFormError = 'Enter ' + problems.join(', ') + '.';
        return;
      }
      $page.variables.miscFormError = '';

      if (!line.requestLineId) {
        $page.variables.miscFormError = 'This equipment has no request line on screen, '
          + 'so the charge cannot be attached to anything. Reload the page and try again.';
        return;
      }

      $page.variables.isSavingMisc = true;

      let resp;
      try {
        resp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/createMiscTransaction',
          body: {
            // Flat path with the line id in the body, matching /posted-weeks and
            // /line-day-exceptions — the two other Post Cost line-child writes.
            requestLineId:       Number(line.requestLineId),
            // These map 1:1 onto EQR_LINE_MISC_TXN columns and, from there, onto
            // the unprocessedProjectCosts payload when Fusion is wired.
            expenditureType:     d.expenditureType,        // -> _EXPENDITURE_TYPE_ID_Display
            expenditureOrg:      d.expenditureOrg,         // -> _ORGANIZATION_ID_Display
            // Send the full ISO instant: the backend binds OffsetDateTime -> LocalDate,
            // the same way weekStartDate does on /posted-weeks.
            expenditureItemDate: String(d.expItemDate).slice(0, 10) + 'T00:00:00Z',
            quantity:            Number(d.quantity),       // -> Quantity
            rawCost:             Number(d.rawCost),        // -> RawCostInTransactionCurrency
            currencyCode:        d.currency || 'USD',      // -> TransactionCurrencyCode
            comments:            d.comments || '',
            // Sent explicitly rather than left to the column default: an omitted
            // field suppresses Lombok's @Builder.Default and writes NULL into a
            // NOT NULL column, which surfaces as a bare "Data integrity violation".
            status:              'DRAFT'
          }
        });
      } catch (e) {
        console.error('[saveMisc] createMiscTransaction error:', e && e.message);
      }

      $page.variables.isSavingMisc = false;

      if (!resp || !resp.ok) {
        $page.variables.miscFormError = 'Could not save the charge'
          + (resp && resp.status ? ' (HTTP ' + resp.status + ')' : '')
          + '. If this is a "not found" error, the misc-transactions endpoint is not '
          + 'deployed yet — see MD/Post Cost/misc-transactions/BACKEND_HANDOFF_misc_transactions.md.';
        return;
      }

      $page.variables.isMiscDrawerOpen = false;

      // Re-read rather than splice a local copy in: the row now exists server-side
      // with an id, and the ledger/view is authoritative for every figure on this
      // page. Same discipline postSelectedChain uses after a successful post.
      try {
        await Actions.callChain(context, { chain: 'vbEnterChain' });
      } catch (e) {
        console.warn('[saveMisc] refresh chain failed:', e && e.message);
      }

      await Actions.fireNotificationEvent(context, {
        summary: 'Charge saved',
        message: d.expenditureType + ' · $' + Number(d.rawCost).toLocaleString()
               + ' saved against ' + (line.equipmentName || 'this equipment')
               + '. It is a Draft until you post it.',
        type: 'confirmation',
      });
    }
  }

  return saveMiscChain;
});
