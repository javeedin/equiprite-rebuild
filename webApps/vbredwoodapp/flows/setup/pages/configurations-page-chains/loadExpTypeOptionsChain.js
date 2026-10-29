define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/expenditureTypes',
  'resources/js/fetchAllPages'
], (ActionChain, Actions, expenditureTypes, paging) => {
  'use strict';

  // What the "add a mapping" form can offer: the three scope lists (equipment
  // models, subclasses, classes) and Fusion's expenditure types.
  //
  // The scope lists come from this app. The expenditure types come from FUSION,
  // and deliberately from the whole tenant rather than from one project's
  // chargeable set: a mapping is authored once and used on every project, so
  // scoping the authoring screen to whichever project happened to be open would
  // hide types that are perfectly valid elsewhere. The narrowing that DOES care
  // about a project happens on the timesheet, where the mapped names are
  // intersected with that project's list.
  class loadExpTypeOptionsChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const callRest = function (opts) { return Actions.callRest(context, opts); };

      // ── scopes ──────────────────────────────────────────────────────────
      // Independent of one another; a failure of one must not cost the others,
      // so each is caught on its own and simply yields an empty picker.

      // Read a whole paged list via the shared helper. ASKING FOR A BIG size
      // IS NOT ENOUGH: these endpoints cap the page and return their own
      // maximum without saying so -- verified on the equipment master, where
      // 306 rows exist but one call returned a subset skewed to the HIGHEST
      // ids, so 'CAT 390F Excavator' (id ...001) was missing from the picker
      // while 'CAT XQ425 Generator' (id ...152) was in it. A truncated picker
      // is worse than a slow one: the equipment simply looks like it does not
      // exist, and there is nothing on screen to suggest otherwise.
      const fetchAllPages = (endpoint, label) => paging.fetchAllPages(
        (o) => Actions.callRest(context, o), endpoint, {}, label);

      const masters = fetchAllPages('eqp-v1/getEquipriteV1EquipmentMaster', 'equipment master')
        .then(function (rows) {
          return rows.map(function (m) {
            return {
              value: m.id,
              // The number is a HINT, shown because it is how the yard refers to
              // a model. It is NOT unique -- 212 distinct across 306 rows -- so
              // nothing keys, joins or dedupes on it.
              label: m.equipmentName + (m.equipmentNumber ? '  (' + m.equipmentNumber + ')' : '')
            };
          }).sort(function (a, b) { return String(a.label).localeCompare(String(b.label)); });
        }).catch(function (e) {
          console.warn('[EXPTYPEMAP] equipment master list failed:', e && e.message);
          return [];
        });

      const subclasses = fetchAllPages('eqp-v1/getAllSubclasses', 'subclasses')
        .then(function (rows) {
          return rows.map(function (s) {
            return { value: s.id, label: s.subclassName + (s.subclassCode ? '  (' + s.subclassCode + ')' : '') };
          }).sort(function (a, b) { return String(a.label).localeCompare(String(b.label)); });
        }).catch(function (e) {
          console.warn('[EXPTYPEMAP] subclass list failed:', e && e.message);
          return [];
        });

      const classes = Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipmentClasses'
      }).then(function (r) {
        const body = (r.ok && r.body) ? r.body : {};
        const rows = Array.isArray(body.data) ? body.data : (Array.isArray(body) ? body : []);
        return rows.map(function (c) {
          return { value: c.id, label: c.className + (c.classCode ? '  (' + c.classCode + ')' : '') };
        }).sort(function (a, b) { return String(a.label).localeCompare(String(b.label)); });
      }).catch(function (e) {
        console.warn('[EXPTYPEMAP] class list failed:', e && e.message);
        return [];
      });

      const resolved = await Promise.all([masters, subclasses, classes]);
      $page.variables.ExpTypeMasterOptions   = resolved[0];
      $page.variables.ExpTypeSubclassOptions = resolved[1];
      $page.variables.ExpTypeClassOptions    = resolved[2];
      // Worth reading against the real counts (306 / 44 / 15 on dev today): a
      // short number here means a page cap won, not that the data is missing.
      console.log('[EXPTYPEMAP] scopes: %d master(s), %d subclass(es), %d class(es)',
        resolved[0].length, resolved[1].length, resolved[2].length);

      // Default the scope picker to whatever the form is currently set to, so
      // the second dropdown is populated on first paint rather than after the
      // user pokes the first one.
      const st = ($page.variables.NewExpTypeMap && $page.variables.NewExpTypeMap.scopeType) || 'MASTER';
      $page.variables.ExpTypeScopeOptions =
        (st === 'SUBCLASS') ? resolved[1] : (st === 'CLASS') ? resolved[2] : resolved[0];

      // ── Fusion expenditure types ────────────────────────────────────────
      // Reuses the timesheet's unit loader, so the two screens read the same
      // source. It returns { name: unit } across every page of the LOV (2,505
      // types at this customer), which is exactly the option list we want, and
      // it carries the UNIT -- the thing that decides whether a timesheet box
      // means a day or an hour. Showing it here lets the author see that
      // "- Operational Day Rate" is a Day before they attach it to a model.
      try {
        const units = await expenditureTypes.loadUnits(callRest);
        const opts = Object.keys(units).sort().map(function (name) {
          return { value: name, label: units[name] ? (name + '  [' + units[name] + ']') : name, uom: units[name] || null };
        });
        $page.variables.FusionExpTypeOptions = opts.length ? opts
          : (expenditureTypes.PROVEN || []).map(function (o) {
            return { value: o.value, label: o.label, uom: null };
          });
        console.log('[EXPTYPEMAP] %d Fusion expenditure type(s) available to author', opts.length);
      } catch (e) {
        // Survivable: fall back to the four values PROVEN accepted by
        // unprocessedProjectCosts, so the screen still authors something rather
        // than presenting an empty picker with no explanation.
        console.warn('[EXPTYPEMAP] Fusion expenditure type list failed, falling back to the proven values:',
          e && e.message);
        $page.variables.FusionExpTypeOptions = (expenditureTypes.PROVEN || []).map(function (o) {
          return { value: o.value, label: o.label, uom: null };
        });
      }
    }
  }

  return loadExpTypeOptionsChain;
});
