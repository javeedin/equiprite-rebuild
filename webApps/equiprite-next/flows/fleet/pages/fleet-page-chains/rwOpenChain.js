define(['vb/action/actionChain', 'resources/js/shellBus', 'resources/js/equipmentRedwood'], (ActionChain, bus, rw) => {
  'use strict';

  // A row of the Redwood table: everything about the unit, in a tab of its own (equipment-360; this tab stays as it is).
  // A serial-numbered unit opens as itself; a lot or stock line opens its equipment item with all its units.
  class rwOpenChain extends ActionChain {
    async run(context, { key }) {
      if (!key) return;
      const u = (context.$page.variables.units || []).filter((x) => String(x.key) === String(key))[0];
      const target = rw.fleetRecord(u);
      if (target) bus.open(target);
    }
  }

  return rwOpenChain;
});
