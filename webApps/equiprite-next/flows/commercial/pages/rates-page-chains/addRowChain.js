define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/fetchAllPages',
  'resources/js/rateRules',
], (ActionChain, Actions, paging, R) => {
  'use strict';

  // "Add equipment": a new row of the grid, i.e. the first line for a class, subclass or equipment. New EquipRite's
  // addRowChain (the old Add-Line drawer's lists and calls), unchanged:
  //   open      every class, through fetchAllPages (it pages at 20 and there are more)
  //   class     its subclasses, GET /equipment-classes/{classId}/subclasses, then
  //   subclass  the equipment names, GET /equipment-master?equipmentClassId=&equipmentSubclassId=&size=200
  //   rateType, method, basis, location, equipment   the draft
  //   create    one line: the first period the method and basis can carry, threshold 0, no total yet
  const id = (v) => (v === '' || v == null ? null : Number(v));
  let seq = 0;

  class addRowChain extends ActionChain {
    async run(context, { action, value }) {
      const { $page } = context;
      const v = $page.variables;
      const draft = Object.assign({}, v.addRow || {});

      switch (action) {
        case 'open': {
          v.addRowOpen = true;
          v.addRow = { classId: null, subclassId: null, className: '', subclassName: '', equipmentName: '',
            rateType: 'USAGE', calcMethod: 'UTILIZED_DURATION', calcBasis: 'DAILY', location: '' };
          v.addSubclasses = [];
          v.addEquipment = [];
          const classes = await paging.fetchAllPages((o) => Actions.callRest(context, o),
            'eqp-v1/getEquipmentClasses', {}, 'getEquipmentClasses');
          v.addClasses = (classes || []).map((item) => ({ value: item.id, label: item.className }))
            .sort((a, b) => String(a.label).localeCompare(String(b.label)));
          return;
        }
        case 'close':
          v.addRowOpen = false;
          return;
        case 'class': {
          const cls = (v.addClasses || []).find((c) => c.value === id(value));
          v.addRow = Object.assign(draft, { classId: id(value), className: cls ? cls.label : '', subclassId: null,
            subclassName: '', equipmentName: '' });
          v.addSubclasses = [];
          v.addEquipment = [];
          if (!id(value)) return;
          const resp = await Actions.callRest(context, {
            endpoint: 'eqp-v1/getEquipmentSubclassesByClassId',
            uriParams: { classId: id(value) },
          });
          v.addSubclasses = resp && resp.ok ? ((resp.body && resp.body.data) || []).map((item) => ({ value: item.id, label: item.subclassName })) : [];
          await this.names(context);
          return;
        }
        case 'subclass': {
          const sub = (v.addSubclasses || []).find((s) => s.value === id(value));
          const same = draft.subclassId === id(value);
          v.addRow = Object.assign(draft, { subclassId: same ? null : id(value), subclassName: same || !sub ? '' : sub.label,
            equipmentName: '' });
          await this.names(context);
          return;
        }
        case 'equipment':
          v.addRow = Object.assign(draft, { equipmentName: draft.equipmentName === value ? '' : String(value || '') });
          return;
        case 'rateType':
        case 'calcMethod':
        case 'calcBasis':
        case 'location':
          draft[action] = String(value || '');
          v.addRow = draft;
          return;
        case 'create': {
          if (!draft.classId) {
            v.lineError = 'Choose a class for the new row.';
            return;
          }
          const period = draft.calcMethod === 'COMPLETE_PERIOD' ? 'DAILY'
            : (R.isHourlyBasis(draft.calcMethod, draft.calcBasis) ? 'HOURLY' : 'DAILY');
          seq += 1;
          const line = R.newLine(draft, period, 0, 'new:' + Date.now() + ':' + seq);
          const exists = (v.lines || []).some((l) => R.groupKey(l) === R.groupKey(line));
          if (exists) {
            v.lineError = 'That equipment already has a row in this schedule: add its periods there.';
            return;
          }
          let next = (v.lines || []).concat([line]);
          try { next = R.sortLines(next); } catch (e) { /* keep append order */ }
          v.lines = next;
          v.lineError = '';
          v.saveNote = '';
          v.dirty = true;
          v.addRowOpen = false;
          return;
        }
        default:
      }
    }

    async names(context) {
      const { $page } = context;
      const d = $page.variables.addRow || {};
      if (!d.classId) { $page.variables.addEquipment = []; return; }
      const params = { equipmentClassId: d.classId, size: 200 };
      if (d.subclassId != null) params.equipmentSubclassId = d.subclassId;
      const resp = await Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1EquipmentMaster', uriParams: params });
      const seen = new Set();
      $page.variables.addEquipment = resp && resp.ok
        ? ((resp.body && resp.body.data) || []).map((item) => item.equipmentName).filter((n) => n && !seen.has(n) && seen.add(n))
          .map((n) => ({ value: n, label: n }))
        : [];
    }
  }

  return addRowChain;
});
