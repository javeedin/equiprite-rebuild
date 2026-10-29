define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // New EquipRite: one field of an inline form changed (inputs and choice buttons carry data-form, data-field).
  // The old page bound these forms two-way ({{ }}) to the same variables, so the save chains read exactly what they
  // read before. The value rules the old components applied are applied here:
  //   agreement type prefix   upper case, letters and digits only (the old on-raw-value-changed handler)
  //   markup, validity months a number, or null when empty (oj-input-number)
  //   buffer period           a whole number of days, at least 0 (oj-input-number min 0 step 1)
  //   on/off fields           true / false (oj-switch)
  // and the side effects the old value-changed listeners ran follow:
  //   Add class TYPE          onTrackingTypeChangedChain        Add class CLASS     onClassLovSelectedChain
  //   column-mapping SOURCE   onColumnMapSourceChangedChain     FIELD GROUP         onColumnMapGroupChangedChain
  //   expenditure APPLIES TO  switchExpTypeScopeChain           scope / search filter  loadExpTypeMapsChain
  const FORMS = {
    EsDraft: true, currentMapping: true, BuOrgEditTarget: true, newClassSubclass: true, EditClassSubclass: true,
    ColumnMapDraft: true, NewExpTypeMap: true, NewAgreementType: true, EditAgreementType: true, NewAttCat: true,
    EditAttCat: true, pick: true,
  };
  const PAGE_VARS = { ExpTypeMapFilterScope: true, ExpTypeMapSearch: true, EquipmentSubclassSelectedId: true };
  const BOOLS = { PASS_PROCUREMENT_COST: true, ADHOC_TIMESHEET_ENABLED: true };
  const NUMBERS = { MARGIN_PERCENTAGE: true, defaultValidityMonths: true };

  class setDraftChain extends ActionChain {
    async run(context, { form, field, value }) {
      const { $page } = context;
      if (!field) return;
      let v = value == null ? '' : value;

      if (form === 'page') {
        if (!PAGE_VARS[field]) return;
        if (field === 'EquipmentSubclassSelectedId') {
          $page.variables.EquipmentSubclassSelectedId = v === '' ? null : Number(v);
          return;
        }
        $page.variables[field] = String(v);
        await Actions.callChain(context, { chain: 'loadExpTypeMapsChain' });
        return;
      }
      if (!FORMS[form]) return;

      if (BOOLS[field]) {
        v = v === true || v === 'true';
      } else if (NUMBERS[field]) {
        v = String(v).trim() === '' ? null : (isNaN(Number(v)) ? String(v) : Number(v));
      } else if (field === 'bufferPeriodDays') {
        v = String(v).trim() === '' || isNaN(Number(v)) ? 0 : Math.max(0, Math.floor(Number(v)));
      } else if (field === 'typePrefix') {
        v = String(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
      } else if (field === 'scopeId') {
        v = v === '' ? null : Number(v);
      } else {
        v = String(v);
      }

      const next = Object.assign({}, $page.variables[form] || {});
      next[field] = v;
      $page.variables[form] = next;

      if (form === 'newClassSubclass' && field === 'trackingType') {
        $page.variables.pick = Object.assign({}, $page.variables.pick || {}, { classLov: '', subclassLov: '' });
        await Actions.callChain(context, { chain: 'onTrackingTypeChangedChain' });
      } else if (form === 'newClassSubclass' && field === 'classLovId') {
        await Actions.callChain(context, { chain: 'onClassLovSelectedChain' });
      } else if (form === 'ColumnMapDraft' && field === 'sourceType') {
        await Actions.callChain(context, { chain: 'onColumnMapSourceChangedChain' });
      } else if (form === 'ColumnMapDraft' && field === 'classGroup') {
        await Actions.callChain(context, { chain: 'onColumnMapGroupChangedChain', params: { level: 'CLASS' } });
      } else if (form === 'ColumnMapDraft' && field === 'subclassGroup') {
        await Actions.callChain(context, { chain: 'onColumnMapGroupChangedChain', params: { level: 'SUBCLASS' } });
      } else if (form === 'NewExpTypeMap' && field === 'scopeType') {
        $page.variables.pick = Object.assign({}, $page.variables.pick || {}, { scope: '' });
        await Actions.callChain(context, { chain: 'switchExpTypeScopeChain', params: { scopeType: v } });
      }
    }
  }

  return setDraftChain;
});
