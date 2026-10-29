/*
 * New EquipRite, Configuration (webApps/equiprite/flows/settings/pages/configuration-page*).
 *
 * Checks the page against the old one it replaces (webApps/vbredwoodapp/flows/setup/pages/configurations-page*):
 *   - inventory: every setting key the old page reads or writes, found by PARSING the old page and chains, is in
 *     resources/js/configurationInventory.js with the same category and description (so a setting added to the old
 *     page later fails here), every old chain is accounted for, and the carried-over page functions answer as the
 *     old ones do
 *   - search: sections, index counts and rows narrow to what matches
 *   - dependencies: what a setting needs (met or not, enforced or advice) and what it affects; the unsaved-changes
 *     summary and its effect on the real menu (app-flow.js visibleNavGroups)
 *   - every old chain that writes (found by parsing the old chains against services/ openapi): the New chain sends
 *     the same calls in the same order as the old chain on the same input (both run against one fake Actions), its
 *     endpoint and body are spelled out, and its failure path is exercised
 *   - every endpoint the page calls exists in services/
 *
 * Run:  node tests/configuration.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const NEW = path.join(ROOT, 'webApps', 'equiprite');
const OLD = path.join(ROOT, 'webApps', 'vbredwoodapp');
const OLD_PAGE = path.join(OLD, 'flows', 'setup', 'pages');
const OLD_CHAINS = path.join(OLD_PAGE, 'configurations-page-chains');
const NEW_PAGE = path.join(NEW, 'flows', 'settings', 'pages');
const NEW_CHAINS = path.join(NEW_PAGE, 'configuration-page-chains');
const JS = path.join(NEW, 'resources', 'js');

function loadAmd(file, deps, extra) {
  const sandbox = Object.assign({
    console: { log() {}, info() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Promise,
    document: { getElementById: () => ({ open() {}, close() {} }) },
    window: { location: { href: '' } },
  }, extra || {});
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps && n in deps ? deps[n] : {}))); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return mod;
}

const inv = loadAmd(path.join(JS, 'configurationInventory.js'));
const Page = loadAmd(path.join(NEW_PAGE, 'configuration-page.js'), { 'resources/js/configurationInventory': inv });
const OldPage = loadAmd(path.join(OLD_PAGE, 'configurations-page.js'));
const page = new Page();
const oldPage = new OldPage();
const html = fs.readFileSync(path.join(NEW_PAGE, 'configuration-page.html'), 'utf8');
const pageJson = JSON.parse(fs.readFileSync(path.join(NEW_PAGE, 'configuration-page.json'), 'utf8'));
const AppModule = loadAmd(path.join(NEW, 'app-flow.js'), {
  'ojs/ojarraydataprovider': function ADP(d) { this.data = d; },
  'resources/js/lineStatusLabels': { formatLabel: (c) => c },
}, { document: { querySelectorAll: () => [], body: {} }, MutationObserver: function () { this.observe = () => {}; } });
const app = new AppModule();

const oldHtml = fs.readFileSync(path.join(OLD_PAGE, 'configurations-page.html'), 'utf8');
const oldJs = fs.readFileSync(path.join(OLD_PAGE, 'configurations-page.js'), 'utf8');
const oldChainSrc = {};
fs.readdirSync(OLD_CHAINS).filter((f) => f.endsWith('.js')).forEach((f) => { oldChainSrc[f.slice(0, -3)] = fs.readFileSync(path.join(OLD_CHAINS, f), 'utf8'); });

// services/: operationId -> HTTP method
const OPS = {};
['eqp-v1', 'bipService', 'ProjectLOV'].forEach((svc) => {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'services', svc, 'openapi3.json'), 'utf8'));
  Object.values(spec.paths || {}).forEach((p) => Object.entries(p).forEach(([m, op]) => {
    if (op && op.operationId) OPS[svc + '/' + op.operationId] = m.toUpperCase();
  }));
});

// ───────────────────────────────────────────────────────────────────────────────
T.section('inventory: every setting the old page reads or writes');
const oldKeys = new Map(); // key -> { category, description } (from the old HTML when it carries them)
(oldHtml.match(/<[^>]*data-setting-key="[A-Z0-9_]+"[^>]*>/g) || []).forEach((tag) => {
  const attr = (n) => { const m = new RegExp(n + '="([^"]*)"').exec(tag); return m ? m[1] : null; };
  oldKeys.set(attr('data-setting-key'), { category: attr('data-setting-category'), description: attr('data-setting-description') });
});
const fromHtmlCount = oldKeys.size;
const allOldSrc = [oldHtml, oldJs].concat(Object.values(oldChainSrc)).join('\n');
const KEY = '([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)';
[new RegExp('getSetting(?:Bool|Value)\\([^,]+,\\s*\'' + KEY + '\'', 'g'),
  new RegExp('settingKey:\\s*\'' + KEY + '\'', 'g'),
  new RegExp('ConfigSettingsMap \\|\\| \\{\\}\\)(?:\\.|\\[\')' + KEY, 'g'),
  new RegExp('\\{ key: \'' + KEY + '\'', 'g'),
].forEach((re) => { let m; while ((m = re.exec(allOldSrc))) { if (!oldKeys.has(m[1])) oldKeys.set(m[1], {}); } });
// CLASS_MAPPING_COLUMNS_<SOURCE>: the key is built by columnMappingKey from SOURCE_CODES.
const prefix = /return '([A-Z_]+_)' \+ String\(source/.exec(oldJs)[1];
const sources = JSON.parse(/const SOURCE_CODES = (\[[^\]]+\])/.exec(oldJs)[1].replace(/'/g, '"'));
sources.forEach((s) => oldKeys.set(prefix + s, {}));
T.check('the old page was read (data-setting-key attributes, getSetting calls, chains)', fromHtmlCount >= 15 && oldKeys.size >= 20, fromHtmlCount + ' / ' + oldKeys.size);
const invKeys = new Set(inv.SETTINGS.map((s) => s.key));
const missingKeys = [...oldKeys.keys()].filter((k) => !invKeys.has(k));
T.check('every old global setting key is in the inventory', missingKeys.length === 0, missingKeys.join(', '));
const invented = [...invKeys].filter((k) => !oldKeys.has(k));
T.check('the inventory invents no setting the old page does not have', invented.length === 0, invented.join(', '));
[...oldKeys].filter(([, v]) => v.category).forEach(([k, v]) => {
  const s = inv.BY_KEY[k] || {};
  T.check(k + ': posted with the old category and description', s.category === v.category && s.description === v.description,
    JSON.stringify([s.category, s.description]) + ' vs ' + JSON.stringify([v.category, v.description]));
});

const esBlock = /esColumnMap\(\) \{[\s\S]*?\n {6}\};/.exec(oldJs)[0];
const oldEs = [...esBlock.matchAll(/^\s+([A-Z_]+):\s+\{ col: '([a-zA-Z]+)'/gm)].map((m) => m[1] + ':' + m[2]);
T.check('the old BU settings columns were read', oldEs.length >= 6, oldEs.join(','));
T.eq('every BU settings column, same API column', inv.BU_FIELDS.map((f) => f.key + ':' + f.col).sort().join(','), oldEs.sort().join(','));

inv.SETTINGS.forEach((s) => {
  const sec = inv.SECTIONS.find((x) => x.key === s.section);
  let shown;
  if (s.kind === 'now') {
    shown = html.includes('data-setting="' + s.key + '"') || (!!s.columnMapping && html.includes('$functions.columnMappingRows('));
  } else {
    const on = {};
    [s.showWhen].filter(Boolean).forEach((k) => { on[k] = { id: 1, settingValue: 'true' }; });
    shown = page.rows(s.section, on, on, {}, '', false).some((r) => r.key === s.key);
  }
  T.check(s.key + ': shown in ' + (sec ? sec.title : '?') + ', with what it affects', !!sec && shown && !!s.affects && !!s.help && !!s.label);
});
T.eq('ten sections', inv.SECTIONS.length, 10);
inv.SECTIONS.forEach((s) => T.check('section ' + s.key + ' is on the page', html.includes("'cfg-' + sec.data") ? (html.includes('id="cfg-' + s.key + '"') || ['modules', 'costing', 'notifications'].includes(s.key)) : false));

T.section('inventory: every old chain is accounted for');
const oldChainNames = Object.keys(oldChainSrc).sort();
T.eq('81 old chains', oldChainNames.length, 81);
const unlisted = oldChainNames.filter((n) => !inv.CHAINS[n]);
T.check('every old chain is listed in the inventory', unlisted.length === 0, unlisted.join(', '));
const newChainNames = fs.readdirSync(NEW_CHAINS).map((f) => f.slice(0, -3));
const lost = oldChainNames.filter((n) => inv.CHAINS[n] === 'same' && !newChainNames.includes(n));
T.check('every carried chain exists under the same name', lost.length === 0, lost.join(', '));
const notNeeded = oldChainNames.filter((n) => inv.CHAINS[n] !== 'same');
T.check('the chains not carried say why (UI only, no write)', notNeeded.every((n) => inv.CHAINS[n].startsWith('not needed:')
  && !/endpoint:/.test(oldChainSrc[n])), notNeeded.join(', '));
// A chain marked "unchanged" must be the old file plus the provenance comment, nothing else.
newChainNames.forEach((n) => {
  const src = fs.readFileSync(path.join(NEW_CHAINS, n + '.js'), 'utf8');
  if (/configurations-page-chains\/[A-Za-z]+\.js, unchanged\./.test(src)) {
    const stripped = src.replace(/\n {2}\/\/ From Old EquipRite flows\/setup\/pages\/configurations-page-chains\/[A-Za-z]+\.js, unchanged\.\n/, '');
    T.check(n + ': identical to the old chain apart from the provenance line', stripped === oldChainSrc[n]);
  } else if (oldChainSrc[n] && n !== 'enforcePageAccessChain') {
    T.check(n + ': says which old chain it comes from', src.includes('configurations-page-chains/' + n + '.js'));
  }
});
T.check('enforcePageAccessChain is byte-identical to the shared one',
  fs.readFileSync(path.join(NEW_CHAINS, 'enforcePageAccessChain.js'), 'utf8')
    === fs.readFileSync(path.join(NEW, 'flows', 'request', 'pages', 'my-requests-page-chains', 'enforcePageAccessChain.js'), 'utf8'));
['invOrgAddress', 'expenditureTypes', 'fetchAllPages', 'bipLov', 'currentUser', 'geocoder'].forEach((f) => {
  T.check('resources/js/' + f + '.js copied unchanged from Old EquipRite',
    fs.readFileSync(path.join(JS, f + '.js'), 'utf8') === fs.readFileSync(path.join(OLD, 'resources', 'js', f + '.js'), 'utf8'));
});
T.check('every chain the page JSON names exists', (() => {
  const named = new Set();
  const visit = (o) => { if (Array.isArray(o)) o.forEach(visit); else if (o && typeof o === 'object') { if (typeof o.chain === 'string') named.add(o.chain); Object.values(o).forEach(visit); } };
  visit(pageJson);
  return [...named].every((c) => newChainNames.includes(c));
})());

T.section('carried page functions answer as the old ones');
const oldFns = Object.getOwnPropertyNames(OldPage.prototype).filter((f) => f !== 'constructor');
T.check('every old page function is in the new module', oldFns.every((f) => typeof Page.prototype[f] === 'function'),
  oldFns.filter((f) => typeof Page.prototype[f] !== 'function').join(', '));
const SAMPLE_TYPES = [{ source: 'INVENTORY', value: 'CATEGORY', label: 'Category', sort: '10', group: 'CATEGORIES', groupName: 'Categories' },
  { source: 'INVENTORY', value: 'ITEM_CLASS', label: 'Item class', sort: '20', group: 'ITEM_CLASS', groupName: 'Item Class' },
  { source: 'MAINTENANCE', value: 'ITEM', label: 'Item', sort: '10', group: 'ATTR', groupName: 'Attributes' }];
const SAMPLE_MAP = { CLASS_MAPPING_COLUMNS_INVENTORY: { id: 1, settingValue: '{"classGroup":"CATEGORIES","classColumn":"CATEGORY","subclassColumn":"ITEM_CLASS","subclassGroup":"ITEM_CLASS"}' },
  PPM_RATES_ENABLED: { id: 2, settingValue: 'true' }, PPM_DOCUMENT: { id: 3, settingValue: 'Misc' } };
const ES_ROWS = [{ id: 1, businessUnitId: 7, businessUnitName: 'BU7', rateSource: 'PPM_RATES', passProcurementCost: 'Y', marginPercentage: 0 },
  { id: 2, businessUnitId: 7 }, { id: 3, businessUnitId: 8, adhocTimesheetEnabled: 'true' }, { id: 4, businessUnitId: null }];
const PARITY = [
  ['trackingTypeLabel', ['FIXED_ASSET']], ['trackingTypeLabel', ['nope']],
  ['buildSettingsMap', [[{ id: 1, settingKey: 'A', settingValue: 'x' }, { settingKey: 'B' }]]],
  ['getSettingBool', [SAMPLE_MAP, 'PPM_RATES_ENABLED']], ['getSettingValue', [SAMPLE_MAP, 'NONE', 'd']],
  ['getMissingPpmPostingRows', [SAMPLE_MAP, { txnSource: 'T', document: 'D', docEntry: 'E' }]],
  ['mapClassRows', [[{ id: 2, className: 'B' }, { id: 1, classCode: 'A', fusionClassRef: 5 }]]],
  ['bulkFusionRequest', ['INVENTORY', { classColumn: 'CATEGORY', subclassColumn: 'ITEM_CLASS' }, [{ key: 0, classRef: '1', className: 'X', subclassRef: '2', subclassName: 'Y' }], true]],
  ['pairStatusLabel', [{ classAction: 'LINK', subAction: 'CREATE' }]], ['pairActionable', [{ classAction: 'EXISTS', subAction: 'NONE' }]],
  ['bulkSourceOptions', [SAMPLE_MAP, 'MAINTENANCE']],
  ['fusionSourceText', [{ classId: 1, fusionSubclassRef: '9' }, [{ id: 1, fusionClassRef: '5', fusionSourceType: 'INVENTORY' }], SAMPLE_TYPES]],
  ['reportTrackingType', ['fixed_asset']], ['classMapSourceOptions', ['']], ['classMapPrecedenceOptions', ['FIXED_ASSET']],
  ['classMapPrecedenceForTruth', ['MAINTENANCE,INVENTORY', 'FIXED_ASSET']], ['addClassTypeOptions', ['MAINTENANCE']],
  ['isAllowedSource', ['FIXED_ASSET', 'MAINTENANCE']], ['fieldGroupOptions', ['INVENTORY', SAMPLE_TYPES]],
  ['columnOptions', ['INVENTORY', 'CATEGORIES', SAMPLE_TYPES]], ['columnMappingFor', [SAMPLE_MAP, 'INVENTORY']],
  ['columnMappingRows', [SAMPLE_MAP]], ['fieldGroupLabel', ['INVENTORY', 'ITEM_CLASS', SAMPLE_TYPES]],
  ['categoryTypeLabel', ['INVENTORY', 'CATALOG', SAMPLE_TYPES]],
  ['mapSubclassRows', [[{ id: 3, eqrEquipmentClassId: 1, subclassName: 'S', timesheetEntryEnabled: 'Y', bufferPeriodDays: '2' }]]],
  ['filterSubclasses', [[{ id: 1, classId: 1 }, { id: 2, classId: 2 }], 2, null]],
  ['buOrgRowKey', [1, 2]], ['buOrgNeedsSubinventory', ['DESTINATION_YARD']],
  ['mapMappingRowsFromApi', [{ data: [{ id: 1, businessUnitId: 1, invOrgId: 2, orgRole: 'EQUIPMENT_YARD', townOrCity: 'X', isActiveFlag: 'N' }] }, [{ value: 'EQUIPMENT_YARD', label: 'Equipment Yard' }]]],
  ['buildBuFilterLov', [[{ buId: 2, buName: 'B' }, { buId: 1, buName: 'A' }, { buId: 2 }]]],
  ['filterBuOrgMappings', [[{ buId: 1 }, { buId: 2 }], '2']],
  ['esDraftToBody', [{ RATE_SOURCE: 'PPM_RATES', PASS_PROCUREMENT_COST: true, MARGIN_PERCENTAGE: '' }]],
  ['mapFusionBuAttrs', [{ BusinessUnitName: 'X', PrimaryLedgerId: '30', LocationId: 4, ManagerId: null }]],
  ['buildSettingsByBu', [ES_ROWS]], ['esLovLabel', ['PPM_RATES', [{ value: 'PPM_RATES', label: 'PPM Rates' }]]], ['esYesNo', ['Y']],
];
PARITY.forEach(([fn, args]) => {
  T.eq(fn + ': same answer as the old module', JSON.stringify(page[fn](...args)), JSON.stringify(oldPage[fn](...args)));
});

// ───────────────────────────────────────────────────────────────────────────────
T.section('search');
const visible = (q) => page.indexEntries(q).filter((e) => e.visible).map((e) => e.key + ':' + e.count).join(',');
T.eq('no search: every section, every setting counted', page.indexEntries('').map((e) => e.count).join(','), '5,9,4,6,4,12,2,1,2,1');
T.eq('"week" finds the two week settings, in Costing & timesheets', visible('week'), 'costing:2');
const ON = { TIMESHEETS_ENABLED: { id: 4, settingValue: 'true' }, WEEK_CONFIG_ENABLED: { id: 7, settingValue: 'true' } };
T.eq('…and only those rows are drawn', page.rows('costing', ON, ON, {}, 'week', false).map((r) => r.key).join(','), 'WEEK_CONFIG_ENABLED,WEEK_END_DAY');
T.eq('a section title shows all of it', page.rows('notifications', {}, {}, {}, 'notifications', false).length, 4);
T.check('the old label finds the setting', page.rows('costing', ON, ON, {}, 'FUSION PPM RATES', false).some((x) => x.key === 'PPM_RATES_ENABLED'));
T.eq('the setting key finds it', page.rows('modules', {}, {}, {}, 'ENABLE_QUOTES', false).map((r) => r.key).join(), 'ENABLE_QUOTES');
T.check('every word must match', page.rows('notifications', {}, {}, {}, 'email approval', false).some((r) => r.key === 'NOTIFY_ON_APPROVAL')
  && !page.rows('notifications', {}, {}, {}, 'email approval', false).some((r) => r.key === 'NOTIFY_ON_REJECTION'));
T.eq('a list field finds its section', visible('subinventory'), 'yards:1');
T.eq('a BU settings column finds its section (markup, and the pass-cost field that uses it)', visible('markup'), 'bu-settings:2');
T.eq('the old tab name finds the section', visible('audit trail'), 'history:1');
T.check('nothing found says so', page.searchSummary('zzqx').startsWith('Nothing matches'));
T.eq('found says how much', page.searchSummary('week'), '2 matches in 1 section.');
T.check('a hidden posting label is not drawn while PPM is off, even when searched', page.rows('costing', ON, ON, {}, 'ppm document', false).length === 0);

T.section('dependencies: what a setting needs and affects');
const row = (key, map, stored, changed, ro) => page.rows(inv.BY_KEY[key].section, map, stored || map, changed || {}, '', !!ro).find((r) => r.key === key);
const TS_OFF = { TIMESHEETS_ENABLED: { id: 4, settingValue: 'false' } };
let r = row('PPM_RATES_ENABLED', TS_OFF);
T.eq('PPM rates needs Timesheets, shown as not met', JSON.stringify(r.needs.map((n) => [n.label, n.ok])), '[["Timesheets",false]]');
T.check('…enforced: the switch is disabled and says why', r.disabled && r.note === 'Turn on Timesheets first.');
r = row('PPM_RATES_ENABLED', ON);
T.check('with Timesheets on the need is met and the switch free', r.needs[0].ok && !r.disabled && r.note === '');
T.check('PPM rates says it withdraws Post costs and Rate schedules', /Post costs and Rate schedules/.test(r.affects));
r = row('AGREEMENTS_ENABLED', { CUSTOMERS_MODULE_ENABLED: { id: 2, settingValue: 'false' } });
T.check('Rental agreements needs the customers module, as advice (not disabled)', !r.needs[0].ok && !r.disabled && r.depth === 1 && r.dim);
T.eq('the modules say one must stay on', row('PROJECTS_MODULE_ENABLED', {}).keepOn, 'Equipment for external customers');
const WEEK = Object.assign({}, ON, { WEEK_END_DAY: { id: 8, settingValue: 'FRIDAY' } });
r = row('WEEK_END_DAY', WEEK);
T.check('a saved week-ending day is locked, offers Reset, says so', r.disabled && r.canReset && /Saved as Friday/.test(r.note));
T.check('…not locked by a pick that is not saved yet', !row('WEEK_END_DAY', WEEK, ON, { WEEK_END_DAY: { settingValue: 'FRIDAY' } }).disabled);
T.check('…and needs the fixed week switch', row('WEEK_END_DAY', TS_OFF).disabled && /Fixed week-ending day/.test(row('WEEK_END_DAY', TS_OFF).note));
T.check('a read-only page disables every control', page.rows('modules', ON, ON, {}, '', true).every((x) => x.disabled));
T.eq('a choice shows the default when never saved', row('ENABLE_QUOTES', {}).options.filter((o) => o.on).map((o) => o.label).join(), 'External only');
T.eq('PPM labels show the default that posts today', row('PPM_TXN_SOURCE', { TIMESHEETS_ENABLED: ON.TIMESHEETS_ENABLED, PPM_RATES_ENABLED: { id: 5, settingValue: 'true' } }).value, 'External Miscellaneous');
T.check('every needs entry names a real setting', inv.SETTINGS.every((s) => (s.needs || []).every((k) => inv.BY_KEY[k])));
r = row('AGREEMENTS_ENABLED', { AGREEMENTS_ENABLED: { id: 3, settingValue: 'true' } }, { AGREEMENTS_ENABLED: { id: 3, settingValue: 'false' } },
  { AGREEMENTS_ENABLED: { id: 3, settingValue: 'true' } });
T.check('a changed row is marked with what it was', r.changed && r.was === 'Off' && /changed/.test(page.rowClass(r)));
T.eq('the change list reads in save order', JSON.stringify(page.changeList({ AGREEMENTS_ENABLED: { settingValue: 'true' }, PPM_TXN_SOURCE: { settingValue: 'X' } },
  { AGREEMENTS_ENABLED: { id: 3, settingValue: 'false' } })),
JSON.stringify([{ key: 'AGREEMENTS_ENABLED', label: 'Rental agreements', from: 'Off', to: 'On' }, { key: 'PPM_TXN_SOURCE', label: 'PPM transaction source', from: 'not saved yet', to: 'X' }]));
const ACCESS = {};
['EQR_DASHBOARD', 'EQR_POST_COST', 'EQR_RATE_SCHEDULE', 'EQR_RENTAL_AGREEMENTS', 'EQR_TIMESHEETS', 'EQR_CONFIGURATIONS'].forEach((c) => { ACCESS[c] = 'FULL'; });
const FLAGS = { PROJECTS_MODULE_ENABLED: 'true', TIMESHEETS_ENABLED: 'true', AGREEMENTS_ENABLED: 'false', PPM_RATES_ENABLED: 'false' };
const impact = (changed) => page.menuImpact(app.visibleNavGroups(ACCESS, true, FLAGS, true, {}),
  app.visibleNavGroups(ACCESS, true, page.flagsAfter(FLAGS, changed), true, {}));
T.eq('turning agreements on: the menu will show Rental agreements', impact({ AGREEMENTS_ENABLED: { settingValue: 'true' } }).join(' '), 'The menu will show Rental agreements.');
T.eq('turning PPM rates on: Post costs and Rate schedules leave the menu', impact({ PPM_RATES_ENABLED: { settingValue: 'true' } }).join(' '),
  'The menu will hide Post costs, Rate schedules.');
T.eq('a non-flag change does not touch the menu', impact({ ENABLE_QUOTES: { settingValue: 'BOTH' } }).length, 0);
T.eq('Configuration is a New screen in the menu', JSON.stringify(app.getNavRoute('configuration')), JSON.stringify({ flow: 'settings', page: 'configuration' }));
T.eq('…gated by EQR_CONFIGURATIONS, with the Old link kept', app.getPageCodeForPage({ id: 'configuration' }) + ' ' + app.oldAppLink('http://x/', 'configuration'),
  'EQR_CONFIGURATIONS http://x/vp/shell/setup/configurations');
T.eq('Business unit settings: the global PPM switch overrides the BU', page.esRateText({ RATE_SOURCE: 'EQUIPRITE_RATES' }, { PPM_RATES_ENABLED: { settingValue: 'true' } }), 'PPM Rates (global)');
T.eq('…a configured BU is not offered for Add (edit it from its row)', page.buPickOptions([{ BusinessUnitId: 7, BusinessUnitName: 'A' }, { BusinessUnitId: 8, BusinessUnitName: 'B' }], '', [{ buId: 7 }]).map((o) => o.value).join(), '8');

// ───────────────────────────────────────────────────────────────────────────────
// Fake VB runtime: one context, a fake Actions recording every call, chains loaded from the old or the new folder.
const bipLovReal = loadAmd(path.join(JS, 'bipLov.js'));
const bipLov = {
  buildSoapBody: bipLovReal.buildSoapBody,
  // The real decoder needs a browser DOMParser; the fake backend answers BI Publisher with rows directly.
  decodeReportRows: (body, tag, id, label, label2) => ((body && body.rows) || []).map((x) => Object.assign({}, x, {
    id: x[id] || '', label: x[label] || '', label2: label2 ? (x[label2] || '') : '' })),
};
const geocoder = { lookup: async () => ({ latitude: 31.85, longitude: -102.37 }) };
const invOrgAddress = loadAmd(path.join(JS, 'invOrgAddress.js'), { 'resources/js/bipLov': bipLov, 'resources/js/geocoder': geocoder });
const cu = { auditHeaders: () => ({ 'X-User-Id': 'priya.raman' }) };
const clone = (o) => JSON.parse(JSON.stringify(o));
const DEFAULTS = {};
Object.entries(pageJson.variables).forEach(([k, v]) => { DEFAULTS[k] = v.defaultValue === undefined ? null : clone(v.defaultValue); });

function makeEnv(which, setup) {
  const s = setup || {};
  const calls = [];
  const toasts = [];
  const dir = which === 'old' ? OLD_CHAINS : NEW_CHAINS;
  const variables = Object.assign(clone(DEFAULTS), clone(s.vars || {}));
  const appVars = Object.assign({ featureFlags: {}, globalSettings: {}, flagsLoaded: true, buRateSources: {}, pageAccessMap: { EQR_CONFIGURATIONS: 'FULL' }, pageAccessLoaded: true }, s.app || {});
  const respond = s.respond || (() => null);
  const Actions = {
    async callRest(ctx, o) {
      const call = { endpoint: o.endpoint, uriParams: o.uriParams || o.queryParams, body: o.body, headers: o.headers };
      calls.push(call);
      const method = OPS[o.endpoint] || 'GET';
      const def = { ok: true, status: method === 'POST' ? 201 : 200, statusCode: method === 'POST' ? 201 : 200, body: method === 'GET' ? { data: [] } : {} };
      const r = respond(o, method, calls);
      if (r && r.ok === false && r.status && r.statusCode === undefined) r.statusCode = r.status;
      return Object.assign(def, r || {});
    },
    async fireNotificationEvent(ctx, n) { toasts.push(n); calls.push({ toast: n.summary, type: n.type }); },
    async callChain(ctx, o) { calls.push({ chain: o.chain }); return run(o.chain, o.params); },
    async callComponentMethod() {},
    async resetVariables() {},
  };
  const context = {
    $page: { variables, functions: which === 'old' ? oldPage : page },
    $application: { variables: appVars, functions: app, user: { username: 'priya.raman' } },
  };
  function run(name, params) {
    const C = loadAmd(path.join(dir, name + '.js'), {
      'vb/action/actionChain': class {}, 'vb/action/actions': Actions,
      'resources/js/configurationInventory': inv, 'resources/js/bipLov': bipLov, 'resources/js/currentUser': cu,
      'resources/js/invOrgAddress': invOrgAddress, 'resources/js/geocoder': geocoder,
      'resources/js/expenditureTypes': loadAmd(path.join(JS, 'expenditureTypes.js')), 'resources/js/fetchAllPages': loadAmd(path.join(JS, 'fetchAllPages.js')),
    });
    return new C().run(context, params || {});
  }
  return { calls, toasts, variables, appVars, context, run,
    writes: () => calls.filter((c) => c.endpoint && OPS[c.endpoint] && OPS[c.endpoint] !== 'GET'),
    seq: () => calls.map((c) => (c.endpoint ? (OPS[c.endpoint] || '?') + ' ' + c.endpoint.split('/')[1] : c.toast ? 'toast:' + c.type : 'chain:' + c.chain)) };
}
// Writes compared old vs new; the timestamp a create stamps is the only thing allowed to differ.
const norm = (w) => JSON.stringify(w.map((c) => ({ endpoint: c.endpoint, uriParams: c.uriParams, headers: c.headers,
  body: c.body && typeof c.body === 'object' ? Object.assign({}, c.body, c.body.effectiveStartDate ? { effectiveStartDate: 'T' } : {}) : c.body })));

const SETTINGS_ROWS = [
  { id: 1, settingKey: 'PROJECTS_MODULE_ENABLED', settingValue: 'true', settingCategory: 'FEATURE_FLAG' },
  { id: 2, settingKey: 'CUSTOMERS_MODULE_ENABLED', settingValue: 'true', settingCategory: 'FEATURE_FLAG' },
  { id: 3, settingKey: 'AGREEMENTS_ENABLED', settingValue: 'false', settingCategory: 'FEATURE_FLAG' },
  { id: 4, settingKey: 'TIMESHEETS_ENABLED', settingValue: 'true', settingCategory: 'FEATURE_FLAG' },
  { id: 6, settingKey: 'ENABLE_QUOTES', settingValue: 'BOTH', settingCategory: 'SYSTEM' },
  { id: 8, settingKey: 'WEEK_END_DAY', settingValue: 'FRIDAY', settingCategory: 'SYSTEM' },
  { id: 11, settingKey: 'CLASS_MAPPING_SOURCE_OF_TRUTH', settingValue: 'MAINTENANCE', settingCategory: 'SYSTEM' },
  { id: 13, settingKey: 'CLASS_MAPPING_PRECEDENCE', settingValue: 'MAINTENANCE,INVENTORY', settingCategory: 'SYSTEM' },
];
const MAP = oldPage.buildSettingsMap(SETTINGS_ROWS);
const okGet = (o) => (o.endpoint === 'eqp-v1/getConfGlobalSettings' ? { body: { data: SETTINGS_ROWS } } : null);
const fail = (endpoint, status, body) => (o) => (o.endpoint === endpoint ? { ok: false, status: status || 500, body: body || { detail: 'boom' } } : okGet(o));

/**
 * CASES: one per old chain that writes. Each runs the New chain and the old chain on the same input against the
 * fake backend and requires the same writes in the same order, then checks what the New chain sent and its
 * failure path. `params` are what the page passes; `oldParams` when the old page passed them differently.
 */
