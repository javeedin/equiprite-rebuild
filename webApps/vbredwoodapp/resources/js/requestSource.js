define([], function () {
  'use strict';

  /**
   * Request-origin vocabulary — shared, single definition.
   *
   * Requests used to be 'PROJECT' | 'CUSTOMER' and are now
   * 'INTERNAL' | 'EXTERNAL' (EQR_EQUIPMENT_REQUEST.REQUEST_TYPE). That rename
   * silently broke every `source === 'CUSTOMER'` test in the app: they did not
   * error, they just quietly evaluated false, so customer-only affordances
   * stopped appearing with no visible cause.
   *
   * This module exists because PAGE MODULES cannot reach $application, so they
   * can't call the app-flow resolver ($application.functions.isExternalSource).
   * Both are kept deliberately identical — app-flow.js is the owner for
   * expressions and chains, this is the same rule for page modules. Change one,
   * change the other.
   *
   * The legacy 'CUSTOMER'/'PROJECT' spellings stay accepted so an unmigrated
   * backend and historical rows keep working; the two vocabularies can coexist
   * because no value means "customer" in one and "not customer" in the other.
   */

  /**
   * @param {string} source - 'EXTERNAL' | 'INTERNAL' | legacy 'CUSTOMER' | 'PROJECT'
   * @returns {boolean} true when the request is customer/externally sourced
   */
  function isExternal(source) {
    var s = String(source || '').toUpperCase();
    return s === 'EXTERNAL' || s === 'CUSTOMER';
  }

  /**
   * Display label in the CURRENT vocabulary, whichever spelling arrived.
   * Empty in, empty out — a blank origin renders nothing rather than a
   * misleading default.
   *
   * @param {string} source
   * @returns {string} 'EXTERNAL' | 'INTERNAL' | ''
   */
  function label(source) {
    if (source === null || source === undefined || String(source).trim() === '') {
      return '';
    }
    return isExternal(source) ? 'EXTERNAL' : 'INTERNAL';
  }

  return {
    isExternal: isExternal,
    label: label
  };
});
