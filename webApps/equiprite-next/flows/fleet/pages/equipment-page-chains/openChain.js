define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // Opens what an entry, a bar or a link names, in a tab of its own (this tab stays as it is):
  //   request       a booking, an allocation, a status change, an inspection: the request ({ id, number })
  //   transfer      a transfer order ({ id, number }), or a move between projects on record without one ({ number, source })
  //   unit          one unit of this item: everything about it ({ serial })
  //   item          from a unit: every unit of its equipment ({ name, equipmentId })
  //   availability  Availability, searched for this equipment (its name, or the unit's serial)
  class openChain extends ActionChain {
    async run(context, { kind, id, number, source, serial }) {
      const v = context.$page.variables;
      const head = v.head || {};
      if (kind === 'request') {
        if (!id && !number) return;
        bus.open({ record: 'request', params: { id: id ? Number(id) : undefined, number: number || '' } });
      } else if (kind === 'transfer') {
        if (!id && !number) return;
        const params = { id: id ? Number(id) : undefined, number: number || '' };
        if (source) params.source = source;
        bus.open({ record: 'transfer', params });
      } else if (kind === 'unit') {
        if (!serial) return;
        bus.open({ record: 'equipment-360', params: { serial, name: head.name || '', equipmentId: head.equipmentId || '' } });
      } else if (kind === 'item') {
        if (!head.equipmentId && !head.name) return;
        bus.open({ record: 'equipment-360', params: { name: head.name || '', equipmentId: head.equipmentId || '' } });
      } else if (kind === 'availability') {
        const text = v.mode === 'unit' ? (head.title || v.serial || v.unit) : (head.name || v.name);
        if (!text) return;
        // The tab first (when Availability takes no hand-off it simply opens), then what to show in it.
        bus.open({ navId: 'availability' });
        bus.focus('availability', { text });
      }
    }
  }

  return openChain;
});
