define([
  'vb/action/actionChain',
  'resources/js/equipmentAttachments',
], (ActionChain, ea) => {
  'use strict';

  // Fired by the dialog's file picker (on-oj-select), and by "Remove file"
  // with clear=true. Type and size are checked here, on pick, so the user is
  // not told after a 20 MB upload.
  //
  // The File goes to equipmentAttachments' holder - see setPendingFile for
  // why it is not a page variable. Only its name, size and type are kept on
  // the page. An empty Name is pre-filled from the file name (minus the
  // extension); a name the user already typed is left alone.
  class pickAttachmentFileChain extends ActionChain {
    async run(context, { file, clear }) {
      const { $page } = context;

      if (clear) {
        ea.setPendingFile(null);
        $page.variables.attFileInfo = {};
        return;
      }
      if (!file) return;

      const problem = ea.acceptsFile(file);
      if (problem) {
        ea.setPendingFile(null);
        $page.variables.attFileInfo = {};
        $page.variables.attErrors = Object.assign({}, $page.variables.attErrors, { file: problem });
        return;
      }

      ea.setPendingFile(file);
      $page.variables.attFileInfo = {
        name: file.name,
        size: ea.formatSize(file.size),
        type: ea.fileTypeLabel(file.type, file.name)
      };
      $page.variables.attErrors = Object.assign({}, $page.variables.attErrors, { file: '' });

      if (!String($page.variables.attForm.name || '').trim()) {
        $page.variables.attForm = Object.assign({}, $page.variables.attForm, {
          name: String(file.name).replace(/\.[^.]+$/, '')
        });
      }
    }
  }

  return pickAttachmentFileChain;
});
