define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/expenditureTypes'
], (ActionChain, Actions, expenditureTypes) => {
  'use strict';

  // The PPM expenditure types for THIS equipment, for the detail page's own
  // section. Same table and same endpoints as Configurations > Expenditure
  // Types -- one source of truth, two places to reach it. This page only ever
  // reads and writes MASTER scope; subclass and class stay on the config
  // screen, where you can see the whole picture before changing something that
  // affects a whole family.
  class loadEquipExpTypesChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const masterId = Number($page.variables.equipmentId) || null;
      if (!masterId) { return; }

      // Two questions, deliberately both asked.
      //
      //   listExpTypeMaps  -> what is authored AT THIS EQUIPMENT (editable here)
      //   resolveExpTypeMaps -> what a TIMESHEET would actually offer for it
      //
      // They differ whenever this equipment has nothing of its own and inherits
      // its subclass's or class's mapping. Showing only the first would make an
      // inheriting equipment look unmapped, and someone would "fix" it by
      // authoring a duplicate at master level -- which then silently REPLACES
      // the family mapping, because resolution is most-specific-wins and never
      // a union. So the page shows what it inherits and says where from.
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

      // Only meaningful when nothing is authored here: it names the family this
      // equipment is currently borrowing from.
      $page.variables.ExpTypeInherited = (level === 'SUBCLASS' || level === 'CLASS')
        ? (entry.types || []).map(function (t) { return t.value; }).join(', ')
        : '';

      console.log('[EQPEXPTYPE] master %s: %d own, resolves at %s', masterId, rows.length, level);

      // The picker's options: Fusion's expenditure types with their UNIT, from
      // the same loader the timesheet and the admin screen use (module-cached,
      // so this is usually free). The unit is shown because it is what decides
      // whether a timesheet box means a day or an hour -- the whole reason this
      // mapping exists.
      //
      // Tenant-wide, not project-scoped: one mapping serves every project this
      // equipment goes to. ⚠️ That means the list contains types a given
      // project cannot be charged under; the timesheet intersects and warns.
      if (!($page.variables.FusionExpTypeOptions || []).length) {
        try {
          const units = await expenditureTypes.loadUnits(
            function (opts) { return Actions.callRest(context, opts); }
          );
          const opts = Object.keys(units).sort().map(function (name) {
            return {
              value: name,
              label: units[name] ? (name + '  [' + units[name] + ']') : name
            };
          });
          $page.variables.FusionExpTypeOptions = opts.length ? opts
            : (expenditureTypes.PROVEN || []).map(function (o) {
              return { value: o.value, label: o.label };
            });
        } catch (e) {
          console.warn('[EQPEXPTYPE] Fusion type list failed, falling back to proven values:',
            e && e.message);
          $page.variables.FusionExpTypeOptions = (expenditureTypes.PROVEN || []).map(function (o) {
            return { value: o.value, label: o.label };
          });
        }
      }
    }
  }

  return loadEquipExpTypesChain;
});
