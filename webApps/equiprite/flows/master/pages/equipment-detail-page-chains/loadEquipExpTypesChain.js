define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/expenditureTypes'
], (ActionChain, Actions, expenditureTypes) => {
  'use strict';

  // The PPM expenditure types for THIS equipment. The old equipment-units-page-chains/loadEquipExpTypesChain.js,
  // without its last part (loading Fusion's expenditure type list for the Add picker): adding, removing and
  // choosing the default are still in Old EquipRite, so this page only reads.
  //
  // Two questions, deliberately both asked:
  //   listExpTypeMaps    -> what is authored AT THIS EQUIPMENT
  //   resolveExpTypeMaps -> what a TIMESHEET would actually offer for it (expenditureTypes.loadMapsForMasters)
  // They differ whenever this equipment has nothing of its own and inherits its subclass's or class's mapping;
  // showing only the first would make an inheriting equipment look unmapped.
  class loadEquipExpTypesChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const masterId = Number($page.variables.equipmentId) || null;
      if (!masterId) { return; }

      const [own, resolved] = await Promise.all([
        Actions.callRest(context, {
          endpoint:  'eqp-v1/listExpTypeMaps',
          // Both or neither -- the endpoint 400s on one without the other.
          uriParams: { scopeType: 'MASTER', scopeId: masterId, page: 0, size: 200 }
        }).catch(function (e) {
          console.warn('[EQPEXPTYPE] own mappings failed:', e && e.message);
          return null;
        }),
        expenditureTypes.loadMapsForMasters(
          function (opts) { return Actions.callRest(context, opts); },
          [masterId]
        ).catch(function () { return {}; })
      ]);

      const rows = (own && own.ok && own.body && Array.isArray(own.body.data)) ? own.body.data : [];
      $page.variables.ExpTypeRows = rows;

      const entry = (resolved && resolved[masterId]) || null;
      const level = (entry && entry.level) || 'NONE';
      $page.variables.ExpTypeResolvedLevel = level;
      $page.variables.ExpTypeInherited = (level === 'SUBCLASS' || level === 'CLASS')
        ? (entry.types || []).map(function (t) { return t.value; }).join(', ')
        : '';
    }
  }

  return loadEquipExpTypesChain;
});
