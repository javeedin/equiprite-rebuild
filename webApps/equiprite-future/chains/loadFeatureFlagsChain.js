define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // App-level global-settings loader (foundation for enforcement).
  //
  // Runs once on app vbEnter. Loads the conf-global-settings table (where all
  // application-level settings now live) and splits the active rows by category
  // into two app-wide maps — neither is BU-scoped:
  //   FEATURE_FLAG → $application.variables.featureFlags  { KEY: 'true'|'false' }
  //   SYSTEM       → $application.variables.globalSettings { KEY: 'value' }
  // Kept separate because SYSTEM settings are enums/strings, so the boolean
  // isFeatureEnabled() contract is the wrong accessor for them.
  //
  // Consumed via $application.functions.isFeatureEnabled() and
  // isQuotingAllowed() (app-flow.js), both of which fail CLOSED until
  // flagsLoaded is true. This is the UX layer only; the backend independently
  // enforces the hard rule per request.
  class loadFeatureFlagsChain extends ActionChain {
    async run(context) {
      const { $application } = context;

      try {
        // ⚠️ THE TABLE IS PAGINATED, despite what this comment used to claim.
        // /conf-global-settings answers with page/pageSize/totalPages and defaults
        // to Spring's size=20. The table is at 17 rows as of 2026-09-14 (V343 added
        // two), so it has been fitting on page 0 by luck, not by design.
        //
        // Three more settings and the last rows silently vanish from the response.
        // A dropped FEATURE_FLAG row does not error — isFeatureEnabled() just fails
        // closed for that key, forever, and the feature looks broken while the
        // table plainly says 'true'. Ask for the whole table explicitly.
        const result = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getConfGlobalSettings',
          uriParams: { size: 500 }
        });

        if (!result || !result.ok) {
          console.error('loadFeatureFlagsChain: failed to load settings',
            result && result.statusCode);
          return; // leave featureFlags empty; isFeatureEnabled stays fail-closed
        }

        const rows = (result.body && result.body.data) || [];
        const map = {};
        // SYSTEM-category settings are non-boolean (enums/strings), so they get
        // their own map rather than being forced through the 'true'/'false'
        // featureFlags contract. Holds ENABLE_QUOTES; read via isQuotingAllowed().
        const settingsMap = {};
        rows.forEach(function (r) {
          // Keep only active rows, split by category. NOTE: the openapi3
          // ConfSettingRecord schema does NOT declare settingCategory /
          // isActiveFlag, but the live API DOES return them (verified
          // 2026-07-01) — so filtering here is safe and keeps unrelated
          // settings (currency, controls, etc.) out of both maps.
          // Application-level → we ignore businessUnitId (single active row wins).
          if (!r || r.settingKey == null) return;
          if (r.isActiveFlag === 'N') return;
          const value = (r.settingValue != null ? String(r.settingValue) : '');
          if (r.settingCategory === 'FEATURE_FLAG') {
            map[r.settingKey] = value;
          } else if (r.settingCategory === 'SYSTEM') {
            settingsMap[r.settingKey] = value;
          }
        });

        $application.variables.featureFlags = map;
        $application.variables.globalSettings = settingsMap;

        // Per-BU RATE_SOURCE, for usesPpmRates() / isRateManagementHidden().
        // Loaded here, before the latch, so the Rate Management menu entry never
        // shows and then vanishes. A failure leaves the map empty, which those
        // helpers read as "no BU is PPM" — only the global flag then applies.
        try {
          const buRes = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getConfEquipmentSettings',
            uriParams: { pageSize: 10000, limit: 10000 }
          });
          $application.variables.buRateSources = (buRes && buRes.ok)
            ? $application.functions.buRateSourceMap((buRes.body && buRes.body.data) || [])
            : {};
        } catch (e) {
          console.error('loadFeatureFlagsChain: BU rate sources failed to load', e);
          $application.variables.buRateSources = {};
        }
        // Set LAST — it's the latch both isFeatureEnabled() and isQuotingAllowed()
        // read, so both maps must be in place before it flips.
        $application.variables.flagsLoaded = true;
      } catch (e) {
        console.error('loadFeatureFlagsChain: unexpected error', e);
        // Stay fail-closed (flagsLoaded remains false).
      }
    }
  }

  return loadFeatureFlagsChain;
});
