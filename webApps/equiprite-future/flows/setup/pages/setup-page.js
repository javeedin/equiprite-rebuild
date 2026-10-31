define(['resources/js/future/fxPage', 'resources/js/future/fxSetup', 'resources/js/exportKit'], (fx, fxSetup, exportKit) => {
  'use strict';

  // Companies & agreements: the page module. fx.Base subscribes the page to the store (fxRefresh → loadChain) and gives
  // the shared binding helpers; the view model and what each change does are resources/js/future/fxSetup.js.
  class PageModule extends fx.Base {
    constructor(context) {
      super(context);
    }

    /** The export formats (Excel, CSV, PDF, Copy). */
    formats() { return exportKit.FORMATS; }

    /** aria-pressed / aria-expanded as VB wants them. */
    pressed(on) { return on ? 'true' : 'false'; }

    /** The sections of the page, with their counts. */
    sections(counts) {
      const c = counts || {};
      return [
        { key: 'companies', label: 'Companies & orgs', count: (c.companies || 0) + ' · ' + (c.bus || 0) + ' · ' + (c.orgs || 0) },
        { key: 'people', label: 'People', count: String(c.people || 0) },
        { key: 'relations', label: 'Who sources from whom', count: String(c.relations || 0) },
        { key: 'agreements', label: 'Agreements & rates', count: String(c.agreements || 0) },
        { key: 'decisions', label: 'Decisions', count: String(c.decisions || 0) }
      ];
    }

    /** A draft's value, else the saved one (for an input's value). */
    draft(drafts, key, current) { return fxSetup.draftOf(drafts, key, current); }

    /** What saving a rate does (a new version), and whether it can be saved. */
    rateChange(drafts, a, r) { return fxSetup.rateChange(drafts, a, r); }

    /** setAgreementRate's payload from the drafts and the Save button's data-…. */
    ratePayload(drafts, data) { return fxSetup.ratePayload(drafts, data); }

    /** What saving a number decision does, and whether it can be saved. */
    settingChange(drafts, st) { return fxSetup.settingChange(drafts, st); }

    /** setSetting's payload from the drafts and the Save button's data-…. */
    settingPayload(drafts, data) { return fxSetup.settingPayload(drafts, data); }

    /** "the user" for a role list. */
    first(name) { return String(name || '').split(' ')[0]; }
  }

  return PageModule;
});
