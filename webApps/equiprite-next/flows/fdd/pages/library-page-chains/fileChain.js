define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // A file was chosen: show its name, and offer a name and version from it ("EquipRite_FDD_v1.7.docx" → "EquipRite FDD",
  // "1.7") when those are still empty.
  class fileChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      let f = null;
      try { const el = document.getElementById('flibFile'); f = el && el.files && el.files[0]; } catch (e) { /* no DOM */ }
      v.upFile = f ? f.name : '';
      v.result = null;
      if (!f) return;
      const base = f.name.replace(/\.[^.]+$/, '');
      const ver = /(?:^|[\s_-])v(?:ersion)?[\s_-]?(\d+(?:\.\d+)*)/i.exec(base);
      if (!v.upVersion && ver) v.upVersion = ver[1];
      if (!v.upName) v.upName = base.replace(/(?:^|[\s_-])v(?:ersion)?[\s_-]?\d+(?:\.\d+)*.*$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || base;
    }
  }
  return fileChain;
});
