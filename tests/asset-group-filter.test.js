/*
 * Equipment Master — Asset Group facet. EXECUTED, not just read.
 *
 * Items are filtered by Fusion asset group, DERIVED from their assets: the
 * backend's assetGroupId matches items with at least one active asset in the
 * group (EQR_ASSET_GROUP_ITEM_V). No group is ever stored on the item.
 *
 * Pinned here:
 *   - the facet reaches the query string as ?assetGroupId=<id>, in both the
 *     nested and the flat criterion shapes, and alongside class + keyword;
 *   - the dropdown is loaded through fetchAllPages (GET /asset-groups pages at
 *     20 by default), labelled by group name, sorted, inactive groups dropped;
 *   - the facet is wired end to end: search config field, page searchContext,
 *     the ADP it reads, and the smart-search suggestion-filters list.
 *
 * Run:  node tests/asset-group-filter.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const H = require('./_harness.js');
const { check, eq, section, report } = H.makeAsserter();

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'webApps/vbredwoodapp');

// AMD loader: `deps` resolved by the caller's map, anything else -> {}.
function loadAmd(file, depMap) {
  const src = fs.readFileSync(file, 'utf8');
  let mod;
  const define = (deps, factory) => {
    mod = factory.apply(null, (deps || []).map(d => (d in depMap ? depMap[d] : {})));
  };
  new Function('define', src)(define);
  return mod;
}

(async () => {
  const URI = require('urijs');
  const T = loadAmd(path.join(ROOT, 'services/eqp-v1/transforms/equipmentMaster.js'),
                    { 'urijs/URI': URI });
  const req = new T.request();
  const params = fc => URI(req.filter({ url: 'http://x/equipment-master' }, fc).url).search(true);

  section('transform — assetGroupId reaches the query string');
  eq('nested SelectSingle', params({ op: '$eq', value: { assetGroupId: 10 } }).assetGroupId, '10');
  eq('flat SelectSingle', params({ op: '$eq', attribute: 'assetGroupId', value: 11 }).assetGroupId, '11');
  {
    const p = params({ $tag: '_root_', criteria: [
      { text: 'CAT', matchBy: 'phrase' },
      { op: '$eq', value: { equipmentClassId: 1000000220 } },
      { op: '$eq', value: { assetGroupId: 12 } }] });
    eq('combined: keyword kept', p.q, 'CAT');
    eq('combined: class kept', p.equipmentClassId, '1000000220');
    eq('combined: group kept', p.assetGroupId, '12');
  }
  check('an unknown facet is still dropped',
    !('someOtherId' in params({ op: '$eq', value: { someOtherId: 1 } })));

  section('init chain — group options');
  {
    const paging = loadAmd(path.join(APP, 'resources/js/fetchAllPages.js'), {});
    const groups = [
      { id: 12, groupName: 'Lifting and Cranes' },
      { id: 10, groupName: 'Denver Mnt Production Vehicles' },
      { id: 13, groupName: 'Old Group', inactiveOnDate: '2020-01-01' },
      { id: 14, groupName: 'Ends Later', inactiveOnDate: '2999-12-31' }];
    const a = H.makeActions(o => o.endpoint === 'eqp-v1/getAssetGroups'
      ? { ok: true, body: { data: groups, recordCount: groups.length, hasMore: false } }
      : { ok: true, body: { data: [], hasMore: false } });
    const Chain = loadAmd(
      path.join(APP, 'flows/equipment-foundation/pages/equipment-master-page-chains/EquipmentInitChain.js'),
      { 'vb/action/actionChain': class {}, 'vb/action/actions': a.Actions,
        'resources/js/fetchAllPages': paging });
    const v = {};
    await new Chain().run({ $page: { variables: v } });

    const call = a.calls.find(c => c.endpoint === 'eqp-v1/getAssetGroups');
    check('asset groups requested', !!call);
    check('through fetchAllPages (page + size sent)',
      call && call.uriParams && call.uriParams.page === 0 && call.uriParams.size > 20);
    eq('labels sorted, inactive dropped',
      (v.assetGroupOptionsArray || []).map(o => o.label).join(' | '),
      'Denver Mnt Production Vehicles | Ends Later | Lifting and Cranes');
    eq('value is the EQR id', (v.assetGroupOptionsArray || [])[0].value, 10);
  }

  section('page wiring');
  {
    const cfg = JSON.parse(fs.readFileSync(path.join(APP, 'resources/data/equipmentMasterSearchConfig.json'), 'utf8'));
    eq('search config field', cfg.filters.AssetGroupFilter && cfg.filters.AssetGroupFilter.options.field, 'assetGroupId');
    const pj = JSON.parse(H.readPageFile('equipment-master-page.json'));
    const f = pj.variables.searchContext.defaultValue.$search.filters.AssetGroupFilter;
    check('searchContext reads the group ADP', f && /assetGroupOptionsADP/.test(f.options.optionsData));
    check('ADP binds the options array',
      /assetGroupOptionsArray/.test(pj.variables.assetGroupOptionsADP.defaultValue.data));
    const html = H.readPageFile('equipment-master-page.html');
    check('offered as a suggestion filter', /suggestion-filters='[^']*"AssetGroupFilter"/.test(html));
    const api = JSON.parse(fs.readFileSync(path.join(ROOT, 'services/eqp-v1/openapi3.json'), 'utf8'));
    check('openapi: getAssetGroups exists', !!(api.paths['/equiprite/v1/asset-groups'] || {}).get);
    check('openapi: equipment-master accepts assetGroupId',
      api.paths['/equiprite/v1/equipment-master'].get.parameters.some(p => p.name === 'assetGroupId'));
  }

  section('catalog — same facet, same derived meaning');
  {
    const C = loadAmd(path.join(ROOT, 'services/eqp-v1/transforms/equipmentCatalog.js'),
                      { 'urijs/URI': URI });
    const creq = new C.request();
    const cp = fc => URI(creq.filter({ url: 'http://x/equipment-catalog?startDate=2026-10-10' }, fc).url).search(true);
    eq('nested facet', cp({ op: '$eq', value: { assetGroupId: 10 } }).assetGroupId, '10');
    eq('flat facet', cp({ op: '$eq', attribute: 'assetGroupId', value: 11 }).assetGroupId, '11');
    {
      const p = cp({ $tag: '_root_', criteria: [
        { text: 'exc', matchBy: 'phrase' }, { op: '$eq', value: { assetGroupId: 12 } }] });
      eq('with keyword: keyword kept', p.keyword, 'exc');
      eq('with keyword: group kept', p.assetGroupId, '12');
      eq('date params untouched', p.startDate, '2026-10-10');
    }
    check('old placeholder field "assetGroup" is not sent',
      !('assetGroup' in cp({ op: '$eq', value: { assetGroup: 10 } })));

    const cfg = JSON.parse(fs.readFileSync(path.join(APP, 'resources/search-config/equipmentCatalogSearchConfig.json'), 'utf8'));
    eq('catalog search config field', cfg.filters.AssetGroupFilter.options.field, 'assetGroupId');
    const cpj = JSON.parse(fs.readFileSync(path.join(APP, 'flows/customer-portal/pages/request-catalog-page.json'), 'utf8'));
    check('catalog searchContext reads the group ADP',
      /AssetGroupOptionsADP/.test(cpj.variables.searchContext.defaultValue.$search.filters.AssetGroupFilter.options.optionsData));
    const chtml = fs.readFileSync(path.join(APP, 'flows/customer-portal/pages/request-catalog-page.html'), 'utf8');
    check('catalog offers it as a suggestion filter', /suggestion-filters='[^']*"AssetGroupFilter"/.test(chtml));
    const init = fs.readFileSync(path.join(APP,
      'flows/customer-portal/pages/request-catalog-page-chains/CatalogInitChain.js'), 'utf8');
    check('catalog init fills AssetGroupOptionsArray from getAssetGroups via fetchAllPages',
      /fetchAllPages\(.{0,120}?'eqp-v1\/getAssetGroups'/.test(init.replace(/\s+/g, ' ')) &&
      /AssetGroupOptionsArray\s*=/.test(init));
    const api = JSON.parse(fs.readFileSync(path.join(ROOT, 'services/eqp-v1/openapi3.json'), 'utf8'));
    check('openapi: equipment-catalog accepts assetGroupId',
      api.paths['/equiprite/v1/views/equipment-catalog'].get.parameters.some(p => p.name === 'assetGroupId'));
  }

  report();
})();
