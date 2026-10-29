define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/bipLov',
], (ActionChain, Actions, bipLov) => {
  'use strict';

  // Loads the Class / Subclass Attribute lists for every source from
  // EQP_CATEGORY_LOV_RP (P_CATEGORY_TYPE = TYPES) -- the report is the one
  // place those lists are defined (codes, labels, order). The page keeps no
  // copy. All three sources are loaded up front so the grid can label rows of
  // any source, not just the one picked in the add row.
  //
  // Each column carries its FIELD GROUP (Item Class / Attributes / Categories),
  // also defined by the report. Then fills the column-mapping form from the
  // picked source's saved mapping (onColumnMapSourceChangedChain).
  //
  // A failure for one source leaves that source's list empty: its pickers show
  // nothing to choose, and the other sources are unaffected.
  const SOURCES = ['INVENTORY', 'FIXED_ASSET', 'MAINTENANCE'];
  // Shape only -- which codes exist is the report's business. Upper case, plus
  // '|' for EFF fields: 'EFF|<attribute group>|<ATTRIBUTE_CHARn|NUMBERn>'.
  const CODE_RE = /^[A-Z][A-Z0-9_|]{0,199}$/;

  class loadClassMapTypesChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const lists = await Promise.all(SOURCES.map(async source => {
        try {
          const response = await Actions.callRest(context, {
            endpoint: 'bipService/runBIPReport',
            body: bipLov.buildSoapBody('/Custom/EquipRite/EQP_CATEGORY_LOV_RP.xdo', [
              { name: 'P_TRACKING_TYPE', value: source },
              { name: 'P_CATEGORY_TYPE', value: 'TYPES' },
              { name: 'P_PARENT_TYPE',   value: 'NONE' },
              { name: 'P_PARENT_ID',     value: '' }
            ])
          });
          return bipLov.decodeReportRows(
            response && response.body, 'G_1', 'LOV_ID', 'LOV_NAME', 'LOV_CODE')
            .map(r => ({
              source: source,
              value: String(r.id),
              label: r.label || String(r.id),
              sort: r.label2 || '',
              group: r.FIELD_GROUP || '',
              groupName: r.FIELD_GROUP_NAME || r.FIELD_GROUP || ''
            }))
            .filter(t => CODE_RE.test(t.value));
        } catch (e) {
          console.error('loadClassMapTypesChain failed for ' + source, e);
          return [];
        }
      }));

      const types = [].concat(...lists);
      $page.variables.ClassMapTypesArray = types;

      await Actions.callChain(context, { chain: 'onColumnMapSourceChangedChain' });
    }
  }

  return loadClassMapTypesChain;
});
