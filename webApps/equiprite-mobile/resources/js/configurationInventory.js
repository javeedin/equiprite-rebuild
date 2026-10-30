define([], () => {
  'use strict';

  /*
   * Configuration (New EquipRite, flows/settings/pages/configuration-page): the inventory of the old page it
   * replaces, webApps/vbredwoodapp/flows/setup/pages/configurations-page.{html,js,json} and its 81 chains.
   *
   * Old page: eight tabs on one 2,578-line page.
   *   Feature Flags          conf-global-settings: module + application flags, PPM posting labels, quotes, week
   *                          config, notification switches. Staged in changedRows, written by Save Changes.
   *   BU Settings            conf-equipment-settings: one columnar row per business unit (drawer).
   *   BU & Org Mapping       bu-org-mappings: yards per BU with yard type, subinventory, transactable, active.
   *   Equipment Classes      Class Mapping (source of truth, precedence, column mappings: conf-global-settings
   *                          saved at once) and Classes & Subclasses (equipment-classes, subclasses, Create from
   *                          Fusion, Add Class drawer, Edit Subclass dialog, unmap).
   *   Expenditure Types      exp-type-maps: equipment / subclass / class -> Fusion expenditure type.
   *   Agreement Types        conf-agreement-types (tab hidden while AGREEMENTS_ENABLED is off).
   *   Attachment Categories  conf-attachment-categories.
   *   Audit Trail            audit-trail (read only).
   *
   * New page: the same data in ten sections (wireframe Settings: one page, a section index, a search). Every
   * write is the old chain's: same endpoint, body and order (see CHAINS below for where each old chain went).
   *
   * Each SETTING says what it NEEDS (other settings that must be on; `enforced` when the old page refused the
   * change, otherwise it is shown as advice exactly as the old page's wording gave it) and what it AFFECTS (what
   * reads it: New EquipRite's menu through app-flow.js isFeatureEnabled / isQuotingAllowed / usesPpmRates, the
   * request pages, or only the backend). Sources: the old page's own descriptions and comments, app-flow.js, and
   * the FDD summary (docs/redesign/fdd-summary, section 12 "Configuration settings" and the menu flag rules).
   */

  const SECTIONS = [
    { key: 'modules', title: 'Modules & features', fdd: '7.17.1', oldTab: 'Feature Flags',
      summary: 'Which parts of EquipRite are switched on. The menu follows these switches as soon as they are saved.',
      keywords: 'module licence license feature flag projects customers agreements quotes' },
    { key: 'costing', title: 'Costing & timesheets', fdd: '7.17.1', oldTab: 'Feature Flags',
      summary: 'Where rental rates come from, whether hours are costed, and what EquipRite tags costs with in Fusion.',
      keywords: 'cost costing rates ppm fusion posting timesheet week hours' },
    { key: 'notifications', title: 'Notifications', fdd: '7.17.1', oldTab: 'Feature Flags',
      summary: 'Email events sent by Oracle Integration Cloud.',
      keywords: 'email notify notification oic alert' },
    { key: 'bu-settings', title: 'Business unit settings', fdd: '7.17.1', oldTab: 'BU Settings',
      summary: 'Billing rules per business unit: rate source, transaction source, batch prefix, procurement cost.',
      keywords: 'business unit bu billing rate source markup procurement batch prefix adhoc' },
    { key: 'yards', title: 'Business units & yards', fdd: '7.17.2', oldTab: 'BU & Org Mapping',
      summary: 'Which inventory orgs belong to each business unit and what each is for. Transfer orders and cost posting read this.',
      keywords: 'business unit bu org organization inventory yard mapping subinventory transactable virtual' },
    { key: 'classes', title: 'Equipment classes', fdd: '7.17.4', oldTab: 'Equipment Classes',
      summary: 'Where classes come from in Fusion, and the behaviour flags on each subclass.',
      keywords: 'class subclass classification fusion mapping column consumable auto-consume buffer tracking import' },
    { key: 'exp-types', title: 'Expenditure types', fdd: '7.17.4', oldTab: 'Expenditure Types',
      summary: 'Which Fusion expenditure types each piece of equipment bills under. Timesheets offer these first.',
      keywords: 'expenditure type mapping timesheet billing default scope' },
    { key: 'agreement-types', title: 'Agreement types', fdd: '7.3A', oldTab: 'Agreement Types',
      summary: 'The types offered when a rental agreement is created, and the prefix of their numbers.',
      keywords: 'agreement rental type prefix' },
    { key: 'attachments', title: 'Attachment categories', fdd: '7.2', oldTab: 'Attachment Categories',
      summary: 'The kinds of document that can be attached to equipment, and which need an expiry date.',
      keywords: 'attachment document certificate category expiry validity' },
    { key: 'history', title: 'Change history', fdd: '7.17', oldTab: 'Audit Trail',
      summary: 'Who changed which configuration value, and what it was before.',
      keywords: 'audit trail history log change' },
  ];

  const DAYS = [
    { value: 'SUNDAY', label: 'Sunday' }, { value: 'MONDAY', label: 'Monday' }, { value: 'TUESDAY', label: 'Tuesday' },
    { value: 'WEDNESDAY', label: 'Wednesday' }, { value: 'THURSDAY', label: 'Thursday' }, { value: 'FRIDAY', label: 'Friday' },
    { value: 'SATURDAY', label: 'Saturday' },
  ];

  /*
   * Global settings (EQR_CONF_GLOBAL_SETTING via eqp-v1 conf-global-settings).
   *   key/category/description  what the old page posts for a never-saved key (its data-setting-key, -category and
   *                             -description attributes, verbatim)
   *   kind      flag (switch, 'true'/'false'), choice (one of options), text, now (saved immediately, own UI)
   *   parent    shown under (indented); showWhen: only shown while that flag is on (the old page hid them)
   *   needs     [key]: must be on; enforced = the old page refused the change (updateSettingChain guards)
   *   keepOn    one of this and that must stay on (the last-module-standing guard)
   *   save      batch = Save changes (saveChangesChain); now = written at once (saveGlobalSettingNowChain)
   */
  const SETTINGS = [
    // ── Modules & features ──
    { key: 'PROJECTS_MODULE_ENABLED', section: 'modules', kind: 'flag', save: 'batch', depth: 0,
      category: 'FEATURE_FLAG', description: 'Module B - Equipment for Projects',
      oldLabel: 'EQUIPMENT FOR INTERNAL CUSTOMERS',
      label: 'Equipment for internal customers (projects)',
      help: 'Module B (PPM): project requests, picking, timesheets, receipt and project costing.',
      keepOn: 'CUSTOMERS_MODULE_ENABLED',
      affects: 'Menu: the Usage & cost group (Time entry, Timesheet approval, Post costs). New request offers project requests.' },
    { key: 'CUSTOMERS_MODULE_ENABLED', section: 'modules', kind: 'flag', save: 'batch', depth: 0,
      category: 'FEATURE_FLAG', description: 'Module C - Equipment for Customers',
      oldLabel: 'EQUIPMENT FOR EXTERNAL CUSTOMERS',
      label: 'Equipment for external customers',
      help: 'Module C (AR / rental): customer requests, rental agreements and customer billing.',
      keepOn: 'PROJECTS_MODULE_ENABLED',
      affects: 'Menu: the Customers group (Customer portal). New request and My requests offer customer requests.' },
    { key: 'AGREEMENTS_ENABLED', section: 'modules', kind: 'flag', save: 'batch', depth: 1, parent: 'CUSTOMERS_MODULE_ENABLED',
      category: 'FEATURE_FLAG', description: 'Rental Agreement sub-feature',
      oldLabel: 'RENTAL AGREEMENTS',
      label: 'Rental agreements',
      help: 'Negotiated rates and agreement lines, a part of Module C.',
      needs: ['CUSTOMERS_MODULE_ENABLED'],
      affects: 'Menu: Rental agreements. The Agreement types section on this page. Requests can be raised from an agreement.' },
    { key: 'EXTERNAL_PROJECT_ASSIGN_ENABLED', section: 'modules', kind: 'flag', save: 'batch', depth: 1, parent: 'CUSTOMERS_MODULE_ENABLED',
      category: 'FEATURE_FLAG',
      description: 'Assign an internal project/task to customer-sourced requests for costing (ON=Assign Project shown and project+task required before confirm)',
      oldLabel: 'PROJECT ENABLED FOR EXTERNAL CUSTOMERS',
      label: 'Projects on customer requests',
      help: 'Let the equipment manager charge a customer request to an internal project and task for costing. The request stays a customer request.',
      needs: ['CUSTOMERS_MODULE_ENABLED'],
      affects: 'Request detail: Assign project on customer requests, and project and task are required before Confirm (editable until the first line is allocated). Customer billing screens are withdrawn.' },
    { key: 'ENABLE_QUOTES', section: 'modules', kind: 'choice', save: 'batch', depth: 0,
      category: 'SYSTEM', description: 'Which request flows can raise a quote (NONE / PROJECTS / CUSTOMER / BOTH)',
      oldLabel: 'QUOTES', defaultValue: 'CUSTOMER',
      label: 'Quotes',
      help: 'Which requests can have a quote generated and accepted. Quotes already made stay viewable.',
      options: [{ value: 'NONE', label: 'None' }, { value: 'PROJECTS', label: 'Internal only' },
        { value: 'CUSTOMER', label: 'External only' }, { value: 'BOTH', label: 'Both' }],
      affects: 'Generate and Accept quote on request detail and the customer cart. New request hides prices on project requests while a quote is coming.' },

    // ── Costing & timesheets ──
    { key: 'TIMESHEETS_ENABLED', section: 'costing', kind: 'flag', save: 'batch', depth: 0,
      category: 'FEATURE_FLAG', description: 'Master timesheet/costing switch (ON=utilization available, OFF=complete-period only)',
      oldLabel: 'TIMESHEETS',
      label: 'Timesheets',
      help: 'Master costing switch. On: hours and utilisation costing are available (set per subclass). Off: bill the whole request period; hours are not used anywhere.',
      affects: 'Menu: Time entry and Timesheet approval. New request asks for planned hours per day. Fusion PPM rates needs it on.' },
    { key: 'PPM_RATES_ENABLED', section: 'costing', kind: 'flag', save: 'batch', depth: 1, parent: 'TIMESHEETS_ENABLED',
      category: 'FEATURE_FLAG', description: 'Rate source is Fusion PPM instead of EquipRite (R3a). ON also withdraws Post Cost (R14).',
      oldLabel: 'FUSION PPM RATES',
      label: 'Fusion PPM rates',
      help: 'On: Fusion prices rentals from its own PPM rate schedules. Off: EquipRite prices them from its rate schedules. Posting to Fusion is not built yet: turning this on stops EquipRite costing without replacing it.',
      needs: ['TIMESHEETS_ENABLED'], enforced: true,
      affects: 'Every business unit uses PPM rates, whatever its own rate source. Menu: Post costs and Rate schedules are withdrawn. Prices show as Fusion PPM. Shows the posting labels below.' },
    { key: 'PPM_TXN_SOURCE', section: 'costing', kind: 'text', save: 'batch', depth: 2, parent: 'PPM_RATES_ENABLED', showWhen: 'PPM_RATES_ENABLED',
      category: 'PPM_POSTING', description: 'Fusion transaction source for PPM-mode equipment cost. Replaces the hardcoded literal in the OIC field map.',
      oldLabel: 'PPM TRANSACTION SOURCE', defaultValue: 'External Miscellaneous', autoSave: true,
      label: 'PPM transaction source',
      help: 'Which system Fusion records as the sender.',
      needs: ['PPM_RATES_ENABLED'],
      affects: 'Every equipment cost posted to Fusion in PPM mode (OIC field map).' },
    { key: 'PPM_DOCUMENT', section: 'costing', kind: 'text', save: 'batch', depth: 2, parent: 'PPM_RATES_ENABLED', showWhen: 'PPM_RATES_ENABLED',
      category: 'PPM_POSTING', description: 'Fusion document for PPM-mode equipment cost.',
      oldLabel: 'PPM DOCUMENT', defaultValue: 'Miscellaneous', autoSave: true,
      label: 'PPM document',
      help: 'What kind of transaction it is.',
      needs: ['PPM_RATES_ENABLED'],
      affects: 'Every equipment cost posted to Fusion in PPM mode.' },
    { key: 'PPM_DOC_ENTRY', section: 'costing', kind: 'text', save: 'batch', depth: 2, parent: 'PPM_RATES_ENABLED', showWhen: 'PPM_RATES_ENABLED',
      category: 'PPM_POSTING', description: 'Fusion document entry for PPM-mode equipment cost. Carries the expenditure type class and the Import raw cost amounts flag.',
      oldLabel: 'PPM DOCUMENT ENTRY', defaultValue: 'Miscellaneous', autoSave: true,
      label: 'PPM document entry',
      help: 'Decides the expenditure type class, and whether Fusion calculates the cost itself (a Fusion setup choice).',
      needs: ['PPM_RATES_ENABLED'],
      affects: 'Every equipment cost posted to Fusion in PPM mode, and whether Fusion prices it.' },
    { key: 'PPM_EXPENDITURE_ORG', section: 'costing', kind: 'text', save: 'batch', depth: 2, parent: 'PPM_RATES_ENABLED', showWhen: 'PPM_RATES_ENABLED',
      category: 'PPM_POSTING', description: "Fusion expenditure organization for PPM-mode equipment cost. Blank keeps the view's old literal, Applications and Services.",
      oldLabel: 'PPM EXPENDITURE ORGANIZATION', defaultValue: '',
      label: 'PPM expenditure organization',
      help: "Fusion expenditure organization for every PPM cost, e.g. SSR Portfolio 4 Project Management. Blank sends 'Applications and Services'.",
      needs: ['PPM_RATES_ENABLED'],
      affects: 'The Fusion posting queue: one organization for every PPM cost.' },
    { key: 'PPM_NLR_FROM_EXP_TYPE', section: 'costing', kind: 'flag', save: 'batch', depth: 2, parent: 'PPM_RATES_ENABLED', showWhen: 'PPM_RATES_ENABLED',
      category: 'PPM_POSTING', description: 'Send NonlaborResource = expenditure type and NonlaborResourceOrganization = the PPM expenditure organization. Oceaneering convention, not a Fusion rule.',
      oldLabel: 'SEND NON-LABOR RESOURCE = EXPENDITURE TYPE',
      label: 'Send non-labor resource = expenditure type',
      help: 'On where the resource is named exactly like the expenditure type and the document entry requires one (Oceaneering). The resource organization is the expenditure organization above.',
      needs: ['PPM_RATES_ENABLED'],
      affects: 'The posting queue: each PPM cost carries a non-labor resource and its organization.' },
    { key: 'WEEK_CONFIG_ENABLED', section: 'costing', kind: 'flag', save: 'batch', depth: 1, parent: 'TIMESHEETS_ENABLED',
      category: 'FEATURE_FLAG', description: 'Enable fixed week-ending day for timesheets',
      oldLabel: 'FIXED WEEK-ENDING DAY',
      label: 'Fixed week-ending day',
      help: 'Timesheet periods end on a fixed day; the 7-day week starts 6 days before it.',
      needs: ['TIMESHEETS_ENABLED'],
      affects: 'Unlocks the week-ending day below. Timesheets do not read it yet (a later phase).' },
    { key: 'WEEK_END_DAY', section: 'costing', kind: 'choice', save: 'batch', depth: 2, parent: 'WEEK_CONFIG_ENABLED',
      category: 'SYSTEM', description: 'Week-ending day for timesheet periods',
      oldLabel: 'WEEK END DAY', defaultValue: '', lockWhenSaved: true,
      label: 'Week-ending day',
      help: 'A one-time choice: it locks once saved. Reset clears it so it can be picked again.',
      options: DAYS,
      needs: ['WEEK_CONFIG_ENABLED'], enforced: true,
      affects: 'Timesheet periods: the week is this day and the 6 days before it.' },

    // ── Notifications ──
    { key: 'EMAIL_NOTIFICATIONS_ENABLED', section: 'notifications', kind: 'flag', save: 'batch', depth: 0,
      category: 'NOTIFICATION', description: 'Master OIC email switch',
      oldLabel: 'EMAIL NOTIFICATIONS',
      label: 'Email notifications',
      help: 'Master switch for every OIC email. Off suppresses each event below.',
      affects: 'The approval, rejection and allocation emails (sent by Oracle Integration Cloud, not by a screen).' },
    { key: 'NOTIFY_ON_APPROVAL', section: 'notifications', kind: 'flag', save: 'batch', depth: 1, parent: 'EMAIL_NOTIFICATIONS_ENABLED',
      category: 'NOTIFICATION', description: 'Email on approval', oldLabel: 'NOTIFY ON APPROVAL',
      label: 'Email on approval', help: 'An email when a request is approved.',
      needs: ['EMAIL_NOTIFICATIONS_ENABLED'], affects: 'OIC email event on approval.' },
    { key: 'NOTIFY_ON_REJECTION', section: 'notifications', kind: 'flag', save: 'batch', depth: 1, parent: 'EMAIL_NOTIFICATIONS_ENABLED',
      category: 'NOTIFICATION', description: 'Email on rejection', oldLabel: 'NOTIFY ON REJECTION',
      label: 'Email on rejection', help: 'An email when a request is rejected.',
      needs: ['EMAIL_NOTIFICATIONS_ENABLED'], affects: 'OIC email event on rejection.' },
    { key: 'NOTIFY_ON_ALLOCATION', section: 'notifications', kind: 'flag', save: 'batch', depth: 1, parent: 'EMAIL_NOTIFICATIONS_ENABLED',
      category: 'NOTIFICATION', description: 'Email on allocation', oldLabel: 'NOTIFY ON ALLOCATION',
      label: 'Email on allocation', help: 'An email when equipment is allocated to a request.',
      needs: ['EMAIL_NOTIFICATIONS_ENABLED'], affects: 'OIC email event on allocation.' },

    // ── Equipment classes: global settings written at once (saveGlobalSettingNowChain, category SYSTEM) ──
    { key: 'CLASS_MAPPING_SOURCE_OF_TRUTH', section: 'classes', kind: 'now', save: 'now', depth: 0,
      category: 'SYSTEM', description: 'Asset classification source used by Class Mapping alongside Inventory (FIXED_ASSET / MAINTENANCE)',
      oldLabel: 'ASSET CLASSIFICATION SOURCE',
      label: 'Asset classification source',
      help: 'Inventory is always available. Choose whether asset classifications come from Fixed Assets or Maintenance. Applies to all users.',
      affects: 'The sources offered for column mappings and Add class, the precedence choices, and the item import.' },
    { key: 'CLASS_MAPPING_PRECEDENCE', section: 'classes', kind: 'now', save: 'now', depth: 1, parent: 'CLASS_MAPPING_SOURCE_OF_TRUTH',
      category: 'SYSTEM', description: 'Class Mapping precedence: ordered sources (INVENTORY / MAINTENANCE / FIXED_ASSET). Each imported item is classified from the first source it has data in.',
      oldLabel: 'SOURCE PRECEDENCE',
      label: 'Source precedence',
      help: 'The item import classifies each item from the first source in this order that has data for it.',
      needs: ['CLASS_MAPPING_SOURCE_OF_TRUTH'], enforced: true,
      affects: 'The equipment item import from Fusion. Until it is saved, the import uses the asset source, then Inventory.' },
    { key: 'CLASS_MAPPING_COLUMNS_INVENTORY', section: 'classes', kind: 'now', save: 'now', depth: 0, columnMapping: 'INVENTORY',
      category: 'SYSTEM', description: 'Class Mapping: the Fusion columns that hold the equipment class and subclass for Inventory',
      oldLabel: 'CLASS & SUBCLASS COLUMNS (Inventory)',
      label: 'Class and subclass columns: Inventory',
      help: 'Which Fusion item column holds the equipment class, and which the subclass.',
      affects: 'Add class and Create from Fusion list these values; the item import assigns items by them.' },
    { key: 'CLASS_MAPPING_COLUMNS_FIXED_ASSET', section: 'classes', kind: 'now', save: 'now', depth: 0, columnMapping: 'FIXED_ASSET',
      category: 'SYSTEM', description: 'Class Mapping: the Fusion columns that hold the equipment class and subclass for Fixed Assets',
      oldLabel: 'CLASS & SUBCLASS COLUMNS (Fixed Assets)',
      label: 'Class and subclass columns: Fixed Assets',
      help: 'Which Fusion asset column holds the equipment class, and which the subclass.',
      affects: 'Add class and Create from Fusion list these values; the item import assigns items by them.' },
    { key: 'CLASS_MAPPING_COLUMNS_MAINTENANCE', section: 'classes', kind: 'now', save: 'now', depth: 0, columnMapping: 'MAINTENANCE',
      category: 'SYSTEM', description: 'Class Mapping: the Fusion columns that hold the equipment class and subclass for Maintenance',
      oldLabel: 'CLASS & SUBCLASS COLUMNS (Maintenance)',
      label: 'Class and subclass columns: Maintenance',
      help: 'Which Fusion maintenance column holds the equipment class, and which the subclass.',
      affects: 'Add class and Create from Fusion list these values; the item import assigns items by them.' },
  ];

  /*
   * Per-business-unit settings (EQR_CONF_EQUIPMENT_SETTING via eqp-v1 conf-equipment-settings): one columnar row per
   * BU. key = the old page's esColumnMap key; col = the API column. IS_SHIP_DOCUMENT is left out on purpose, as on the
   * old page (out of esColumnMap so a save can never blank it).
   */
  const BU_FIELDS = [
    { key: 'RATE_SOURCE', col: 'rateSource', label: 'Rate source', required: true,
      help: 'EquipRite rates: priced from EquipRite rate schedules. PPM rates: Fusion prices this business unit.',
      options: [{ value: 'EQUIPRITE_RATES', label: 'EquipRite Rates' }, { value: 'PPM_RATES', label: 'PPM Rates' }],
      affects: 'Rate schedules leave the menu when no business unit prices from EquipRite. Fusion PPM rates (global) overrides it.' },
    { key: 'PPM_TRANS_SOURCE', col: 'ppmTransSource', label: 'Project transaction source', help: 'e.g. EQUIPRITE.' },
    { key: 'PPM_BATCH_PREFIX', col: 'ppmBatchPrefix', label: 'Expenditure batch prefix', help: 'e.g. EQRP-HOU.' },
    { key: 'MARGIN_PERCENTAGE', col: 'marginPercentage', label: 'Procurement markup (%)',
      help: 'Applied to the PO price when Pass procurement cost is on. 0 passes the PO cost through. Rentals are unaffected.' },
    { key: 'PASS_PROCUREMENT_COST', col: 'passProcurementCost', label: 'Pass procurement cost (use PO price)',
      help: 'Yes: the charge-out base is the PO price (plus the markup). No: the EquipRite rate schedule.' },
    { key: 'ADHOC_TIMESHEET_ENABLED', col: 'adhocTimesheetEnabled', label: 'Adhoc timesheets',
      help: 'Allow timesheet entries that are not tied to a scheduled line.' },
  ];

  /* The fields of the list sections, so the search finds them too. */
  const LIST_FIELDS = [
    { section: 'yards', label: 'Yard type', help: 'Equipment yard, destination yard, virtual project org, virtual customer org.' },
    { section: 'yards', label: 'Subinventory', help: 'Where a transfer order delivers into this org (Stores when blank).' },
    { section: 'yards', label: 'Transactable', help: 'Whether transactions are posted against the org.' },
    { section: 'yards', label: 'Active mapping', help: 'Switch a mapping off without deleting it.' },
    { section: 'classes', label: 'Classes and subclasses', help: 'Created by hand or from Fusion values.' },
    { section: 'classes', label: 'Consumable', help: 'Used up, not returned.' },
    { section: 'classes', label: 'Auto-consume', help: 'Accepting delivery issues the material transaction at once.' },
    { section: 'classes', label: 'Timesheet entry', help: 'Serials of the subclass appear on timesheets for hours.' },
    { section: 'classes', label: 'Buffer period (days)', help: 'Days after return kept for QC and maintenance.' },
    { section: 'classes', label: 'Type (tracking)', help: 'Default tracking intent for new items: Inventory, Maintenance, Fixed Assets, Custom.' },
    { section: 'classes', label: 'Create from Fusion', help: 'Create classes and subclasses from the mapped Fusion values.' },
    { section: 'exp-types', label: 'Expenditure type mapping', help: 'Equipment, subclass or class to a Fusion expenditure type.' },
    { section: 'exp-types', label: 'Default expenditure type', help: 'Listed first on the timesheet.' },
    { section: 'agreement-types', label: 'Agreement type prefix', help: 'Agreement numbers are PREFIX-####.' },
    { section: 'attachments', label: 'Attached to', help: 'Equipment, serial units, or both.' },
    { section: 'attachments', label: 'Expiry date', help: 'Valid from / to asked for on upload.' },
    { section: 'history', label: 'Audit trail', help: 'Old value, new value, who and when.' },
  ];

  /*
   * Every chain of the old page and where it went. `same` = a chain of the same name in
   * flows/settings/pages/configuration-page-chains carries its logic (writes unchanged); otherwise the reason it
   * is not needed. Kept as data so tests/configuration.test.js can check that no old chain is forgotten.
   */
  const CHAINS = {
    BuTypeaheadChain: 'not needed: the BU picker lists the BUs configured in Business unit settings and filters as you type (the old Fusion typeahead it fed was unused by that picker)',
    CaptureBuChain: 'same',
    addAgreementTypeChain: 'same',
    addAttachmentCategoryChain: 'same',
    addBuOrgMappingChain: 'same',
    addExpTypeMapChain: 'same',
    applyBuFilterChain: 'same',
    applyClassFilterChain: 'same',
    buOrgMenuActionChain: 'not needed: Edit and Delete are buttons on each mapping row (no row menu)',
    captureBuOrgYardChain: 'same',
    captureEsBuChain: 'same',
    clearBuFilterChain: 'same',
    clearClassFilterChain: 'same',
    closeAddClassDrawerChain: 'same',
    closeBuOrgDrawerChain: 'same',
    closeEsDrawerChain: 'same',
    createClassMapPairsChain: 'same',
    createClassSubclassChain: 'same',
    deleteAgreementTypeChain: 'same',
    deleteAttachmentCategoryChain: 'same',
    deleteBuOrgMappingRowChain: 'same',
    deleteClassChain: 'same',
    deleteExpTypeMapChain: 'same',
    deleteSubclassChain: 'same',
    enforcePageAccessChain: 'same',
    loadAgreementTypesChain: 'same',
    loadAllSubclassesChain: 'same',
    loadAttachmentCategoriesChain: 'same',
    loadAuditTrailChain: 'same',
    loadBuOrgMappingsChain: 'same',
    loadBuOrgSubinventoriesChain: 'same',
    loadClassLovChain: 'same',
    loadClassMapTypesChain: 'same',
    loadConfigSettingsChain: 'same',
    loadEquipmentClassesChain: 'same',
    loadEsSettingsChain: 'same',
    loadExpTypeMapsChain: 'same',
    loadExpTypeOptionsChain: 'same',
    loadSubclassLovChain: 'same',
    onClassLovSelectedChain: 'same',
    onColumnMapGroupChangedChain: 'same',
    onColumnMapSourceChangedChain: 'same',
    onTrackingTypeChangedChain: 'same',
    openAddClassDrawerChain: 'same',
    openBuOrgDrawerChain: 'same',
    openBuOrgEditChain: 'same',
    openBuOrgRowMenuChain: 'not needed: Edit and Delete are buttons on each mapping row (no row menu)',
    openClassMapBulkChain: 'same',
    openDeleteAgreementTypeChain: 'same',
    openDeleteAttachmentCategoryChain: 'same',
    openDeleteBuOrgChain: 'same',
    openDeleteClassChain: 'same',
    openDeleteExpTypeMapChain: 'same',
    openDeleteSubclassChain: 'same',
    openEditAgreementTypeChain: 'same',
    openEditAttachmentCategoryChain: 'same',
    openEditClassSubclassChain: 'same',
    openEsDrawerChain: 'same',
    openEsEditChain: 'same',
    openUnmapChain: 'same',
    previewClassMapPairsChain: 'same',
    removeColumnMappingChain: 'same',
    resetChangesChain: 'same',
    resetWeekEndDayChain: 'same',
    saveBuOrgEditChain: 'same',
    saveChangesChain: 'same',
    saveClassMapPrecedenceChain: 'same',
    saveClassMapTruthChain: 'same',
    saveColumnMappingChain: 'same',
    saveEditClassSubclassChain: 'same',
    saveEsDrawerChain: 'same',
    saveGlobalSettingNowChain: 'same',
    setExpTypeMapDefaultChain: 'same',
    switchExpTypeScopeChain: 'same',
    toggleAgreementTypeChain: 'same',
    toggleAttachmentCategoryChain: 'same',
    toggleBuOrgActiveChain: 'same',
    unmapChain: 'same',
    updateAgreementTypeChain: 'same',
    updateAttachmentCategoryChain: 'same',
    updateSettingChain: 'same',
  };

  /* What the wireframe shows that neither the old page nor the backend has; said plainly on the page. */
  const NOT_YET = [
    { title: 'Warehouse and Project site settings', why: 'Transfer orders per BU, ship entire request, picking lead time, receiving and acceptance (FDD 7.17.2, 7.17.5). No backend setting exists yet.' },
    { title: 'Inspection points', why: 'The class by inspection-point matrix (FDD 7.17.3). The Inspection screen will own it.' },
    { title: 'Roles & page access', why: 'Its own screen in Settings (Page access).', navId: 'page-access' },
  ];

  const BY_KEY = {};
  SETTINGS.forEach((s) => { BY_KEY[s.key] = s; });

  return { SECTIONS, SETTINGS, BU_FIELDS, LIST_FIELDS, CHAINS, NOT_YET, DAYS, BY_KEY };
});
