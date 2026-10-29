define([], function () {
  'use strict';

  // ── TEST VALUES, AWAITING A DECISION ────────────────────────────────────────────────────────────────────────────
  // The Fusion sell contract a customer request gets (POST fscmRestApi .../contracts through ProjectLOV) is created
  // with FIXED values for the legal entity, business unit, party and contract type. They are not per request and not
  // per customer: every customer contract is raised for 'EPC UAE' / 'Stark Industries', whoever the customer is.
  //
  // They are copied unchanged from Old EquipRite, where they are written inline in two chains:
  //   flows/customer-portal/pages/request-cart-page-chains/SubmitRequestChain.js   (submit, when customer quoting is off)
  //   flows/customer-portal/pages/customer-quote-page-chains/AcceptQuoteChain.js   (quote accepted)
  // New EquipRite keeps the calls identical for parity, but reads the values from HERE, the one place to change them.
  //
  // DECISION NEEDED before go-live: where these come from (the customer's own party / account, the BU's legal entity,
  // a configured contract type in Settings), or confirmation that they really are fixed for the tenant. Until then a
  // contract created from New EquipRite is exactly as wrong, or as right, as one created from Old EquipRite.
  // tests/customer.test.js checks these against the old chains, so a change here that the old app does not make fails
  // the suite on purpose: move both, or record the decision there.
  var CONTRACT = Object.freeze({
    LegalEntityName:  'EPC UAE',
    OrgId:            300000334372921,
    PrimaryPartyId:   100000000395788,
    ContractTypeId:   300000048179116,
    InvOrgName:       'Operations',
    OrgName:          'EPC_UAE_BU',
    ContractTypeName: 'Sell Lines',
    PartyName:        'Stark Industries',
    CurrencyCode:     'USD'
  });

  var LINE = Object.freeze({
    LineTypeId:   300000000099381,
    LineTypeName: 'Free-form, project'
  });

  // The endpoint both old chains call.
  var ENDPOINT = 'ProjectLOV/postFscmRestApiResources11_13_18_05Contracts';

  /**
   * One ContractLine entry, in the old chains' shape and key order.
   * @param {Object} l { lineNumber, itemName, itemDescription, startDate }
   */
  function contractLine(l) {
    return {
      LinePuid:        null,
      LineNumber:      String(l.lineNumber),
      LineTypeId:      LINE.LineTypeId,
      LineTypeName:    LINE.LineTypeName,
      ItemNameTxt:     l.itemName || '',
      ItemDescription: l.itemDescription,
      StartDate:       l.startDate || null
    };
  }

  /**
   * The contract body, in the old chains' key order: the request's own values around the fixed ones above.
   * @param {Object} c { cognomen, startDate, endDate, estimatedAmount, lines: [contractLine(...)] }
   */
  function contractBody(c) {
    return {
      Cognomen:         c.cognomen,
      LegalEntityName:  CONTRACT.LegalEntityName,
      OrgId:            CONTRACT.OrgId,
      PrimaryPartyId:   CONTRACT.PrimaryPartyId,
      ContractTypeId:   CONTRACT.ContractTypeId,
      InvOrgName:       CONTRACT.InvOrgName,
      OrgName:          CONTRACT.OrgName,
      ContractTypeName: CONTRACT.ContractTypeName,
      PartyName:        CONTRACT.PartyName,
      StartDate:        c.startDate,
      EndDate:          c.endDate,
      EstimatedAmount:  c.estimatedAmount,
      CurrencyCode:     CONTRACT.CurrencyCode,
      ContractLine:     c.lines || []
    };
  }

  return {
    CONTRACT: CONTRACT,
    LINE: LINE,
    ENDPOINT: ENDPOINT,
    contractLine: contractLine,
    contractBody: contractBody
  };
});
