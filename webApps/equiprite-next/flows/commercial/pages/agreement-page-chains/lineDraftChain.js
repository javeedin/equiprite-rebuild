define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/fetchAllPages',
  'resources/js/agreementRules',
], (ActionChain, Actions, paging, A) => {
  'use strict';

  // Adding and removing lines: New EquipRite's lineDraftChain (the old Add-Line drawer's lists and calls), unchanged:
  //   open      every class through fetchAllPages (it pages at 20)
  //   class     its subclasses, GET /equipment-classes/{classId}/subclasses, then the equipment
  //   subclass  the equipment again, narrowed: GET /equipment-master?equipmentClassId=&equipmentSubclassId=&size=200;
  //             the value is the master id, which the line saves (EQR_EQUIPMENT_MASTER_ID)
  //   equipment, description, unitPrice, priceUom   the draft
  //   add       the old addAgreementLineChain: a class, a rate above 0, not the same equipment twice; the line number
  //             is max(existing) + 1; nothing is saved until Save
  //   remove    a saved line's id goes to deletedLineIds, which Save deletes first; a line never saved is just dropped
  const id = (v) => (v === '' || v == null ? null : Number(v));
  const EMPTY = { classId: null, className: '', subclassId: null, subclassName: '', equipmentMasterId: null,
    equipmentName: '', description: '', unitPrice: null, priceUom: 'DAY' };

  class lineDraftChain extends ActionChain {
    async run(context, { action, value, key }) {
      const { $page } = context;
      const v = $page.variables;
      const draft = Object.assign({}, v.currentLine || EMPTY);

      switch (action) {
        case 'open': {
          v.addLineOpen = true;
          v.lineError = '';
          v.currentLine = Object.assign({}, EMPTY);
          v.equipmentSubclassesArray = [];
          v.equipmentNamesArray = [];
          const classes = await paging.fetchAllPages((o) => Actions.callRest(context, o),
            'eqp-v1/getEquipmentClasses', {}, 'getEquipmentClasses');
          v.equipmentClassesArray = (classes || []).filter((c) => c != null)
            .map((c) => ({ value: c.id, label: c.className || c.classCode || String(c.id) }));
          return;
        }
        case 'close':
          v.addLineOpen = false;
          return;
        case 'class': {
          const cls = (v.equipmentClassesArray || []).find((c) => c.value === id(value));
          v.currentLine = Object.assign(draft, { classId: id(value), className: cls ? cls.label : '', subclassId: null,
            subclassName: '', equipmentMasterId: null, equipmentName: '' });
          v.equipmentSubclassesArray = [];
          v.equipmentNamesArray = [];
          if (!id(value)) return;
          const result = await Actions.callRest(context, {
            endpoint: 'eqp-v1/getEquipmentSubclassesByClassId',
            uriParams: { classId: id(value) }
          });
          v.equipmentSubclassesArray = result && result.body && result.body.data
            ? result.body.data.filter((s) => s != null).map((s) => ({ value: s.id, label: s.subclassName || s.subclassCode || String(s.id) }))
            : [];
          await this.names(context);
          return;
        }
        case 'subclass': {
          const sub = (v.equipmentSubclassesArray || []).find((s) => s.value === id(value));
          const same = draft.subclassId === id(value);
          v.currentLine = Object.assign(draft, { subclassId: same ? null : id(value), subclassName: same || !sub ? '' : sub.label,
            equipmentMasterId: null, equipmentName: '' });
          await this.names(context);
          return;
        }
        case 'equipment': {
          const e = (v.equipmentNamesArray || []).find((x) => Number(x.value) === Number(value));
          const same = Number(draft.equipmentMasterId) === Number(value);
          v.currentLine = Object.assign(draft, { equipmentMasterId: same || !e ? null : Number(e.value), equipmentName: same || !e ? '' : e.label });
          return;
        }
        case 'description':
          v.currentLine = Object.assign(draft, { description: String(value || '') });
          return;
        case 'unitPrice':
          v.currentLine = Object.assign(draft, { unitPrice: value === '' || value == null ? null : Number(value) });
          return;
        case 'priceUom':
          v.currentLine = Object.assign(draft, { priceUom: String(value || 'DAY') });
          return;
        case 'add': {
          const problem = A.lineProblem(draft, v.equipmentLines);
          if (problem) {
            v.lineError = problem;
            return;
          }
          v.equipmentLines = (v.equipmentLines || []).concat([A.lineFromDraft(draft, v.equipmentLines)]);
          v.currentLine = Object.assign({}, EMPTY);
          v.addLineOpen = false;
          v.lineError = '';
          v.dirty = true;
          return;
        }
        case 'remove': {
          const lines = v.equipmentLines || [];
          const line = lines.find((l) => String(l.lineNumber) === String(key));
          if (!line) return;
          if (line.lineId != null) {
            v.deletedLineIds = (v.deletedLineIds || []).concat([Number(line.lineId)]);
          }
          v.equipmentLines = lines.filter((l) => l !== line);
          v.dirty = true;
          return;
        }
        default:
      }
    }

    // Old loadEquipmentNamesByClassChain: the spec's parameter names (equipmentClassId / equipmentSubclassId),
    // value = the master id.
    async names(context) {
      const { $page } = context;
      const d = $page.variables.currentLine || {};
      $page.variables.equipmentNamesArray = [];
      if (!d.classId) return;
      const params = { equipmentClassId: d.classId, size: 200 };
      if (d.subclassId != null) params.equipmentSubclassId = d.subclassId;
      const result = await Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1EquipmentMaster', uriParams: params });
      if (!result || !result.body || !result.body.data) return;
      $page.variables.equipmentNamesArray = result.body.data
        .filter((e) => e != null && e.id != null)
        .map((e) => ({ value: Number(e.id), label: e.equipmentName || String(e.id) }));
    }
  }

  return lineDraftChain;
});
