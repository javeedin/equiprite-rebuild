define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraBacklog',
  'resources/js/shellBus',
], (ActionChain, Actions, J, bus) => {
  'use strict';

  // An attachment of one of the stories that is not an image: read through the jira connection, opened or saved.
  class fileChain extends ActionChain {
    async run(context, { id, key }) {
      const v = context.$page.variables;
      const s = (v.stories || []).filter((x) => x.key === String(key || ''))[0];
      const att = ((s && s.attachments) || []).filter((a) => a.id === String(id || ''))[0];
      if (!att) return;
      bus.toast('Opening ' + att.name + '…', 'info');
      const ok = await J.openAttachment(context, Actions, att);
      if (!ok) bus.toast('Jira did not give ' + att.name + '. Open it from the story in Jira.', 'error');
    }
  }
  return fileChain;
});
