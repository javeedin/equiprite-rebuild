define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/createClassSubclassChain.js, unchanged.

  // Add Class drawer, Create: an equipment CLASS (and optionally a SUBCLASS
  // under it) picked from the values of the Fusion columns MAPPED for the TYPE
  // on the Class Mapping sub-tab (CLASS_MAPPING_COLUMNS_<TYPE>).
  //
  // Each row stores where it came from -- FUSION_SOURCE_TYPE = the TYPE, the
  // mapped column as FUSION_*_TYPE (+ its name), the picked value as
  // FUSION_*_REF -- the same as Preview & Create, and exactly what the item
  // import matches items on.
  //
  // A class that already exists for the same TYPE + column + value is REUSED, so
  // adding a second subclass under it never duplicates the class.
  //
  // CUSTOM: class / subclass names typed by hand, stored with NO Fusion fields --
  // the import never matches items to them. An existing class of the same name
  // is reused the same way.
  class createClassSubclassChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const form = $page.variables.newClassSubclass || {};
      const source = String(form.trackingType || '').toUpperCase();
      const mapping = $page.functions.columnMappingFor($page.variables.ConfigSettingsMap, source);
      const notify = (summary, message, type) =>
        Actions.fireNotificationEvent(context, { summary, message, type, displayMode: 'transient' });

      const custom = source === 'CUSTOM';
      // CUSTOM reads the typed names into the same shape the pickers give.
      const pickedClass = custom
        ? (String(form.className || '').trim() ? { value: null, label: String(form.className).trim() } : null)
        : ($page.variables.ClassLovArray || []).find(r => String(r.value) === String(form.classLovId));
      const pickedSub = custom
        ? (String(form.subclassName || '').trim() ? { value: null, label: String(form.subclassName).trim() } : null)
        : (form.subclassLovId != null && form.subclassLovId !== ''
            ? ($page.variables.SubclassLovArray || []).find(r => String(r.value) === String(form.subclassLovId))
            : null);

      if (!custom && !mapping) {
        await notify('No column mapping',
          'Map the class column for ' + $page.functions.fusionSourceLabel(source) + ' on the Class Mapping tab first.', 'warning');
        return;
      }
      if (!pickedClass) {
        await notify('Required information missing', custom ? 'Enter a class name.' : 'Select a class.', 'warning');
        return;
      }

      const className = String(pickedClass.label || pickedClass.value).trim();
      const subclassName = pickedSub ? String(pickedSub.label || pickedSub.value).trim() : '';

      const existing = ($page.variables.EquipmentClassesArray || []).find(c => custom
        ? !c.fusionClassRef && String(c.className).trim().toLowerCase() === className.toLowerCase()
        : c.fusionSourceType === source && c.fusionClassType === mapping.classColumn
          && String(c.fusionClassRef) === String(pickedClass.value));
      if (existing && !pickedSub) {
        await notify('Class already exists', '"' + className + '" already exists as equipment class "'
          + existing.className + '".', 'warning');
        return;
      }
      if (existing && pickedSub && ($page.variables.AllSubclassesArray || []).some(s =>
            Number(s.classId) === Number(existing.id) && (custom
              ? String(s.subclassName).trim().toLowerCase() === subclassName.toLowerCase()
              : String(s.fusionSubclassRef) === String(pickedSub.value)
                && s.fusionSubclassType === mapping.subclassColumn))) {
        await notify('Subclass already exists', '"' + subclassName + '" already exists under "'
          + existing.className + '".', 'warning');
        return;
      }

      // Derive a simple uppercase code from the name (backend code column).
      const toCode = (name) => name.toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
      const failDetail = (res) => (res.body && res.body.detail)
        || (res.body && JSON.stringify(res.body)) || ('status ' + res.statusCode);
      // NOT-NULL columns the backend does not auto-populate: EFFECTIVE_START_DATE,
      // CREATED_BY, LAST_UPDATED_BY. Sent explicitly.
      const audit = { effectiveStartDate: new Date().toISOString(), createdBy: 'EQUIPRITE',
                      lastUpdatedBy: 'EQUIPRITE', objectVersionNumber: 1 };

      $page.variables.isAddingClassSubclass = true;
      try {
        // 1) The class -- reuse it, or create it.
        let classId = existing ? Number(existing.id) : null;
        if (classId == null) {
          const res = await Actions.callRest(context, {
            endpoint: 'eqp-v1/createEquipmentClass',
            body: {
              className: className,
              classCode: toCode(className),
              assetClassCode: toCode(className),
              // CUSTOM: no Fusion fields at all (the pair rule rejects a type
              // or source without a ref).
              ...(custom ? {} : {
                fusionSourceType: source,
                fusionClassType: mapping.classColumn,
                fusionClassTypeName: mapping.classColumnName,
                fusionClassRef: String(pickedClass.value),
                fusionClassCode: pickedClass.code || null,
                fusionClassName: className
              }),
              ...audit
            }
          });
          if (!res.ok) throw new Error(failDetail(res));
          classId = Number(res.body && res.body.id);
        }

        // 2) Optionally the subclass under it. The behaviour flags live on the
        //    subclass, so without one they are not stored.
        if (pickedSub) {
          const res = await Actions.callRest(context, {
            endpoint: 'eqp-v1/createSubclass',
            uriParams: { classId: classId },
            body: {
              eqrEquipmentClassId: classId,
              subclassName: subclassName,
              subclassCode: toCode(subclassName),
              trackingType: source,
              consumableFlag: form.consumableFlag === 'Y' ? 'Y' : 'N',
              autoConsumeFlag: form.autoConsumeFlag === 'Y' ? 'Y' : 'N',
              ...(custom ? {} : {
                fusionSubclassType: mapping.subclassColumn,
                fusionSubclassTypeName: mapping.subclassColumnName,
                fusionSubclassRef: String(pickedSub.value),
                fusionSubclassCode: pickedSub.code || null,
                fusionSubclassName: subclassName
              }),
              bufferPeriodDays: 0,
              ...audit
            }
          });
          if (!res.ok) {
            // The class (if new) is already saved -- reload so it is not lost
            // from view, then report the subclass failure.
            await Actions.callChain(context, { chain: 'loadEquipmentClassesChain' });
            throw new Error('Subclass "' + subclassName + '": ' + failDetail(res));
          }
        }

        // 3) Refresh, and filter the grid to the class so the result is visible.
        await Actions.callChain(context, { chain: 'loadEquipmentClassesChain' });
        await Actions.callChain(context, { chain: 'applyClassFilterChain', params: { classId: classId } });
        $page.variables.isAddClassDrawerOpen = false;

        await notify(existing ? 'Subclass added' : 'Class created',
          existing ? 'Added subclass "' + subclassName + '" to "' + existing.className + '".'
            : (subclassName ? 'Added "' + className + '" with subclass "' + subclassName + '".'
              : 'Added class "' + className + '".'),
          'confirmation');
      } catch (e) {
        console.error('createClassSubclassChain failed', e);
        await notify('Class not created', (e && e.message) || 'The class could not be created. Try again.', 'error');
      } finally {
        $page.variables.isAddingClassSubclass = false;
      }
    }
  }

  return createClassSubclassChain;
});
