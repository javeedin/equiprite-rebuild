define([], function () {
  'use strict';

  // ════════════════════════════════════════════════════════════════════════
  // Relocate the maintenance asset in Fusion when equipment ships.
  // ════════════════════════════════════════════════════════════════════════
  //
  // WHAT IT DOES
  // When a request's delivery location is an internal inventory location
  // (deliveryLocationType === 'INV_ORG') and a line ships, tell Fusion the
  // equipment's maintenance asset now lives at that location:
  //
  //   PATCH installedBaseAssets/{AssetId}
  //   { CurrentLocationContextCode: 'ORA_INTERNAL_LOCATION',
  //     CurrentLocationId:          <request.deliveryLocationId>,
  //     OperatingOrganizationId:    <the asset's OWN value, echoed back> }
  //
  // and record the same move on EquipRite's own serial record, so the Units grid
  // and Unit Detail agree with the Fusion card sitting next to them.
  //
  // OperatingOrganizationId is NOT the delivery org — it means "the organization
  // that creates or operates the asset". Sending the delivery org there re-homes
  // the asset as a side effect of moving it. It is echoed back unchanged only
  // because Fusion marks it mandatory. See the payload note further down.
  //
  // WHY IT IS NEEDED AT ALL — AND ONLY FOR SOME LINES
  // For INVENTORY-TRACKED equipment Fusion maintains the asset's location
  // itself: the transfer order's inventory transaction moves it, and the asset
  // sits in location context ORA_INVENTORY. That context is not ours to write.
  // Quoting the live pod's own installedBaseAssets/describe:
  //
  //   "You can't use location context ORA_INVENTORY as the context when creating
  //    or updating the maintenance asset. An inventory transaction can modify
  //    ORA_INVENTORY."
  //
  // and correspondingly SubinventoryCode and LocatorId are updatable:false.
  //
  // But F&M equipment — maintenance/fixed-asset tracked, NOT inventory tracked —
  // has no transfer order and no inventory transaction, so nothing in Fusion ever
  // moves it. Its asset sits wherever it was last put, indefinitely. That is the
  // gap this closes, and it is why the gate is maintenance-tracked AND NOT
  // TRANSACTABLE rather than maintenance-tracked alone: 8 masters are both, and
  // patching those would fight the inventory engine over a field it owns. The
  // full gate and the three-way master split are documented at the filter itself.
  //
  // PORTED FROM THE OLD APP, NOT INVENTED
  // OLD EQP's ShipoutSaveButtonActionChain did exactly this on its Ship Out
  // button. Two deliberate differences:
  //   * it patched /maintenanceAssets/{AssetId}, whose describe now reads
  //     "Deprecated ... replaced by the Installed Base Assets resource";
  //   * that resource took `CurrentLocationContext`. On installedBaseAssets that
  //     field is read-only and `CurrentLocationContextCode` is the writable one.
  // Its hierarchy-detach step is deliberately NOT ported: it called a Fusion
  // endpoint that was never declared in the old app's service spec, so it threw
  // on every run and nobody has ever seen the intended behaviour.
  //
  // BEST-EFFORT, ALWAYS. Every path returns an outcome instead of throwing. A
  // Fusion outage must never fail a ship: the line status is the source of truth
  // for whether equipment left the yard, and this is a downstream notification.
  // ════════════════════════════════════════════════════════════════════════

  var LOCATION_CONTEXT = 'ORA_INTERNAL_LOCATION';

  // Fusion q values are single-quoted, so an embedded quote must be doubled or
  // the filter is malformed. Same helper as equipment-unit-detail's vbEnterChain.
  function qLit(v) {
    return "'" + String(v).replace(/'/g, "''") + "'";
  }

  function flagOn(context, key) {
    try {
      // ⚠️ THREE ARGUMENTS, NOT ONE. isFeatureEnabled is an APP-MODULE function,
      // and app-module functions cannot read $application.variables themselves —
      // so the map and the loaded latch are passed IN. Its signature is
      // isFeatureEnabled(flags, loaded, key); see app-flow.js:808.
      //
      // Calling it as isFeatureEnabled(key) is not an error, it is WORSE: the key
      // string lands in `flags`, `loaded` is undefined, the fail-closed guard
      // trips and it returns false for every flag, forever, silently. That cost
      // three test rounds of "why is it still dry-running" while the flag was
      // demonstrably 'true' in the table AND on the API.
      //
      // Fails CLOSED by design — false while flags are still loading, and false
      // for a key that is not a FEATURE_FLAG row. For something that writes to
      // live Fusion that is the only acceptable default.
      var app = context.$application;
      return app.functions.isFeatureEnabled(
        app.variables.featureFlags,
        app.variables.flagsLoaded,
        key
      ) === true;
    } catch (e) {
      console.warn('[maintAssetLocation] flag read failed for', key, e);
      return false;
    }
  }

  /**
   * Fusion OrganizationId → everything we need about that inventory org.
   *
   * THE SINGLE OWNER of this lookup. CaptureInvOrgLocationChain calls it when the
   * user picks a yard; readDeliveryTarget calls it again at ship time. Both paths
   * must ask the same question the same way, or a request could be captured under
   * one rule and shipped under another.
   *
   * LOCAL FIRST. EQR_INV_ORG is a 345-row mirror of Fusion's inventory
   * organizations and it already carries LOCATION_ID next to ORGANIZATION_ID —
   * verified identical to a live Fusion call (Chicago 003 → 300000047013180). So
   * the common path needs no Fusion round-trip, no credentials, and no CORS.
   *
   * It also yields the piece Fusion cannot give us: invOrgId, the LOCAL surrogate
   * that EQR_SERIAL_REF.CURRENT_INV_ORG_ID is a foreign key to. Writing the Fusion
   * organizationId into that column violates FK_EQR_SERIAL_INV_ORG.
   *
   * ⚠️ THE LIST IS SCANNED, NOT FILTERED. /inv-orgs accepts `q` (matches code or
   * name) but SILENTLY IGNORES `organizationId` — passing it returns all 345 rows
   * looking exactly like a successful filter. We hold the org ID, not the code, so
   * we fetch the list and match in JS. It is one small call and it cannot quietly
   * return the wrong org.
   *
   * @returns {Promise<{locationId:number|null, invOrgSurrogate:number|null, name:string}|null>}
   */
  async function resolveInvOrg(context, Actions, invOrgId) {
    if (invOrgId == null || invOrgId === '') return null;
    var wanted = String(invOrgId);

    try {
      var resp = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getInvOrgs',
        uriParams: { size: 500 }
      });
      if (resp && resp.ok && resp.body && Array.isArray(resp.body.data)) {
        var row = null;
        for (var i = 0; i < resp.body.data.length; i++) {
          if (String(resp.body.data[i].organizationId) === wanted) { row = resp.body.data[i]; break; }
        }
        if (row) {
          console.log('[maintAssetLocation] org', invOrgId, 'resolved locally —',
                      row.organizationCode, row.organizationName,
                      '| LocationId', row.locationId, '| local invOrgId', row.invOrgId);
          return {
            locationId:      row.locationId != null ? Number(row.locationId) : null,
            invOrgSurrogate: row.invOrgId   != null ? Number(row.invOrgId)   : null,
            name:            row.organizationName || row.organizationCode || ''
          };
        }
        console.warn('[maintAssetLocation] org', invOrgId, 'is not in EQR_INV_ORG',
                     '(' + resp.body.data.length + ' rows scanned) — falling back to Fusion.');
      } else {
        console.warn('[maintAssetLocation] local inv-orgs read failed — HTTP',
                     resp && resp.status, '— falling back to Fusion.');
      }
    } catch (e) {
      console.warn('[maintAssetLocation] local inv-orgs read threw — falling back to Fusion.', e);
    }

    // FALLBACK. The mirror can be incomplete — 1 of the 6 bu-org mappings has no
    // EQR_INV_ORG row — and Fusion is the system of record for the location even
    // if it cannot tell us the local surrogate.
    var locId = await resolveLocationIdFromFusion(context, Actions, invOrgId);
    return { locationId: locId, invOrgSurrogate: null, name: '' };
  }

  /** Fusion-only location lookup. The fallback path of resolveInvOrg. */
  async function resolveLocationIdFromFusion(context, Actions, invOrgId) {
    if (invOrgId == null || invOrgId === '') return null;

    var resp;
    try {
      resp = await Actions.callRest(context, {
        endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05InventoryOrganizations',
        uriParams: {
          // Fusion's q is a filter EXPRESSION, not a field=value map.
          q:      'OrganizationId=' + Number(invOrgId),
          fields: 'OrganizationId,LocationId',
          limit:  '1'
        }
      });
    } catch (e) {
      console.warn('[maintAssetLocation] LocationId lookup THREW for org', invOrgId,
                   '— usually auth or CORS, not data.', e);
      return null;
    }

    if (!resp || !resp.ok) {
      console.warn('[maintAssetLocation] LocationId lookup REJECTED for org', invOrgId,
                   '— HTTP', resp && resp.status, resp && resp.body);
      return null;
    }

    var items = (resp.body && resp.body.items) || [];
    if (!items.length) {
      console.warn('[maintAssetLocation] LocationId lookup returned NO ROWS for org', invOrgId,
                   '— the q filter matched nothing. Raw body:', resp.body);
      return null;
    }

    var locId = items[0].LocationId;
    if (locId == null) {
      console.warn('[maintAssetLocation] org', invOrgId,
                   'EXISTS but has a NULL LocationId in Fusion. This is the case that',
                   'needs the OIC EQP_INV_ORG_LOCATION fallback. Raw row:', items[0]);
      return null;
    }

    console.log('[maintAssetLocation] org', invOrgId, '-> LocationId', locId);
    return Number(locId);
  }

  /**
   * Fetch the request header and decide whether it targets an internal location.
   * @returns {Object|null} { invOrgId, locationId } or null if not applicable
   */
  async function readDeliveryTarget(context, Actions, requestId) {
    var resp;
    try {
      resp = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getEquipriteV1EquipmentRequestById',
        uriParams: { id: Number(requestId) }
      });
    } catch (e) {
      console.warn('[maintAssetLocation] request read threw:', e);
      return null;
    }
    if (!resp || !resp.ok || !resp.body) return null;

    var r = resp.body;
    if (r.deliveryLocationType !== 'INV_ORG') {
      console.log('[maintAssetLocation] request', requestId, 'deliveryLocationType is',
                  JSON.stringify(r.deliveryLocationType), '- not an internal location, nothing to do.');
      return null;
    }

    // The org id is the one thing that must already be there. It is stored the
    // instant a row is picked, before any network call, so its absence means the
    // request predates this feature or was authored some other way.
    if (r.deliveryInvOrgId == null) {
      console.warn('[maintAssetLocation] request', requestId,
                   'is INV_ORG but carries no deliveryInvOrgId — nothing to resolve from.');
      return null;
    }

    // Resolved every ship, not just when the location is missing, because we also
    // need invOrgSurrogate — the LOCAL EQR_INV_ORG key that the serial write-back
    // is a foreign key to. Fusion cannot supply that, and it is not worth a
    // column on the request when one small local call answers it.
    var org = await resolveInvOrg(context, Actions, r.deliveryInvOrgId);

    var locationId = r.deliveryLocationId;

    // SHIP-TIME BACKFILL. deliveryLocationId is normally resolved once, when the
    // yard is picked. If it is missing we resolve it again here rather than
    // silently skipping: the org id is enough to ask Fusion the same question, and
    // this covers requests created before this feature existed, and any request
    // whose lookup failed at selection time (a Fusion blip there would otherwise
    // disable the relocation permanently, with the request looking perfectly fine).
    if (locationId == null) {
      console.warn('[maintAssetLocation] request', requestId,
                   'is INV_ORG with org', r.deliveryInvOrgId,
                   'but no stored deliveryLocationId — resolving it now.');
      locationId = org && org.locationId;

      // Heal the record too, so the next ship does not repeat the lookup and the
      // request stops lying about what it knows. Best-effort: a failed backfill
      // must not stop the relocation we just gathered everything for.
      if (locationId != null) {
        try {
          await Actions.callRest(context, {
            endpoint:  'eqp-v1/patchEquipmentRequest',
            uriParams: { id: Number(requestId) },
            body:      { deliveryLocationId: locationId }
          });
          console.log('[maintAssetLocation] backfilled deliveryLocationId', locationId,
                      'onto request', requestId);
        } catch (e) {
          console.warn('[maintAssetLocation] backfill PATCH failed (continuing anyway):', e);
        }
      }
    }

    // Both ids or nothing. A PATCH carrying one of the two would move the asset
    // to a half-specified place, which is worse than not moving it: Fusion would
    // accept it and the asset would then claim a location nobody chose.
    if (locationId == null) {
      console.warn('[maintAssetLocation] request', requestId,
                   'still has no LocationId after re-resolving — skipping. The reason is',
                   'in the LocationId lookup log immediately above.');
      return null;
    }

    return {
      invOrgId:   Number(r.deliveryInvOrgId),
      locationId: Number(locationId),
      // May be null when the org is missing from the EQR_INV_ORG mirror. The
      // Fusion relocation still proceeds; only the local write-back is skipped,
      // and it says so rather than guessing at a foreign key.
      invOrgSurrogate: (org && org.invOrgSurrogate != null) ? Number(org.invOrgSurrogate) : null,
      orgName:         (org && org.name) || ''
    };
  }

  /**
   * line → allocation → serial. Returns the serial AND its maintenance asset
   * number (which may be null - the unit still shipped, there is just nothing in
   * Fusion to relocate).
   * Returns null when the line has no allocated serial or no asset number; both
   * are ordinary, not errors (an inventory line may be allocated by item alone).
   */
  async function serialForLine(context, Actions, lineId) {
    var alloc;
    try {
      alloc = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getAllocations',
        uriParams: { requestLineId: Number(lineId) }
      });
    } catch (e) {
      console.warn('[maintAssetLocation] allocations read threw for line', lineId, e);
      return null;
    }
    if (!alloc || !alloc.ok || !alloc.body || !Array.isArray(alloc.body.data)) return null;

    // EQR_REQUEST_LINE.EQR_SERIAL_REF_ID is NULL on every line in the database —
    // the serial lives on the ALLOCATION, never on the line. Do not be tempted to
    // read it off the line object.
    var withSerial = alloc.body.data.filter(function (a) { return a && a.serialRefId != null; });
    if (!withSerial.length) {
      console.log('[maintAssetLocation] line', lineId, 'has no allocation carrying a serial —',
                  alloc.body.data.length, 'allocation(s) seen. Nothing to relocate.');
      return null;
    }

    var serialRefId = withSerial[0].serialRefId;

    var serial;
    try {
      serial = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getSerialRefById',
        uriParams: { id: Number(serialRefId) }
      });
    } catch (e) {
      console.warn('[maintAssetLocation] serial read threw for', serialRefId, e);
      return null;
    }
    if (!serial || !serial.ok || !serial.body) return null;

    var num = serial.body.maintenanceAssetNumber;
    if (num == null || String(num).trim() === '') {
      // Ordinary, not an error — but it is the single most likely reason a ship
      // looks like it did nothing, and it must name the SERIAL. A master's serials
      // are not interchangeable here: on dev, ATL-CMP-XAS1800-2025-0060 carries an
      // asset number and ...-0059 does not, and which one you get is the
      // allocator's choice, not the requester's.
      console.log('[maintAssetLocation] line', lineId, 'allocated serial',
                  JSON.stringify(serial.body.serialNumber),
                  '(serialRefId ' + serialRefId + ') has NO maintenanceAssetNumber —',
                  'there is no Fusion asset to relocate for this unit.');
      return null;
    }
    console.log('[maintAssetLocation] line', lineId, 'serial',
                JSON.stringify(serial.body.serialNumber), '-> asset number', num);
    // serialRefId rides along so the caller can write the new current location
    // back onto EquipRite's own serial record once Fusion accepts the move.
    return {
      assetNumber:  String(num).trim(),
      serialRefId:  Number(serialRefId),
      serialNumber: serial.body.serialNumber
    };
  }

  /**
   * Record the new CURRENT location on EquipRite's own serial record.
   *
   * WHY. Unit Detail shows two location panels side by side: its own Stock &
   * Location fields, and a Maintenance Asset card read LIVE from Fusion. Patching
   * Fusion alone makes that page contradict itself — the Fusion card reads Chicago
   * while EquipRite still reads Seattle — and the Units grid and yard stock stay on
   * the old value too.
   *
   * CURRENT_INV_ORG_ID, NOT EQP_INV_ORG_ID. Settled 2026-09-14: shipping to a yard
   * says where the unit IS, not where it BELONGS. EQP_INV_ORG_ID is the home yard
   * and drives availability and catalog pricing (which prices from the yard nearest
   * the delivery address), so moving it would silently re-home the unit across the
   * whole app. CURRENT_INV_ORG_ID is the deployed-location field, and it was
   * unwritten on all 405 serials before this.
   *
   * ⚠️ The value is the LOCAL surrogate (EQR_INV_ORG.INV_ORG_ID, e.g. 1000032 for
   * Chicago), not the Fusion OrganizationId — FK_EQR_SERIAL_INV_ORG points at the
   * surrogate, so the Fusion id would be rejected.
   *
   * CURRENT_LOCATION_ID is deliberately left alone: it is a soft reference to
   * EQR_LOCATION, 20 seeded yards whose addresses do not correspond to the Fusion
   * orgs at all, so there is no honest mapping from a Fusion location onto one.
   *
   * Best-effort — Fusion has already been updated by the time this runs, and a
   * failure here must not turn a successful relocation into an error.
   */
  async function recordLocalLocation(context, Actions, serialRefId, invOrgSurrogate, label) {
    if (serialRefId == null || invOrgSurrogate == null) {
      console.warn('[maintAssetLocation] NOT recording local location for', label,
                   '— serialRefId', serialRefId, ', invOrgSurrogate', invOrgSurrogate,
                   '. Fusion was updated; EquipRite will still show the old location.',
                   'Most likely the delivery org is missing from the EQR_INV_ORG mirror.');
      return false;
    }
    try {
      var resp = await Actions.callRest(context, {
        endpoint:  'eqp-v1/patchSerialRef',
        uriParams: { id: Number(serialRefId) },
        body:      { currentInvOrgId: Number(invOrgSurrogate) }
      });
      if (resp && resp.ok) {
        console.log('[maintAssetLocation] serial', serialRefId,
                    'current location set to local invOrgId', invOrgSurrogate);
        return true;
      }
      console.warn('[maintAssetLocation] serial location write REJECTED for', serialRefId,
                   '— HTTP', resp && resp.status, resp && resp.body);
      return false;
    } catch (e) {
      console.warn('[maintAssetLocation] serial location write THREW for', serialRefId, e);
      return false;
    }
  }

  /**
   * AssetNumber → { assetId, operatingOrgId }.
   *
   * OperatingOrganizationId is read so it can be echoed back UNCHANGED on the
   * PATCH. It is mandatory on installedBaseAssets, but it does not mean what the
   * old app assumed — Fusion defines it as "the organization that CREATES OR
   * OPERATES the asset", i.e. ownership, not whereabouts. The field for "the
   * organization where the asset currently resides" is LocationOrganizationId,
   * and that one is only valid for ORA_WORK_CENTER. See the payload note below.
   */
  async function assetForNumber(context, Actions, assetNumber) {
    var resp;
    try {
      resp = await Actions.callRest(context, {
        endpoint:  'ProjectLOV/getInstalledBaseAssets',
        uriParams: {
          q:      'AssetNumber=' + qLit(assetNumber),
          fields: 'AssetId,AssetNumber,OperatingOrganizationId,CurrentLocationContextCode,CurrentLocationId',
          limit:  1
        }
      });
    } catch (e) {
      console.warn('[maintAssetLocation] asset lookup threw for', assetNumber, e);
      return null;
    }
    if (!resp || !resp.ok || !resp.body) {
      console.warn('[maintAssetLocation] asset lookup failed for', assetNumber,
                   'HTTP', resp && resp.status, resp && resp.body);
      return null;
    }
    var items = resp.body.items || [];
    if (!items.length) {
      // Expected on dev far more often than not: of the 209 serials carrying an
      // asset number, 50 are seeded 'MNT-*' strings that exist nowhere in Fusion.
      console.log('[maintAssetLocation] no Fusion asset matches AssetNumber', assetNumber);
      return null;
    }
    var a = items[0];
    if (a.AssetId == null) return null;
    console.log('[maintAssetLocation] resolved', assetNumber, '-> AssetId', a.AssetId,
                '(currently', a.CurrentLocationContextCode, 'loc', a.CurrentLocationId + ')');
    return { assetId: a.AssetId, operatingOrgId: a.OperatingOrganizationId };
  }

  /**
   * Relocate every maintenance asset among the lines that just shipped.
   *
   * @param {Object} context      action-chain context
   * @param {Object} Actions      vb/action/actions
   * @param {Object} opts
   * @param {number} opts.requestId
   * @param {Array}  opts.lines   the line rows that just advanced to SHIP_TO_SITE
   * @returns {Promise<{attempted:number, patched:number, failed:number, skipped:string, dryRun:boolean}>}
   */
  async function relocateShippedAssets(context, Actions, opts) {
    // localUpdated counts SERIALS whose EquipRite current-location was recorded.
    // Deliberately separate from `patched`, which counts Fusion ASSETS: the two
    // are different grains and on dev they routinely disagree, because many
    // serials share one asset number and some carry none at all.
    var result = { attempted: 0, patched: 0, failed: 0, localUpdated: 0, skipped: '', dryRun: false };

    var lines = (opts && opts.lines) || [];

    // ALWAYS announce entry. Every early return below is a legitimate outcome, but
    // a silent console is indistinguishable from "the code never ran" — which is
    // exactly the wrong thing to be guessing about while testing.
    console.log('[maintAssetLocation] start — request', opts && opts.requestId,
                'with', lines.length, 'shipped line(s)');

    if (!opts || !opts.requestId || !lines.length) {
      result.skipped = 'nothing shipped';
      console.log('[maintAssetLocation] done —', result.skipped);
      return result;
    }

    var enabled = flagOn(context, 'MAINT_ASSET_LOCATION_SYNC_ENABLED');
    var cascade = flagOn(context, 'MAINT_ASSET_CASCADE_CHILDREN');

    // DRY RUN when the switch is off. It still resolves every asset and logs the
    // exact payload it would send, and simply never calls PATCH. That is the
    // whole point: you can watch it pick the right asset, against real data,
    // before it is ever allowed to write to Fusion.
    result.dryRun = !enabled;

    // Say out loud what the flags resolved to, and whether they had even finished
    // loading. "dryRun: true" on its own is ambiguous between "the switch is off"
    // and "I could not read the switch", and those need opposite fixes.
    console.log('[maintAssetLocation] flags — sync:', enabled, 'cascade:', cascade,
                '| flagsLoaded:', context.$application.variables.flagsLoaded,
                '| raw:', JSON.stringify(
                  (context.$application.variables.featureFlags || {})['MAINT_ASSET_LOCATION_SYNC_ENABLED']));

    // ── GATE: maintenance-tracked AND NOT transactable ──────────────────────
    // isMaintenanceTracked alone is not enough. The live masters split three ways:
    //
    //   MT=N IT=Y FA=N TX=Y   229   pure inventory, no maintenance asset at all
    //   MT=Y IT=N FA=Y TX=N    69   F&M - no transfer order, nothing moves it
    //   MT=Y IT=Y FA=Y TX=Y     8   dual-tracked - maintenance AND transactable
    //
    // That third group is the trap. Those assets DO have a maintenance record, so
    // a maintenance-only gate patches them — but they are transactable, so they
    // also get a transfer order, and its inventory transaction moves the asset
    // into ORA_INVENTORY. We would be writing ORA_INTERNAL_LOCATION over a
    // context Fusion owns and is about to rewrite, which is precisely the
    // conflict the ORA_INVENTORY note at the top of this file exists to avoid.
    //
    // isTransactable is the right discriminator rather than isInventoryTracked
    // because it is already THE test this app uses for "does this line have a
    // transfer order" — see isFAndM in openPickingDrawerChain. The two agree on
    // every master today; if they ever diverge, the transfer order is what
    // decides whether Fusion is going to move the asset without us.
    // FAILS CLOSED ON A MISSING FLAG. isTransactable must be explicitly present
    // and explicitly not 'Y'. A bare String(undefined) !== 'Y' test would pass an
    // unflagged line straight through to a live Fusion write, which is the wrong
    // way round for a guard whose whole job is to keep us off assets the inventory
    // engine owns. Every master carries the flag today; that is not a reason to
    // default to writing when one does not. Same shape as isFAndM in
    // openPickingDrawerChain, which also demands an explicit value.
    var candidates = lines.filter(function (l) {
      if (!l || l.isMaintenanceTracked !== 'Y') return false;
      var tx = l.isTransactable;
      if (tx === undefined || tx === null || tx === '') {
        console.warn('[maintAssetLocation] line', l.id,
                     'has no isTransactable flag — skipping rather than guessing.',
                     'If this line really has no transfer order, the master is missing IS_TRANSACTABLE.');
        return false;
      }
      return String(tx).toUpperCase() !== 'Y';
    });
    if (!candidates.length) {
      result.skipped = 'no non-transactable maintenance-tracked lines';
      console.log('[maintAssetLocation] done —', result.skipped, '— shipped lines were',
                  lines.map(function (l) {
                    return '(' + (l && l.id) + ' MT=' + (l && l.isMaintenanceTracked) +
                           ' TX=' + (l && l.isTransactable) + ')';
                  }).join(' '));
      return result;
    }

    var target = await readDeliveryTarget(context, Actions, opts.requestId);
    if (!target) {
      result.skipped = 'no usable internal delivery location';
      console.log('[maintAssetLocation] done —', result.skipped);
      return result;
    }

    // ── PAYLOAD: LOCATION ONLY ───────────────────────────────────────────────
    // CurrentLocationId alone says where the asset is. An hr_locations id already
    // carries its own address and org, so nothing else is needed to place it.
    //
    // The old app ALSO sent OperatingOrganizationId set to the delivery
    // inventory org, and that is wrong. Fusion defines OperatingOrganizationId as
    // "the organization that CREATES OR OPERATES the asset" — ownership, not
    // whereabouts. Sending the delivery org there would quietly re-home every
    // asset we ship: BT-100000 operates out of org 001, and a delivery to Chicago
    // (003) would have rewritten its operating org to 003 as a side effect of
    // moving it. Nothing on screen would have said so.
    //
    // The field that DOES mean "where it resides" is LocationOrganizationId, and
    // Fusion only accepts it when the context is ORA_WORK_CENTER — not ours.
    //
    // OperatingOrganizationId is nonetheless mandatory on this resource, so each
    // asset's EXISTING value is read in assetForNumber and echoed back unchanged
    // below: it satisfies the requirement without asserting anything new.
    var basePayload = {
      CurrentLocationContextCode: LOCATION_CONTEXT,
      CurrentLocationId:          target.locationId
    };

    // DEDUPE BY AssetId. Dev data has 158 serials sharing the single asset number
    // '100001728623616', so a multi-line ship would otherwise PATCH one real
    // Fusion asset over and over in the same click. Keyed on the resolved AssetId
    // rather than the line, so two lines legitimately carrying the same asset
    // collapse to one call.
    var seen = Object.create(null);

    for (var i = 0; i < candidates.length; i++) {
      var lineId = Number(candidates[i].id);

      var line = await serialForLine(context, Actions, lineId);
      if (!line) continue;

      // LOCAL FIRST, AND UNCONDITIONALLY. Two reasons this is not folded into the
      // Fusion branch below:
      //   * it is per SERIAL, while the Fusion dedupe below is per ASSET. With 158
      //     dev serials sharing one asset number, two shipped units collapse to a
      //     single Fusion PATCH — but they are two different units and each one's
      //     own record has to say where it went.
      //   * a serial with no maintenance asset number still shipped to Chicago.
      //     ATL-CMP-XAS1800-2025-0059 is exactly that case. There is nothing to
      //     relocate in Fusion, and the Units grid should still be right.
      if (!result.dryRun) {
        if (await recordLocalLocation(context, Actions, line.serialRefId,
                                      target.invOrgSurrogate, line.serialNumber)) {
          result.localUpdated++;
        }
      } else {
        console.log('[maintAssetLocation] DRY RUN — would set serial', line.serialRefId,
                    '(' + line.serialNumber + ') current location to local invOrgId',
                    target.invOrgSurrogate);
      }

      var assetNumber = line.assetNumber;
      if (!assetNumber) continue;

      var asset = await assetForNumber(context, Actions, assetNumber);
      if (!asset) continue;

      var assetId = asset.assetId;
      // Echo the asset's own operating org back unchanged — see the payload note.
      var payload = Object.assign({}, basePayload);
      if (asset.operatingOrgId != null) {
        payload.OperatingOrganizationId = asset.operatingOrgId;
      }

      var key = String(assetId);
      if (seen[key]) {
        console.log('[maintAssetLocation] asset', assetNumber, '(' + assetId + ')',
                    'already handled in this ship — skipping line', lineId);
        continue;
      }
      seen[key] = true;
      result.attempted++;

      if (result.dryRun) {
        console.log('[maintAssetLocation] DRY RUN — would PATCH installedBaseAssets/' +
                    assetId + ' (' + assetNumber + ') from line ' + lineId + ':',
                    JSON.stringify(payload));
        continue;
      }

      var patched = await patchAsset(context, Actions, assetId, assetNumber, payload);
      if (patched) result.patched++; else result.failed++;

      if (cascade) {
        await cascadeToChildren(context, Actions, assetId, basePayload, seen, result);
      }
    }

    if (!result.attempted && !result.localUpdated) {
      result.skipped = 'no shipped line resolved to a Fusion asset';
    }
    console.log('[maintAssetLocation] done —', JSON.stringify(result));
    return result;
  }

  async function patchAsset(context, Actions, assetId, label, payload) {
    try {
      var resp = await Actions.callRest(context, {
        endpoint:  'ProjectLOV/patchInstalledBaseAsset',
        uriParams: { AssetId: String(assetId) },
        body:      payload
      });
      if (resp && resp.ok) {
        console.log('[maintAssetLocation] relocated asset', label, '(' + assetId + ')');
        return true;
      }
      console.warn('[maintAssetLocation] PATCH rejected for asset', label,
                   '(' + assetId + ') HTTP', resp && resp.status, resp && resp.body);
      return false;
    } catch (e) {
      console.warn('[maintAssetLocation] PATCH threw for asset', label, e);
      return false;
    }
  }

  /**
   * Move the asset's structure children to the same place.
   *
   * GATED OFF BY DEFAULT (MAINT_ASSET_CASCADE_CHILDREN). Right for an excavator
   * whose bucket and hammer travel with it; wrong the moment a hierarchy is stale,
   * because it relocates assets nobody on this request ever mentioned. The old app
   * did this unconditionally.
   *
   * Children come from installedBaseAssets' own `relationships` child resource
   * rather than the old app's OIC getAssets integration — one fewer dependency,
   * and it is the same source Fusion's own UI reads.
   */
  async function cascadeToChildren(context, Actions, assetId, basePayload, seen, result) {
    var kids;
    try {
      kids = await Actions.callRest(context, {
        endpoint:  'ProjectLOV/getInstalledBaseAssetRelationships',
        uriParams: { AssetId: String(assetId), limit: 200 }
      });
    } catch (e) {
      console.warn('[maintAssetLocation] relationships read threw for', assetId, e);
      return;
    }
    if (!kids || !kids.ok || !kids.body) return;

    var items = kids.body.items || [];
    for (var i = 0; i < items.length; i++) {
      // AssetId on a relationships row is the CHILD's id, not the parent from
      // the path — confirmed against the live pod's installedBaseAssets/describe,
      // where the child resource exposes exactly
      // RelationshipId / AssetId / SerialNumber / ItemNumber / AssetNumber.
      var childId = items[i].AssetId;
      if (childId == null || String(childId) === String(assetId)) continue;
      var key = String(childId);
      if (seen[key]) continue;
      seen[key] = true;

      // Each child keeps its OWN operating org, for the same reason the parent
      // does — moving a component must not re-home it. Costs one lookup per
      // child, which is acceptable for a path that is off by default.
      var childPayload = Object.assign({}, basePayload);
      var childNum = items[i].AssetNumber;
      if (childNum) {
        var childAsset = await assetForNumber(context, Actions, childNum);
        if (childAsset && childAsset.operatingOrgId != null) {
          childPayload.OperatingOrganizationId = childAsset.operatingOrgId;
        }
      }

      result.attempted++;
      var ok = await patchAsset(context, Actions, childId, 'child of ' + assetId, childPayload);
      if (ok) result.patched++; else result.failed++;
    }
  }

  return {
    LOCATION_CONTEXT:       LOCATION_CONTEXT,
    // Exported so CaptureInvOrgLocationChain resolves the LocationId through the
    // very same function this file uses at ship time — one owner, one behaviour,
    // one set of log messages to read.
    resolveInvOrg:          resolveInvOrg,
    relocateShippedAssets:  relocateShippedAssets
  };
});
