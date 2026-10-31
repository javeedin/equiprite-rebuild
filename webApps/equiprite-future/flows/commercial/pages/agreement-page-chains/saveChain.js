define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/agreementRules',
  'resources/js/shellBus',
], (ActionChain, Actions, A, bus) => {
  'use strict';

  // Save: New EquipRite's saveAgreementChain (the old rental-agreement-create one), call for call and body for body.
  //   0 FULL access, and not already saving; every missing field at once (agreementRules.missingFields)
  //   edit    PUT /agreement-headers/{id} with the full DTO from the loaded header (its number, status and
  //           objectVersionNumber; PATCH cannot take the dates) → DELETE each removed line (first, so a number can be
  //           reused) → PATCH each kept line, POST each new one (quantity → MIN_COMMIT_DAYS, 1)
  //   create  the number PREFIX-#### (the type's typePrefix from conf-agreement-types, else AGR; the highest number
  //           with that prefix in views/rental-agreements + 1) → POST /agreement-headers as DRAFT → POST each line
  // Then, in Next: an edited agreement is read again in its tab; a new one opens in a tab of its own and this one closes.
  // What happened stays on the page in words.
  class saveChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const av = $application.variables;
      if ($application.functions.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_RENTAL_AGREEMENTS') !== 'FULL') return;
      if ($page.variables.saving) return;
      $page.variables.saving = true;
      try {
        await this.save(context);
      } finally {
        try { $page.variables.saving = false; } catch (e) { /* tab already closed */ }
      }
    }

    async save(context) {
      const v = context.$page.variables;
      const formData = v.form;
      const loaded = v.loadedHeader;
      const missing = A.missingFields(formData);
      v.missing = missing;
      if (missing.length > 0) {
        bus.toast('Not saved. Fill in: ' + missing.join(', ') + '.', 'error');
        return;
      }

      // ── EDIT ──────────────────────────────────────────────────────────
      if (loaded && loaded.id) {
        const headerId = Number(loaded.id);
        const putHeaderResult = await Actions.callRest(context, {
          endpoint: 'eqp-v1/updateAgreementHeader',
          uriParams: { id: headerId },
          body: A.putHeaderBody(headerId, loaded, formData)
        });
        if (!putHeaderResult || !putHeaderResult.ok) {
          const detail = (putHeaderResult && putHeaderResult.body && JSON.stringify(putHeaderResult.body)) || 'No response from the server.';
          this.fail(v, 'The agreement could not be saved (HTTP ' + (putHeaderResult && putHeaderResult.status) + '). Nothing was changed. ' + detail);
          return;
        }

        const problems = [];
        const deletedIds = v.deletedLineIds || [];
        for (const lineId of deletedIds) {
          const delResult = await Actions.callRest(context, {
            endpoint:  'eqp-v1/deleteAgreementLine',
            uriParams: { id: Number(lineId) }
          });
          if (!delResult || !delResult.ok) {
            console.warn('[saveChain] delete line failed for id=', lineId, 'status=', delResult && delResult.status);
            problems.push('a removed line could not be deleted (HTTP ' + (delResult && delResult.status) + ')');
          }
        }
        v.deletedLineIds = [];

        const lines = v.equipmentLines || [];
        for (const line of lines) {
          let r;
          if (line.lineId) {
            r = await Actions.callRest(context, {
              endpoint: 'eqp-v1/patchAgreementLine',
              uriParams: { id: line.lineId },
              body: A.patchLineBody(line)
            });
          } else {
            r = await Actions.callRest(context, {
              endpoint: 'eqp-v1/createAgreementLine',
              body: A.createLineBody(headerId, line)
            });
          }
          if (!r || !r.ok) problems.push('line ' + line.lineNumber + ' could not be saved (HTTP ' + (r && r.status) + ')');
        }

        // (Page variables read live: what was saved is counted before the agreement is read again.)
        const updatedNumber = String((putHeaderResult.body && putHeaderResult.body.agreementNumber) || loaded.agreementNumber);
        const count = lines.length;
        v.dirty = false;
        v.mode = 'view';
        await Actions.callChain(context, { chain: 'viewLoadChain' });
        if (problems.length) this.fail(v, updatedNumber + ' was saved, but ' + problems.join('; ') + '.');
        else this.ok(v, updatedNumber + ' was saved: the header and ' + (count === 1 ? 'its line' : 'its ' + count + ' lines') + '.');
        return;
      }

      // ── CREATE ────────────────────────────────────────────────────────
      let prefixCode = 'AGR';
      try {
        const typesResp = await Actions.callRest(context, { endpoint: 'eqp-v1/getConfAgreementTypes' });
        const types = (typesResp && typesResp.ok && Array.isArray(typesResp.body)) ? typesResp.body : [];
        prefixCode = A.typePrefix(types, formData.agreementType);
      } catch (e) {
        console.warn('[saveChain] could not resolve the type prefix, using AGR', e);
      }

      const listResult = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getEquipriteV1ViewsRentalAgreements',
        uriParams: { page: 0, size: 500 }
      });
      const agreementNumber = A.nextAgreementNumber(prefixCode, (listResult && listResult.body && listResult.body.data) || []);

      const headerResult = await Actions.callRest(context, {
        endpoint: 'eqp-v1/createAgreementHeader',
        body: A.createHeaderBody(agreementNumber, formData)
      });
      if (!headerResult || !headerResult.body || !headerResult.body.id) {
        const detail = (headerResult && headerResult.body && JSON.stringify(headerResult.body)) || 'No response from the server.';
        this.fail(v, 'The agreement could not be created (HTTP ' + (headerResult && headerResult.status) + '). ' + detail);
        return;
      }

      const newHeaderId = headerResult.body.id;
      const lines = v.equipmentLines || [];
      const failed = [];
      for (const line of lines) {
        const lineResult = await Actions.callRest(context, {
          endpoint: 'eqp-v1/createAgreementLine',
          body: A.createLineBody(newHeaderId, line)
        });
        if (!lineResult || !lineResult.ok) failed.push(line.lineNumber);
      }

      v.dirty = false;
      bus.toast(failed.length
        ? 'Agreement ' + agreementNumber + ' was created as a draft, but line' + (failed.length === 1 ? ' ' : 's ') + failed.join(', ') + ' could not be saved.'
        : 'Agreement ' + agreementNumber + ' was created as a draft with ' + lines.length + (lines.length === 1 ? ' line' : ' lines') + '. Finance approves it next.',
        failed.length ? 'error' : 'info');
      bus.open({ record: 'agreement', params: { number: agreementNumber } });
      bus.close('agreement:new');
    }

    ok(v, message) { v.note = message; v.noteTone = 'info'; bus.toast(message, 'info'); }
    fail(v, message) { v.note = message; v.noteTone = 'error'; bus.toast(message, 'error'); }
  }

  return saveChain;
});
