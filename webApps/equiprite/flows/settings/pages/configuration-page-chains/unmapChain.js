define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/unmapChain.js. Unchanged except the
  // dialog: it closes the page's confirm card where the old chain closed the dialog.

  // Every Fusion field, per level. Explicit nulls: PATCH clears a field only
  // when the key is present -- an omitted key is left as stored.
  const CLASS_FUSION_CLEAR = {
    fusionSourceType: null,
    fusionClassType: null,
    fusionClassTypeName: null,
    fusionClassRef: null,
    fusionClassCode: null,
    fusionClassName: null
  };
  const SUBCLASS_FUSION_CLEAR = {
    fusionSubclassType: null,
    fusionSubclassTypeName: null,
    fusionSubclassRef: null,
    fusionSubclassCode: null,
    fusionSubclassName: null
  };

  // Class Mapping "Unmap" (confirmed): removes the Fusion link but KEEPS the
  // EquipRite class/subclass -- unlike Delete, which soft-deletes the class and
  // is refused while subclasses remain.
  //
  // CLASS level clears the class's axis, type and ref in ONE request: since
  // V370 the backend 400s on clearing the ref alone (the type would be left
  // dangling). It clears the subclasses' Fusion fields FIRST, because a
  // subclass ref only means something under its class's source -- and doing
  // them first means a failure part-way leaves the class still mapped and
  // visible here to retry, rather than hidden with stray subclass refs.
  class unmapChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const t = $page.variables.UnmapTarget || {};
      if (t.classId == null) return;

      const failDetail = (res) => (res.body && res.body.detail)
        || (res.body && JSON.stringify(res.body))
        || ('status ' + res.statusCode);
      const patchSubclass = (id) => Actions.callRest(context, {
        endpoint: 'eqp-v1/patchSubclass',
        uriParams: { classId: Number(t.classId), id: Number(id) },
        body: SUBCLASS_FUSION_CLEAR
      });

      // Trust the echo, not the 200: PATCH ignores keys it does not bind, and the
      // mapper null-ignores some fields, so a "cleared" field can come back
      // still set. Names every field the server kept.
      const kept = (dto, fields) => Object.keys(fields)
        .filter(k => dto && dto[k] != null && dto[k] !== '');
      const leftovers = [];

      $page.variables.isUnmapping = true;
      try {
        if (t.level === 'SUBCLASS') {
          const res = await patchSubclass(t.subclassId);
          if (!res.ok) throw new Error(failDetail(res));
          leftovers.push(...kept(res.body, SUBCLASS_FUSION_CLEAR));
        } else {
          const mappedSubs = ($page.variables.AllSubclassesArray || [])
            .filter(s => Number(s.classId) === Number(t.classId) && s.fusionSubclassRef);
          for (const s of mappedSubs) {
            const res = await patchSubclass(s.id);
            if (!res.ok) throw new Error('Subclass "' + s.subclassName + '": ' + failDetail(res));
            leftovers.push(...kept(res.body, SUBCLASS_FUSION_CLEAR));
          }
          const res = await Actions.callRest(context, {
            endpoint: 'eqp-v1/patchEquipmentClass',
            uriParams: { id: Number(t.classId) },
            body: CLASS_FUSION_CLEAR
          });
          if (!res.ok) throw new Error(failDetail(res));
          leftovers.push(...kept(res.body, CLASS_FUSION_CLEAR));
        }

        $page.variables.confirm = null;

        if (leftovers.length) {
          const fields = Array.from(new Set(leftovers)).join(', ');
          await Actions.fireNotificationEvent(context, {
            summary: 'Mapping partially removed',
            message: 'The following fields were not cleared: ' + fields + '. Contact your administrator.',
            displayMode: 'persist', type: 'warning'
          });
          return;
        }

        await Actions.fireNotificationEvent(context, {
          summary: 'Mapping removed',
          message: t.level === 'SUBCLASS'
            ? 'Removed the mapping from subclass "' + t.subclassName + '".'
            : 'Removed the mapping from class "' + t.className + '". The class is retained under Classes & Subclasses.',
          displayMode: 'transient', type: 'confirmation'
        });
      } catch (e) {
        console.error('unmapChain failed', e);
        $page.variables.confirm = null;
        await Actions.fireNotificationEvent(context, {
          summary: 'Mapping not removed',
          message: (e && e.message) || 'The mapping could not be removed. Try again.',
          displayMode: 'transient', type: 'error'
        });
      } finally {
        // Reload either way: a class-level unmap can fail after some subclasses
        // were already cleared, and the grid must show what is actually stored.
        await Actions.callChain(context, { chain: 'loadEquipmentClassesChain' });
        $page.variables.isUnmapping = false;
      }
    }
  }

  return unmapChain;
});
