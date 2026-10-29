define([], function() {
  'use strict';

  // Mapbox public geocoding token — the app's own token, identical to the one
  // in equipment-schedule-page.js, line-detail-page.js and the two
  // create-request pages. It's a "pk." public token; safe in client code.
  //
  // WAS a leftover Bryntum DEMO token ('matsbryntse'), copied in with their
  // sample map code. That token is not ours and Mapbox rejects it with
  // 401 Unauthorized, so every lookup() silently returned null (the function is
  // best-effort and swallows !resp.ok). Symptom: addresses resolved but
  // coordinates never did — inv-org mappings saved with an address and null
  // lat/long, and the delivery-location map search returned nothing.
  var ACCESS_TOKEN = 'pk.eyJ1IjoicmFodWxqYW1hbGFwdXJhbSIsImEiOiJjbXNkYngyeDcwNGN4MzVwdmRkMHRmN2ppIn0.P7EFTLmcAsXXammLSgF3Qw';

  // Best-effort forward geocoding: free-text address → { latitude, longitude,
  // formattedAddress } or null when no match / network failure. Never throws —
  // the caller treats this as enrichment, not a hard requirement.
  //
  // Mapbox endpoint:
  //   GET https://api.mapbox.com/geocoding/v5/mapbox.places/{query}.json
  //         ?access_token=...&limit=1
  // Response shape:
  //   { features: [{ center: [lng, lat], place_name: "..." , ... }] }
  function lookup(address) {
    var query = (address || '').toString().trim();
    if (!query) return Promise.resolve(null);

    var url =
      'https://api.mapbox.com/geocoding/v5/mapbox.places/' +
      encodeURIComponent(query) +
      '.json?limit=1&access_token=' + ACCESS_TOKEN;

    return fetch(url)
      .then(function(resp) {
        if (!resp.ok) return null;
        return resp.json();
      })
      .then(function(body) {
        if (!body || !Array.isArray(body.features) || body.features.length === 0) return null;
        var f = body.features[0];
        var center = f.center; // [lng, lat]
        if (!Array.isArray(center) || center.length < 2) return null;
        return {
          latitude:         Number(center[1]),
          longitude:        Number(center[0]),
          formattedAddress: f.place_name || query
        };
      })
      .catch(function(e) {
        console.warn('[geocoder] lookup failed:', e);
        return null;
      });
  }

  return {
    lookup: lookup
  };
});
