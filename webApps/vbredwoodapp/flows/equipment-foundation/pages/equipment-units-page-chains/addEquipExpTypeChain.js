define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Attach one expenditure type to THIS equipment. MASTER scope only -- this
  // page never authors at subclass or class, because a change there affects
  // equipment that is not on screen.
  class addEquipExpTypeChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const masterId = Number($page.variables.equipmentId) || null;
      const expType  = ($page.variables.NewEquipExpType || '').trim();
      if (!masterId) { return; }

      if (!expType) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Pick an expenditure type',
          message: 'Choose the Fusion expenditure type this equipment bills under.',
          displayMode: 'transient',
          type: 'warning'
        });
        return;
      }
      // Matches EQR_EXP_TYPE_MAP.EXPENDITURE_TYPE, which matches
      // EQR_REQUEST_LINE.EXPENDITURE_TYPE -- a name that cannot be written onto
      // the line is no use here.
      if (expType.length > 80) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Name too long',
          message: 'Expenditure type names are limited to 80 characters.',
          displayMode: 'transient',
          type: 'warning'
        });
        return;
      }

      // The rows already loaded for THIS equipment are the whole truth for this
      // scope -- unlike the admin table, this list is never filtered -- so the
      // first-becomes-default rule can be decided from them.
      const existing = $page.variables.ExpTypeRows || [];

      // Captured BEFORE the add and before the reload. The reload sets
      // ExpTypeResolvedLevel to MASTER -- a row exists now -- so reading it
      // afterwards would always say MASTER and the warning below could never
      // fire. That warning is the only thing standing between a well-meaning
      // add and silently detaching this equipment from its family mapping.
      const inheritedFrom = ($page.variables.ExpTypeResolvedLevel === 'SUBCLASS') ? 'subclass'
                          : ($page.variables.ExpTypeResolvedLevel === 'CLASS') ? 'class'
                          : null;

      const maxOrder = existing.reduce(function (m, r) {
        const o = (r && r.displayOrder != null) ? Number(r.displayOrder) : 0;
        return o > m ? o : m;
      }, 0);

      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/createExpTypeMap',
        body: {
          scopeType:       'MASTER',
          scopeId:         masterId,
          expenditureType: expType,
          isDefault:       existing.length === 0 ? 'Y' : 'N',
          displayOrder:    maxOrder + 1,
          mapSource:       'MANUAL'
        }
      });

      if (result.ok) {
        $page.variables.NewEquipExpType = '';
        await Actions.callChain(context, { chain: 'loadEquipExpTypesChain' });

        // Worth saying out loud the first time: authoring here STOPS the
        // inheritance, it does not add to it. Resolution is most-specific-wins
        // and never a union, so one type here replaces the whole subclass list
        // for this equipment.
        const replaced = existing.length === 0 && !!inheritedFrom;
        await Actions.fireNotificationEvent(context, {
          summary: 'Expenditure type added',
          message: replaced
            ? '"' + expType + '" now applies to this equipment INSTEAD of the types it '
              + 'inherited from its ' + inheritedFrom + '. Add the others here too if they '
              + 'still apply.'
            : '"' + expType + '" will be offered on timesheets for this equipment.',
          displayMode: 'transient',
          type: replaced ? 'warning' : 'confirmation'
        });
      } else if (result.statusCode === 409) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Already attached',
          message: '"' + expType + '" is already on this equipment.',
          displayMode: 'transient',
          type: 'warning'
        });
      } else {
        const detail = (result.body && (result.body.detail || JSON.stringify(result.body)))
          || ('status ' + result.statusCode);
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not add',
          message: detail,
          displayMode: 'transient',
          type: 'error'
        });
      }
    }
  }

  return addEquipExpTypeChain;
});
