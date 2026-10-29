define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // CREATE / LINK everything the Create from Fusion list marked actionable, in
  // ONE call (bulkCreateClassesFromFusion). The backend applies the same rules
  // as the dryRun preview, one transaction per class group (the class and its
  // subclasses): a failed group rolls back and is reported, the rest commit.
  // Each row stores where it came from (FUSION_SOURCE_TYPE, the mapped column
  // as FUSION_*_TYPE + its name, the value as FUSION_*_REF), which is exactly
  // what the item import matches items on. Results come back in request order.
  class createClassMapPairsChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const fn = $page.functions;
      const source = $page.variables.ClassMapPairsSource;
      const m = fn.columnMappingFor($page.variables.ConfigSettingsMap, source);
      const pairs = ($page.variables.ClassMapPairsArray || []).filter(p => fn.pairActionable(p));
      if (!m || !pairs.length) return;

      let body = null;
      let error = null;
      $page.variables.isClassMapCreating = true;
      try {
        const res = await Actions.callRest(context, {
          endpoint: 'eqp-v1/bulkCreateClassesFromFusion',
          body: fn.bulkFusionRequest(source, m, pairs, false)
        });
        if (!res.ok) throw new Error((res.body && res.body.detail) || ('status ' + res.statusCode));
        body = res.body || {};
      } catch (e) {
        error = (e && e.message) || String(e);
      } finally {
        await Actions.callChain(context, { chain: 'loadEquipmentClassesChain' });
        await Actions.callChain(context, { chain: 'previewClassMapPairsChain', params: { source } });
        $page.variables.isClassMapCreating = false;
      }

      if (error) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Classes not created', message: error, displayMode: 'persist', type: 'error'
        });
        return;
      }

      const n = k => Number(body[k] || 0);
      const summary = 'Created ' + n('createdClasses') + ' classes and ' + n('createdSubclasses') + ' subclasses'
        + (n('linkedClasses') || n('linkedSubclasses')
          ? '; linked ' + n('linkedClasses') + ' existing classes and ' + n('linkedSubclasses') + ' subclasses' : '')
        + ' from ' + fn.fusionSourceLabel(source) + '.';
      // FAILED = the class group rolled back; OK rows can still carry a note
      // (e.g. a subclass code made unique as LAPTOP_2).
      const failed = (body.results || []).filter(r => r && r.status === 'FAILED');
      const notes = (body.results || []).filter(r => r && r.status === 'OK' && r.message);
      await Actions.fireNotificationEvent(context, failed.length ? {
        summary: 'Created with errors',
        message: summary + ' ' + failed.length + ' failed: '
          + failed.slice(0, 3).map(r => r.message).join(' | ') + (failed.length > 3 ? ' ...' : ''),
        displayMode: 'persist', type: 'warning'
      } : {
        summary: 'Classes created',
        message: summary + (notes.length ? ' ' + notes.slice(0, 3).map(r => r.message).join(' | ')
          + (notes.length > 3 ? ' ...' : '') : ''),
        displayMode: notes.length ? 'persist' : 'transient', type: 'confirmation'
      });
    }
  }

  return createClassMapPairsChain;
});
