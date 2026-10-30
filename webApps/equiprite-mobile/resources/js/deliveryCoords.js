define(['resources/js/geocoder'], function (geocoder) {
  'use strict';

  // Resolves the coordinates of the request's DELIVERY ADDRESS, so the catalog
  // can price equipment from the yard nearest to where it is being delivered.
  //
  // There are two ways a delivery address gets onto a request, and this covers
  // both so nearest-yard pricing doesn't silently depend on which one was used:
  //
  //   1. MAP DRAWER ("Enter Delivery location") — the user dropped a pin or
  //      picked a geocoder suggestion, so exact coordinates already exist on the
  //      page ($page.variables.pickedLat / pickedLng). Preferred whenever
  //      present: they are the precise point the user chose, and re-geocoding
  //      the composed one-line address could land somewhere slightly different.
  //
  //   2. PROJECT SITE — the address came from the contract's ship-to list
  //      (CaptureShipToSiteChain writes the SITE_ADDRESS string straight into
  //      request.location). No coordinates exist, so the address string is
  //      geocoded here.
  //
  // Both paths converge on request.location being a plain address string, which
  // is why one resolver can serve both.
  //
  // BEST-EFFORT: never throws, and resolves { latitude: null, longitude: null }
  // when nothing can be determined. The caller sends the coordinates only when
  // they are non-null, and the backend falls back to its default (non-proximity)
  // rate resolution — pricing must never be blocked by a geocoder outage.

  function isNum(v) {
    return v != null && v !== '' && isFinite(Number(v));
  }

  var EMPTY = { latitude: null, longitude: null };

  // pickedLat/pickedLng: the map drawer's coordinates ($page scoped), or null.
  // address: request.location — the human-readable delivery address.
  function resolve(pickedLat, pickedLng, address) {
    // 1. Map-picked coordinates win — they are exact and cost nothing.
    if (isNum(pickedLat) && isNum(pickedLng)) {
      return Promise.resolve({
        latitude:  Number(pickedLat),
        longitude: Number(pickedLng)
      });
    }

    // 2. Otherwise derive them from the address text (the project-site case).
    var query = (address || '').toString().trim();
    if (!query) return Promise.resolve(EMPTY);

    return geocoder.lookup(query)
      .then(function (geo) {
        if (geo && isNum(geo.latitude) && isNum(geo.longitude)) {
          return { latitude: Number(geo.latitude), longitude: Number(geo.longitude) };
        }
        console.warn('[deliveryCoords] no geocode match for delivery address:', query);
        return EMPTY;
      })
      .catch(function (e) {
        console.warn('[deliveryCoords] geocode failed for delivery address:', query, e);
        return EMPTY;
      });
  }

  return { resolve: resolve };
});
