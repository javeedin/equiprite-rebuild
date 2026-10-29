define([
  'vb/action/actionChain',
  'resources/js/equipmentAttachments',
], (ActionChain, ea) => {
  'use strict';

  // The category decides whether Valid from / Valid to exist at all.
  //
  //   needs dates  -> Valid from defaults to today, Valid to to today +
  //                   defaultValidityMonths (minus a day) when configured.
  //                   Dates the user already entered are kept.
  //   no dates     -> both cleared. The fields are hidden, and the backend
  //                   stores NULL for such a category anyway.
  class attCategoryChangedChain extends ActionChain {
    async run(context, { categoryId }) {
      const { $page } = context;
      const cat = ea.findCategory($page.variables.attCategoryOptions, categoryId);
      const form = Object.assign({}, $page.variables.attForm);

      if (cat && cat.validityRequired) {
        if (!form.validFrom) form.validFrom = ea.todayIso();
        if (!form.validTo && cat.defaultValidityMonths) {
          form.validTo = ea.addMonthsIso(form.validFrom, cat.defaultValidityMonths);
        }
      } else {
        form.validFrom = null;
        form.validTo = null;
      }

      $page.variables.attForm = form;
      $page.variables.attNeedsDates = !!(cat && cat.validityRequired);
      const errors = Object.assign({}, $page.variables.attErrors);
      delete errors.category; delete errors.validFrom; delete errors.validTo;
      $page.variables.attErrors = errors;
    }
  }

  return attCategoryChangedChain;
});
