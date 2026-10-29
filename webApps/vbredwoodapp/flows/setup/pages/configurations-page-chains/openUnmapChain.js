define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Class Mapping "Unmap": stash what is being unmapped and open the confirm
  // dialog. unmapChain does the PATCHes on confirm.
  class openUnmapChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const { level, classId, subclassId } = params || {};
      if (classId == null || classId === '') return;

      const cls = ($page.variables.EquipmentClassesArray || [])
        .find(c => Number(c.id) === Number(classId));
      const subs = ($page.variables.AllSubclassesArray || [])
        .filter(s => Number(s.classId) === Number(classId));
      const sub = level === 'SUBCLASS'
        ? subs.find(s => Number(s.id) === Number(subclassId))
        : null;
      if (!cls || (level === 'SUBCLASS' && !sub)) return;

      $page.variables.UnmapTarget = {
        level: level === 'SUBCLASS' ? 'SUBCLASS' : 'CLASS',
        classId: Number(cls.id),
        subclassId: sub ? Number(sub.id) : null,
        className: cls.className || '',
        subclassName: sub ? (sub.subclassName || '') : '',
        mappedSubclassCount: subs.filter(s => s.fusionSubclassRef).length
      };

      const dlg = document.getElementById('classUnmapDialog');
      if (dlg) dlg.open();
    }
  }

  return openUnmapChain;
});
