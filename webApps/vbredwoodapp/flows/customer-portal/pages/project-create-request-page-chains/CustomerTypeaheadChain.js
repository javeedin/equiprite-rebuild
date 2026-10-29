define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/bipLov',
], (ActionChain, Actions, bipLov) => {
  'use strict';

  // Runs the BIP report EQP_CUSTOMERS_LOV_RP for the text the Customer
  // oj-select-single asked about, and delivers the rows back to the page module's
  // customer provider via $page.functions.deliverCustomers(text, rows).
  //
  // Triggered by the page event customerSearchRequested, which the PROVIDER fires
  // from fetchFirst — the same provider-driven design as ProjectTypeaheadChain
  // (see there for why: it removes the race that left the dropdown empty). No
  // debounce here; oj-input-search debounces typing itself.
  //
  // Why a report and not Fusion REST shippingCustomersLOV: its `Customer LIKE` is
  // case-sensitive, rejects UPPER()/finder and honours only the first OR term, so
  // "acme" finds nothing for "Acme Corp". The report does
  // UPPER(name|number) LIKE UPPER('%text%'). See docs/sql/EQP_CUSTOMERS_LOV_RP.sql.
  //
  // The Customer field is an oj-select-single, which shows every row the
  // provider returns (oj-input-search used to cut them to 12). This is only a
  // guard against a very broad search flooding the dropdown — not a page size.
  const MAX_SUGGESTIONS = 500;

  // buildSoapBody splices values straight into XML, so a typed & or < would
  // break the envelope.
  function xmlEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  class CustomerTypeaheadChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const text = (params && params.searchValue != null) ? String(params.searchValue).trim() : '';
      // Blank text is allowed: it is the browse list shown when the field is
      // clicked, and the report returns the first rows by name for a blank search.

      let rows = [];
      try {
        const soapBody = bipLov.buildSoapBody(
          '/Custom/EquipRite/EQP_CUSTOMERS_LOV_RP.xdo',
          [
            { name: 'P_SEARCH',    value: xmlEscape(text) },
            { name: 'P_SEARCH_BY', value: 'ALL' },
          ]
        );

        const response = await Actions.callRest(context, {
          endpoint: 'bipService/runBIPReport',
          body: soapBody,
        });

        // BIP upper-cases the element names (CUSTOMERID...). Rename them back to
        // shippingCustomersLOV's, which CaptureFallbackCustomerChain and the
        // suggestion template read.
        const found = bipLov.decodeReportRows(response.body, 'G_1', 'CUSTOMERID', 'CUSTOMER', 'CUSTOMERNUMBER');
        rows = found.slice(0, MAX_SUGGESTIONS).map((r) => ({
          CustomerId:     r.CUSTOMERID,
          CustomerNumber: r.CUSTOMERNUMBER,
          Customer:       r.CUSTOMER,
          PartyType:      r.PARTYTYPE,
        }));
        console.log('CustomerTypeaheadChain:', found.length, 'customers for', JSON.stringify(text));
      } catch (e) {
        console.error('CustomerTypeaheadChain error:', e);
      }
      $page.functions.deliverCustomers(text, rows);
    }
  }

  return CustomerTypeaheadChain;
});
