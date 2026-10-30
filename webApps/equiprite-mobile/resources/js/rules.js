define([], function () {
  'use strict';

  // The business rules EquipRite Next shares with Old and New EquipRite, in one testable place: who the user is
  // (persona), what a role may open (page access), which modules are on (feature flags), where rates come from, and
  // how a request's origin reads. Ported unchanged in behaviour from New EquipRite's app-flow.js; the menu and the
  // screens are Next's own (nav.js).
  //
  // Everything fails closed: unknown, not loaded or failed reads as hidden / off.

  // Fusion role -> persona, the fallback when GET /rbac/session-roles gave nothing (RBAC_ROLE_MAP is the authority).
  var ORACLE_ROLE_TO_PERSONA = {
    RT_EQP_ADMINISTRATOR: { role: 'EQUIP_ADMIN', priority: 30 },
    RT_EQP_MANAGER: { role: 'EQUIP_MGR', priority: 40 },
    RT_EQP_REQUESTOR: { role: 'REQUESTOR', priority: 50 },
    RT_EQP_INSPECTION: { role: 'INSPECTION', priority: 60 },
    RT_EQP_TIMEKEEPER: { role: 'TIMEKEEPER', priority: 70 },
    RT_EQP_TIME_APPROVER: { role: 'TIME_APPROVER', priority: 80 },
    RT_EQP_EXTERNAL_REQUESTOR: { role: 'EXTERNAL_REQUESTOR', priority: 90 },
    RT_EQP_FINANCE: { role: 'FINANCE_USER', priority: 100 }
  };

  var PERSONA_LABELS = {
    EQUIP_ADMIN: 'Administrator',
    EQUIP_MGR: 'Equipment Manager',
    REQUESTOR: 'Requestor',
    INSPECTION: 'Inspection',
    TIMEKEEPER: 'Timekeeper',
    TIME_APPROVER: 'Time Approver',
    EXTERNAL_REQUESTOR: 'Customer',
    FINANCE_USER: 'Finance'
  };
  var ALL_PERSONAS = ['EQUIP_ADMIN', 'EQUIP_MGR', 'REQUESTOR', 'INSPECTION', 'TIMEKEEPER', 'TIME_APPROVER', 'FINANCE_USER'];
  var MANAGER_TIER = { EQUIP_MGR: 1, EQUIP_ADMIN: 1 };

  function codes(list) {
    return (Array.isArray(list) ? list : []).map(function (r) {
      return String((r && (r.sessionRole || r.code)) || r || '').trim().toUpperCase();
    }).filter(Boolean);
  }

  /** The user's persona: the first session role with a persona (server order), else the best RT_EQP_* role, else ''. */
  function persona(fusionRoles, sessionRoles) {
    var fromServer = codes(sessionRoles).filter(function (c) { return PERSONA_LABELS[c]; })[0];
    if (fromServer) return fromServer;
    var best = null;
    codes(fusionRoles).forEach(function (c) {
      var hit = ORACLE_ROLE_TO_PERSONA[c];
      if (hit && (!best || hit.priority < best.priority)) best = hit;
    });
    return best ? best.role : '';
  }

  /** The personas this user may view work as: every one for an administrator, else their own (none when only one). */
  function personas(fusionRoles, sessionRoles) {
    var own = persona(fusionRoles, sessionRoles);
    var mine = codes(sessionRoles);
    var list = own === 'EQUIP_ADMIN' ? ALL_PERSONAS
      : ALL_PERSONAS.filter(function (c) { return c === own || mine.indexOf(c) !== -1; });
    return list.length > 1 ? list.map(function (c) { return { code: c, label: PERSONA_LABELS[c] }; }) : [];
  }

  function personaLabel(code) { return PERSONA_LABELS[code] || code || ''; }

  /** Manager tier (sees every request, project and customer). */
  function isManager(fusionRoles, sessionRoles) {
    if (codes(sessionRoles).some(function (c) { return MANAGER_TIER[c] === 1; })) return true;
    return codes(fusionRoles).some(function (c) { return c === 'RT_EQP_MANAGER' || c === 'RT_EQP_ADMINISTRATOR'; });
  }

  /** 'FULL' | 'READ_ONLY' | 'HIDDEN' for a page code, or the best of several joined by '|'. Hidden until loaded. */
  function pageAccess(map, loaded, pageCode) {
    if (!loaded || !map || !pageCode) return 'HIDDEN';
    var levels = String(pageCode).split('|').map(function (c) { return map[c] || 'HIDDEN'; });
    if (levels.indexOf('FULL') !== -1) return 'FULL';
    return levels.indexOf('READ_ONLY') !== -1 ? 'READ_ONLY' : 'HIDDEN';
  }

  function canSee(map, loaded, pageCodes) {
    return (pageCodes || []).some(function (c) { return pageAccess(map, loaded, c) !== 'HIDDEN'; });
  }

  function isFeatureEnabled(flags, loaded, key) {
    return !!(loaded && flags && key) && flags[key] === 'true';
  }

  /** Positively loaded and off (for screens withdrawn when a flag is on). */
  function isFeatureFlagOff(flags, loaded, key) {
    return !!(loaded && flags && key) && flags[key] !== 'true';
  }

  /** conf-equipment-settings rows -> { buId: 'PPM_RATES' | 'EQUIPRITE_RATES' }. */
  function buRateSourceMap(rows) {
    var out = {};
    (rows || []).forEach(function (r) {
      if (!r || r.businessUnitId == null || r.isActiveFlag === 'N') return;
      out[String(r.businessUnitId)] = String(r.rateSource || '').toUpperCase() === 'PPM_RATES' ? 'PPM_RATES' : 'EQUIPRITE_RATES';
    });
    return out;
  }

  /** Rate schedules are withdrawn when no business unit prices from EquipRite (hidden until flags load). */
  function isRateManagementHidden(flags, flagsLoaded, buRateSources) {
    if (!flagsLoaded) return true;
    if (isFeatureEnabled(flags, flagsLoaded, 'PPM_RATES_ENABLED')) return true;
    var ids = Object.keys(buRateSources || {});
    return ids.length > 0 && ids.every(function (id) { return buRateSources[id] === 'PPM_RATES'; });
  }

  /** EXTERNAL (or the legacy CUSTOMER) is a customer request; anything else is internal. */
  function isExternalSource(source) {
    var s = String(source || '').trim().toUpperCase();
    return s === 'EXTERNAL' || s === 'CUSTOMER';
  }

  /** ENABLE_QUOTES: NONE | PROJECTS | CUSTOMER | BOTH. Closed until settings load. */
  function isQuotingAllowed(settings, loaded, source) {
    if (!loaded || !settings) return false;
    var mode = String(settings.ENABLE_QUOTES || '').toUpperCase();
    if (mode === 'BOTH') return true;
    var external = isExternalSource(source);
    if (mode === 'CUSTOMER') return external;
    if (mode === 'PROJECTS') return !external;
    return false;
  }

  /** A lookup's label from the common-lookups cache, else the fallback, else the code in words. */
  function getLookupLabel(cache, loaded, type, code, fallback) {
    if (code === undefined || code === null || code === '') return '';
    var list = loaded && cache && cache[type];
    if (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].value === code) return list[i].label;
      }
    }
    if (fallback) return fallback;
    return String(code).replace(/_/g, ' ').toUpperCase();
  }

  var NAME_FIELDS = ['fullName', 'displayName', 'name', 'login', 'userName', 'username', 'preferred_username', 'email', 'userId'];

  function userDisplayName(user) {
    if (!user) return '';
    for (var i = 0; i < NAME_FIELDS.length; i++) {
      var v = user[NAME_FIELDS[i]];
      if (v && typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function userInitials(user) {
    var name = userDisplayName(user);
    if (!name) return '';
    var parts = name.split('@')[0].split(/[\s._-]+/).filter(function (p) { return p && /[a-z]/i.test(p); });
    if (!parts.length) return '';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  return {
    PERSONA_LABELS: PERSONA_LABELS,
    persona: persona,
    personas: personas,
    personaLabel: personaLabel,
    isManager: isManager,
    pageAccess: pageAccess,
    canSee: canSee,
    isFeatureEnabled: isFeatureEnabled,
    isFeatureFlagOff: isFeatureFlagOff,
    buRateSourceMap: buRateSourceMap,
    isRateManagementHidden: isRateManagementHidden,
    isExternalSource: isExternalSource,
    isQuotingAllowed: isQuotingAllowed,
    getLookupLabel: getLookupLabel,
    userDisplayName: userDisplayName,
    userInitials: userInitials
  };
});
