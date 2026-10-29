define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/currentUser',
], (ActionChain, Actions, cu) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/addAttachmentCategoryChain.js, unchanged.

  // Create an attachment category from the inline add panel, then reload.
  //
  // The user types only the friendly name; the stored code is derived from it
  // (uppercase, runs of anything else -> '_', max 30), the same way Agreement
  // Types does it. The code is PERMANENT - the backend rejects a change - so
  // only the label can be edited later.
  //
  // Default validity (months) only means something when the category needs
  // dates, so it is dropped otherwise.
  class addAttachmentCategoryChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const draft = $page.variables.NewAttCat || {};
      const label = String(draft.categoryLabel || '').trim();
      const needsDates = draft.validityRequired === 'Y';

      const warn = (summary, message) => Actions.fireNotificationEvent(context, {
        summary: summary, message: message, displayMode: 'transient', type: 'warning'
      });

      if (!label) {
        await warn('Name required', 'Enter a name for the category before adding it.');
        return;
      }
      const code = label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').substring(0, 30);
      if (!code) {
        await warn('Invalid name', 'The name must contain at least one letter or number.');
        return;
      }
      const existing = $page.variables.AttCatAllArray || [];
      if (existing.some(c => String(c.categoryCode) === code)) {
        await warn('Already exists', 'There is already a category with that name.');
        return;
      }
      let months = draft.defaultValidityMonths;
      months = (needsDates && months !== null && months !== undefined && months !== '') ? Number(months) : null;
      if (months !== null && (!Number.isInteger(months) || months <= 0)) {
        await warn('Check "Usually valid for"', 'Enter a whole number of months, or leave it empty.');
        return;
      }

      const maxOrder = existing.reduce((m, c) => Math.max(m, Number(c.displayOrder) || 0), 0);

      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/createAttachmentCategory',
        headers: cu.auditHeaders(context),
        body: {
          categoryCode: code,
          categoryLabel: label,
          appliesTo: draft.appliesTo || 'BOTH',
          validityRequired: needsDates ? 'Y' : 'N',
          defaultValidityMonths: months,
          isActive: 'Y',
          displayOrder: maxOrder + 10
        }
      });

      if (result.ok) {
        $page.variables.NewAttCat = { categoryLabel: '', appliesTo: 'BOTH', validityRequired: 'N', defaultValidityMonths: null };
        await Actions.callChain(context, { chain: 'loadAttachmentCategoriesChain' });
        await Actions.fireNotificationEvent(context, {
          summary: 'Category added',
          message: '"' + label + '" can now be chosen when adding attachments.',
          displayMode: 'transient', type: 'confirmation'
        });
      } else {
        const b = result.body || {};
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not add category',
          message: b.message || b.detail || ('HTTP ' + result.status),
          displayMode: 'transient', type: 'error'
        });
      }
    }
  }

  return addAttachmentCategoryChain;
});
