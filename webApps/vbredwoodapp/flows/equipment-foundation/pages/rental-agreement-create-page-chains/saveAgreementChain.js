define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  function toIso(dateStr) {
    if (!dateStr) return null;
    if (dateStr.indexOf('T') !== -1) return dateStr;
    return dateStr + 'T00:00:00Z';
  }

  // Collect ALL missing required fields up front and return their labels, so a
  // single save attempt reports everything at once (rather than one-at-a-time,
  // which forced the user to fix → save → see the next error → repeat).
  // Required = the fields the save actually persists + enforces: Agreement Name,
  // Agreement Type, Customer, Start Date, End Date. (Business Unit / Billing
  // Frequency / Payment Terms are not persisted, so not validated.)
  function collectMissingFields(formData) {
    const missing = [];
    if (!formData.agreementName || !formData.agreementName.trim()) missing.push('Agreement Name');
    if (!formData.agreementType) missing.push('Agreement Type');
    if (!formData.customerId)    missing.push('Customer');
    if (!formData.startDate)     missing.push('Start Date');
    if (!formData.endDate)       missing.push('End Date');
    return missing;
  }

  class saveAgreementChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const formData = $page.variables.formData;
      const editAgreementId = $page.variables.agreementId;

      // ── EDIT MODE ─────────────────────────────────────────────────────
      if (editAgreementId) {

        // Step 1 — Validation (all missing fields reported at once)
        const missingEdit = collectMissingFields(formData);
        if (missingEdit.length > 0) {
          await Actions.fireNotificationEvent(context, {
            summary: 'Required Fields Missing',
            message: 'Please fill in: ' + missingEdit.join(', ') + '.',
            displayMode: 'transient',
            type: 'error'
          });
          return;
        }

        // Step 2 — agreementId is the numeric headerId from the view
        const headerId = Number(editAgreementId);
        if (!headerId) {
          await Actions.fireNotificationEvent(context, {
            summary: 'Error',
            message: 'Invalid agreement ID.',
            displayMode: 'transient',
            type: 'error'
          });
          return;
        }

        // Step 3 — PUT the header (full update via DTO).
        // We can't use PATCH here because the backend's patch handler takes
        // a generic Map<String,Object> and applies fields by reflection,
        // which throws IllegalArgumentException for OffsetDateTime fields
        // (effectiveFrom / effectiveTo) when given a String value. PUT
        // goes through proper Jackson deserialization to AgreementHeaderDto
        // and handles the ISO date strings correctly. Full body is built
        // from the cached loadedHeader (immutable fields like
        // agreementNumber, status, objectVersionNumber, audit) merged with
        // the user's edits.
        const loaded = $page.variables.loadedHeader || {};
        const putHeaderResult = await Actions.callRest(context, {
          endpoint: 'eqp-v1/updateAgreementHeader',
          uriParams: { id: headerId },
          body: {
            id:                  headerId,
            agreementNumber:     loaded.agreementNumber,
            agreementName:       formData.agreementName,
            customerRefId:       null,
            fusionCustomerId:    formData.customerId != null ? Number(formData.customerId) : null,
            projectRefId:        loaded.projectRefId        != null ? loaded.projectRefId        : null,
            equipmentClassId:    loaded.equipmentClassId    != null ? loaded.equipmentClassId    : null,
            agreementType:       formData.agreementType,
            status:              loaded.status || 'DRAFT',
            effectiveFrom:       toIso(formData.startDate),
            effectiveTo:         toIso(formData.endDate),
            currencyCode:        formData.currencyCode || 'USD',
            notes:               formData.notes || '',
            objectVersionNumber: loaded.objectVersionNumber != null ? loaded.objectVersionNumber : 1
          }
        });

        if (!putHeaderResult || !putHeaderResult.ok) {
          const detail = (putHeaderResult && putHeaderResult.body && JSON.stringify(putHeaderResult.body)) || 'No response from server.';
          await Actions.fireNotificationEvent(context, {
            summary: 'Update Failed',
            message: 'Could not update the agreement header. ' + detail,
            displayMode: 'transient',
            type: 'error'
          });
          return;
        }

        // Step 4 — Apply deletions for lines the user removed in this session.
        // deletedLineIds was populated by deleteAgreementLineChain. We run
        // deletes BEFORE upserts so a deleted lineNumber can be reused by
        // a freshly-added line in the same save (uk_eqr_agr_line_num is on
        // (header_id, line_number)).
        const deletedIds = $page.variables.deletedLineIds || [];
        for (const lineId of deletedIds) {
          const delResult = await Actions.callRest(context, {
            endpoint:  'eqp-v1/deleteAgreementLine',
            uriParams: { id: Number(lineId) }
          });
          if (!delResult || !delResult.ok) {
            console.warn('[save-agreement] delete line failed for id=', lineId,
                         'status=', delResult && delResult.status,
                         'body=', delResult && delResult.body);
          }
        }
        $page.variables.deletedLineIds = [];

        // Step 5 — Reconcile remaining lines (update existing, create new)
        const lines = $page.variables.equipmentLines || [];

        for (const line of lines) {
          if (line.lineId) {
            await Actions.callRest(context, {
              endpoint: 'eqp-v1/patchAgreementLine',
              uriParams: { id: line.lineId },
              body: {
                equipmentClassId:  line.equipmentClassId,
                equipmentMasterId: line.equipmentMasterId || null,
                description:       line.description || '',
                unitPrice:         line.unitPrice,
                priceUom:          line.priceUom
              }
            });
          } else {
            await Actions.callRest(context, {
              endpoint: 'eqp-v1/createAgreementLine',
              body: {
                agreementHeaderId: headerId,
                lineNumber:        line.lineNumber,
                equipmentClassId:  line.equipmentClassId,
                equipmentMasterId: line.equipmentMasterId || null,
                description:       line.description || '',
                unitPrice:         line.unitPrice,
                priceUom:          line.priceUom,
                // See create-mode note: quantity -> MIN_COMMIT_DAYS NOT NULL.
                quantity:          (line.quantity != null ? Number(line.quantity) : 1)
              }
            });
          }
        }

        // Step 6 — Success
        const updatedNumber = (putHeaderResult.body && putHeaderResult.body.agreementNumber) || editAgreementId;
        await Actions.fireNotificationEvent(context, {
          summary: 'Agreement Updated',
          message: 'Agreement ' + updatedNumber + ' updated successfully.',
          displayMode: 'transient',
          type: 'confirmation'
        });

        await Actions.navigateToPage(context, { page: 'rental-agreements' });
        return;
      }

      // ── CREATE MODE ───────────────────────────────────────────────────

      // ── 0. Client-side validation (all missing fields reported at once) ──
      const missingCreate = collectMissingFields(formData);
      if (missingCreate.length > 0) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Required Fields Missing',
          message: 'Please fill in: ' + missingCreate.join(', ') + '.',
          displayMode: 'transient',
          type: 'error'
        });
        return;
      }

      // ── 1. Generate agreement number: PREFIX-#### (sequence per prefix) ──
      // The prefix comes from the selected agreement type's configured
      // typePrefix (EQR_CONF_AGREEMENT_TYPE, managed in Configurations →
      // Agreement Types). Each prefix has its own running sequence.
      // Falls back to 'AGR' if the type has no prefix configured yet.
      let prefixCode = 'AGR';
      try {
        const typesResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getConfAgreementTypes'
        });
        const types = (typesResp.ok && Array.isArray(typesResp.body)) ? typesResp.body : [];
        const match = types.find(t => t && t.typeCode === formData.agreementType);
        if (match && match.typePrefix) {
          prefixCode = String(match.typePrefix).toUpperCase();
        }
      } catch (e) {
        console.warn('[save-agreement] could not resolve type prefix, using AGR', e);
      }

      const numPrefix = prefixCode + '-';   // e.g. "RNT-"

      const listResult = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getEquipriteV1ViewsRentalAgreements',
        uriParams: { page: 0, size: 500 }
      });

      console.log('[save-agreement] list result:', JSON.stringify({ ok: listResult && listResult.ok, len: listResult && listResult.body && listResult.body.data && listResult.body.data.length }));

      // Scan existing numbers sharing this prefix; take the max trailing
      // sequence + 1. Anchored regex (^PREFIX-\d+$) so e.g. "ST-" doesn't
      // also match a hypothetical "STX-0001".
      const seqRe = new RegExp('^' + prefixCode + '-(\\d+)$');
      const matches = ((listResult && listResult.body && listResult.body.data) || [])
        .map(a => a && a.agreementNumber && seqRe.exec(a.agreementNumber))
        .filter(Boolean)
        .map(m => parseInt(m[1], 10) || 0);
      const nextSeq = matches.length > 0 ? Math.max.apply(null, matches) + 1 : 1;
      const agreementNumber = numPrefix + String(nextSeq).padStart(4, '0');

      console.log('[save-agreement] generated agreementNumber=', agreementNumber);

      // ── 2. POST agreement header ───────────────────────────────────────
      console.log('[save-agreement] saving header for formData:', JSON.stringify(formData));

      const headerResult = await Actions.callRest(context, {
        endpoint: 'eqp-v1/createAgreementHeader',
        body: {
          agreementNumber:  agreementNumber,
          agreementName:    formData.agreementName,
          customerRefId:    null,
          fusionCustomerId: formData.customerId != null ? Number(formData.customerId) : null,
          agreementType:    formData.agreementType,
          status:           'DRAFT',
          effectiveFrom:    toIso(formData.startDate),
          effectiveTo:      toIso(formData.endDate),
          currencyCode:     formData.currencyCode || 'USD',
          notes:            formData.notes || ''
        }
      });

      console.log('[save-agreement] header result:', JSON.stringify({
        ok:     headerResult && headerResult.ok,
        status: headerResult && headerResult.status,
        id:     headerResult && headerResult.body && headerResult.body.id,
        body:   headerResult && headerResult.body
      }));

      if (!headerResult || !headerResult.body || !headerResult.body.id) {
        const detail = (headerResult && headerResult.body && JSON.stringify(headerResult.body)) || 'No response from server.';
        await Actions.fireNotificationEvent(context, {
          summary: 'Save Failed',
          message: 'Could not create the agreement header. ' + detail,
          displayMode: 'transient',
          type: 'error'
        });
        return;
      }

      // ── 3. POST each line ─────────────────────────────────────────────
      const newHeaderId = headerResult.body.id;
      const lines = $page.variables.equipmentLines || [];

      console.log('[save-agreement] posting', lines.length, 'lines for headerId=', newHeaderId);

      for (const line of lines) {
        const lineResult = await Actions.callRest(context, {
          endpoint: 'eqp-v1/createAgreementLine',
          body: {
            agreementHeaderId: newHeaderId,
            lineNumber:        line.lineNumber,
            equipmentClassId:  line.equipmentClassId,
            equipmentMasterId: line.equipmentMasterId || null,
            description:       line.description || '',
            unitPrice:         line.unitPrice,
            priceUom:          line.priceUom,
            // quantity is stored in EQR_AGREEMENT_LINE.MIN_COMMIT_DAYS (NOT NULL,
            // Hibernate ignores the DB default). This page has no quantity UI —
            // an agreement line is a price-list entry; actual qty lives on the
            // request. Default to 1 so the NOT-NULL insert succeeds.
            quantity:          (line.quantity != null ? Number(line.quantity) : 1)
          }
        });

        console.log('[save-agreement] line', line.lineNumber, 'ok=', lineResult && lineResult.ok, 'body=', JSON.stringify(lineResult && lineResult.body));

        if (!lineResult || !lineResult.ok) {
          const lineDetail = (lineResult && lineResult.body && JSON.stringify(lineResult.body)) || 'Unknown error.';
          await Actions.fireNotificationEvent(context, {
            summary: 'Line Save Failed',
            message: 'Line ' + line.lineNumber + ' could not be saved. ' + lineDetail,
            displayMode: 'transient',
            type: 'error'
          });
        }
      }

      // ── 4. Success ────────────────────────────────────────────────────
      await Actions.fireNotificationEvent(context, {
        summary: 'Agreement Created',
        message: 'Agreement ' + agreementNumber + ' created successfully with ' + lines.length + ' line(s).',
        displayMode: 'transient',
        type: 'confirmation'
      });

      await Actions.navigateToPage(context, {
        page: 'rental-agreements'
      });
    }
  }

  return saveAgreementChain;
});
