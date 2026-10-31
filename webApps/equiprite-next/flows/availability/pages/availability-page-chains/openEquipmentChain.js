define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // A row or a cell of the yard grid opens everything about that equipment in a tab of its own (record
  // equipment-360): an equipment row as { name, equipmentId } (the id when its units name one), a unit row as
  // { serial }. This tab stays as it is.
  class openEquipmentChain extends ActionChain {
    async run(context, { name, equipmentId, serial }) {
      if (serial) {
        bus.open({ record: 'equipment-360', params: { serial: String(serial) } });
        return;
      }
      if (!name && !equipmentId) return;
      const params = { name: name ? String(name) : '' };
      if (equipmentId) params.equipmentId = String(equipmentId);
      bus.open({ record: 'equipment-360', params });
    }
  }

  return openEquipmentChain;
});
