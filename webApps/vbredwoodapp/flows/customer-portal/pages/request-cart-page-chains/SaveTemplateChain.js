define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class SaveTemplateChain extends ActionChain {
    async run(context) {
      const { $page, $flow } = context;

      const name = ($page.variables.templateName || '').trim();
      const desc = ($page.variables.templateDescription || '').trim();

      if (!name) {
        $page.variables.templateNameError = 'Template name is required.';
        return;
      }
      $page.variables.templateNameError = '';

      const cartItems = $flow.variables.CartItemsArray || [];
      if (cartItems.length === 0) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Cart is empty',
          message: 'Cannot save an empty template.',
          type: 'warning',
          displayMode: 'transient'
        });
        return;
      }

      const detail = $flow.variables.ActiveRequestDetail || {};

      // ── 1. Create the template header. ───────────────────────────────
      // A template is a reusable equipment grouping — no dates, no billing,
      // no request linkage. Body matches the createRequestTemplate contract:
      //   templateCode, templateName, userId, description, isSharedFlag,
      //   isActiveFlag. isSharedFlag/isActiveFlag are NOT NULL on the table.
      // userId stays null (the FK rejects the customer-portal id, which lives in
      // a different id space).
      //
      // templateCode has a UNIQUE constraint. A name-derived code collided when
      // two templates shared a name ("data-integrity-violation: a record with
      // this key already exists"), so we append a timestamp suffix to guarantee
      // uniqueness while keeping the name-based prefix readable.
      const codePrefix = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 16);
      const codeSuffix = Date.now().toString(36).toUpperCase();
      const templateCode = 'TMPL-' + (codePrefix ? codePrefix + '-' : '') + codeSuffix;
      const headerResult = await Actions.callRest(context, {
        endpoint: 'eqp-v1/createRequestTemplate',
        body: {
          templateCode:        templateCode || null,
          templateName:        name,
          userId:              null,
          description:         desc || null,
          isSharedFlag:        'Y',
          isActiveFlag:        'Y'
        }
      });

      console.log('[SaveTemplate] POST header status:', headerResult.status, JSON.stringify(headerResult.body));

      if (!headerResult.ok || !headerResult.body || headerResult.body.id == null) {
        var hErr = (headerResult.body && (headerResult.body.detail || headerResult.body.errors)) || '';
        await Actions.fireNotificationEvent(context, {
          summary: 'Save failed',
          message: 'Could not create the template (HTTP ' + headerResult.status + ')' + (hErr ? ': ' + hErr : '') + '.',
          type: 'error',
          displayMode: 'transient'
        });
        return;
      }

      const templateId = headerResult.body.id;

      // The template-lines endpoint requires templateName + templateNumber on
      // EACH line (NOT NULL → 400 "Validation Failed" when omitted). Pull the
      // canonical templateNumber from the header response if it returned one;
      // otherwise fall back to the new template id (a unique non-null number).
      const hb = headerResult.body || {};
      const templateNumber = hb.templateNumber != null ? Number(hb.templateNumber)
        : (hb.templateNo != null ? Number(hb.templateNo) : Number(templateId));

      // ── 2. Create one line per cart item. ────────────────────────────
      // Each line points to the SPECIFIC unit the user grouped via
      // equipmentMasterId (the column backend added 2026-06-09), and keeps
      // equipmentClassId for reporting. requestedDays is NOT NULL DEFAULT 1
      // on the table and templates carry no dates, so we always send 1.
      // Cart items without a master id are skipped + reported (partial-
      // failure UX mirrors SubmitRequestChain).
      const failedLines = [];
      for (let i = 0; i < cartItems.length; i++) {
        const ci = cartItems[i];
        const masterId = ci.equipmentId != null ? ci.equipmentId : ci.id;
        const label = ci.name || ('Line ' + (i + 1));

        if (masterId == null) {
          console.warn('[SaveTemplate] skipping line — no equipmentId:', JSON.stringify(ci));
          failedLines.push({ name: label, status: 'no equipment id' });
          continue;
        }

        const lineResult = await Actions.callRest(context, {
          endpoint: 'eqp-v1/createTemplateLine',
          body: {
            // FK to the header — the contract shows both requestTemplateId and
            // templateHeaderId; send both (= new template id) so whichever the
            // backend binds resolves.
            requestTemplateId: Number(templateId),
            templateHeaderId:  Number(templateId),
            // REQUIRED on the line (NOT NULL): templateName + templateNumber.
            // Omitting these was the 400 "templateName/templateNumber must not
            // be null". templateName mirrors the header name; templateNumber
            // comes from the header response (or the id as a unique fallback).
            templateName:        name,
            templateNumber:      templateNumber,
            templateDescription: desc || null,
            lineNumber:        i + 1,
            equipmentMasterId: Number(masterId),
            equipmentClassId:  ci.classId != null ? Number(ci.classId) : null,
            quantity:          Number(ci.quantity) || 1,
            requestedDays:     1,
            notes:             ci.notes || null
          }
        });

        console.log('[SaveTemplate] Line', i + 1, 'status:', lineResult.status, JSON.stringify(lineResult.body));
        if (!lineResult.ok) {
          var lErr = (lineResult.body && (lineResult.body.detail || lineResult.body.errors)) || '';
          console.warn('[SaveTemplate] Line failed:', JSON.stringify(lineResult.body));
          failedLines.push({ name: label, status: lineResult.status, detail: lErr });
        }
      }

      if (failedLines.length > 0) {
        // Header + some lines exist; report what didn't save. Don't clear the
        // form so the user can see what happened and retry if needed.
        const failNames = failedLines.map((f) => f.name).join(', ');
        const firstDetail = (failedLines.find(function(f){ return f.detail; }) || {}).detail || '';
        await Actions.fireNotificationEvent(context, {
          summary: 'Template saved with errors',
          message: failedLines.length + ' of ' + cartItems.length + ' line(s) failed: ' + failNames + (firstDetail ? ' — ' + firstDetail : '') + '.',
          type: 'error',
          displayMode: 'transient'
        });
        return;
      }

      // ── 3. Success — close dialog, reset form, confirm. ──────────────
      const dialog = document.getElementById('saveTemplateDialog');
      if (dialog && typeof dialog.close === 'function') dialog.close();

      $page.variables.templateName        = '';
      $page.variables.templateDescription = '';
      $page.variables.templateNameError   = '';

      await Actions.fireNotificationEvent(context, {
        summary: 'Template Saved',
        message: '"' + name + '" saved with ' + cartItems.length + ' item' + (cartItems.length === 1 ? '' : 's') + '.',
        type: 'confirmation',
        displayMode: 'transient'
      });
    }
  }

  return SaveTemplateChain;
});
