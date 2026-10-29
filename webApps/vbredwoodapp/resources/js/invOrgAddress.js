define(['resources/js/bipLov', 'resources/js/geocoder'], function (bipLov, geocoder) {
  'use strict';

  // Inventory-org address enrichment for the BU & Org Mapping table.
  //
  // When an admin maps an inventory org to a business unit, we want the org's
  // physical address (and its coordinates) stored on the mapping row, so the
  // Transfer Order engine and anything distance-based has a real location for
  // the yard instead of just a LOCATION_CODE.
  //
  // Flow, per mapping:
  //   1. BIP report EQP_INV_ORG_ADDRESSES, keyed by the inventory org id  →
  //      the hr_locations row for that org (address lines, city, region,
  //      postal code, country, …).
  //   2. Compose those parts into a single-line address string.
  //   3. Geocode that string via the shared Mapbox geocoder → lat/long.
  //      hr_locations carries no coordinates, so they have to be derived.
  //
  // BEST-EFFORT BY DESIGN. Every step returns null rather than throwing, and the
  // caller saves the mapping regardless — enrichment must never block an admin
  // from creating a mapping, and anything missing can be backfilled by re-saving
  // the row later.
  //
  // The SOAP call itself cannot live in here: a plain JS module has no action
  // chain $context and so can't reach a VB service-catalog endpoint (proxy,
  // auth, forceProxy). The caller passes in a `callBip` function that performs
  // the Actions.callRest — same split bipLov.js already uses.

  // '/shared' is deliberately omitted: BI resolves it from this path, and the
  // two working reports in this app (EQP_CONTRACTS_BY_PROJECT_LOV_RP,
  // EQP_SHIP_TO_SITES_BY_CONTRACT_LOV_RP) use the same convention. Adding it
  // breaks the call.
  var REPORT_PATH = '/Custom/EquipRite/EQP_INV_ORG_ADDRESSES.xdo';

  // The report's bind variable is :org_id, so the BIP parameter is named
  // 'org_id'. buildSoapBody passes this through verbatim — if the data model
  // declares a different name (e.g. P_ORG_ID), change it HERE and nowhere else.
  var ORG_ID_PARAM = 'org_id';

  // hr_locations column → EQR_BU_ORG_MAPPING column. The EQR table was built to
  // mirror hr_locations, so these are same-named throughout; the map is explicit
  // anyway so an unexpected extra column in `SELECT hl.*` can't leak into the
  // payload.
  //
  // hr_locations has NO latitude/longitude — that is exactly why step 3 exists.
  var ADDRESS_FIELDS = [
    'ADDRESS_LINE_1',
    'ADDRESS_LINE_2',
    'ADDRESS_LINE_3',
    'ADDRESS_LINE_4',
    'BUILDING',
    'FLOOR_NUMBER',
    'TOWN_OR_CITY',
    'REGION_1',
    'REGION_2',
    'REGION_3',
    'POSTAL_CODE',
    'LONG_POSTAL_CODE',
    'COUNTRY',
    'STYLE',
    'LOCATION_CODE'
  ];

  // SNAKE_CASE (BIP/XML tag + DB column) → camelCase (JSON payload field).
  function toCamel(snake) {
    return snake.toLowerCase().replace(/_([a-z0-9])/g, function (m, c) {
      return c.toUpperCase();
    });
  }

  // The parts that make a geocodable one-line address, in order. Deliberately a
  // SUBSET of ADDRESS_FIELDS: BUILDING/FLOOR/STYLE/LOCATION_CODE are internal
  // descriptors that confuse a geocoder rather than help it, and REGION_1/3 are
  // usually admin divisions that add noise once city + region_2 are present.
  var GEOCODE_PARTS = [
    'ADDRESS_LINE_1',
    'ADDRESS_LINE_2',
    'TOWN_OR_CITY',
    'REGION_2',
    'POSTAL_CODE',
    'COUNTRY'
  ];

  function composeAddress(row) {
    return GEOCODE_PARTS
      .map(function (f) { return row[f]; })
      .filter(function (v) { return v != null && String(v).trim() !== ''; })
      .join(', ');
  }

  // Fetch the hr_locations row for one inventory org. Returns the raw row keyed
  // by its XML tag names (upper snake), or null.
  //
  // callBip: function(soapBody) -> Promise<responseBody>   (the caller's callRest)
  function fetchAddressRow(callBip, invOrgId) {
    if (invOrgId == null || typeof callBip !== 'function') return Promise.resolve(null);

    var soapBody = bipLov.buildSoapBody(REPORT_PATH, [
      { name: ORG_ID_PARAM, value: invOrgId }
    ]);

    return Promise.resolve(callBip(soapBody))
      .then(function (responseBody) {
        // decodeReportRows keeps EVERY element of the row as a property, so
        // `SELECT hl.*` gives us all of hr_locations regardless of the id/label
        // args (which only add the .id/.label aliases we don't use here).
        var rows = bipLov.decodeReportRows(responseBody, 'G_1', 'LOCATION_ID', 'LOCATION_CODE');
        if (!rows || !rows.length) {
          console.warn('[invOrgAddress] no address row returned for inv org', invOrgId);
          return null;
        }
        // The report can return several hr_locations rows if an org resolves to
        // more than one; take the first deterministically rather than guessing.
        if (rows.length > 1) {
          console.warn('[invOrgAddress] ' + rows.length + ' address rows for inv org',
            invOrgId, '— using the first');
        }
        return rows[0];
      })
      .catch(function (e) {
        console.warn('[invOrgAddress] BIP address fetch failed for inv org', invOrgId, e);
        return null;
      });
  }

  // Full enrichment for one inventory org: address + derived coordinates.
  // Resolves to a camelCase object ready to merge into the mapping payload, or
  // {} when nothing could be resolved (never null, so callers can spread it
  // unconditionally).
  function enrich(callBip, invOrgId) {
    return fetchAddressRow(callBip, invOrgId).then(function (row) {
      if (!row) return {};

      var out = {};
      ADDRESS_FIELDS.forEach(function (f) {
        var v = row[f];
        if (v != null && String(v).trim() !== '') out[toCamel(f)] = String(v).trim();
      });

      var address = composeAddress(row);
      if (!address) {
        console.warn('[invOrgAddress] address row for inv org', invOrgId,
          'had no geocodable parts — skipping coordinates');
        return out;
      }

      return geocoder.lookup(address).then(function (geo) {
        if (geo && isFinite(geo.latitude) && isFinite(geo.longitude)) {
          out.invOrgLatitude  = geo.latitude;
          out.invOrgLongitude = geo.longitude;
        } else {
          console.warn('[invOrgAddress] geocode returned no match for', address);
        }
        return out;
      });
    });
  }

  return {
    enrich:          enrich,
    fetchAddressRow: fetchAddressRow,
    composeAddress:  composeAddress,
    REPORT_PATH:     REPORT_PATH,
    ORG_ID_PARAM:    ORG_ID_PARAM,
    ADDRESS_FIELDS:  ADDRESS_FIELDS
  };
});