const CASES = {};
const WRITERS_SEEN = new Set();
function parity(name, setup, label) {
  const a = makeEnv('old', setup);
  const b = makeEnv('new', setup);
  return Promise.resolve()
    .then(() => a.run(name, setup.oldParams || setup.params))
    .catch((e) => { a.error = e; })
    .then(() => b.run(name, setup.params))
    .catch((e) => { b.error = e; })
    .then(() => {
      WRITERS_SEEN.add(name);
      T.eq(name + ': same writes as the old chain' + (label ? ' (' + label + ')' : ''), norm(b.writes()), norm(a.writes()));
      return b;
    });
}
const firstWrite = (e) => e.writes()[0] || {};
const lastToast = (e) => e.toasts[e.toasts.length - 1] || {};

CASES.saveChangesChain = async () => {
  const changed = {
    AGREEMENTS_ENABLED: { id: 3, settingValue: 'true', businessUnitId: null, settingCategory: 'FEATURE_FLAG', description: null },
    PPM_TXN_SOURCE: { id: null, settingValue: 'External Miscellaneous', settingCategory: 'PPM_POSTING', description: inv.BY_KEY.PPM_TXN_SOURCE.description },
  };
  const e = await parity('saveChangesChain', { vars: { changedRows: changed, hasChanges: true, ConfigSettingsMap: MAP }, respond: okGet });
  T.eq('save: PATCH a stored key by id with its value only', JSON.stringify([firstWrite(e).endpoint, firstWrite(e).uriParams, firstWrite(e).body]),
    JSON.stringify(['eqp-v1/patchConfGlobalSettingsById', { id: 3 }, { settingValue: 'true' }]));
  T.eq('save: POST a never-saved key with its category, description and the audit columns', JSON.stringify(e.writes()[1].body), JSON.stringify({
    settingKey: 'PPM_TXN_SOURCE', settingValue: 'External Miscellaneous', settingCategory: 'PPM_POSTING', isActiveFlag: 'Y',
    description: inv.BY_KEY.PPM_TXN_SOURCE.description, createdBy: 'EQUIPRITE', lastUpdatedBy: 'EQUIPRITE' }));
  T.eq('save: writes, reload, app flags refresh, toast', e.seq().join(' > '),
    'PATCH patchConfGlobalSettingsById > POST postConfGlobalSettings > chain:loadConfigSettingsChain > GET getConfGlobalSettings > GET getAuditTrail'
    + ' > chain:onColumnMapSourceChangedChain > GET getConfGlobalSettings > toast:confirmation');
  T.check('save: the app flags the menu reads are refreshed', e.appVars.featureFlags.AGREEMENTS_ENABLED === 'false' && e.appVars.globalSettings.ENABLE_QUOTES === 'BOTH');
  T.check('save: nothing pending afterwards', Object.keys(e.variables.changedRows).length === 0 && !e.variables.hasChanges);
  const f = makeEnv('new', { vars: { changedRows: changed, hasChanges: true, ConfigSettingsMap: MAP },
    respond: (o) => (o.endpoint === 'eqp-v1/patchConfGlobalSettingsById' ? { ok: false, status: 500 } : o.endpoint === 'eqp-v1/postConfGlobalSettings' ? { body: { id: 99 } } : null) });
  await f.run('saveChangesChain');
  T.check('save failure: says which key failed, no reload', /AGREEMENTS_ENABLED/.test(f.variables.saveError) && !f.calls.some((c) => c.chain));
  T.check('save failure: only the failed key stays pending; the created one keeps its new id',
    Object.keys(f.variables.changedRows).join() === 'AGREEMENTS_ENABLED' && f.variables.ConfigSettingsMap.PPM_TXN_SOURCE.id === 99);
};
CASES.saveGlobalSettingNowChain = async () => {
  let e = await parity('saveGlobalSettingNowChain', { vars: { ConfigSettingsMap: MAP }, params: { settingKey: 'CLASS_MAPPING_PRECEDENCE', settingValue: 'INVENTORY,MAINTENANCE' } }, 'stored');
  T.eq('save now: PATCH by id', JSON.stringify([firstWrite(e).endpoint, firstWrite(e).uriParams, firstWrite(e).body]),
    JSON.stringify(['eqp-v1/patchConfGlobalSettingsById', { id: 13 }, { settingValue: 'INVENTORY,MAINTENANCE' }]));
  e = await parity('saveGlobalSettingNowChain', { vars: { ConfigSettingsMap: MAP }, params: { settingKey: 'CLASS_MAPPING_COLUMNS_FIXED_ASSET', settingValue: '{}', description: 'd' } }, 'new');
  T.eq('save now: POST a new key as SYSTEM', JSON.stringify(firstWrite(e).body), JSON.stringify({ settingKey: 'CLASS_MAPPING_COLUMNS_FIXED_ASSET',
    settingValue: '{}', settingCategory: 'SYSTEM', isActiveFlag: 'Y', description: 'd', createdBy: 'EQUIPRITE', lastUpdatedBy: 'EQUIPRITE' }));
  e = makeEnv('new', { vars: { ConfigSettingsMap: MAP } });
  const same = await e.run('saveGlobalSettingNowChain', { settingKey: 'CLASS_MAPPING_PRECEDENCE', settingValue: 'MAINTENANCE,INVENTORY' });
  T.check('save now: the stored value again writes nothing', !same.saved && e.writes().length === 0);
  e = makeEnv('new', { vars: { ConfigSettingsMap: MAP }, respond: fail('eqp-v1/patchConfGlobalSettingsById', 400, { detail: 'bad' }) });
  T.check('save now: a failure throws to the caller', await e.run('saveGlobalSettingNowChain', { settingKey: 'CLASS_MAPPING_PRECEDENCE', settingValue: 'X' }).then(() => false, (err) => err.message === 'bad'));
};
CASES.resetWeekEndDayChain = async () => {
  const setup = { vars: { ConfigSettingsMap: MAP, StoredSettingsMap: MAP, confirm: { kind: 'resetWeek' } }, respond: okGet };
  const e = await parity('resetWeekEndDayChain', setup);
  T.eq('reset week: PATCH WEEK_END_DAY to blank', JSON.stringify([firstWrite(e).uriParams, firstWrite(e).body]), JSON.stringify([{ id: 8 }, { settingValue: '' }]));
  T.check('reset week: reload, confirm closed', e.calls.some((c) => c.chain === 'loadConfigSettingsChain') && e.variables.confirm === null);
  const f = makeEnv('new', Object.assign({}, setup, { respond: fail('eqp-v1/patchConfGlobalSettingsById') }));
  await f.run('resetWeekEndDayChain');
  T.check('reset week failure: error toast, no reload', lastToast(f).type === 'error' && !f.calls.some((c) => c.chain));
};
const ES_ROW = { buId: 300000001, buName: 'EPC_US_BU', __rowId: 70, RATE_SOURCE: 'EQUIPRITE_RATES', PPM_TRANS_SOURCE: 'EQUIPRITE', PPM_BATCH_PREFIX: 'P', MARGIN_PERCENTAGE: 10, PASS_PROCUREMENT_COST: true, ADHOC_TIMESHEET_ENABLED: false };
const BU_ATTRS = { businessUnitName: 'EPC_US_BU', buPrimaryLedgerId: 30, buLocationId: 4, buManagerId: null, buLegalEntityId: 5 };
CASES.saveEsDrawerChain = async () => {
  const draft = Object.assign({}, ES_ROW, { buAttrs: BU_ATTRS, MARGIN_PERCENTAGE: 12 });
  let e = await parity('saveEsDrawerChain', { vars: { EsDraft: draft, EsSettingsByBuArray: [ES_ROW], isEsDrawerOpen: true } }, 'edit');
  T.eq('BU settings edit: PATCH the BU row with its columns, the Fusion BU columns and lastUpdatedBy',
    JSON.stringify([firstWrite(e).endpoint, firstWrite(e).uriParams, firstWrite(e).body]), JSON.stringify(['eqp-v1/patchConfEquipmentSettingsById', { id: 70 },
      { rateSource: 'EQUIPRITE_RATES', passProcurementCost: 'Y', ppmTransSource: 'EQUIPRITE', ppmBatchPrefix: 'P', adhocTimesheetEnabled: 'N', marginPercentage: 12,
        businessUnitName: 'EPC_US_BU', buPrimaryLedgerId: 30, buLocationId: 4, buManagerId: null, buLegalEntityId: 5, lastUpdatedBy: 'EQUIPRITE' }]));
  T.check('BU settings edit: closes, reloads', !e.variables.isEsDrawerOpen && e.calls.some((c) => c.chain === 'loadEsSettingsChain'));
  e = await parity('saveEsDrawerChain', { vars: { EsDraft: Object.assign({}, draft, { buId: 300000002 }), EsSettingsByBuArray: [ES_ROW] } }, 'new BU');
  T.eq('BU settings add: POST a row with the BU id, active, audit columns first', JSON.stringify(Object.keys(firstWrite(e).body).slice(0, 4).concat(firstWrite(e).body.businessUnitId)),
    JSON.stringify(['businessUnitId', 'isActiveFlag', 'createdBy', 'lastUpdatedBy', 300000002]));
  for (const [label, d, msg] of [['no BU', { buId: null }, 'Business Unit required'], ['no rate source', { RATE_SOURCE: '' }, 'Rate Source required']]) {
    const x = await parity('saveEsDrawerChain', { vars: { EsDraft: Object.assign({}, draft, d), EsSettingsByBuArray: [ES_ROW] } }, label);
    T.check('BU settings: ' + label + ' is refused with a warning, nothing written', x.writes().length === 0 && lastToast(x).summary === msg);
  }
  e = makeEnv('new', { vars: { EsDraft: Object.assign({}, draft, { MARGIN_PERCENTAGE: 150 }), EsSettingsByBuArray: [ES_ROW] } });
  await e.run('saveEsDrawerChain');
  T.check('BU settings: a markup over 100% is refused (the old number field allowed 0-100)', e.writes().length === 0 && lastToast(e).type === 'warning');
  e = makeEnv('new', { vars: { EsDraft: draft, EsSettingsByBuArray: [ES_ROW], isEsDrawerOpen: true }, respond: fail('eqp-v1/patchConfEquipmentSettingsById') });
  await e.run('saveEsDrawerChain');
  T.check('BU settings failure: error toast, the form stays open', lastToast(e).type === 'error' && e.variables.isEsDrawerOpen);
};
const MAPPINGS = oldPage.mapMappingRowsFromApi({ data: [
  { id: 501, businessUnitId: 300000001, buName: 'EPC_US_BU', invOrgId: 9001, invOrgName: 'Houston Yard', invOrgCode: 'HOU', locationCode: 'HOU-01', orgRole: 'EQUIPMENT_YARD',
    isActiveFlag: 'Y', isTransactable: 'N', subinventoryCode: 'STORES', addressLine1: '1 Yard Rd', invOrgLatitude: 29.7, invOrgLongitude: -95.3 },
  { id: 502, businessUnitId: 300000001, buName: 'EPC_US_BU', invOrgId: 9003, invOrgName: 'Old Yard', orgRole: 'DESTINATION_YARD', isActiveFlag: 'N' },
  { id: 503, businessUnitId: 300000002, buName: 'EPC_UAE_BU', invOrgId: 9100, invOrgName: 'Dubai Yard', orgRole: 'EQUIPMENT_YARD', isActiveFlag: 'Y' }] },
DEFAULTS.OrgRoleLovArray);
const BIP_ADDR = (o) => (o.endpoint === 'bipService/runBIPReport' ? { body: { rows: [{ LOCATION_ID: 1, LOCATION_CODE: 'ODS-01', ADDRESS_LINE_1: '1200 Pipeline Rd', TOWN_OR_CITY: 'Odessa', COUNTRY: 'US' }] } } : null);
CASES.addBuOrgMappingChain = async () => {
  const cur = { buId: 300000001, buName: 'EPC_US_BU', orgId: 9002, orgName: 'Odessa Yard', orgCode: 'ODS', location: 'ODS-01', status: 'Active', yardType: 'VIRTUAL_PROJECT', isTransactable: 'Y', subinventoryCode: 'YARD' };
  const e = await parity('addBuOrgMappingChain', { vars: { currentMapping: cur, BuOrgMappingsArray: MAPPINGS, isBuOrgDrawerOpen: true }, respond: BIP_ADDR });
  const put = e.writes().find((w) => w.endpoint === 'eqp-v1/upsertBuOrgMappingsByBU') || {};
  T.eq('add mapping: the address report first, then one PUT for the BU', e.writes().map((w) => w.endpoint).join(' > '), 'bipService/runBIPReport > eqp-v1/upsertBuOrgMappingsByBU');
  T.check('add mapping: the address report is asked for this org', /EQP_INV_ORG_ADDRESSES/.test(firstWrite(e).body) && /9002/.test(firstWrite(e).body));
  T.eq('add mapping: PUT by business unit, with its stored name', JSON.stringify([put.uriParams, put.body.businessUnitId, put.body.buName]), JSON.stringify([{ businessUnitId: 300000001 }, 300000001, 'EPC_US_BU']));
  T.eq('add mapping: the BU\'s other ACTIVE yards are sent again, other BUs and inactive rows are not', put.body.mappings.map((m) => m.invOrgId).join(), '9001,9002');
  T.eq('add mapping: an existing yard keeps its own flags, subinventory and address',
    JSON.stringify(put.body.mappings[0]), JSON.stringify({ invOrgId: 9001, orgRole: 'EQUIPMENT_YARD', invOrgCode: 'HOU', invOrgName: 'Houston Yard', locationCode: 'HOU-01',
      isActiveFlag: 'Y', isTransactable: 'N', subinventoryCode: 'STORES', addressLine1: '1 Yard Rd', invOrgLatitude: 29.7, invOrgLongitude: -95.3 }));
  T.eq('add mapping: the new yard with its Fusion address and coordinates', JSON.stringify(put.body.mappings[1]), JSON.stringify({ invOrgId: 9002, orgRole: 'VIRTUAL_PROJECT',
    invOrgCode: 'ODS', invOrgName: 'Odessa Yard', locationCode: 'ODS-01', isActiveFlag: 'Y', isTransactable: 'Y', subinventoryCode: 'YARD', addressLine1: '1200 Pipeline Rd',
    townOrCity: 'Odessa', country: 'US', invOrgLatitude: 31.85, invOrgLongitude: -102.37 }));
  T.check('add mapping: reloads afterwards', e.calls.some((c) => c.chain === 'loadBuOrgMappingsChain'));
  for (const [label, patch, msg] of [['no BU', { buId: null }, 'Business Unit required'], ['no yard', { orgId: null }, 'Yard required'],
    ['no yard type', { yardType: null }, 'Yard type required'], ['a yard already mapped', { orgId: 9001 }, 'Yard already mapped']]) {
    const x = await parity('addBuOrgMappingChain', { vars: { currentMapping: Object.assign({}, cur, patch), BuOrgMappingsArray: MAPPINGS }, respond: BIP_ADDR }, label);
    T.check('add mapping: ' + label + ' is refused, nothing written', x.writes().length === 0 && lastToast(x).summary === msg);
  }
  const x = await parity('addBuOrgMappingChain', { vars: { currentMapping: Object.assign({}, cur, { orgId: 9003, yardType: 'DESTINATION_YARD' }), BuOrgMappingsArray: MAPPINGS }, respond: BIP_ADDR }, 'an inactive yard again');
  T.check('add mapping: an inactive (deleted) yard can be mapped again, without a subinventory for a destination yard',
    x.writes().length === 2 && x.writes()[1].body.mappings[1].subinventoryCode === null);
  const f = makeEnv('new', { vars: { currentMapping: cur, BuOrgMappingsArray: MAPPINGS }, respond: (o) => (o.endpoint === 'eqp-v1/upsertBuOrgMappingsByBU' ? { ok: false, status: 409 } : BIP_ADDR(o)) });
  await f.run('addBuOrgMappingChain');
  T.check('add mapping failure: error toast with the status', lastToast(f).type === 'error' && /409/.test(lastToast(f).message));
};
CASES.deleteBuOrgMappingRowChain = async () => {
  const setup = { vars: { BuOrgMappingsArray: MAPPINGS, confirm: { kind: 'deleteBuOrg' } }, params: { rowKey: '300000001-9001' } };
  const e = await parity('deleteBuOrgMappingRowChain', setup);
  T.eq('delete mapping: DELETE by id', JSON.stringify([firstWrite(e).endpoint, firstWrite(e).uriParams]), JSON.stringify(['eqp-v1/deleteBuOrgMapping', { id: 501 }]));
  T.check('delete mapping: confirm closed, reloaded', e.variables.confirm === null && e.calls.some((c) => c.chain === 'loadBuOrgMappingsChain'));
  const f = makeEnv('new', Object.assign({}, setup, { respond: fail('eqp-v1/deleteBuOrgMapping') }));
  await f.run('deleteBuOrgMappingRowChain', setup.params);
  T.check('delete mapping failure: error toast', lastToast(f).summary === 'Could not delete mapping');
};
CASES.toggleBuOrgActiveChain = async () => {
  const setup = { vars: { BuOrgMappingsArray: MAPPINGS }, params: { rowKey: '300000001-9001', value: false } };
  const e = await parity('toggleBuOrgActiveChain', setup);
  T.eq('active switch: PATCH isActiveFlag with lastUpdatedBy', JSON.stringify([firstWrite(e).endpoint, firstWrite(e).uriParams, firstWrite(e).body]),
    JSON.stringify(['eqp-v1/patchBuOrgMapping', { id: 501 }, { isActiveFlag: 'N', lastUpdatedBy: 'EQUIPRITE' }]));
  const same = await parity('toggleBuOrgActiveChain', { vars: { BuOrgMappingsArray: MAPPINGS }, params: { rowKey: '300000001-9001', value: true } }, 'already on');
  T.eq('active switch: the state it already has writes nothing', same.writes().length, 0);
  const f = makeEnv('new', Object.assign({}, setup, { respond: fail('eqp-v1/patchBuOrgMapping') }));
  await f.run('toggleBuOrgActiveChain', setup.params);
  T.check('active switch failure: reload (switch snaps back) and error toast', f.calls.some((c) => c.chain === 'loadBuOrgMappingsChain') && lastToast(f).type === 'error');
};
CASES.saveBuOrgEditChain = async () => {
  const target = { id: 501, buName: 'EPC_US_BU', orgId: 9001, orgName: 'Houston Yard', yardType: 'DESTINATION_YARD', isTransactable: 'N', subinventoryCode: 'STORES' };
  const e = await parity('saveBuOrgEditChain', { vars: { BuOrgEditTarget: target, isBuOrgEditOpen: true } });
  T.eq('edit mapping: PATCH role and transactable; a destination yard drops its subinventory', JSON.stringify(firstWrite(e).body),
    JSON.stringify({ orgRole: 'DESTINATION_YARD', isTransactable: 'N', subinventoryCode: null, lastUpdatedBy: 'EQUIPRITE' }));
  T.check('edit mapping: the editor closes', !e.variables.isBuOrgEditOpen);
  const x = await parity('saveBuOrgEditChain', { vars: { BuOrgEditTarget: Object.assign({}, target, { yardType: null }) } }, 'no yard type');
  T.check('edit mapping: no yard type is refused', x.writes().length === 0 && lastToast(x).summary === 'Yard Type required');
  const f = makeEnv('new', { vars: { BuOrgEditTarget: target }, respond: fail('eqp-v1/patchBuOrgMapping') });
  await f.run('saveBuOrgEditChain');
  T.check('edit mapping failure: error toast', lastToast(f).summary === 'Could not update mapping');
};
const CLASSES = oldPage.mapClassRows([{ id: 1, className: 'Excavators', fusionSourceType: 'INVENTORY', fusionClassType: 'CATEGORY', fusionClassRef: '100' }, { id: 2, className: 'Generators' }]);
const SUBS = oldPage.mapSubclassRows([{ id: 11, eqrEquipmentClassId: 1, subclassName: 'Crawler', fusionSubclassRef: '101' },
  { id: 12, eqrEquipmentClassId: 1, subclassName: 'Wheeled', fusionSubclassRef: '102' }, { id: 21, eqrEquipmentClassId: 2, subclassName: 'Diesel' }])
  .map((s) => Object.assign(s, { className: s.classId === 1 ? 'Excavators' : 'Generators' }));
