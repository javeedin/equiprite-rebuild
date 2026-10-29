define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/currentUser',
], (ActionChain, Actions, cu) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/updateAttachmentCategoryChain.js. Unchanged except the
  // dialog: the old dialog is an inline editor in its section (shown while its is…Open flag is true).

  // Save the edit dialog: label, where it is used, whether it needs dates and
  // the default validity. The code is not sent - it is permanent.
  //
  // Changing "Used on" or "Valid dates" does NOT change documents already
  // filed under the category; the new rules apply to new uploads and edits.
  class updateAttachmentCategoryChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const e = $page.variables.EditAttCat || {};
      const label = String(e.categoryLabel || '').trim();
      const needsDates = e.validityRequired === 'Y';

      const warn = (summary, message) => Actions.fireNotificationEvent(context, {
        summary: summary, message: message, displayMode: 'transient', type: 'warning'
      });
      if (!label) { await warn('Name required', 'The category needs a name.'); return; }
      let months = e.defaultValidityMonths;
      months = (needsDates && months !== null && months !== undefined && months !== '') ? Number(months) : null;
      if (months !== null && (!Number.isInteger(months) || months <= 0)) {
        await warn('Check "Usually valid for"', 'Enter a whole number of months, or leave it empty.');
        return;
      }

      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/patchAttachmentCategory',
        uriParams: { id: Number(e.id) },
        headers: cu.auditHeaders(context),
        body: {
          categoryLabel: label,
          appliesTo: e.appliesTo || 'BOTH',
          validityRequired: needsDates ? 'Y' : 'N',
          defaultValidityMonths: months,
          objectVersionNumber: e.objectVersionNumber
        }
      });

      if (result.ok) {
        $page.variables.isAttEditOpen = false;
        await Actions.callChain(context, { chain: 'loadAttachmentCategoriesChain' });
        await Actions.fireNotificationEvent(context, {
          summary: 'Category saved', message: '"' + label + '" was updated.',
          displayMode: 'transient', type: 'confirmation'
        });
      } else {
        const b = result.body || {};
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not save category',
          message: result.status === 409
            ? 'Someone else changed this category since you opened it. Close and reopen it, then try again.'
            : (b.message || b.detail || ('HTTP ' + result.status)),
          displayMode: 'transient', type: 'error'
        });
      }
    }
  }

  return updateAttachmentCategoryChain;
});
