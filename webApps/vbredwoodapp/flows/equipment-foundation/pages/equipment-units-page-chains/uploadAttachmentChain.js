define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/equipmentAttachments',
  'resources/js/currentUser',
], (ActionChain, Actions, ea, cu) => {
  'use strict';

  // Upload: validate, then ONE multipart POST to eqpt
  // (eqp-v1/uploadEquipmentAttachment). The backend stores the file in
  // common-service and the record in EQR_ATTACHMENT, and discards the file if
  // the record fails - so this chain never talks to common-service.
  //
  // ── VALIDATION ────────────────────────────────────────────────────────────
  // The category decides the rules: file, category and name always; Valid
  // from + Valid to (to >= from) only when the category needs dates. Shown on
  // each field via messages-custom. The backend enforces the same rules (and
  // that the category is allowed at this level); checking here first means
  // the user is told before a 20 MB upload, not after.
  //
  // ── THE MULTIPART BODY ────────────────────────────────────────────────────
  // Parts `file` and `metadata`, matching openapi3.json. `metadata` is a Blob
  // of type application/json - eqpt answers 415 otherwise (verified by the
  // backend session 2026-10-01; the same Blob pattern already worked against
  // common-service through VB).
  //
  // X-User-Id from currentUser.auditHeaders -> EQR_ATTACHMENT.CREATED_BY, the
  // "Uploaded by" column. Omitted when no user resolves (backend stamps SYSTEM).
  class uploadAttachmentChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const t = ea.target($page);
      const file = ea.getPendingFile();
      const form = $page.variables.attForm || {};
      const cat = ea.findCategory($page.variables.attCategoryOptions, form.category);
      const name = String(form.name || '').trim();
      $page.variables.attNotice = {};

      const errors = {};
      const fileProblem = ea.acceptsFile(file);
      if (fileProblem) errors.file = fileProblem;
      if (!cat)  errors.category = 'Select a category.';
      if (!name) errors.name = 'Enter a name.';
      if (cat && cat.validityRequired) {
        if (!form.validFrom) errors.validFrom = 'Enter the date this document is valid from.';
        if (!form.validTo)   errors.validTo   = 'Enter the date this document is valid to.';
        else if (form.validFrom && String(form.validTo).substring(0, 10) < String(form.validFrom).substring(0, 10)) {
          errors.validTo = 'Valid to must be on or after valid from.';
        }
      }
      $page.variables.attErrors = errors;
      if (Object.keys(errors).length) return;

      if (!t.entityId) {
        $page.variables.attNotice = { type: 'error', text: 'No equipment record is loaded.' };
        return;
      }

      const metadata = {
        entityName:     t.entityName,
        entityId:       t.entityId,
        attachmentName: name.substring(0, 500),
        categoryId:     Number(cat.value),
        validFromDate:  cat.validityRequired ? String(form.validFrom).substring(0, 10) : null,
        validToDate:    cat.validityRequired ? String(form.validTo).substring(0, 10) : null,
        notes:          String(form.notes || '').trim().substring(0, 4000) || null
      };

      $page.variables.attSaving = true;
      try {
        const response = await Actions.callRest(context, {
          endpoint: 'eqp-v1/uploadEquipmentAttachment',
          headers: cu.auditHeaders(context),
          body: {
            metadata: new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
            file: file
          },
          contentType: 'multipart/form-data'
        });

        if (!response.ok) {
          console.error('[uploadAttachmentChain] rejected', response.status, response.body);
          let fallback = 'Upload failed';
          if (response.status === 413) fallback = 'The file is too large (limit 20 MB)';
          else if (response.status === 415) fallback = 'That file type is not allowed';
          else if (response.status === 502) fallback = 'Document storage is unavailable right now';
          throw new Error(ea.errorText(response, fallback));
        }

        // Back to the list, where the new document now appears.
        await Actions.callChain(context, { chain: 'resetAttachmentFormChain', params: { mode: 'list' } });
        $page.variables.attNotice = { type: 'success', text: '"' + name + '" was uploaded.' };
        await Actions.callChain(context, { chain: 'loadAttachmentsChain' });
      } catch (e) {
        $page.variables.attNotice = { type: 'error', text: (e && e.message) ? e.message : 'Could not upload the attachment.' };
      } finally {
        $page.variables.attSaving = false;
      }
    }
  }

  return uploadAttachmentChain;
});