CASES.saveEditClassSubclassChain = async () => {
  const edit = { id: 21, classId: 2, subclassName: 'Diesel', trackingType: 'MAINTENANCE', consumableFlag: 'Y', autoConsumeFlag: 'N', timesheetEntryEnabled: 'Y', bufferPeriodDays: 3 };
  const e = await parity('saveEditClassSubclassChain', { vars: { EditClassSubclass: edit, AllSubclassesArray: SUBS, isSubclassEditOpen: true } });
  T.eq('edit subclass: PATCH the five flags under its class', JSON.stringify([firstWrite(e).endpoint, firstWrite(e).uriParams, firstWrite(e).body]),
    JSON.stringify(['eqp-v1/patchSubclass', { classId: 2, id: 21 }, { consumableFlag: 'Y', autoConsumeFlag: 'N', bufferPeriodDays: 3, timesheetEntryEnabled: 'Y', trackingType: 'MAINTENANCE' }]));
  T.check('edit subclass: the row is updated and the editor closes', e.variables.AllSubclassesArray.find((s) => s.id === 21).consumableFlag === 'Y' && !e.variables.isSubclassEditOpen);
  const f = makeEnv('new', { vars: { EditClassSubclass: edit, AllSubclassesArray: SUBS, isSubclassEditOpen: true }, respond: fail('eqp-v1/patchSubclass') });
  await f.run('saveEditClassSubclassChain');
  T.check('edit subclass failure: error toast, editor stays open', lastToast(f).type === 'error' && f.variables.isSubclassEditOpen);
};
CASES.deleteSubclassChain = async () => {
  const setup = { vars: { DeleteSubclassTarget: { id: 21, classId: 2, subclassName: 'Diesel' }, AllSubclassesArray: SUBS, confirm: { kind: 'deleteSubclass' } } };
  const e = await parity('deleteSubclassChain', setup);
  T.eq('delete subclass: DELETE under its class', JSON.stringify([firstWrite(e).endpoint, firstWrite(e).uriParams]), JSON.stringify(['eqp-v1/deleteSubclass', { classId: 2, id: 21 }]));
  const g = makeEnv('new', Object.assign({}, setup, { respond: fail('eqp-v1/deleteSubclass', 404) }));
  await g.run('deleteSubclassChain');
  T.check('delete subclass: already gone (404) counts as done', lastToast(g).type === 'confirmation');
  const f = makeEnv('new', Object.assign({}, setup, { respond: fail('eqp-v1/deleteSubclass', 500, { detail: 'in use' }) }));
  await f.run('deleteSubclassChain');
  T.check('delete subclass failure: the backend detail is shown', lastToast(f).type === 'error' && /in use/.test(lastToast(f).message));
};
CASES.deleteClassChain = async () => {
  const setup = { vars: { DeleteClassTarget: { id: 2, className: 'Generators' }, EquipmentClassSelectedId: 2, confirm: { kind: 'deleteClass' } } };
  const e = await parity('deleteClassChain', setup);
  T.eq('delete class: DELETE by id', JSON.stringify([firstWrite(e).endpoint, firstWrite(e).uriParams]), JSON.stringify(['eqp-v1/deleteEquipmentClass', { id: 2 }]));
  T.check('delete class: the class filter is cleared', e.variables.EquipmentClassSelectedId === null);
  const f = makeEnv('new', Object.assign({}, setup, { respond: fail('eqp-v1/deleteEquipmentClass', 409, { detail: 'Remove its 1 active subclass first.' }) }));
  await f.run('deleteClassChain');
  T.check('delete class with subclasses (409): the backend\'s guidance', lastToast(f).summary === 'Cannot delete class' && /active subclass/.test(lastToast(f).message));
};
const COLMAP_MAP = Object.assign({}, MAP, { CLASS_MAPPING_COLUMNS_INVENTORY: { id: 12, settingValue: JSON.stringify({ classGroup: 'CATEGORIES', classColumn: 'CATEGORY', classColumnName: 'Category', subclassGroup: 'ITEM_CLASS', subclassColumn: 'ITEM_CLASS', subclassColumnName: 'Item class' }) } });
CASES.createClassSubclassChain = async () => {
  let e = await parity('createClassSubclassChain', { vars: { newClassSubclass: { trackingType: 'CUSTOM', className: 'Compaction', subclassName: 'Plate', consumableFlag: 'Y', autoConsumeFlag: 'Y' },
    EquipmentClassesArray: CLASSES, AllSubclassesArray: SUBS, ConfigSettingsMap: COLMAP_MAP, isAddClassDrawerOpen: true },
  respond: (o) => (o.endpoint === 'eqp-v1/createEquipmentClass' ? { body: { id: 3 } } : null) }, 'custom');
  T.eq('add class (custom): POST the class, then its subclass', e.writes().map((w) => w.endpoint).join(' > '), 'eqp-v1/createEquipmentClass > eqp-v1/createSubclass');
  const cls = e.writes()[0].body;
  T.eq('add class: class body', JSON.stringify(Object.assign({}, cls, { effectiveStartDate: 'T' })), JSON.stringify({ className: 'Compaction', classCode: 'COMPACTION',
    assetClassCode: 'COMPACTION', effectiveStartDate: 'T', createdBy: 'EQUIPRITE', lastUpdatedBy: 'EQUIPRITE', objectVersionNumber: 1 }));
  T.eq('add class: subclass under the new class, flags on the subclass', JSON.stringify([e.writes()[1].uriParams, e.writes()[1].body.consumableFlag, e.writes()[1].body.trackingType]),
    JSON.stringify([{ classId: 3 }, 'Y', 'CUSTOM']));
  e = await parity('createClassSubclassChain', { vars: { newClassSubclass: { trackingType: 'INVENTORY', classLovId: '100', subclassLovId: '103' },
    ClassLovArray: [{ value: '100', label: 'Excavators', code: 'EXC' }], SubclassLovArray: [{ value: '103', label: 'Long reach', code: 'LR' }],
    EquipmentClassesArray: CLASSES, AllSubclassesArray: SUBS, ConfigSettingsMap: COLMAP_MAP } }, 'Fusion class that exists');
  T.eq('add class (Fusion, class exists): only the subclass is created, with its Fusion reference', JSON.stringify([e.writes().length, e.writes()[0].uriParams,
    e.writes()[0].body.fusionSubclassRef, e.writes()[0].body.fusionSubclassType]), JSON.stringify([1, { classId: 1 }, '103', 'ITEM_CLASS']));
  const x = await parity('createClassSubclassChain', { vars: { newClassSubclass: { trackingType: 'MAINTENANCE', classLovId: '1' }, ConfigSettingsMap: MAP } }, 'no mapping');
  T.check('add class: a type without a column mapping is refused', x.writes().length === 0 && lastToast(x).summary === 'No column mapping');
  const f = makeEnv('new', { vars: { newClassSubclass: { trackingType: 'CUSTOM', className: 'Compaction' }, EquipmentClassesArray: CLASSES, AllSubclassesArray: SUBS, isAddClassDrawerOpen: true },
    respond: fail('eqp-v1/createEquipmentClass', 400, { detail: 'duplicate code' }) });
  await f.run('createClassSubclassChain');
  T.check('add class failure: the detail is shown, the form stays open', /duplicate code/.test(lastToast(f).message) && f.variables.isAddClassDrawerOpen && !f.variables.isAddingClassSubclass);
};
CASES.unmapChain = async () => {
  let e = await parity('unmapChain', { vars: { UnmapTarget: { level: 'CLASS', classId: 1, className: 'Excavators' }, AllSubclassesArray: SUBS, EquipmentClassesArray: CLASSES, confirm: { kind: 'unmap' } } }, 'class');
  T.eq('unmap class: each mapped subclass first, then the class', e.writes().map((w) => w.endpoint + JSON.stringify(w.uriParams)).join(' > '),
    'eqp-v1/patchSubclass{"classId":1,"id":11} > eqp-v1/patchSubclass{"classId":1,"id":12} > eqp-v1/patchEquipmentClass{"id":1}');
  T.eq('unmap class: every Fusion field of the class sent as null', JSON.stringify(e.writes()[2].body), JSON.stringify({ fusionSourceType: null, fusionClassType: null,
    fusionClassTypeName: null, fusionClassRef: null, fusionClassCode: null, fusionClassName: null }));
  e = await parity('unmapChain', { vars: { UnmapTarget: { level: 'SUBCLASS', classId: 1, subclassId: 12, subclassName: 'Wheeled' }, AllSubclassesArray: SUBS }, respond: (o) => (o.endpoint === 'eqp-v1/patchSubclass' ? { body: { fusionSubclassRef: '102' } } : null) }, 'subclass, field kept');
  T.check('unmap: a field the server kept is reported', lastToast(e).summary === 'Mapping partially removed' && /fusionSubclassRef/.test(lastToast(e).message));
  const f = makeEnv('new', { vars: { UnmapTarget: { level: 'CLASS', classId: 1 }, AllSubclassesArray: SUBS, confirm: { kind: 'unmap' } }, respond: fail('eqp-v1/patchSubclass') });
  await f.run('unmapChain');
  T.check('unmap failure: stops at the first failure, reloads, error toast', f.writes().length === 1 && f.calls.some((c) => c.chain === 'loadEquipmentClassesChain')
    && lastToast(f).type === 'error' && f.variables.confirm === null);
};
const PAIR_ROWS = { rows: [{ LOV_ID: '100', LOV_NAME: 'Excavators', LOV_CODE: 'EXC', SUB_ID: '103', SUB_NAME: 'Long reach', ITEM_COUNT: '4' },
  { LOV_ID: '200', LOV_NAME: 'Cranes', LOV_CODE: 'CRN', SUB_ID: '', ITEM_COUNT: '2' }] };
