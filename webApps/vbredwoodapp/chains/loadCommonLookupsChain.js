define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // App-level shared-lookup loader. Runs once on app vbEnter alongside
  // loadFeatureFlagsChain and loadPageAccessChain.
  //
  // Reads COMMONRITE.RS_LOOKUP_VALUES through the Rite common-service, scoped
  // to APPLICATION_CODE='EQUIP_RITE'. That table is SHARED with I9_ADMIN,
  // ONBOARD_RITE and TALENT_TRACKER — several hundred rows that are not ours —
  // so the application_code filter is an isolation boundary, not an
  // optimisation. Never call this endpoint without it.
  //
  // Populates:
  //   $application.variables.commonLookups  { LOOKUP_TYPE: [{value,label}] }
  //   $application.variables.lookupsLoaded  latch, set LAST
  //
  // Read via $application.functions.getLookupLabel() / getLookupOptions()
  // (app-flow.js).
  //
  // FAILS SOFT — deliberately UNLIKE the two chains it otherwise mirrors.
  // loadFeatureFlagsChain and loadPageAccessChain fail CLOSED: an empty map
  // there disables features and hides pages, because those are authorisation
  // and gating concerns. Lookups are DISPLAY DATA. Every accessor degrades to
  // the caller's fallback or the raw code, so a dead common-service costs
  // prettier labels and nothing else. Do NOT add a gate that depends on
  // lookupsLoaded, and do not copy the fail-closed pattern onto it.
  class loadCommonLookupsChain extends ActionChain {
    async run(context) {
      const { $application } = context;

      try {
        // vbEnter fires once per app load, but a page (or a future retry
        // action) can re-enter this chain. Skip the round trip when the cache
        // is already warm.
        if ($application.variables.lookupsLoaded) {
          return;
        }

        // No lookupType param — fetch EVERY active type for EQUIP_RITE, so the
        // whole session cache warms in one round trip.
        const result = await Actions.callRest(context, {
          endpoint: 'commonService/getCommonLookupValues',
          // Query params belong under uriParams; a `parameters` key is
          // SILENTLY IGNORED by callRest, and a uriParam whose name does not
          // match the openapi3 declaration character-for-character is silently
          // dropped. 'application_code' is snake_case on purpose — that is the
          // common-service contract, not a typo.
          uriParams: {
            application_code: 'EQUIP_RITE',
            language: 'en'
          }
        });

        if (!result || !result.ok) {
          console.error('[loadCommonLookupsChain] lookup fetch failed',
            result && result.statusCode);
          return; // cache stays empty; accessors fall back to raw codes
        }

        // Shape tolerance. common-service specifies a FLAT ARRAY, which is
        // unlike every eqp-v1 endpoint in this app ({data:[], recordCount}).
        // Accept both rather than blanking every label if the service is later
        // wrapped, or if it ends up fronted by ORDS.
        const body = result.body;
        const rows = Array.isArray(body)
          ? body
          : (body && Array.isArray(body.data) ? body.data : null);

        if (!rows) {
          console.error('[loadCommonLookupsChain] unexpected payload shape', body);
          return;
        }

        // Group into { LOOKUP_TYPE: [{value,label}] }. {value,label} rather
        // than the raw {lookupCode,meaning} so getLookupOptions() output binds
        // straight into an ArrayDataProvider for oj-select-single without a
        // remap at every call site.
        const map = {};
        rows.forEach(function (r) {
          // Validate before copying — one malformed row must not poison a
          // whole lookup type.
          if (!r || !r.lookupType || r.lookupCode === undefined
              || r.lookupCode === null) {
            return;
          }
          // The service already filters on ENABLED_FLAG; belt and braces.
          if (r.enabledFlag === 'N') {
            return;
          }
          const type = String(r.lookupType);
          if (!map[type]) {
            map[type] = [];
          }
          map[type].push({
            value: String(r.lookupCode),
            // MEANING is nullable in RS_LOOKUP_VALUES, so fall back to the
            // code rather than rendering the string 'null'.
            label: (r.meaning !== undefined && r.meaning !== null && r.meaning !== '')
              ? String(r.meaning)
              : String(r.lookupCode)
          });
        });

        $application.variables.commonLookups = map;
        // Set LAST — it is the latch both accessors read, so the map must be
        // fully in place before it flips.
        $application.variables.lookupsLoaded = true;

        console.log('[loadCommonLookupsChain] loaded', Object.keys(map).length,
          'lookup types for EQUIP_RITE');
      } catch (e) {
        console.error('[loadCommonLookupsChain] unexpected error', e);
        // Cache stays empty; every accessor degrades to the raw code.
      }
    }
  }

  return loadCommonLookupsChain;
});
