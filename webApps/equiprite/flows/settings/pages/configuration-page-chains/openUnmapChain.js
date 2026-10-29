define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/openUnmapChain.js. Unchanged except the
  // dialog: the confirmation is the page's confirm card (confirmChain runs the delete on OK).

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

      $page.variables.confirm = {
        kind: 'unmap',
        section: 'classes',
        title: 'Remove mapping',
        okLabel: 'Remove mapping',
        danger: false,
        message: $page.variables.UnmapTarget.level === 'SUBCLASS'
          ? 'Remove the Oracle Fusion mapping from subclass "' + $page.variables.UnmapTarget.subclassName + '" in class "'
            + $page.variables.UnmapTarget.className + '"? The subclass is retained; only its source classification is cleared.'
          : 'Remove the Oracle Fusion mapping from class "' + $page.variables.UnmapTarget.className + '"?'
            + ($page.variables.UnmapTarget.mappedSubclassCount > 0 ? ' The mappings of its ' + $page.variables.UnmapTarget.mappedSubclassCount + ' mapped subclasses are also removed.' : '')
            + ' The class and its subclasses are retained; they show as Custom until mapped again.'
      };
    }
  }

  return openUnmapChain;
});