const DRY = { results: [{ classAction: 'EXISTS', subAction: 'CREATE' }, { classAction: 'CREATE', subAction: 'NONE' }] };
CASES.previewClassMapPairsChain = async () => {
  const e = await parity('previewClassMapPairsChain', { vars: { ConfigSettingsMap: COLMAP_MAP }, params: { source: 'INVENTORY' },
    respond: (o) => (o.endpoint === 'bipService/runBIPReport' ? { body: PAIR_ROWS } : o.endpoint === 'eqp-v1/bulkCreateClassesFromFusion' ? { body: DRY } : null) });
  T.eq('preview: the PAIRS report, then a dry run', e.writes().map((w) => w.endpoint).join(' > '), 'bipService/runBIPReport > eqp-v1/bulkCreateClassesFromFusion');
  T.check('preview: the report asks for the class column paired with the subclass column', /CATEGORY/.test(e.writes()[0].body) && /#PAIRS/.test(e.writes()[0].body));
  T.eq('preview: dry run with the mapping and the pairs', JSON.stringify([e.writes()[1].body.dryRun, e.writes()[1].body.classColumn, e.writes()[1].body.pairs.length]), '[true,"CATEGORY",2]');
  T.eq('preview: the decisions are on the pairs', e.variables.ClassMapPairsArray.map((p) => page.pairStatusLabel(p)).join(), 'New subclass,New');
  const f = makeEnv('new', { vars: { ConfigSettingsMap: COLMAP_MAP }, respond: (o) => (o.endpoint === 'bipService/runBIPReport' ? { body: PAIR_ROWS } : fail('eqp-v1/bulkCreateClassesFromFusion')(o)) });
  await f.run('previewClassMapPairsChain', { source: 'INVENTORY' });
  T.check('preview failure: error toast', lastToast(f).summary === 'Preview not loaded');
};
CASES.createClassMapPairsChain = async () => {
  const pairs = [{ key: 0, classRef: '100', className: 'Excavators', subclassRef: '103', subclassName: 'Long reach', classAction: 'EXISTS', subAction: 'CREATE' },
    { key: 1, classRef: '300', className: 'Old', classAction: 'EXISTS', subAction: 'NONE' }];
  const e = await parity('createClassMapPairsChain', { vars: { ConfigSettingsMap: COLMAP_MAP, ClassMapPairsSource: 'INVENTORY', ClassMapPairsArray: pairs },
    respond: (o) => (o.endpoint === 'eqp-v1/bulkCreateClassesFromFusion' && o.body.dryRun === false ? { body: { createdSubclasses: 1, results: [{ status: 'OK' }] } } : null) });
  const bulk = e.writes()[0] || {};
  T.eq('create from Fusion: one real run with only the pairs that do something', JSON.stringify([bulk.endpoint, bulk.body.dryRun, bulk.body.pairs.map((p) => p.key)]),
    JSON.stringify(['eqp-v1/bulkCreateClassesFromFusion', false, [0]]));
  T.check('create from Fusion: reload and fresh preview, then the summary', e.calls.some((c) => c.chain === 'loadEquipmentClassesChain') && /Created 0 classes and 1 subclasses/.test(lastToast(e).message));
  const f = makeEnv('new', { vars: { ConfigSettingsMap: COLMAP_MAP, ClassMapPairsSource: 'INVENTORY', ClassMapPairsArray: pairs }, respond: fail('eqp-v1/bulkCreateClassesFromFusion') });
  await f.run('createClassMapPairsChain');
  T.check('create from Fusion failure: a lasting error', lastToast(f).summary === 'Classes not created' && lastToast(f).displayMode === 'persist');
};
CASES.saveColumnMappingChain = async () => {
  const types = [{ source: 'FIXED_ASSET', value: 'MAJOR', label: 'Major category', group: 'CAT' }, { source: 'FIXED_ASSET', value: 'MINOR', label: 'Minor category', group: 'CAT' }];
  const e = await parity('saveColumnMappingChain', { vars: { ConfigSettingsMap: MAP, ClassMapTypesArray: types,
    ColumnMapDraft: { sourceType: 'FIXED_ASSET', classGroup: 'CAT', classColumn: 'MAJOR', subclassGroup: 'CAT', subclassColumn: 'MINOR' } } });
  T.eq('column mapping: POST CLASS_MAPPING_COLUMNS_FIXED_ASSET with the columns and their names', JSON.stringify([firstWrite(e).endpoint, firstWrite(e).body.settingKey, JSON.parse(firstWrite(e).body.settingValue)]),
    JSON.stringify(['eqp-v1/postConfGlobalSettings', 'CLASS_MAPPING_COLUMNS_FIXED_ASSET', { classGroup: 'CAT', classColumn: 'MAJOR', classColumnName: 'Major category',
      subclassGroup: 'CAT', subclassColumn: 'MINOR', subclassColumnName: 'Minor category' }]));
  for (const [label, d, msg] of [['a subclass group without a column', { subclassColumn: null }, 'Required information missing'],
    ['the same column twice', { subclassColumn: 'MAJOR' }, 'Same column twice']]) {
    const x = await parity('saveColumnMappingChain', { vars: { ConfigSettingsMap: MAP, ClassMapTypesArray: types,
      ColumnMapDraft: Object.assign({ sourceType: 'FIXED_ASSET', classGroup: 'CAT', classColumn: 'MAJOR', subclassGroup: 'CAT', subclassColumn: 'MINOR' }, d) } }, label);
    T.check('column mapping: ' + label + ' is refused', x.writes().length === 0 && lastToast(x).summary === msg);
  }
  const f = makeEnv('new', { vars: { ConfigSettingsMap: MAP, ClassMapTypesArray: types, ColumnMapDraft: { sourceType: 'FIXED_ASSET', classGroup: 'CAT', classColumn: 'MAJOR' } },
    respond: fail('eqp-v1/postConfGlobalSettings', 400, { detail: 'nope' }) });
  await f.run('saveColumnMappingChain');
  T.check('column mapping failure: error toast with the detail', lastToast(f).summary === 'Column mapping not saved' && lastToast(f).message === 'nope');
};
CASES.removeColumnMappingChain = async () => {
  const e = await parity('removeColumnMappingChain', { vars: { ConfigSettingsMap: COLMAP_MAP, ColumnMapDraft: { sourceType: 'INVENTORY' } }, params: { source: 'INVENTORY' } });
  T.eq('remove column mapping: PATCH the setting to blank (the row is kept)', JSON.stringify([firstWrite(e).uriParams, firstWrite(e).body]), JSON.stringify([{ id: 12 }, { settingValue: '' }]));
  const f = makeEnv('new', { vars: { ConfigSettingsMap: COLMAP_MAP }, respond: fail('eqp-v1/patchConfGlobalSettingsById') });
  await f.run('removeColumnMappingChain', { source: 'INVENTORY' });
  T.check('remove column mapping failure: error toast', lastToast(f).summary === 'Column mapping not removed');
};
CASES.saveClassMapTruthChain = async () => {
  // The old chain saved the precedence through the picker's value-changed event; the New one calls that chain
  // itself, so the old run is completed the same way before comparing.
  const setup = { vars: { ConfigSettingsMap: MAP, ClassMapTruthSel: 'FIXED_ASSET', ClassMapPrecedenceSel: 'MAINTENANCE,INVENTORY', ColumnMapDraft: { sourceType: 'MAINTENANCE' } } };
  const a = makeEnv('old', setup);
  await a.run('saveClassMapTruthChain');
  await a.run('saveClassMapPrecedenceChain');
  const b = makeEnv('new', setup);
  await b.run('saveClassMapTruthChain');
  WRITERS_SEEN.add('saveClassMapTruthChain');
  T.eq('saveClassMapTruthChain: same writes as the old chain and the precedence picker it set off', norm(b.writes()), norm(a.writes()));
  T.eq('asset source: PATCH the source, then the precedence with the new source in the same rank',
    b.writes().map((w) => JSON.stringify([w.uriParams.id, w.body.settingValue])).join(' > '), '[11,"FIXED_ASSET"] > [13,"FIXED_ASSET,INVENTORY"]');
  T.eq('asset source: a column-mapping form on a source no longer allowed falls back to Inventory', b.variables.ColumnMapDraft.sourceType, 'INVENTORY');
  const c = makeEnv('new', { vars: { ConfigSettingsMap: MAP, ClassMapTruthSel: 'MAINTENANCE' } });
  await c.run('saveClassMapTruthChain', { value: 'FIXED_ASSET' });
  T.eq('asset source: the picked value comes as a parameter', c.writes()[0].body.settingValue, 'FIXED_ASSET');
  const f = makeEnv('new', { vars: { ConfigSettingsMap: MAP, ClassMapTruthSel: 'MAINTENANCE' }, respond: fail('eqp-v1/patchConfGlobalSettingsById') });
  await f.run('saveClassMapTruthChain', { value: 'FIXED_ASSET' });
  T.check('asset source failure: the choice goes back to what is stored', f.variables.ClassMapTruthSel === 'MAINTENANCE' && lastToast(f).type === 'error');
};
CASES.saveClassMapPrecedenceChain = async () => {
  const e = await parity('saveClassMapPrecedenceChain', { vars: { ConfigSettingsMap: MAP, ClassMapTruthSel: 'MAINTENANCE', ClassMapPrecedenceSel: 'INVENTORY,MAINTENANCE' } });
  T.eq('precedence: PATCH by id with the ordered list', JSON.stringify([firstWrite(e).uriParams, firstWrite(e).body]), JSON.stringify([{ id: 13 }, { settingValue: 'INVENTORY,MAINTENANCE' }]));
  const n = makeEnv('new', { vars: { ConfigSettingsMap: MAP, ClassMapTruthSel: '' } });
  await n.run('saveClassMapPrecedenceChain', { value: 'INVENTORY,MAINTENANCE' });
  T.eq('precedence: nothing to choose before the asset source', n.writes().length, 0);
  const f = makeEnv('new', { vars: { ConfigSettingsMap: MAP, ClassMapTruthSel: 'MAINTENANCE' }, respond: fail('eqp-v1/patchConfGlobalSettingsById') });
  await f.run('saveClassMapPrecedenceChain', { value: 'INVENTORY,MAINTENANCE' });
  T.check('precedence failure: back to the stored order', f.variables.ClassMapPrecedenceSel === 'MAINTENANCE,INVENTORY' && lastToast(f).type === 'error');
};
CASES.addExpTypeMapChain = async () => {
  const setup = { vars: { NewExpTypeMap: { scopeType: 'MASTER', scopeId: 11, expenditureType: 'Operational Day Rate' } } };
  let e = await parity('addExpTypeMapChain', setup, 'first for the scope');
  T.eq('add expenditure type: ask the server what the scope holds, then POST', e.seq().slice(0, 2).join(' > '), 'GET listExpTypeMaps > POST createExpTypeMap');
  T.eq('add expenditure type: the first type of a scope is its default', JSON.stringify(e.writes()[0].body), JSON.stringify({ scopeType: 'MASTER', scopeId: 11,
    expenditureType: 'Operational Day Rate', isDefault: 'Y', displayOrder: 1, mapSource: 'MANUAL' }));
  e = await parity('addExpTypeMapChain', Object.assign({}, setup, { respond: (o) => (o.endpoint === 'eqp-v1/listExpTypeMaps' ? { body: { data: [{ displayOrder: 4 }] } } : null) }), 'second');
  T.eq('add expenditure type: later ones are not, and go last', JSON.stringify([e.writes()[0].body.isDefault, e.writes()[0].body.displayOrder]), '["N",5]');
  for (const [label, d, msg] of [['no scope', { scopeId: null }, 'Pick something to map'], ['no type', { expenditureType: ' ' }, 'Expenditure type required'],
    ['a name over 80 characters', { expenditureType: 'x'.repeat(81) }, 'Name too long']]) {
    const x = await parity('addExpTypeMapChain', { vars: { NewExpTypeMap: Object.assign({}, setup.vars.NewExpTypeMap, d) } }, label);
    T.check('add expenditure type: ' + label + ' is refused', x.writes().length === 0 && lastToast(x).summary === msg);
  }
  const f = makeEnv('new', Object.assign({}, setup, { respond: fail('eqp-v1/createExpTypeMap', 409) }));
  await f.run('addExpTypeMapChain');
  T.check('add expenditure type: already mapped (409) says so', lastToast(f).summary === 'Already mapped');
};
const EXP_ROWS = [{ eqrExpTypeMapId: 1, scopeName: 'CAT 320', expenditureType: 'Day Rate', isDefault: 'N' }, { eqrExpTypeMapId: 2, isDefault: 'Y' }];
CASES.deleteExpTypeMapChain = async () => {
  const setup = { vars: { DeleteExpTypeMapTarget: { id: 1, scopeName: 'CAT 320', expenditureType: 'Day Rate', isDefault: 'N' }, confirm: { kind: 'deleteExpType' } }, params: { id: 1 } };
  const e = await parity('deleteExpTypeMapChain', setup);
  T.eq('remove expenditure type: DELETE by id', JSON.stringify([firstWrite(e).endpoint, firstWrite(e).uriParams]), JSON.stringify(['eqp-v1/deleteExpTypeMap', { id: 1 }]));
  const f = makeEnv('new', Object.assign({}, setup, { respond: fail('eqp-v1/deleteExpTypeMap', 500, { detail: 'locked' }) }));
  await f.run('deleteExpTypeMapChain', { id: 1 });
  T.check('remove expenditure type failure: the detail is shown', lastToast(f).summary === 'Could not remove mapping' && lastToast(f).message === 'locked');
};
CASES.setExpTypeMapDefaultChain = async () => {
  const e = await parity('setExpTypeMapDefaultChain', { vars: { ExpTypeMapAllArray: EXP_ROWS }, params: { id: 1 } });
  T.eq('make default: PATCH isDefault only', JSON.stringify([firstWrite(e).uriParams, firstWrite(e).body]), JSON.stringify([{ id: 1 }, { isDefault: 'Y' }]));
  const same = await parity('setExpTypeMapDefaultChain', { vars: { ExpTypeMapAllArray: EXP_ROWS }, params: { id: 2 } }, 'already default');
  T.eq('make default: the default already writes nothing', same.writes().length, 0);
  const f = makeEnv('new', { vars: { ExpTypeMapAllArray: EXP_ROWS }, respond: fail('eqp-v1/patchExpTypeMap') });
  await f.run('setExpTypeMapDefaultChain', { id: 1 });
  T.check('make default failure: error toast', lastToast(f).summary === 'Could not set the default');
};
const AGR = [{ id: 1, typeLabel: 'Rental', typePrefix: 'RNT', isActive: 'Y', displayOrder: 3 }, { id: 2, typeLabel: 'Demo', typePrefix: 'DEMO', isActive: 'N' }];
CASES.addAgreementTypeChain = async () => {
  const e = await parity('addAgreementTypeChain', { vars: { AgreementTypeAllArray: AGR, NewAgreementType: { typeLabel: 'Long term lease', typePrefix: 'ltl' } } });
  T.eq('add agreement type: POST with the code from the name, the prefix in capitals, last in order', JSON.stringify([firstWrite(e).endpoint, firstWrite(e).body]),
    JSON.stringify(['eqp-v1/createConfAgreementType', { typeCode: 'LONG_TERM_LEASE', typeLabel: 'Long term lease', typePrefix: 'LTL', isActive: 'Y', displayOrder: 4 }]));
  for (const [label, d, msg] of [['no name', { typeLabel: '' }, 'Type name required'], ['no prefix', { typePrefix: '' }, 'Prefix required'],
    ['a one-letter prefix', { typePrefix: 'X' }, 'Invalid prefix'], ['a prefix in use', { typePrefix: 'rnt' }, 'Prefix already in use']]) {
    const x = await parity('addAgreementTypeChain', { vars: { AgreementTypeAllArray: AGR, NewAgreementType: Object.assign({ typeLabel: 'Lease', typePrefix: 'LS' }, d) } }, label);
    T.check('add agreement type: ' + label + ' is refused', x.writes().length === 0 && lastToast(x).summary === msg);
  }
  const f = makeEnv('new', { vars: { AgreementTypeAllArray: AGR, NewAgreementType: { typeLabel: 'Lease', typePrefix: 'LS' } }, respond: fail('eqp-v1/createConfAgreementType') });
  await f.run('addAgreementTypeChain');
  T.check('add agreement type failure: error toast, the form is kept', lastToast(f).summary === 'Could not add type' && f.variables.NewAgreementType.typeLabel === 'Lease');
};
CASES.toggleAgreementTypeChain = async () => {
  const e = await parity('toggleAgreementTypeChain', { vars: { AgreementTypeAllArray: AGR }, params: { id: '2', value: true } });
  T.eq('agreement type active switch: PATCH isActive', JSON.stringify([firstWrite(e).uriParams, firstWrite(e).body]), JSON.stringify([{ id: 2 }, { isActive: 'Y' }]));
  const f = makeEnv('new', { vars: { AgreementTypeAllArray: AGR }, respond: fail('eqp-v1/patchConfAgreementType') });
  await f.run('toggleAgreementTypeChain', { id: '2', value: true });
  T.check('agreement type switch failure: error toast and reload', lastToast(f).type === 'error' && f.calls.some((c) => c.chain === 'loadAgreementTypesChain'));
};
CASES.updateAgreementTypeChain = async () => {
  const e = await parity('updateAgreementTypeChain', { vars: { AgreementTypeAllArray: AGR, EditAgreementType: { id: 1, typeLabel: ' Rental ', typePrefix: 'rn1' }, isAgrEditOpen: true } });
  T.eq('edit agreement type: PATCH name and prefix', JSON.stringify([firstWrite(e).uriParams, firstWrite(e).body]), JSON.stringify([{ id: 1 }, { typeLabel: 'Rental', typePrefix: 'RN1' }]));
  T.check('edit agreement type: the editor closes', !e.variables.isAgrEditOpen);
  const x = await parity('updateAgreementTypeChain', { vars: { AgreementTypeAllArray: AGR, EditAgreementType: { id: 1, typeLabel: 'Rental', typePrefix: 'DEMO' } } }, 'prefix of another type');
  T.check('edit agreement type: another type\'s prefix is refused', x.writes().length === 0 && lastToast(x).summary === 'Prefix already in use');
  const f = makeEnv('new', { vars: { AgreementTypeAllArray: AGR, EditAgreementType: { id: 1, typeLabel: 'Rental', typePrefix: 'RNT' }, isAgrEditOpen: true }, respond: fail('eqp-v1/patchConfAgreementType') });
  await f.run('updateAgreementTypeChain');
  T.check('edit agreement type failure: error toast, editor stays open', lastToast(f).summary === 'Could not save' && f.variables.isAgrEditOpen);
};
CASES.deleteAgreementTypeChain = async () => {
  const setup = { vars: { DeleteAgreementTypeTarget: { id: 2, typeLabel: 'Demo' }, confirm: { kind: 'deleteAgreementType' } }, params: { id: 2 } };
  const e = await parity('deleteAgreementTypeChain', setup);
  T.eq('delete agreement type: DELETE by id', JSON.stringify([firstWrite(e).endpoint, firstWrite(e).uriParams]), JSON.stringify(['eqp-v1/deleteConfAgreementType', { id: 2 }]));
  const f = makeEnv('new', Object.assign({}, setup, { respond: fail('eqp-v1/deleteConfAgreementType') }));
  await f.run('deleteAgreementTypeChain', { id: 2 });
  T.check('delete agreement type failure: error toast', lastToast(f).summary === 'Could not delete type');
};
const ATT = [{ id: 1, categoryCode: 'LOAD_TEST', categoryLabel: 'Load Test', displayOrder: 20, objectVersionNumber: 3, isActive: 'Y' }];
CASES.addAttachmentCategoryChain = async () => {
  const e = await parity('addAttachmentCategoryChain', { vars: { AttCatAllArray: ATT, NewAttCat: { categoryLabel: 'Data card', appliesTo: 'HEADER', validityRequired: 'N', defaultValidityMonths: 12 } } });
  T.eq('add attachment category: POST with the audit header; months dropped without dates', JSON.stringify([firstWrite(e).endpoint, firstWrite(e).headers, firstWrite(e).body]),
    JSON.stringify(['eqp-v1/createAttachmentCategory', { 'X-User-Id': 'priya.raman' }, { categoryCode: 'DATA_CARD', categoryLabel: 'Data card', appliesTo: 'HEADER',
      validityRequired: 'N', defaultValidityMonths: null, isActive: 'Y', displayOrder: 30 }]));
  for (const [label, d, msg] of [['no name', { categoryLabel: '' }, 'Name required'], ['a name already used', { categoryLabel: 'load test' }, 'Already exists'],
    ['half a month', { validityRequired: 'Y', defaultValidityMonths: 1.5 }, 'Check "Usually valid for"']]) {
    const x = await parity('addAttachmentCategoryChain', { vars: { AttCatAllArray: ATT, NewAttCat: Object.assign({ categoryLabel: 'Cert', appliesTo: 'BOTH', validityRequired: 'N' }, d) } }, label);
    T.check('add attachment category: ' + label + ' is refused', x.writes().length === 0 && lastToast(x).summary === msg);
  }
  const f = makeEnv('new', { vars: { AttCatAllArray: ATT, NewAttCat: { categoryLabel: 'Cert', appliesTo: 'BOTH', validityRequired: 'N' } }, respond: fail('eqp-v1/createAttachmentCategory', 400, { message: 'bad' }) });
  await f.run('addAttachmentCategoryChain');
  T.check('add attachment category failure: the message is shown', lastToast(f).message === 'bad');
};
CASES.toggleAttachmentCategoryChain = async () => {
  const e = await parity('toggleAttachmentCategoryChain', { vars: { AttCatAllArray: ATT }, params: { id: '1', value: false } });
  T.eq('attachment category switch: PATCH isActive with the version', JSON.stringify([firstWrite(e).uriParams, firstWrite(e).body, firstWrite(e).headers]),
    JSON.stringify([{ id: 1 }, { isActive: 'N', objectVersionNumber: 3 }, { 'X-User-Id': 'priya.raman' }]));
  const f = makeEnv('new', { vars: { AttCatAllArray: ATT }, respond: fail('eqp-v1/patchAttachmentCategory', 409) });
  await f.run('toggleAttachmentCategoryChain', { id: '1', value: false });
  T.check('attachment category switch, changed by someone else (409): says so and reloads', /Someone else/.test(lastToast(f).message) && f.calls.some((c) => c.chain === 'loadAttachmentCategoriesChain'));
};
CASES.updateAttachmentCategoryChain = async () => {
  const edit = { id: 1, categoryLabel: 'Load test cert', appliesTo: 'LINE', validityRequired: 'Y', defaultValidityMonths: 12, objectVersionNumber: 3 };
  const e = await parity('updateAttachmentCategoryChain', { vars: { EditAttCat: edit, isAttEditOpen: true } });
  T.eq('edit attachment category: PATCH without the (permanent) code', JSON.stringify(firstWrite(e).body), JSON.stringify({ categoryLabel: 'Load test cert', appliesTo: 'LINE',
    validityRequired: 'Y', defaultValidityMonths: 12, objectVersionNumber: 3 }));
  const f = makeEnv('new', { vars: { EditAttCat: edit, isAttEditOpen: true }, respond: fail('eqp-v1/patchAttachmentCategory', 409) });
  await f.run('updateAttachmentCategoryChain');
  T.check('edit attachment category, stale (409): says so, editor stays', /since you opened it/.test(lastToast(f).message) && f.variables.isAttEditOpen);
};
CASES.deleteAttachmentCategoryChain = async () => {
  const setup = { vars: { DeleteAttCatTarget: { id: 1, categoryLabel: 'Load Test' }, confirm: { kind: 'deleteAttCat' } } };
  const e = await parity('deleteAttachmentCategoryChain', setup);
  T.eq('delete attachment category: DELETE with the audit header', JSON.stringify([firstWrite(e).endpoint, firstWrite(e).uriParams, firstWrite(e).headers]),
    JSON.stringify(['eqp-v1/deleteAttachmentCategory', { id: 1 }, { 'X-User-Id': 'priya.raman' }]));
  const f = makeEnv('new', Object.assign({}, setup, { respond: fail('eqp-v1/deleteAttachmentCategory', 409) }));
  await f.run('deleteAttachmentCategoryChain');
  T.check('delete attachment category in use (409): switch it off instead, lasting message', /Switch it off/.test(lastToast(f).message) && lastToast(f).displayMode === 'persist');
};

(async () => {
  T.section('every old chain that writes');
  // Writers: a non-GET endpoint (services/ openapi) other than the BI Publisher read, or a call to the old
  // save-now chain. Derived from the old files, so a writing chain added to the old page later fails here.
  const writers = oldChainNames.filter((n) => {
    const eps = [...oldChainSrc[n].matchAll(/endpoint:\s*'([^']+)'/g)].map((m) => m[1]);
    return eps.some((ep) => ep !== 'bipService/runBIPReport' && OPS[ep] && OPS[ep] !== 'GET') || /chain: 'saveGlobalSettingNowChain'/.test(oldChainSrc[n]);
  });
  T.check('the old writing chains were found', writers.length >= 25, writers.length + '');
  const untested = writers.filter((n) => !CASES[n]);
  T.check('every old writing chain has a case here', untested.length === 0, untested.join(', '));
  for (const n of writers.filter((w) => CASES[w])) {
    T.section(n);
    try {
      await CASES[n]();
    } catch (e) {
      T.check(n + ' ran', false, e.stack);
    }
  }
  T.check('every case compared old and new', writers.every((n) => WRITERS_SEEN.has(n)), writers.filter((n) => !WRITERS_SEEN.has(n)).join(', '));

  T.section('staging a switch (updateSettingChain): the old guards');
  const stage = async (vars, key, value) => {
    const e = makeEnv('new', { vars: Object.assign({ ConfigSettingsMap: clone(MAP), StoredSettingsMap: clone(MAP), changedRows: {} }, vars) });
    await e.run('updateSettingChain', { settingKey: key, value });
    return e;
  };
  let s = await stage({}, 'AGREEMENTS_ENABLED', 'true');
  T.eq('a switch is staged by id, nothing written', JSON.stringify([s.variables.changedRows.AGREEMENTS_ENABLED.id, s.variables.changedRows.AGREEMENTS_ENABLED.settingValue, s.writes().length, s.variables.hasChanges]),
    '[3,"true",0,true]');
  s = await stage({ ConfigSettingsMap: Object.assign(clone(MAP), { CUSTOMERS_MODULE_ENABLED: { id: 2, settingValue: 'false' } }) }, 'PROJECTS_MODULE_ENABLED', 'false');
  T.check('the last module cannot be switched off', !s.variables.changedRows.PROJECTS_MODULE_ENABLED && lastToast(s).summary === 'At least one module must stay enabled');
  s = await stage({ ConfigSettingsMap: Object.assign(clone(MAP), { TIMESHEETS_ENABLED: { id: 4, settingValue: 'false' } }) }, 'PPM_RATES_ENABLED', 'true');
  T.check('PPM rates cannot go on without timesheets', !s.variables.changedRows.PPM_RATES_ENABLED && lastToast(s).summary === 'Timesheets must be on first');
  s = await stage({ changedRows: { PPM_RATES_ENABLED: { id: null, settingValue: 'true' } } }, 'TIMESHEETS_ENABLED', 'false');
  T.check('timesheets cannot go off under PPM rates (a pending PPM counts)', !s.variables.changedRows.TIMESHEETS_ENABLED && lastToast(s).summary === 'Fusion PPM Rates depends on timesheets');
  s = await stage({}, 'PPM_RATES_ENABLED', 'true');
  T.eq('PPM rates on also stages the posting labels never saved, before itself', Object.keys(s.variables.changedRows).join(), 'PPM_TXN_SOURCE,PPM_DOCUMENT,PPM_DOC_ENTRY,PPM_RATES_ENABLED');
  T.eq('…a never-saved key carries the old category and description', JSON.stringify([s.variables.changedRows.PPM_RATES_ENABLED.settingCategory, s.variables.changedRows.PPM_RATES_ENABLED.description]),
    JSON.stringify(['FEATURE_FLAG', inv.BY_KEY.PPM_RATES_ENABLED.description]));
  s = await stage({ ConfigSettingsMap: Object.assign(clone(MAP), { AGREEMENTS_ENABLED: { id: 3, settingValue: 'true' } }), changedRows: { AGREEMENTS_ENABLED: { id: 3, settingValue: 'true' } } }, 'AGREEMENTS_ENABLED', 'false');
  T.check('switching back to the stored value drops the pending change', !s.variables.changedRows.AGREEMENTS_ENABLED && !s.variables.hasChanges);
  s = await stage({}, 'PPM_DOCUMENT', 'Misc 2');
  T.eq('a text setting keeps its on-screen copy', s.variables.PpmDocumentSel, 'Misc 2');
  s = await stage({ readOnly: true }, 'AGREEMENTS_ENABLED', 'true');
  T.eq('a read-only page stages nothing', Object.keys(s.variables.changedRows).length, 0);
  // Same staging as the old chain for the same switch (the old one read the key off the DOM event).
  const oldE = makeEnv('old', { vars: { ConfigSettingsMap: clone(MAP), changedRows: {} } });
  await oldE.run('updateSettingChain', { value: true, event: { target: { dataset: { settingKey: 'PPM_RATES_ENABLED', settingCategory: 'FEATURE_FLAG',
    settingDescription: inv.BY_KEY.PPM_RATES_ENABLED.description } } } });
  const newE = await stage({}, 'PPM_RATES_ENABLED', true);
  T.eq('staged rows equal the old chain\'s for the same switch', JSON.stringify(newE.variables.changedRows), JSON.stringify(oldE.variables.changedRows));

  T.section('the confirm card and the form fields');
  const c = makeEnv('new', { vars: { BuOrgMappingsArray: MAPPINGS } });
  await c.run('openDeleteBuOrgChain', { rowKey: '300000001-9001' });
  T.check('delete asks first, worded as the old dialog', c.variables.confirm.kind === 'deleteBuOrg' && /Permanently delete the mapping for "Houston Yard" from EPC_US_BU/.test(c.variables.confirm.message)
    && c.writes().length === 0);
  await c.run('confirmChain', { action: 'ok' });
  T.eq('OK runs the old delete with the row', JSON.stringify([firstWrite(c).endpoint, firstWrite(c).uriParams]), JSON.stringify(['eqp-v1/deleteBuOrgMapping', { id: 501 }]));
  T.eq('…and the card closes', c.variables.confirm, null);
  const w = makeEnv('new', { vars: { ConfigSettingsMap: MAP, StoredSettingsMap: MAP } });
  await w.run('confirmChain', { action: 'ask', kind: 'resetWeek' });
  await w.run('confirmChain', { action: 'cancel' });
  T.check('Cancel writes nothing', w.variables.confirm === null && w.writes().length === 0);
  const d = makeEnv('new', {});
  await d.run('setDraftChain', { form: 'NewAgreementType', field: 'typePrefix', value: 'ab-c 1' });
  await d.run('setDraftChain', { form: 'EsDraft', field: 'PASS_PROCUREMENT_COST', value: 'true' });
  await d.run('setDraftChain', { form: 'EsDraft', field: 'MARGIN_PERCENTAGE', value: '' });
  await d.run('setDraftChain', { form: 'EditClassSubclass', field: 'bufferPeriodDays', value: '-3' });
  await d.run('setDraftChain', { form: 'nope', field: 'x', value: '1' });
  T.eq('form fields get the old components\' value rules', JSON.stringify([d.variables.NewAgreementType.typePrefix, d.variables.EsDraft.PASS_PROCUREMENT_COST,
    d.variables.EsDraft.MARGIN_PERCENTAGE, d.variables.EditClassSubclass.bufferPeriodDays, d.variables.nope]), JSON.stringify(['ABC1', true, null, 0, undefined]));
  await d.run('setDraftChain', { form: 'NewExpTypeMap', field: 'scopeType', value: 'CLASS' });
  T.check('changing what a mapping applies to clears the picked scope (old switchExpTypeScopeChain)', d.calls.some((x) => x.chain === 'switchExpTypeScopeChain') && d.variables.NewExpTypeMap.scopeId === null);

  T.section('every endpoint the page calls exists in services/');
  const used = new Set();
  fs.readdirSync(NEW_CHAINS).forEach((f) => (fs.readFileSync(path.join(NEW_CHAINS, f), 'utf8').match(/endpoint:\s*'([^']+)'/g) || [])
    .forEach((m) => used.add(m.replace(/endpoint:\s*'/, '').replace("'", ''))));
  [...used].sort().forEach((e) => T.check(e, !!OPS[e]));

  T.report();
})();
