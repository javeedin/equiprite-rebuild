'use strict';
/*
 * Configuration in a real browser: the ten sections render from fake settings, the search finds a setting, a
 * switched flag is saved with the old call (and the menu follows it), and adding a yard mapping sends the old
 * upsert-by-BU PUT with the address enrichment. No console errors.
 * Needs `npm run build`. Run: node tests/e2e/configuration.e2e.js   (screenshots go to the OS temp folder)
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();

// conf-global-settings, stateful so the save is read back (the app-level flags refresh after Save changes).
const SETTINGS = [
  { id: 1, settingKey: 'PROJECTS_MODULE_ENABLED', settingValue: 'true', settingCategory: 'FEATURE_FLAG' },
  { id: 2, settingKey: 'CUSTOMERS_MODULE_ENABLED', settingValue: 'true', settingCategory: 'FEATURE_FLAG' },
  { id: 3, settingKey: 'AGREEMENTS_ENABLED', settingValue: 'false', settingCategory: 'FEATURE_FLAG' },
  { id: 4, settingKey: 'TIMESHEETS_ENABLED', settingValue: 'true', settingCategory: 'FEATURE_FLAG' },
  { id: 5, settingKey: 'PPM_RATES_ENABLED', settingValue: 'false', settingCategory: 'FEATURE_FLAG' },
  { id: 6, settingKey: 'ENABLE_QUOTES', settingValue: 'CUSTOMER', settingCategory: 'SYSTEM' },
  { id: 7, settingKey: 'WEEK_CONFIG_ENABLED', settingValue: 'true', settingCategory: 'FEATURE_FLAG' },
  { id: 8, settingKey: 'WEEK_END_DAY', settingValue: 'FRIDAY', settingCategory: 'SYSTEM' },
  { id: 9, settingKey: 'EMAIL_NOTIFICATIONS_ENABLED', settingValue: 'true', settingCategory: 'NOTIFICATION' },
  { id: 10, settingKey: 'NOTIFY_ON_APPROVAL', settingValue: 'true', settingCategory: 'NOTIFICATION' },
  { id: 11, settingKey: 'CLASS_MAPPING_SOURCE_OF_TRUTH', settingValue: 'MAINTENANCE', settingCategory: 'SYSTEM' },
  { id: 12, settingKey: 'CLASS_MAPPING_COLUMNS_INVENTORY', settingCategory: 'SYSTEM',
    settingValue: JSON.stringify({ classGroup: 'CATEGORIES', classColumn: 'CATEGORY', classColumnName: 'Category', subclassGroup: null, subclassColumn: null }) },
].map((r) => Object.assign({ isActiveFlag: 'Y' }, r));

const TYPES = [
  { LOV_ID: 'CATEGORY', LOV_NAME: 'Category', LOV_CODE: '10', FIELD_GROUP: 'CATEGORIES', FIELD_GROUP_NAME: 'Categories' },
  { LOV_ID: 'ITEM_CLASS', LOV_NAME: 'Item class', LOV_CODE: '20', FIELD_GROUP: 'ITEM_CLASS', FIELD_GROUP_NAME: 'Item Class' },
];

function handle(req, res) {
  const p = req.path;
  if (p.endsWith('/conf-global-settings') && req.method === 'GET') return res.json({ data: SETTINGS });
  const g = /\/conf-global-settings\/(\d+)$/.exec(p);
  if (g && req.method === 'PATCH') {
    const row = SETTINGS.find((r) => r.id === Number(g[1]));
    if (row) row.settingValue = req.json().settingValue;
    return res.json(row || {});
  }
  if (p.endsWith('/conf-equipment-settings')) return res.json({ data: [
    { id: 70, businessUnitId: 300000001, businessUnitName: 'EPC_US_BU', rateSource: 'EQUIPRITE_RATES', passProcurementCost: 'Y',
      marginPercentage: 10, ppmTransSource: 'EQUIPRITE', ppmBatchPrefix: 'EQRP-HOU', adhocTimesheetEnabled: 'N', isActiveFlag: 'Y' }] });
  if (p.endsWith('/finBusinessUnitsLOV')) return res.json({ items: [
    { BusinessUnitId: 300000001, BusinessUnitName: 'EPC_US_BU' }, { BusinessUnitId: 300000002, BusinessUnitName: 'EPC_UAE_BU' }] });
  if (p.endsWith('/bu-org-mappings') && req.method === 'GET') return res.json({ data: [
    { id: 501, businessUnitId: 300000001, buName: 'EPC_US_BU', invOrgId: 9001, invOrgName: 'Houston Yard', invOrgCode: 'HOU',
      locationCode: 'HOU-01', orgRole: 'EQUIPMENT_YARD', isActiveFlag: 'Y', isTransactable: 'Y', subinventoryCode: 'STORES',
      addressLine1: '1 Yard Rd', townOrCity: 'Houston', invOrgLatitude: 29.76, invOrgLongitude: -95.37 }] });
  if (p.endsWith('/bu-org-mappings') && req.method === 'PUT') return res.json({ ok: true });
  if (p.endsWith('/inventoryOrganizations')) return res.json({ items: [
    { OrganizationId: 9001, OrganizationCode: 'HOU', OrganizationName: 'Houston Yard', ManagementBusinessUnitId: 300000001, LocationCode: 'HOU-01', Status: 'Active' },
    { OrganizationId: 9002, OrganizationCode: 'ODS', OrganizationName: 'Odessa Yard', ManagementBusinessUnitId: 300000001, LocationCode: 'ODS-01', Status: 'Active' }] });
  if (p.endsWith('/subinventories')) return res.json({ items: [
    { SecondaryInventoryName: 'STORES', Description: 'Main stores' }, { SecondaryInventoryName: 'YARD', Description: 'Open yard' }] });
  if (p.endsWith('/ExternalReportWSSService')) {
    if (req.body.includes('EQP_INV_ORG_ADDRESSES')) return res.bip([{ LOCATION_ID: 1, LOCATION_CODE: 'ODS-01', ADDRESS_LINE_1: '1200 Pipeline Rd',
      TOWN_OR_CITY: 'Odessa', REGION_2: 'TX', POSTAL_CODE: '79761', COUNTRY: 'US' }]);
    if (req.body.includes('TYPES')) return res.bip(TYPES);
    if (req.body.includes('EQP_CATEGORY_LOV_RP')) return res.bip([{ LOV_ID: '100', LOV_NAME: 'Excavators', LOV_CODE: 'EXC' }]);
    return undefined;
  }
  if (p.endsWith('/equipment-classes') && req.method === 'GET') return res.json({ data: [
    { id: 1, className: 'Excavators', classCode: 'EXCAVATORS', fusionSourceType: 'INVENTORY', fusionClassType: 'CATEGORY',
      fusionClassTypeName: 'Category', fusionClassRef: '100', fusionClassName: 'Excavators' },
    { id: 2, className: 'Generators', classCode: 'GENERATORS' }] });
  if (p.endsWith('/subclasses')) return res.json({ data: [
    { id: 11, eqrEquipmentClassId: 1, subclassName: 'Crawler', trackingType: 'INVENTORY', consumableFlag: 'N', autoConsumeFlag: 'N' },
    { id: 21, eqrEquipmentClassId: 2, subclassName: 'Diesel 100kVA', trackingType: 'MAINTENANCE', consumableFlag: 'N', autoConsumeFlag: 'N' }], hasMore: false });
  if (p.endsWith('/views/exp-type-map-admin')) return res.json({ data: [
    { eqrExpTypeMapId: 1, scopeType: 'MASTER', scopeName: 'CAT 320 Excavator', expenditureType: 'Operational Day Rate', isDefault: 'Y' }], hasMore: false });
  if (p.endsWith('/equipment-master')) return res.json({ data: [{ id: 11, equipmentName: 'CAT 320 Excavator', equipmentNumber: 'EX-320' }], hasMore: false });
  if (p.endsWith('/expenditureTypesLOV')) return res.json({ items: [{ ExpenditureTypeName: 'Operational Day Rate', UnitOfMeasure: 'Days' }], hasMore: false });
  if (p.endsWith('/conf-agreement-types')) return res.json([{ id: 1, typeCode: 'RENTAL', typeLabel: 'Rental', typePrefix: 'RNT', isActive: 'Y', displayOrder: 1 }]);
  if (p.endsWith('/conf-attachment-categories')) return res.json({ data: [{ id: 1, categoryCode: 'LOAD_TEST', categoryLabel: 'Load Test Certificate',
    appliesTo: 'LINE', validityRequired: 'Y', defaultValidityMonths: 12, isActive: 'Y', objectVersionNumber: 1 }] });
  if (p.endsWith('/audit-trail')) return res.json({ data: [{ id: 1, timestamp: '2026-10-01 10:00', modifiedBy: 'priya.raman', section: 'FEATURE_FLAG',
    field: 'TIMESHEETS_ENABLED', oldValue: 'false', newValue: 'true' }] });
  return undefined;
}

(async () => {
  const env = await E.start({ port: 19170, handle });
  const { page } = env;
  const visibleSections = () => page.$$eval('.er-cf-section', (s) => s.map((x) => x.id));
  // A section on its own, once the toasts have gone (a full-page shot catches them and the sticky header).
  const sectionShot = async (sel, name) => {
    await page.waitForFunction(() => !document.querySelector('#appMessages oj-message'), null, { timeout: 8000 }).catch(() => {});
    const file = require('path').join(require('os').tmpdir(), 'equiprite-e2e', name);
    await page.locator(sel).screenshot({ path: file });
    return file;
  };
  try {
    T.section('the ten sections render from the settings');
    await env.open('/vp/shell/settings/configuration');
    await page.waitForSelector('#cfg-modules .er-cf-row', { timeout: 30000 });
    await page.waitForSelector('#cfg-yards [data-row]', { timeout: 20000 });
    await page.waitForTimeout(800);
    T.eq('ten sections, in order', (await visibleSections()).join(','),
      'cfg-modules,cfg-costing,cfg-notifications,cfg-bu-settings,cfg-yards,cfg-classes,cfg-exp-types,cfg-agreement-types,cfg-attachments,cfg-history');
    T.check('the menu item is New Configuration, highlighted', (await env.text('.er-nav-item--active')).includes('Configuration'));
    T.check('a switch reflects the stored flag', await page.$eval('#cfg-row-TIMESHEETS_ENABLED .er-cf-switch', (b) => b.getAttribute('aria-checked')) === 'true'
      && await page.$eval('#cfg-row-AGREEMENTS_ENABLED .er-cf-switch', (b) => b.getAttribute('aria-checked')) === 'false');
    T.check('a dependent switch shows what it needs', (await env.text('#cfg-row-PPM_RATES_ENABLED .er-cf-deps')).includes('Timesheets'));
    T.check('…and what it affects', (await env.text('#cfg-row-PPM_RATES_ENABLED .er-cf-affects')).includes('Post costs'));
    T.check('a saved week-ending day is locked, with Reset', (await env.text('#cfg-row-WEEK_END_DAY')).includes('locked')
      && await page.$eval('#cfg-row-WEEK_END_DAY .er-seg-btn', (b) => b.disabled) && !!(await page.$('#cfg-row-WEEK_END_DAY .er-cf-reset')));
    T.check('quotes choice shows the stored value', (await env.text('#cfg-row-ENABLE_QUOTES .er-seg-btn--on')) === 'External only');
    T.check('BU settings row', (await env.text('#cfg-bu-settings [data-bu="300000001"]')).includes('EPC_US_BU')
      && (await env.text('#cfg-bu-settings [data-bu="300000001"]')).includes('10%'));
    T.check('yard mapping row', (await env.text('#cfg-yards [data-row]')).includes('Houston Yard'));
    T.check('subclass rows with their Fusion source', (await env.text('#cfg-classes [data-subclass="11"]')).includes('Inventory · Category = Excavators'));
    T.check('the asset classification source is marked', (await env.text('#cfg-classes [data-setting="CLASS_MAPPING_SOURCE_OF_TRUTH"] .er-seg-btn--on')) === 'Maintenance');
    T.check('the saved column mapping is listed', (await env.text('#cfg-classes .er-cf-grid--colmap')).includes('Category'));
    T.check('expenditure type mapping', (await env.text('#cfg-exp-types')).includes('Operational Day Rate'));
    T.check('agreement types wait for Rental agreements', (await env.text('#cfg-agreement-types')).includes('managed while Rental agreements is on'));
    T.check('attachment category', (await env.text('#cfg-attachments')).includes('usually 12 months'));
    T.check('change history', (await env.text('#cfg-history')).includes('TIMESHEETS_ENABLED'));
    await env.shot('configuration.png');

    T.section('search finds a setting');
    await page.fill('#cfgSearch', 'week');
    await page.waitForTimeout(400);
    T.eq('only the costing section is left', (await visibleSections()).join(','), 'cfg-costing');
    T.eq('…showing the two week settings', (await page.$$eval('#cfg-costing .er-cf-row', (r) => r.map((x) => x.dataset.setting))).join(','),
      'WEEK_CONFIG_ENABLED,WEEK_END_DAY');
    T.check('the index counts the matches', (await env.text('.er-cf-index-btn[data-key="costing"]')).includes('2'));
    await env.shot('configuration-search.png');
    await page.fill('#cfgSearch', 'subinventory');
    await page.waitForTimeout(300);
    T.eq('a list field finds its section', (await visibleSections()).join(','), 'cfg-yards');
    await page.fill('#cfgSearch', '');
    await page.waitForTimeout(300);

    T.section('switching a flag: consequences first, then the old save');
    T.check('Rental agreements is not in the menu yet', !(await env.text('.er-nav')).includes('Rental agreements'));
    env.writes.length = 0;
    await page.click('#cfg-row-AGREEMENTS_ENABLED .er-cf-switch');
    await page.waitForSelector('.er-cf-bar');
    T.check('the bar counts the change', (await env.text('.er-cf-bar')).includes('1 unsaved change'));
    T.check('…says what it changes', (await env.text('.er-cf-bar')).includes('Rental agreements Off → On'));
    T.check('…and what the menu will do', (await env.text('.er-cf-bar')).includes('The menu will show Rental agreements'));
    T.check('the row is marked changed', !!(await page.$('#cfg-row-AGREEMENTS_ENABLED.er-cf-row--changed')));
    T.eq('nothing is written before Save', env.writes.length, 0);
    await env.shot('configuration-unsaved.png');
    await page.click('#cfgSave');
    await page.waitForFunction(() => !document.querySelector('.er-cf-bar'), null, { timeout: 15000 });
    await page.waitForTimeout(600);
    T.eq('Save sends the old PATCH, by id, with the value only', JSON.stringify(env.writes.map((w) => [w.method, w.path.replace('/equiprite/v1', ''), w.body])),
      JSON.stringify([['PATCH', '/conf-global-settings/3', { settingValue: 'true' }]]));
    T.check('the menu now has Rental agreements', (await env.text('.er-nav')).includes('Rental agreements'));
    T.check('and the agreement types are managed here', (await env.text('#cfg-agreement-types')).includes('RNT'));

    T.section('a guarded switch is refused, nothing staged');
    await page.click('#cfg-row-PROJECTS_MODULE_ENABLED .er-cf-switch');
    await page.waitForTimeout(300);
    await page.click('#cfg-row-CUSTOMERS_MODULE_ENABLED .er-cf-switch');
    await page.waitForTimeout(500);
    T.check('turning off the last module is refused', await page.$eval('#cfg-row-CUSTOMERS_MODULE_ENABLED .er-cf-switch', (b) => b.getAttribute('aria-checked')) === 'true'
      && (await env.text('.er-cf-bar')).includes('1 unsaved change'));
    await page.click('.er-cf-bar button:has-text("Discard")');
    await page.waitForFunction(() => !document.querySelector('.er-cf-bar'), null, { timeout: 10000 });

    T.section('editing business unit settings: the old PATCH of the BU row');
    env.writes.length = 0;
    await page.click('#cfg-bu-settings button[data-bu="300000001"]');
    await page.waitForSelector('#cfgEsSave');
    T.check('the editor opens on the BU with its stored values', (await env.text('#cfg-bu-settings .er-cf-editor h3')).includes('EPC_US_BU')
      && await page.$eval('#cfg-bu-settings input[data-field="MARGIN_PERCENTAGE"]', (i) => i.value) === '10');
    await page.fill('#cfg-bu-settings input[data-field="MARGIN_PERCENTAGE"]', '12');
    await page.click('#cfg-bu-settings .er-seg-btn[data-field="RATE_SOURCE"][data-value="PPM_RATES"]');
    await page.click('#cfgEsSave');
    await page.waitForFunction(() => !document.querySelector('#cfgEsSave'), null, { timeout: 15000 });
    const es = env.writes[0] || {};
    T.eq('one PATCH of the BU\'s row', env.writes.map((w) => w.method + ' ' + w.path.replace('/equiprite/v1', '')).join(), 'PATCH /conf-equipment-settings/70');
    T.check('…with every column, the BU name from Fusion and lastUpdatedBy', es.body && es.body.marginPercentage === 12 && es.body.rateSource === 'PPM_RATES'
      && es.body.passProcurementCost === 'Y' && es.body.ppmBatchPrefix === 'EQRP-HOU' && es.body.businessUnitName === 'EPC_US_BU' && es.body.lastUpdatedBy === 'EQUIPRITE', JSON.stringify(es.body));

    T.section('a delete asks first');
    env.writes.length = 0;
    await page.click('#cfg-yards button:has-text("Delete")');
    await page.waitForSelector('#cfg-yards .er-cf-confirm');
    T.check('the confirm card names the yard and the BU', (await env.text('#cfg-yards .er-cf-confirm')).includes('Permanently delete the mapping for "Houston Yard" from EPC_US_BU'));
    await sectionShot('#cfg-yards', 'configuration-confirm.png');
    await page.click('#cfg-yards .er-cf-confirm button:has-text("Cancel")');
    await page.waitForTimeout(300);
    T.check('Cancel closes it and writes nothing', !(await page.$('#cfg-yards .er-cf-confirm')) && env.writes.length === 0);

    T.section('adding a yard mapping: the old upsert-by-BU PUT');
    env.writes.length = 0;
    await page.click('#cfgOrgAdd');
    await page.click('#cfg-yards .er-cf-editor .er-chip[data-value="300000001"]');
    await page.waitForSelector('#cfg-yards .er-result[data-value="9002"]');
    T.check('a yard already mapped says so before it is picked', (await env.text('#cfg-yards .er-result[data-value="9001"]')).includes('Already mapped'));
    await page.click('#cfg-yards .er-result[data-value="9002"]');
    await page.click('#cfg-yards .er-seg-btn[data-field="yardType"][data-value="EQUIPMENT_YARD"]');
    await page.waitForSelector('#cfg-yards .er-chip[data-field="subinventoryCode"][data-value="YARD"]');
    await page.click('#cfg-yards .er-chip[data-field="subinventoryCode"][data-value="YARD"]');
    await sectionShot('#cfg-yards', 'configuration-add-mapping.png');
    await page.click('#cfgOrgSave');
    await page.waitForFunction(() => !document.querySelector('#cfgOrgSave'), null, { timeout: 15000 });
    await page.waitForTimeout(500);
    const put = env.writes.find((w) => w.method === 'PUT');
    T.check('one PUT to bu-org-mappings for the BU', !!put && put.path.endsWith('/bu-org-mappings') && put.query.includes('businessUnitId=300000001'), put && put.query);
    T.eq('nothing else was written', env.writes.map((w) => w.method).join(','), 'PUT');
    const body = put ? put.body : {};
    T.eq('body: BU id and stored name', JSON.stringify([body.businessUnitId, body.buName]), JSON.stringify([300000001, 'EPC_US_BU']));
    T.eq('every active yard of the BU is sent again, then the new one', (body.mappings || []).map((m) => m.invOrgId).join(','), '9001,9002');
    const added = (body.mappings || [])[1] || {};
    T.eq('the new yard: role, code, name, location, flags, subinventory',
      JSON.stringify([added.orgRole, added.invOrgCode, added.invOrgName, added.locationCode, added.isActiveFlag, added.isTransactable, added.subinventoryCode]),
      JSON.stringify(['EQUIPMENT_YARD', 'ODS', 'Odessa Yard', 'ODS-01', 'Y', 'Y', 'YARD']));
    T.check('…with its Fusion address and map position', added.addressLine1 === '1200 Pipeline Rd' && added.townOrCity === 'Odessa'
      && added.invOrgLatitude === 31.85 && added.invOrgLongitude === -102.37, JSON.stringify(added));
    const kept = (body.mappings || [])[0] || {};
    T.check('the existing yard keeps its subinventory and address', kept.subinventoryCode === 'STORES' && kept.addressLine1 === '1 Yard Rd' && kept.invOrgLatitude === 29.76);
    T.check('the address was asked of BI Publisher', env.calls.some((c) => c.startsWith('POST') && c.includes('ExternalReportWSSService')));

    T.section('every other editor opens, nothing written');
    env.writes.length = 0;
    await page.click('#cfg-classes button:has-text("Add class")');
    await page.waitForSelector('#cfg-classes [aria-label="Add class"] .er-result[data-field="classLovId"]');
    await page.click('#cfg-classes [aria-label="Add class"] .er-result[data-field="classLovId"]');
    await page.waitForTimeout(300);
    T.check('Add class lists the mapped Fusion column\'s values; a pick shows', (await env.text('#cfg-classes [aria-label="Add class"] .er-picked')).includes('Excavators'));
    await sectionShot('#cfg-classes', 'configuration-add-class.png');
    await page.click('#cfg-classes [aria-label="Add class"] button:has-text("Cancel")');
    await page.click('#cfg-classes button:has-text("Create from Fusion")');
    await page.waitForSelector('#cfg-classes .er-cf-grid--pairs [role="row"]:nth-child(2)', { timeout: 15000 });
    T.check('Create from Fusion previews the values', (await env.text('#cfg-classes .er-cf-grid--pairs')).includes('Excavators'));
    await page.click('#cfg-classes button[data-name="isClassMapBulkOpen"]');
    await page.click('#cfg-classes [data-subclass="21"] button:has-text("Edit")');
    await page.waitForSelector('#cfg-classes [aria-label="Edit subclass"]');
    T.check('Edit subclass opens on the row', (await env.text('#cfg-classes [aria-label="Edit subclass"] h3')).includes('Diesel 100kVA')
      && (await env.text('#cfg-classes [aria-label="Edit subclass"] [aria-label="Type"] .er-seg-btn--on')) === 'Maintenance');
    await page.click('#cfg-classes button[data-name="isSubclassEditOpen"]');
    await page.click('#cfg-agreement-types button:has-text("Edit")');
    await page.waitForSelector('#cfg-agreement-types [aria-label="Edit agreement type"]');
    T.eq('Edit agreement type opens on the row', await page.$eval('#cfg-agreement-types [aria-label="Edit agreement type"] input[data-field="typePrefix"]', (i) => i.value), 'RNT');
    await page.click('#cfg-agreement-types button[data-name="isAgrEditOpen"]');
    await page.click('#cfg-attachments button:has-text("Edit")');
    await page.waitForSelector('#cfg-attachments [aria-label="Edit attachment category"]');
    T.eq('Edit attachment category opens on the row', await page.$eval('#cfg-attachments [aria-label="Edit attachment category"] input[data-field="defaultValidityMonths"]', (i) => i.value), '12');
    await page.click('#cfg-attachments button[data-name="isAttEditOpen"]');
    await page.click('#cfgEsAdd');
    await page.waitForSelector('#cfg-bu-settings .er-result');
    T.eq('Add business unit offers only units without settings', (await page.$$eval('#cfg-bu-settings .er-result strong', (s) => s.map((x) => x.textContent))).join(), 'EPC_UAE_BU');
    await page.click('#cfg-bu-settings .er-cf-editor button:has-text("Cancel")');
    await page.fill('#cfg-exp-types input[data-field="scope"]', 'cat 320');
    await page.click('#cfg-exp-types .er-result[data-field="scopeId"]');
    await page.fill('#cfg-exp-types input[data-field="expType"]', 'day');
    await page.click('#cfg-exp-types .er-result[data-field="expenditureType"]');
    await page.waitForTimeout(300);
    T.check('expenditure type pickers: equipment and type picked, the unit shown', (await env.text('#cfg-exp-types [aria-label="Add an expenditure type mapping"]')).includes('CAT 320 Excavator')
      && (await env.text('#cfg-exp-types [aria-label="Add an expenditure type mapping"]')).includes('Operational Day Rate [Days]'));
    T.eq('opening editors wrote nothing (the preview dry run aside)', env.writes.filter((w) => !(w.body && w.body.dryRun)).length, 0);

    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('configuration-failed.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();
