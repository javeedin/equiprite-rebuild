define([], function () {
  'use strict';

  // Picking a delivery point on a map, as Old EquipRite's location drawer does (project-create-request-page.js:
  // initLocationMap, _reverseGeocode): Mapbox streets, a draggable pin, a click drops it; an address search with
  // suggestions. The same public Mapbox token as geocoder.js and Old's maps ("pk." token, safe in client code).
  //
  //   search(text)        address suggestions: [{ label, lat, lng }]
  //   reverse(lng, lat)   the address at a point, keeping the point itself: { label, lat, lng }
  //   open(el, mapboxgl, picked, onPick)   the map in el; onPick({ label, lat, lng }) on a click or a drag
  // Network failures never throw: a search finds nothing, a point without an address is named by its coordinates.

  var ACCESS_TOKEN = 'pk.eyJ1IjoicmFodWxqYW1hbGFwdXJhbSIsImEiOiJjbXNkYngyeDcwNGN4MzVwdmRkMHRmN2ppIn0.P7EFTLmcAsXXammLSgF3Qw';
  var GEOCODE = 'https://api.mapbox.com/geocoding/v5/mapbox.places/';
  // Nothing picked yet: Houston metro, where most of the fleet works (Old's default).
  var DEFAULT_CENTER = [-95.3698, 29.7604];
  var MAX_RESULTS = 6;

  function num(v) { return v != null && v !== '' && isFinite(Number(v)) ? Number(v) : null; }
  function coordsText(lat, lng) { return Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5); }

  /** A Mapbox feature as a place: { label, lat, lng }; null without a point. */
  function placeOf(f) {
    if (!f || !Array.isArray(f.center) || f.center.length < 2) return null;
    var lng = num(f.center[0]);
    var lat = num(f.center[1]);
    if (lat == null || lng == null) return null;
    return { label: String(f.place_name || f.text || coordsText(lat, lng)), lat: lat, lng: lng };
  }

  function getJson(url, fetchFn) {
    var go = fetchFn || (typeof fetch === 'function' ? fetch : null);
    if (!go) return Promise.resolve(null);
    return go(url).then(function (r) { return r && r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  /** Address suggestions for typed text, best first. near: [lng, lat] to prefer places near it. */
  function search(text, near, fetchFn) {
    var q = String(text || '').trim();
    if (q.length < 3) return Promise.resolve([]);
    var url = GEOCODE + encodeURIComponent(q) + '.json?autocomplete=true&limit=' + MAX_RESULTS
      + (near && near.length === 2 ? '&proximity=' + near[0] + ',' + near[1] : '') + '&access_token=' + ACCESS_TOKEN;
    return getJson(url, fetchFn).then(function (body) {
      return (body && Array.isArray(body.features) ? body.features : []).map(placeOf).filter(Boolean).slice(0, MAX_RESULTS);
    });
  }

  /** The address at a point; the point stays where it was put (the geocoder's own centre is snapped). */
  function reverse(lng, lat, fetchFn) {
    var url = GEOCODE + lng + ',' + lat + '.json?limit=1&access_token=' + ACCESS_TOKEN;
    return getJson(url, fetchFn).then(function (body) {
      var f = body && Array.isArray(body.features) ? body.features[0] : null;
      return { label: f && f.place_name ? String(f.place_name) : coordsText(lat, lng), lat: Number(lat), lng: Number(lng) };
    });
  }

  /**
   * The map, in el. picked: { lat, lng } to start on (else the default centre). onPick(place) after a click on the map
   * or a drag of the pin (reverse-geocoded); onError(message) when the map cannot be drawn.
   * Returns { show(place), destroy() }.
   */
  function open(el, mapboxgl, picked, onPick, onError) {
    if (!mapboxgl.accessToken) mapboxgl.accessToken = ACCESS_TOKEN;
    var has = picked && num(picked.lat) != null && num(picked.lng) != null;
    var map = new mapboxgl.Map({
      container: el,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: has ? [Number(picked.lng), Number(picked.lat)] : DEFAULT_CENTER,
      zoom: has ? 14 : 9,
      attributionControl: true
    });
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    var marker = new mapboxgl.Marker({ draggable: true, color: '#2e5468' });
    if (has) marker.setLngLat([Number(picked.lng), Number(picked.lat)]).addTo(map);
    var loaded = false;
    map.on('load', function () { loaded = true; });
    // A handler here keeps Mapbox from logging the failure itself; the dialog says it in words instead.
    map.on('error', function (e) {
      if (!loaded && typeof onError === 'function') onError((e && e.error && e.error.message) || 'The map could not be loaded.');
    });
    var pick = function (lng, lat) {
      marker.setLngLat([lng, lat]).addTo(map);
      reverse(lng, lat).then(function (place) { if (typeof onPick === 'function') onPick(place); });
    };
    map.on('click', function (e) { pick(e.lngLat.lng, e.lngLat.lat); });
    marker.on('dragend', function () { var ll = marker.getLngLat(); pick(ll.lng, ll.lat); });
    // The dialog has just opened: tiles need the container's real size.
    setTimeout(function () { try { map.resize(); } catch (e) { /* removed meanwhile */ } }, 250);
    return {
      show: function (place) {
        if (!place || num(place.lat) == null || num(place.lng) == null) return;
        marker.setLngLat([place.lng, place.lat]).addTo(map);
        try { map.flyTo({ center: [place.lng, place.lat], zoom: 15 }); } catch (e) { /* not drawn */ }
      },
      // Stop any fly-to first: a camera still moving after remove() would keep drawing a map that is gone.
      destroy: function () {
        try { map.stop(); } catch (e) { /* not drawn */ }
        try { map.remove(); } catch (e) { /* already gone */ }
      }
    };
  }

  return { search: search, reverse: reverse, placeOf: placeOf, open: open, DEFAULT_CENTER: DEFAULT_CENTER };
});
