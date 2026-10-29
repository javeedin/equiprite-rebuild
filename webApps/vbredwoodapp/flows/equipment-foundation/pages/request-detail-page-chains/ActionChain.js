define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
  'resources/js/requestDetailLines',
  'resources/js/releaseTransferOrder',
  'resources/js/currentUser',
  'resources/js/fetchAllPages',
  'resources/js/requestLineBody',
], (ActionChain, Actions, _au, rdl, rto, cu, paging, lineBody) => {
  'use strict';

  // Toast helper — the shell's notification data-provider can fail with
  // "valid payload was not provided" depending on shell config. We don't
  // want that to break flows, so swallow toast errors as warnings.
  async function safeNotify(context, payload) {
    try {
      await Actions.fireNotificationEvent(context, payload);
    } catch (e) {
      console.warn('[request-detail ActionChain] toast failed — continuing:', e);
    }
  }

  // US states + abbreviations (uppercased), used to recognize the state token in
  // a free-text address when there's no ZIP to anchor on (e.g. "Cleveland, Ohio",
  // "Pittsburgh, PA"). DC included.
  const US_STATE_TOKENS = new Set([
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
    'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
    'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
    'ALABAMA','ALASKA','ARIZONA','ARKANSAS','CALIFORNIA','COLORADO','CONNECTICUT','DELAWARE','FLORIDA',
    'GEORGIA','HAWAII','IDAHO','ILLINOIS','INDIANA','IOWA','KANSAS','KENTUCKY','LOUISIANA','MAINE',
    'MARYLAND','MASSACHUSETTS','MICHIGAN','MINNESOTA','MISSISSIPPI','MISSOURI','MONTANA','NEBRASKA',
    'NEVADA','NEW HAMPSHIRE','NEW JERSEY','NEW MEXICO','NEW YORK','NORTH CAROLINA','NORTH DAKOTA','OHIO',
    'OKLAHOMA','OREGON','PENNSYLVANIA','RHODE ISLAND','SOUTH CAROLINA','SOUTH DAKOTA','TENNESSEE','TEXAS',
    'UTAH','VERMONT','VIRGINIA','WASHINGTON','WEST VIRGINIA','WISCONSIN','WYOMING','DISTRICT OF COLUMBIA'
  ]);

  // Parse a free-text / geocoded address string into the structured one-time
  // location shape { address1, address2, city, state, postalCode, county,
  // countryCode }. Recognizes each component by SHAPE (not comma position), so it
  // handles both a full geocoded address
  //   "13254 Forkland Lane, Houston, Harris County, Texas 77077, United States"
  //     -> a1="13254 Forkland Lane" city="Houston" county="Harris County"
  //        state="Texas" postal="77077"
  // and a bare locality
  //   "Pittsburgh, PA"  -> city="Pittsburgh" state="PA" (a1 falls back to city)
  // Strategy: split on commas, then peel known components off the END
  // (country -> state/ZIP -> county), leaving [street..., city] at the front.
  // Country in the UI is fixed to US, so countryCode is always 'US'; we only
  // strip the country token so it doesn't pollute the state. Address Line 1 is a
  // required Fusion field, so it never comes back empty (falls back to city, then
  // to the raw string).
  // Strip surrounding whitespace and stray punctuation (leading/trailing
  // '.', ',', '-') from a token, so "Texas." recognizes as a state and a
  // "TX -"/"TX-" separator before a ZIP doesn't leak into the state value.
  function tidyToken(t) {
    return String(t == null ? '' : t).replace(/^[\s.,\-]+|[\s.,\-]+$/g, '').trim();
  }

  function parseRequestAddress(raw) {
    const result = { address1: '', address2: '', city: '', state: '', postalCode: '', county: '', countryCode: 'US' };
    const s = String(raw || '').trim();
    if (!s) return result;

    let parts = s.split(',').map(function (p) { return p.trim(); }).filter(Boolean);

    // 1. Strip a trailing country token.
    if (parts.length) {
      const up = tidyToken(parts[parts.length - 1]).toUpperCase();
      if (up === 'UNITED STATES' || up === 'USA' || up === 'US' || up === 'UNITED STATES OF AMERICA') {
        parts.pop();
      }
    }

    // 2. Pull state + ZIP off the end. Handles "Texas 77077", "TX - 77450",
    //    "TX-77077", a bare ZIP "77077" (then the prior token may be the state),
    //    or a bare state "Ohio" / "PA" / "Texas.". The [\s,\-]* separator class
    //    keeps a dash between state and ZIP out of the state token.
    if (parts.length) {
      const last = parts[parts.length - 1];
      const m = last.match(/^(.*?)[\s,\-]*\b(\d{5}(?:-\d{4})?)\s*$/); // "<state?> <zip>"
      if (m) {
        result.postalCode = m[2];
        const statePart = tidyToken(m[1]);
        parts.pop();
        if (statePart) {
          result.state = statePart;
        } else if (parts.length && US_STATE_TOKENS.has(tidyToken(parts[parts.length - 1]).toUpperCase())) {
          result.state = tidyToken(parts.pop());
        }
      } else if (US_STATE_TOKENS.has(tidyToken(last).toUpperCase())) {
        result.state = tidyToken(last);
        parts.pop();
      }
    }

    // 3. Strip a county token ("... County").
    if (parts.length && /county\.?$/i.test(tidyToken(parts[parts.length - 1]))) {
      result.county = tidyToken(parts.pop());
    }

    // 4. What remains is [street parts..., city]. The last token is the city; any
    //    tokens before it form the street (address line 1).
    if (parts.length >= 2) {
      result.city = tidyToken(parts.pop());
      result.address1 = parts.join(', ');
    } else if (parts.length === 1) {
      // A single remaining token: if we already found a state/ZIP it's the city
      // (e.g. "Pittsburgh, PA"); otherwise treat it as the street/line 1.
      if (result.state || result.postalCode) {
        result.city = tidyToken(parts[0]);
      } else {
        result.address1 = parts[0];
      }
    }

    // 5. Address Line 1 is required — never leave it blank.
    if (!result.address1) {
      result.address1 = result.city || s;
    }
    return result;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Refetch + rebuild $page.variables (same logic as vbEnterChain).
  // Called after auto-allocate so the linesArray, allocationProgress and
  // total cost reflect the new server state without a page reload.
  // ───────────────────────────────────────────────────────────────────────
  async function refreshRequestData(context) {
    const { $page } = context;
    const requestId = $page.variables.requestId;
    // Respect the currently-selected yard so a Refresh after allocation keeps
    // the availability scoped to the same org the user was looking at.
    const yardId    = $page.variables.selectedYard;

    const settled = await Promise.allSettled([
      Actions.callRest(context, {
        endpoint:  'eqp-v1/getEquipriteV1ViewsWorkbenchRequests',
        uriParams: { eqrEquipmentRequestId: Number(requestId) }
      }),
      rdl.fetchAndBuild(context, Actions, requestId, yardId)
    ]);

    const headerResp   = settled[0].status === 'fulfilled' ? settled[0].value : null;
    const linesResult  = settled[1].status === 'fulfilled' ? settled[1].value : { ok: false, lines: [] };

    let header = {};
    if (headerResp && headerResp.ok) {
      // Server-side scoped by eqrEquipmentRequestId — take the first row.
      const wbRows = headerResp.body.data || [];
      if (wbRows.length) header = wbRows[0];
    }

    // ── Lines (enriched endpoint, built by the shared module) ──────────────
    rdl.applyLines($page, linesResult.lines);

    // Keep header status in sync (only field the refresh updates on the header).
    if (header.requestStatus) {
      $page.variables.formData = { ...$page.variables.formData, status: header.requestStatus };
    }
  }


  // ───────────────────────────────────────────────────────────────────────
  // Hand a bucket's reservations back when its OIC call failed, so the lines are
  // confirmable again immediately instead of waiting out the 15-minute TTL.
  // Best-effort and never throws: the confirm has already failed for this bucket,
  // and a failed cleanup must not mask that with a second, confusing error. Worst
  // case the reservation simply ages out.
  async function releaseReservation(context, requestId, batchNumber) {
    try {
      await Actions.callRest(context, {
        endpoint:  'eqp-v1/releaseReservation',
        uriParams: { requestId: Number(requestId) },
        // No X-User-Id: the live endpoint does not declare it (verified against
        // the service's own OpenAPI). Releasing a reservation records no actor,
        // and sending an undeclared header would be silently dropped anyway.

        body:      { batchNumber: batchNumber }
      });
    } catch (e) {
      console.warn('[request-detail confirmRequest] release-reservation failed for batch ' +
                   batchNumber + ' (will age out):', e);
    }
  }

  // ══ SERVER-SIDE WRITE-BACK SWITCH ═══════════════════════════════════
  // true  → EQR_TRANSFER_ORDER_PKG.record_confirm via POST .../record: ONE
  //          TRANSACTION per bucket. Allocation stamps, line stamps and the
  //          status promotion either all land or none do.
  // false → the original client-side PATCH loops, kept verbatim below.
  //
  // WHY THE OLD PATH STILL EXISTS: the legacy loop is best-effort by design —
  // every failure is logged and swallowed, because the Transfer Order already
  // exists by then and an error would wrongly read as "the transfer didn't
  // happen". That behaviour has been in production for months. Flipping to a
  // transactional path changes the failure mode, so both live side by side until
  // /record has been exercised on real confirms. Flip this to false to revert
  // instantly, without a code change beyond one boolean.
  //
  // Remove the legacy branch only once /record is trusted — not before.
  const USE_SERVER_RECORD = true;

  // == SERVER-SIDE PLAN =====================================================
  // true  -> POST .../plan resolves buckets, blocks and the F&M split in one
  //          call, and its answer is used. Replaces the per-line
  //          getAllocations loop, the 2000-row equipment-master fetch and the
  //          TO-dedupe fetches: roughly 120 round-trips down to ~10.
  // false -> the original client-side resolution, kept verbatim below.
  //
  // Falls back to the client path on ANY failure, so this is safe to leave on.
  const USE_SERVER_PLAN = true;

  // Persist one bucket's confirm through the package. Returns true on success.
  // On ANY failure returns false, and the caller falls back to the legacy loop:
  // a write-back that did not happen is far worse than one done the old way.
  async function recordConfirmBucket(context, requestId, batchNumber, items) {
    const first = items[0];
    try {
      const r = await Actions.callRest(context, {
        endpoint:  'eqp-v1/recordConfirm',
        uriParams: { requestId: Number(requestId) },
        // Stamps RESERVED_BY / LAST_UPDATED_BY. Omitted when no actor resolves,
        // so the backend's own 'SYSTEM' default applies — better one sentinel
        // than two.
        headers:   cu.auditHeaders(context),
        body: {
          batchNumber:      batchNumber,
          lineIds:          items.map(it => Number(it.entry.line.line_id)),
          sourceOrgId:      first.srcOrgId,
          sourceOrgCode:    first.srcCode,
          sourceOrgName:    first.srcOrgName,
          destOrgId:        first.destOrgId,
          destOrgCode:      first.destCode,
          // `destOrgName` — NOT `destName`. Bucket items are built in bySource
          // under the key destOrgName (the yard group's own field is destName,
          // renamed on the way in). Reading destName sent undefined, Jackson
          // omitted the field, and DEST_INV_ORG_NAME persisted NULL on every
          // line and allocation while everything else looked correct — silent,
          // and only visible by querying the table afterwards.
          destOrgName:      first.destOrgName,
          // MANUAL = a person allocated specific units then confirmed.
          // AUTO   = confirmed with no allocation; the source came from the
          //          Yard picker and the system chose the units.
          allocationMethod: first.fromFallbackYard ? 'AUTO' : 'MANUAL'
        }
      });
      if (r && r.ok) return true;
      console.warn('[request-detail confirmRequest] /record not ok for batch ' + batchNumber +
                   ' (HTTP ' + (r && r.status) + ') — falling back to client PATCH loop');
      return false;
    } catch (e) {
      console.warn('[request-detail confirmRequest] /record threw for batch ' + batchNumber +
                   ' — falling back to client PATCH loop:', e);
      return false;
    }
  }

  // Return-leg twin of releaseReservation. Separate endpoint because the two
  // legs are separate reservations; best-effort and never throws, for the same
  // reason - the return has already failed and a failed cleanup must not mask it.
  async function releaseReturnReservation(context, requestId, batchNumber) {
    try {
      await Actions.callRest(context, {
        endpoint:  'eqp-v1/releaseReturnReservation',
        uriParams: { requestId: Number(requestId) },
        headers:   cu.auditHeaders(context),
        body:      { batchNumber: batchNumber }
      });
    } catch (e) {
      console.warn('[request-detail processReturn] release-reservation failed for batch ' +
                   batchNumber + ' (will age out):', e);
    }
  }

  // How many times has this line set already been attempted and failed?
  //
  // Drives `attempt` on the idempotency key, which is what makes a deliberate
  // RETRY a new intent instead of a replay. Without it /reserve answers
  // replayed:true and the retry silently creates nothing.
  //
  // Read off the page rows, which resources/js/requestDetailLines already marked
  // from POST .../transfer-orders/failed during the line load. NOT a client-side
  // counter: that would reset to 0 on reload and re-collapse the retry.
  //
  // 1 when any selected line is a known failure, 0 otherwise. A single bump is
  // enough — the key only has to CHANGE between attempts, and a failed line is
  // cleared of its marking once a Transfer Order succeeds, so a second failure
  // produces a fresh 0 -> 1 transition against a different batch anyway.
  function attemptFor(lines) {
    return (lines || []).some(l => l && l.to_retryable === true) ? 1 : 0;
  }

  // LAYER 1 — deterministic idempotency key over a confirm/return INTENT.
  //
  // Same request + same line set + same leg + same ATTEMPT  =>  same key, always.
  // No clock, no random, no dependence on call ordering. That is the whole point:
  // it is what lets a repeat fire be RECOGNISED as a repeat instead of new work.
  //
  // `attempt` is what makes a deliberate RETRY possible. Without it the key is a
  // pure function of the selection, so a retry after a Fusion failure produces the
  // SAME key, /reserve answers replayed:true, and the retry silently creates
  // nothing — correct for a double-click, useless for "try again".
  //
  // It MUST come from the server (get_failed_to_lines counts prior failed TOs), not
  // a client-side counter: a page reload would reset the latter to 0 and re-collapse
  // the retry into a replay. Absent/0 = first attempt, and the key is byte-identical
  // to what it was before this parameter existed — so the 11 reservations already
  // recorded stay valid.
  //
  // Hash: FNV-1a 32-bit, run twice over the same input with different offset
  // bases and concatenated to 16 hex chars. Not cryptographic — it does not need
  // to be. It needs to be deterministic, dependency-free (crypto.subtle is async
  // and unavailable on insecure origins) and collision-resistant enough that two
  // DIFFERENT confirms never collide.
  //
  // The DB column is VARCHAR2(64), so there is room if this is ever upgraded to a
  // real SHA-256 — do that server-side if it matters, not here.
  function buildIdempotencyKey(intent) {
    const ids = (intent.lineIds || [])
      .map(Number)
      .filter(n => Number.isFinite(n))
      .sort((a, b) => a - b)          // NUMERIC sort — default Array sort is lexical
      .join(',');
    const canonical = [
      'v1',
      String(intent.requestId  || ''),
      ids,
      String(intent.leg        || ''),
      String(intent.sourceCode || '')   // empty for request-level intents
    ].join('|')
      // APPENDED ONLY WHEN PRESENT, never a placeholder segment. Joining an empty
      // string would add a trailing '|' and change the hash of every existing key
      // — the 11 reservations already recorded in EQR_TO_RESERVATION would stop
      // matching, and a repeat of any past confirm would read as new work.
      // Verified: attempt omitted/0/null reproduces live key 305fd7a48464b373.
      + (Number(intent.attempt) > 0 ? '|a' + Number(intent.attempt) : '');

    const fnv = (str, seed) => {
      let h = seed >>> 0;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;   // 32-bit FNV prime, exact via imul
      }
      return ('00000000' + h.toString(16)).slice(-8);
    };

    return fnv(canonical, 0x811c9dc5) + fnv(canonical, 0x9dc5811c);
  }

  // Build equipmentMasterId -> equipmentNumber lookup, covering `lines` via a
  // bulk fetch of /equipment-master, then falling back to per-id GETs for any
  // master the bulk fetch missed (size cap, just-created row, etc.). Shared
  // by confirmRequest (outbound TO) and the processReturn branch (inbound
  // TO) — both need the same masterId -> itemNumber resolution to build the
  // OIC supplyRequestLines payload.
  // ───────────────────────────────────────────────────────────────────────
  async function buildMasterIdToItemNumberMap(context, lines) {
    const masterIdToItemNumber = new Map();
    try {
      // size=2000 is silently clamped to 200 by this endpoint (306 rows
      // exist, pageSize comes back 200 with hasMore=true), so page through
      // rather than trusting one call. The per-id fallback below already
      // covered the gap, but only by issuing one extra request per missing
      // master - paging gets them all in one page more.
      const rows = await paging.fetchAllPages(
        (o) => Actions.callRest(context, o),
        'eqp-v1/getEquipriteV1EquipmentMaster',
        {},
        'equipment-master'
      );
      rows.forEach(em => {
        if (em.id != null && em.equipmentNumber) {
          masterIdToItemNumber.set(Number(em.id), em.equipmentNumber);
        }
      });
    } catch (e) {
      console.warn('[request-detail ActionChain] failed to load /equipment-master:', e);
    }

    const neededMasterIds = Array.from(new Set(
      lines.map(l => Number(l.equipment_master_id)).filter(id => Number.isFinite(id) && id > 0)
    ));
    const uncovered = neededMasterIds.filter(id => !masterIdToItemNumber.has(id));
    if (uncovered.length) {
      console.log('[request-detail ActionChain] bulk master fetch missed', uncovered.length,
                  'master ids — falling back to per-id GET:', uncovered);
      const perIdResults = await Promise.all(uncovered.map(id =>
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1EquipmentMasterById',
          uriParams: { id: Number(id) }
        }).then(r => ({ id, ok: !!(r && r.ok), em: r && r.body }))
          .catch(() => ({ id, ok: false, em: null }))
      ));
      perIdResults.forEach(r => {
        if (r.ok && r.em && r.em.equipmentNumber) {
          masterIdToItemNumber.set(Number(r.id), r.em.equipmentNumber);
        }
      });
    }

    return masterIdToItemNumber;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Group each request line's ACTIVE allocations BY SOURCE YARD, resolving the
  // outbound-TO SOURCE + DESTINATION org CODEs for each yard.
  //
  // Why per-yard: the OIC integration creates exactly ONE Transfer Order per
  // createSupplyRequest call (one Fusion TO + one EQR_InsertTransferOrder header;
  // the only loop, ForEach_InsertTOLines, just writes the TO's lines). It does
  // NOT split by SourceOrganizationCode. So a line whose units are allocated
  // across two yards needs the caller to fire TWO createSupplyRequest calls —
  // one per source yard — to get two TOs. This helper returns the per-yard
  // breakdown the caller groups on.
  //
  // SOURCE: the org id is on each active allocation row
  // (EQR_ALLOCATION.EQP_INV_ORG_ID). id -> code via EQR_BU_ORG_MAPPING.
  // DESTINATION: the VIRTUAL org's code in the SAME BU as that source org, keyed
  // by request ORIGIN (destRole): PROJECT -> VIRTUAL_PROJECT (e.g. '005'),
  // CUSTOMER -> VIRTUAL_CUSTOMER (e.g. '006'). destRole=null -> no dest resolved.
  //
  // Returns Map<Number lineId, Array<{ orgId, sourceCode, destCode, qty }>>:
  //   - one entry per DISTINCT source yard the line's active allocations sit in;
  //   - qty = units from that yard (count for serial where allocatedQty=1 each;
  //     summed allocatedQty for lot/inventory);
  //   - orgId null (pre-fix allocation with NULL EQP_INV_ORG_ID) or an unmapped
  //     id leaves sourceCode/destCode null — the caller substitutes the legacy
  //     defaults so Confirm never breaks.
  // ───────────────────────────────────────────────────────────────────────
  // fallbackYardOrgId — the Yard picked in the page toolbar, used as the SOURCE
  // for lines that have no active allocation to derive one from.
  //
  // There is a real flow where equipment is never allocated and Confirm is
  // clicked directly. Those lines have no allocation, so no yard: previously
  // they silently fell back to the hardcoded '001' and shipped from a yard
  // nobody chose. Now the manager's explicit Yard selection supplies it, and
  // when no yard is chosen the caller REFUSES to confirm rather than guessing —
  // "which yard does this ship from" is a decision, not a lookup.
  //
  // Allocated lines are unaffected: their own allocations still win, so a
  // stray Yard selection cannot redirect equipment that is already committed.
  async function buildLineYardGroups(context, lines, destRole, fallbackYardOrgId) {
    const groupsByLineId = new Map();
    const wantRole = destRole ? String(destRole).toUpperCase() : null;
    const fallbackOrgId = (fallbackYardOrgId != null && fallbackYardOrgId !== '')
      ? Number(fallbackYardOrgId)
      : null;

    // 1. From the mapping table (ALL rows — an allocation may sit on an org that
    //    is now inactive, so don't filter), build:
    //      orgId -> invOrgCode            (source code lookup)
    //      orgId -> businessUnitId        (source org's BU)
    //      businessUnitId -> <destRole> invOrgCode  (destination lookup)
    const orgIdToCode = new Map();
    const orgIdToBu   = new Map();
    const buToDestCode = new Map();
    // Name + id lookups, captured in the SAME pass so the confirmed yard pair
    // can be persisted onto EQR_ALLOCATION / EQR_TRANSFER_ORDER, which store the
    // org as id + name + code. The OIC payload itself only needs the codes.
    const orgIdToName  = new Map();
    const buToDestOrg  = new Map(); // businessUnitId -> { id, code, name }
    try {
      const mapResp = await Actions.callRest(context, { endpoint: 'eqp-v1/getBuOrgMappings' });
      if (mapResp && mapResp.ok) {
        (mapResp.body.data || []).forEach(m => {
          if (m.invOrgId == null) return;
          const oid = Number(m.invOrgId);
          if (m.invOrgCode) orgIdToCode.set(oid, m.invOrgCode);
          if (m.invOrgName) orgIdToName.set(oid, m.invOrgName);
          if (m.businessUnitId != null) orgIdToBu.set(oid, Number(m.businessUnitId));
          if (wantRole && m.businessUnitId != null && m.invOrgCode &&
              String(m.orgRole).toUpperCase() === wantRole) {
            buToDestCode.set(Number(m.businessUnitId), m.invOrgCode);
            buToDestOrg.set(Number(m.businessUnitId), {
              id:   oid,
              code: m.invOrgCode,
              name: m.invOrgName || ''
            });
          }
        });
      } else {
        console.warn('[request-detail confirmRequest] bu-org-mappings fetch not ok — org codes fall back to defaults');
      }
    } catch (e) {
      console.warn('[request-detail confirmRequest] bu-org-mappings fetch failed:', e);
    }

    // 2. Per line, group ACTIVE allocations by eqpInvOrgId with summed qty.
    const results = await Promise.all(lines.map(l =>
      Actions.callRest(context, {
        endpoint:  'eqp-v1/getAllocations',
        uriParams: { requestLineId: Number(l.line_id) }
      }).then(r => ({ lineId: Number(l.line_id), data: (r && r.ok && r.body && r.body.data) || [] }))
        .catch(() => ({ lineId: Number(l.line_id), data: [] }))
    ));

    // Line lookup so the unallocated branch below can read the line's qty.
    const lineById = new Map(lines.map(l => [Number(l.line_id), l]));

    results.forEach(r => {
      const active = r.data.filter(a =>
        (a.allocationStatus || '').toUpperCase() !== 'RELEASED' && !a.releasedDate);

      if (!active.length) {
        // NO ALLOCATION — the confirm-without-allocating flow. Fall back to the
        // Yard the manager picked in the toolbar, resolved through the SAME
        // bu-org-mappings lookup an allocated line uses, so both paths produce
        // an identical group shape (code + id + name for each end).
        //
        // Without a chosen yard we emit NOTHING: the caller then skips the line
        // and, if that leaves no line resolvable, refuses the confirm and tells
        // the manager to pick a yard. Guessing here is what previously shipped
        // equipment from the wrong place.
        if (fallbackOrgId == null) return;
        const fbCode = orgIdToCode.get(fallbackOrgId) || null;
        const fbBu   = orgIdToBu.get(fallbackOrgId);
        const fbDest = (wantRole && fbBu != null) ? (buToDestOrg.get(fbBu) || null) : null;
        // Both ends must resolve — a yard that isn't mapped to a BU (or whose BU
        // has no virtual org for this request type) can't produce a valid TO.
        if (!fbCode || !fbDest || !fbDest.code) return;
        const fbLine = lineById.get(r.lineId);
        groupsByLineId.set(r.lineId, [{
          // Marks this group as coming from the picked Yard rather than an
          // allocation. Drives ALLOCATION_METHOD = 'AUTO' on the line (the
          // system chose the units), vs 'MANUAL' when a person allocated them.
          fromFallbackYard: true,
          orgId:      fallbackOrgId,
          sourceCode: fbCode,
          sourceName: orgIdToName.get(fallbackOrgId) || null,
          destCode:   fbDest.code,
          destOrgId:  fbDest.id,
          destName:   fbDest.name,
          qty:        (fbLine && fbLine.qty) || 1
        }]);
        return;
      }

      // Sum qty per source org. null orgId (pre-fix) bucketed under a NaN key so
      // it stays a distinct "unknown" group that falls back to the default source.
      const NULL_KEY = 'null';
      const qtyByOrg = new Map();
      active.forEach(a => {
        const key = a.eqpInvOrgId != null ? Number(a.eqpInvOrgId) : NULL_KEY;
        qtyByOrg.set(key, (qtyByOrg.get(key) || 0) + Number(a.allocatedQty || 1));
      });

      const groups = [];
      qtyByOrg.forEach((qty, key) => {
        const orgId = key === NULL_KEY ? null : key;
        const sourceCode = orgId != null ? (orgIdToCode.get(orgId) || null) : null;
        const bu = orgId != null ? orgIdToBu.get(orgId) : null;
        const destCode = (wantRole && bu != null) ? (buToDestCode.get(bu) || null) : null;
        // Name/id for both ends, carried alongside the codes so the confirmed
        // yard pair can be written to the DB (which stores id + name + code)
        // without a second lookup.
        const sourceName = orgId != null ? (orgIdToName.get(orgId) || null) : null;
        const destOrg    = (wantRole && bu != null) ? (buToDestOrg.get(bu) || null) : null;
        groups.push({
          orgId, sourceCode, destCode, qty,
          sourceName: sourceName,
          destOrgId:  destOrg ? destOrg.id   : null,
          destName:   destOrg ? destOrg.name : null
        });
      });
      groupsByLineId.set(r.lineId, groups);
    });

    return groupsByLineId;
  }

  // ───────────────────────────────────────────────────────────────────────
  // RETURN LEG — resolve the (source, destination) org pair per line.
  //
  // A return is the outbound movement reversed: the equipment travels FROM the
  // virtual org it was delivered to, BACK TO the physical yard it came from. So
  // for each line:
  //
  //     return source      = outbound DESTINATION  (virtual org, '005'/'006')
  //     return destination = outbound SOURCE       (the yard, e.g. '001'/'002')
  //
  // Two resolution paths, in order of trustworthiness:
  //
  //   1. THE STORED ALLOCATION. Confirm now stamps SOURCE_ORG_CODE /
  //      DESTINATION_ORG_CODE onto EQR_ALLOCATION at the moment the outbound TO
  //      is created. When present these are the literal codes that were sent to
  //      OIC, so swapping them returns the equipment along exactly the path it
  //      travelled — no re-derivation, no drift if the BU mapping changed since.
  //
  //   2. THE STAMPED REQUEST LINE. Confirm also writes the same pair onto
  //      EQR_REQUEST_LINE — which is the ONLY record for a line confirmed
  //      WITHOUT allocating (picked-yard flow), since no allocation row exists
  //      to carry it. Read from /equipment-requests/{id}/lines, which exposes
  //      all six columns (views/request-detail-lines does not, but the grid is
  //      not what needs them here).
  //
  //   3. RE-DERIVED via buildLineYardGroups, for allocations stamped before any
  //      of this shipped. Same call the outbound makes: the line's own
  //      allocations give the yard, and destRole (VIRTUAL_PROJECT for INTERNAL,
  //      VIRTUAL_CUSTOMER for EXTERNAL — driven by the request's customer type)
  //      gives the virtual org. The result is inverted for the return.
  //
  // A line that resolves NEITHER end is returned with a null pair and the
  // caller SKIPS it, naming it in the message. There is deliberately no
  // '001'/'002' fallback: a hardcoded pair silently ships equipment to the
  // wrong yard, which is worse than refusing to create the Transfer Order.
  //
  // Returns Map<lineId, Array<{ sourceCode, destCode, qty }>> — an array
  // because a line allocated across two yards must return to both.
  async function buildLineReturnGroups(context, lines, destRole, requestId) {
    const out = new Map();

    // Allocation-stamped codes, keyed by line. One line can hold several
    // allocations; group them by their own (dest -> source) pair so a split
    // line yields one return group per yard it came from.
    const stamped = await Promise.all(lines.map(l =>
      Actions.callRest(context, {
        endpoint:  'eqp-v1/getAllocations',
        uriParams: { requestLineId: Number(l.line_id) }
      })
        .then(r => ({ lineId: Number(l.line_id), data: (r && r.ok && r.body && r.body.data) || [] }))
        .catch(() => ({ lineId: Number(l.line_id), data: [] }))
    ));

    const needsFallback = [];
    stamped.forEach(r => {
      const active = r.data.filter(a =>
        String(a.allocationStatus || '').toUpperCase() !== 'RELEASED' && !a.releasedDate);

      // Pair key is "returnSource|returnDest" = outbound dest -> outbound source.
      const byPair = new Map();
      active.forEach(a => {
        const retSrc  = a.destinationOrgCode || null;   // outbound destination
        const retDest = a.sourceOrgCode      || null;   // outbound source
        if (!retSrc || !retDest) return;                // not stamped — fall back
        const key = retSrc + '|' + retDest;
        const prev = byPair.get(key);
        const qty  = Number(a.allocatedQty || 1);
        if (prev) prev.qty += qty;
        else byPair.set(key, { sourceCode: retSrc, destCode: retDest, qty: qty });
      });

      if (byPair.size > 0) out.set(r.lineId, Array.from(byPair.values()));
      else needsFallback.push(r.lineId);
    });

    if (!needsFallback.length) return out;

    // Path 2 — the LINE's own stamp. This is the only record for a line
    // confirmed without allocating, so it must be consulted before re-deriving.
    // One fetch for the whole request rather than per line.
    try {
      const lineResp = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
        uriParams: { requestId: Number(requestId), size: 2000 }
      });
      const lineRows = (lineResp && lineResp.ok && lineResp.body && lineResp.body.data) || [];
      const stampByLineId = new Map(lineRows.map(r => [Number(r.id), r]));
      for (let i = needsFallback.length - 1; i >= 0; i--) {
        const lineId = needsFallback[i];
        const row = stampByLineId.get(lineId);
        // Same inversion as the allocation path: the line stores the OUTBOUND
        // pair, so the return travels destination -> source.
        if (row && row.destinationOrgCode && row.sourceOrgCode) {
          const l = lines.find(x => Number(x.line_id) === lineId);
          out.set(lineId, [{
            sourceCode: row.destinationOrgCode,
            destCode:   row.sourceOrgCode,
            qty:        (l && l.qty) || row.quantity || 1
          }]);
          needsFallback.splice(i, 1);
        }
      }
    } catch (e) {
      console.warn('[request-detail processReturn] line-stamp lookup failed, falling back to re-derivation', e);
    }

    if (!needsFallback.length) return out;

    // Path 3 — re-derive for the lines neither stamp covered.
    const fallbackLines = lines.filter(l => needsFallback.indexOf(Number(l.line_id)) !== -1);
    // NO fallback yard on the return leg (4th arg deliberately omitted). The
    // return must send equipment back to where it ACTUALLY came from; the
    // toolbar Yard is the manager's choice for a NEW outbound shipment and
    // would be a guess here. A line that resolves nothing is skipped and named
    // by the caller — for an unallocated line that shipped on a picked yard, the
    // allocation stamp written at confirm time is what makes the return
    // resolvable, which is exactly why that stamping exists.
    const outboundGroups = await buildLineYardGroups(context, fallbackLines, destRole);
    fallbackLines.forEach(l => {
      const groups = outboundGroups.get(Number(l.line_id)) || [];
      // INVERTED: outbound destCode becomes the return's source, and the
      // outbound sourceCode (the yard) becomes the return's destination.
      // Both ends must be resolvable — a group missing either is dropped, and
      // a line left with no groups is skipped by the caller.
      const usable = groups
        .filter(g => g.destCode && g.sourceCode)
        .map(g => ({ sourceCode: g.destCode, destCode: g.sourceCode, qty: g.qty }));
      if (usable.length) out.set(Number(l.line_id), usable);
    });

    return out;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Confirm Request: build the OIC supplyRequest payload from ALLOCATED
  // lines that are not yet on a Transfer Order, POST to OIC, stay on page.
  // OIC writes EQR_TRANSFER_ORDER asynchronously; user clicks Refresh to
  // see the TO # populate on each line.
  // ───────────────────────────────────────────────────────────────────────

  // TODO: Replace these placeholder values with real sources before production.
  // Origins discussed 2026-05-16: source/dest org codes are Fusion organization
  // codes; subinventory/UOM/preparer are demo constants pending business input.
  // Source/DestinationOrganizationCode are resolved dynamically PER SOURCE YARD
  // from each line's allocations (buildLineYardGroups): source = the yard's org
  // code; destination = the virtual org in that yard's BU keyed by request origin
  // (PROJECT → VIRTUAL_PROJECT '005', CUSTOMER → VIRTUAL_CUSTOMER '006'). Confirm
  // fires one createSupplyRequest per source yard → one TO per yard. The '001'/
  // '002' here are just the FALLBACKS when an allocation has no resolvable org
  // (or an unknown origin, for destination).
  const PAYLOAD_DEFAULTS = {
    InterfaceSourceCode:         'EXT',
    SupplyOrderSource:           'EXT',
    SupplyRequestStatus:         'NEW',
    ProcessRequestFlag:          'Y',
    // NO SourceOrganizationCode / DestinationOrganizationCode defaults.
    // Both org codes are resolved PER LINE from its own allocations — outbound
    // via buildLineYardGroups, return via buildLineReturnGroups. They used to
    // default to '001'/'002' (Seattle/Atlanta) whenever resolution failed, which
    // silently created a Transfer Order moving real equipment from a yard it was
    // never allocated in. A line that cannot resolve both ends is now skipped
    // and named instead. Do not reintroduce these keys.
    // FALLBACK only. The destination subinventory comes from the destination
    // org's BU Org Mapping (EQR_BU_ORG_MAPPING.SUBINVENTORY_CODE, see
    // loadSubinventoryByOrgCode); this is used while a mapping has none.
    DestinationSubinventoryCode: 'Stores',
    UOMCode:                     'zzu',
    BackToBackFlag:              'N',
    SupplyType:                  'TRANSFER',
    SupplyOperation:             'CREATE',
    DestinationTypeCode:         'INVENTORY',
    PreparerId:                  300000047340498,
    DeliverToRequesterId:        300000047340498,
    OrderType:                   'OUTBOUND',
  };

  // Destination subinventory per org CODE, from the BU Org Mapping
  // (Configurations → BU Org Mapping → Subinventory). Keyed by code because
  // every TO path (allocations, TO plan, toolbar fallback, return legs) ends in
  // a destCode, and Fusion inventory org codes are unique. Orgs with no
  // subinventory mapped are left out, so destSubinventory() falls back to
  // PAYLOAD_DEFAULTS. A failed fetch also falls back: it must not stop a TO.
  async function loadSubinventoryByOrgCode(context) {
    const byCode = new Map();
    try {
      const r = await Actions.callRest(context, { endpoint: 'eqp-v1/getBuOrgMappings' });
      ((r && r.ok && r.body && r.body.data) || []).forEach(m => {
        const sub = m && m.subinventoryCode ? String(m.subinventoryCode).trim() : '';
        if (m && m.invOrgCode && sub && m.isActiveFlag !== 'N') byCode.set(String(m.invOrgCode), sub);
      });
    } catch (e) {
      console.warn('[request-detail] subinventory lookup failed, using default:', e);
    }
    return byCode;
  }

  function destSubinventory(byCode, destCode) {
    const sub = destCode != null ? byCode.get(String(destCode)) : null;
    if (!sub) {
      console.warn('[request-detail] no subinventory mapped for org ' + destCode +
                   ', using ' + PAYLOAD_DEFAULTS.DestinationSubinventoryCode);
    }
    return sub || PAYLOAD_DEFAULTS.DestinationSubinventoryCode;
  }

  async function confirmRequest(context) {
    const { $page } = context;
    const requestId     = $page.variables.requestId;
    const requestNumber = $page.variables.requestNumber || '';

    // 1. Gather the SELECTED, currently-ALLOCATED lines from page state.
    // Confirm operates only on the lines the user ticked (button is enabled
    // only when ≥1 selected line is ALLOCATED and not yet on a TO), so a
    // mixed request can be confirmed in subsets without stranding the
    // unallocated lines.
    const allLines      = $page.variables.linesArray || [];
    const selectedIdx   = ($page.functions && typeof $page.functions.getSelectedRowIndexes === 'function')
      ? ($page.functions.getSelectedRowIndexes() || [])
      : [];
    const selectedLines = selectedIdx
      .map(i => allLines[i])
      .filter(Boolean);
    // Confirm-eligible = line lifecycle in CONFIRMABLE_LINE_STATUSES *and* not
    // already on a Transfer Order.
    //
    // MUST MIRROR the button gate in request-detail-page.js updateActionButtons
    // (CONFIRMABLE_LINE_STATUSES there) — if the two drift, the button enables
    // and then the click fails with "Cannot Confirm", or worse the reverse.
    //
    // Allocation is NOT a precondition: this used to also require
    // alloc_status === 'ALLOCATED', so only fully-allocated lines could be
    // confirmed. Confirm is now allowed from IN_PROCESS and QUOTE_ACCEPTED as
    // well, so the request can be sent onward before allocation finishes.
    // A line on the procurement track (UNDER_PROCUREMENT) is still excluded — it
    // is supplied by a PR/PO, not a yard transfer.
    //
    // A line is "already on a TO" if the server populated to_number OR we
    // optimistically locked it this session (a prior createSupplyRequest
    // succeeded but OIC hasn't written to_number back yet). The page module
    // owns that optimistic set — checking it here closes the async-window
    // duplicate: clicking Confirm twice before Refresh no longer double-fires.
    const CONFIRMABLE_LINE_STATUSES = ['ALLOCATED', 'QUOTE_ACCEPTED', 'IN_PROCESS'];
    const toInitiatedLocally = (l) =>
      !!(l && $page.functions &&
         typeof $page.functions.hasToInitiated === 'function' &&
         $page.functions.hasToInitiated(l.line_id));
    const hasToNum = (l) =>
      !!(l && l.to_number && String(l.to_number).trim() !== '') || toInitiatedLocally(l);
    // F&M LINES MUST BE FULLY ALLOCATED TO CONFIRM.
    //
    // Allocation is deliberately NOT a precondition for S&T (see the note
    // above): an S&T line can be confirmed straight from IN_PROCESS, and the
    // Yard picker supplies the source so the Transfer Order still knows where
    // the equipment ships from. The TO, and later the pick, are what pin down
    // the actual units.
    //
    // An F&M line has none of that. There is no Transfer Order, no yard
    // fallback and no picking step that could resolve WHICH asset is going out
    // — the allocation IS the only record of that. Confirming an unallocated
    // F&M line would commit the request to equipment nobody chose, and nothing
    // downstream would ever ask.
    //
    // So they must be allocated first, manually, on the line-detail page.
    // PARTIAL is not enough: half-allocated means some units are still
    // unidentified, and confirm has no later step to finish them.
    const isFAndMLine = (l) => !!l && rdl.isFAndM(l);
    const isAllocatedForFAndM = (l) =>
      String(l.alloc_status || '').toUpperCase() === 'ALLOCATED';

    // QUOTE-FIRST GATE — mirrors updateActionButtons in request-detail-page.js.
    // With quoting ON and no quote yet produced, a line must reach
    // QUOTE_ACCEPTED before it can be confirmed: confirming from IN_PROCESS
    // would create the Transfer Order and commit the equipment without the
    // customer ever accepting a price.
    //
    // Recomputed here rather than trusting the button's own flag, for the same
    // reason every other rule in this function is: the button is a hint, the
    // click is the decision. A deep-link, a stale page or a status that moved
    // since render must all be caught at click time.
    //
    // Same shape as the page module's isQuoteOwed(): quoting enabled for this
    // request's origin AND the header shows no quote yet.
    const quoteOwedNow = (() => {
      const v = ($page && $page.variables) || {};
      if (!v.quotingAllowed || !v.formData) return false;
      const st = String(v.formData.status || '').toUpperCase();
      return ['QUOTE_GENERATED', 'QUOTE_ACCEPTED', 'DEPLOYED'].indexOf(st) === -1;
    })();
    const isQuoteBlockedLine = (l) =>
      quoteOwedNow && String((l || {}).line_status || '').toUpperCase() === 'IN_PROCESS';

    const isConfirmableLine = (l) =>
      !!l &&
      CONFIRMABLE_LINE_STATUSES.indexOf(String(l.line_status || '').toUpperCase()) !== -1 &&
      !hasToNum(l) &&
      (!isFAndMLine(l) || isAllocatedForFAndM(l)) &&
      !isQuoteBlockedLine(l);

    // BLOCK-ALL (product decision — all-or-nothing over subset-confirm): if the
    // selection contains ANY line that is NOT confirmable, create NO Transfer
    // Order and name the offending lines. This is what stops a wrong-status line
    // (e.g. Purchase Request Raised) from being silently ignored while a sibling
    // line gets a TO.
    const blocking = selectedLines.filter(l => !isConfirmableLine(l));
    if (blocking.length) {
      const nameOf = (l) => 'Line ' + (l.line_no != null ? l.line_no : '?') +
                            ' — ' + (l.equipment_name || '?');

      // Separate the two reasons. An F&M line blocked purely for want of an
      // allocation is a DIFFERENT problem from a wrong-status line, and the
      // remedy is different too — allocate it, don't deselect it. Reporting
      // both as "not in a confirmable state" would send the user looking at
      // the status column, which is fine.
      const needAlloc = blocking.filter(l =>
        isFAndMLine(l) &&
        !isAllocatedForFAndM(l) &&
        CONFIRMABLE_LINE_STATUSES.indexOf(String(l.line_status || '').toUpperCase()) !== -1 &&
        !hasToNum(l));

      // Third reason, same rationale as splitting out needAlloc: a line held
      // back purely because the quote has not been produced yet is NOT a
      // wrong-status line, and the remedy is different — generate the quote and
      // get it accepted, don't deselect the line. Told to "deselect it and
      // retry", a manager would deselect every line on the request and be left
      // with nothing to confirm and no idea why.
      const needQuote = blocking.filter(l =>
        needAlloc.indexOf(l) === -1 && isQuoteBlockedLine(l) && !hasToNum(l));

      const otherBlocking = blocking.filter(l =>
        needAlloc.indexOf(l) === -1 && needQuote.indexOf(l) === -1);

      if (needAlloc.length) {
        const names = needAlloc.slice(0, 4).map(nameOf).join('; ');
        await safeNotify(context, {
          summary:     'Cannot Confirm',
          message:     (needAlloc.length === 1
                         ? 'This fixed-asset line must be allocated before it can be confirmed: '
                         : 'These fixed-asset lines must be allocated before they can be confirmed: ') +
                       names + (needAlloc.length > 4 ? ' …' : '') +
                       '. Fixed-asset equipment has no transfer order and no picking step, so the ' +
                       'allocation is the only record of which asset goes out — open the line and ' +
                       'assign it, then confirm.',
          type:        'error',
          displayMode: 'persist'
        });
        return;
      }

      if (needQuote.length) {
        const names = needQuote.slice(0, 4).map(nameOf).join('; ');
        await safeNotify(context, {
          summary:     'Quote Required',
          message:     (needQuote.length === 1
                         ? 'This line must be quoted and the quote accepted before it can be confirmed: '
                         : 'These lines must be quoted and the quote accepted before they can be confirmed: ') +
                       names + (needQuote.length > 4 ? ' …' : '') +
                       '. Quoting is enabled for this request, so confirming now would commit the ' +
                       'equipment before a price has been agreed — use Generate Quote first.',
          type:        'error',
          displayMode: 'persist'
        });
        return;
      }

      const names = otherBlocking.slice(0, 4).map(nameOf).join('; ');
      await safeNotify(context, {
        summary:     'Cannot Confirm',
        message:     (otherBlocking.length === 1 ? 'This selected line is' : 'These selected lines are') +
                     ' not in a confirmable, unconfirmed state: ' + names +
                     (otherBlocking.length > 4 ? ' …' : '') + '. Deselect ' +
                     (otherBlocking.length === 1 ? 'it' : 'them') + ' and retry.',
        type:        'error',
        displayMode: 'persist'
      });
      return;
    }

    const allocated = selectedLines.filter(isConfirmableLine);
    if (!allocated.length) {
      await safeNotify(context, {
        summary:     'Cannot Confirm',
        message:     'Select one or more confirmable lines (Allocated, Quote Accepted or In Process) to confirm.',
        type:        'error',
        displayMode: 'persist'
      });
      return;
    }

    // 2. Fetch existing TOs + their lines to know which requestLineIds are already covered
    const alreadyOnTO = new Set();
    try {
      const toListResp = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getTransferOrders',
        uriParams: { equipmentRequestId: Number(requestId) }
      });
      if (toListResp && toListResp.ok) {
        const tos = toListResp.body.data || [];
        const toLineFetches = await Promise.all(
          tos.map(t => Actions.callRest(context, {
            endpoint:  'eqp-v1/getTransferOrderLines',
            uriParams: { transferOrderId: Number(t.id) }
          }).catch(() => null))
        );
        toLineFetches.forEach(resp => {
          if (!resp || !resp.ok) return;
          (resp.body.data || []).forEach(tl => {
            if (tl.requestLineId != null) alreadyOnTO.add(tl.requestLineId);
          });
        });
      }
    } catch (e) {
      console.warn('[request-detail confirmRequest] failed to load existing TOs:', e);
    }

    const eligible = allocated.filter(l => !alreadyOnTO.has(l.line_id));
    if (!eligible.length) {
      await safeNotify(context, {
        summary:     'Nothing to Confirm',
        message:     'All allocated lines are already on a Transfer Order.',
        type:        'info',
        displayMode: 'transient'
      });
      return;
    }

    // 3. Build equipmentMasterId -> equipmentNumber lookup from the BASE
    // /equipment-master endpoint. EquipmentDto carries `equipmentNumber`
    // even though the OpenAPI spec doesn't declare it (spec-drift —
    // confirmed 2026-06-09). This replaces the fragile name-bridge through
    // views/equipment-master, which was missing rows whose equipment
    // master had no equipmentNumber in the view's projection.
    //
    // We use the base endpoint with a high size cap and key by `id`. The
    // lines on the page already carry `equipment_master_id` (= EquipmentDto.id)
    // from vbEnterChain — so this is a true ID join, no string matching.
    // NOTE: still fetched even when /plan is authoritative. payloadLines is
    // built below - before /plan is called - and needs itemNumber to decide
    // which lines are skippable, and /plan needs that same eligible set as its
    // input. Removing this fetch means moving the whole payloadLines/F&M split
    // to after /plan, which is a larger change than this one; the remaining
    // saving (the per-line getAllocations loop) is the bigger half and is
    // already taken.
    const masterIdToItemNumber = await buildMasterIdToItemNumberMap(context, eligible);

    // ══ /plan CROSS-CHECK (SHADOW MODE) ════════════════════════════════
    // The package resolves the SAME buckets this function is about to resolve
    // client-side — eligibility, yard grouping, item numbers, the F&M split. Ask
    // it, and log any disagreement.
    //
    // DELIBERATELY NOT AUTHORITATIVE YET. Switching the client to trust /plan
    // means deleting ~800 lines of resolution logic whose rules are load-bearing
    // and, in several places, subtle (the block-all precedence, the no-guess yard
    // rule, the F&M-only-is-success case). Running both first turns that from a
    // leap into an evidence-based step: if the console shows no disagreement
    // across real confirms, the swap is safe. If it shows disagreement, we found
    // a bug before it shipped rather than after.
    //
    // Cheap: one call replacing nothing. Never blocks — a /plan outage must not
    // stop a confirm that the existing path can complete unaided.
    // == SERVER-SIDE PLAN - authoritative when it answers =====================
    // EQR_TRANSFER_ORDER_PKG resolves eligibility, yard grouping, item numbers
    // and the S&T/F&M split in ONE call - replacing a per-line getAllocations
    // loop, a 2000-row equipment-master fetch and the TO-dedupe fetches.
    //
    // WHY IT IS TRUSTED NOW: it ran in shadow mode across three real confirms
    // (requests 1000001524, 1000001544, 1000001545) and agreed with the client
    // every time - same buckets, same source/dest pairs, same line sets, same
    // F&M split. The one divergence found was on block-all for a mixed
    // selection, and that turned out to be a CLIENT bug (a line was being
    // silently dropped and left at IN_PROCESS). The client now blocks too, so
    // the two agree by design rather than by coincidence.
    //
    // FALLS BACK, NEVER FAILS: any non-OK response or throw leaves planBuckets
    // null and the original client-side resolution below runs unchanged. An
    // outage of the faster path must not become an outage of confirm.
    let planBuckets = null;   // non-null => authoritative, skip client resolution
    let planFmIds   = null;
    if (USE_SERVER_PLAN) {
      try {
        const planResp = await Actions.callRest(context, {
          endpoint:  'eqp-v1/planConfirm',
          uriParams: { requestId: Number(requestId) },
          body: {
            lineIds:           eligible.map(l => Number(l.line_id)),
            fallbackYardOrgId: ($page.variables.selectedYard != null &&
                                $page.variables.selectedYard !== '')
                                 ? Number($page.variables.selectedYard) : null
          }
        });
        if (planResp && planResp.ok) {
          const pb = planResp.body || {};
          const blocks = pb.blocks || [];

          // BLOCK-ALL. Any unconfirmable line refuses the WHOLE confirm.
          // Reported by reason, because the remedies differ - "allocate it" and
          // "deselect it" send a manager to different screens, and giving the
          // wrong one is worse than giving none.
          if (blocks.length) {
            const REASON_TEXT = {
              NEEDS_ALLOCATION: 'must be allocated first - fixed-asset equipment has no transfer ' +
                                'order and no picking step, so the allocation is the only record ' +
                                'of which asset goes out',
              NEEDS_QUOTE:      'must be quoted and the quote accepted first - confirming now would ' +
                                'commit the equipment before a price has been agreed',
              NO_YARD:          'has no allocation, so nothing tells us which yard it ships FROM - ' +
                                'choose a Yard in the picker above, or allocate the line',
              NO_ITEM_NUMBER:   'has no equipmentNumber on its equipment master, so it cannot be ' +
                                'transferred',
              ALREADY_RESERVED: 'is being confirmed by another user right now',
              NOT_CONFIRMABLE:  'is not in a confirmable, unconfirmed state'
            };
            // One reason at a time, most actionable first - a list mixing three
            // different remedies is harder to act on than one clear instruction.
            const ORDER = ['NEEDS_ALLOCATION', 'NEEDS_QUOTE', 'NO_YARD',
                           'NO_ITEM_NUMBER', 'ALREADY_RESERVED', 'NOT_CONFIRMABLE'];
            let picked = null;
            for (let bi = 0; bi < ORDER.length && !picked; bi++) {
              const g = blocks.filter(b => b.reasonCode === ORDER[bi]);
              if (g.length) picked = { code: ORDER[bi], rows: g };
            }
            if (!picked) picked = { code: 'NOT_CONFIRMABLE', rows: blocks };

            const names = picked.rows.slice(0, 4).map(b =>
              'Line ' + (b.lineNumber != null ? b.lineNumber : '?') +
              ' - ' + (b.equipmentName || '?')).join('; ');
            const many = picked.rows.length !== 1;

            await safeNotify(context, {
              summary:     picked.code === 'NO_YARD'          ? 'Select a Yard'
                         : picked.code === 'NEEDS_QUOTE'      ? 'Quote Required'
                         : picked.code === 'ALREADY_RESERVED' ? 'Lines In Use'
                         :                                      'Cannot Confirm',
              message:     (many ? 'These lines ' : 'This line ') +
                           (REASON_TEXT[picked.code] || REASON_TEXT.NOT_CONFIRMABLE) + ': ' +
                           names + (picked.rows.length > 4 ? ' ...' : '') +
                           '. NO Transfer Orders were created.',
              type:        'error',
              displayMode: 'persist'
            });
            return;
          }

          planBuckets = pb.buckets || [];
          planFmIds   = pb.fAndMLineIds || [];
          console.log('[request-detail confirmRequest] /plan authoritative:',
            planBuckets.length, 'bucket(s),', planFmIds.length, 'F&M line(s)');
        } else {
          console.warn('[request-detail confirmRequest] /plan not ok (HTTP ' +
                       (planResp && planResp.status) + ') - resolving client-side');
        }
      } catch (e) {
        console.warn('[request-detail confirmRequest] /plan threw - resolving client-side:', e);
      }
    }

    // 5. Skip lines missing equipmentNumber.
    //
    // S&T ONLY. equipmentNumber becomes the ItemNumber on the createSupplyRequest
    // payload, so an S&T line without one cannot be transferred and must be
    // skipped. An F&M line never reaches that payload (it creates no Transfer
    // Order — see 5c below), so requiring the number of it would drop it from
    // the confirm entirely and leave it stuck at IN_PROCESS for a field its
    // pathway never uses.
    //
    // Every F&M master in paasdev happens to carry an equipmentNumber today, so
    // this changes nothing right now — but an F&M item is by definition not a
    // Fusion inventory item, so the first one seeded without a number would
    // otherwise silently vanish from confirm.
    const payloadLines = [];
    const skippedLines = [];
    eligible.forEach(l => {
      const itemNumber = masterIdToItemNumber.get(Number(l.equipment_master_id));
      if (!itemNumber && !rdl.isFAndM(l)) {
        skippedLines.push('Line ' + l.line_no + ' (' + (l.equipment_name || '?') + ')');
        return;
      }
      payloadLines.push({ line: l, itemNumber: itemNumber });
    });

    // Same block-all rule as the yard guard below: a line missing its item number
    // cannot be transferred, so confirm NOTHING rather than shipping its siblings
    // and leaving it behind at IN_PROCESS with only a toast clause to show for it.
    // This branch used to fire only when EVERY line was missing one.
    if (skippedLines.length && payloadLines.length) {
      await safeNotify(context, {
        summary:     'Cannot Confirm',
        message:     (skippedLines.length === 1
                       ? 'This line has no equipmentNumber on its equipment master, so it cannot be ' +
                         'transferred: '
                       : 'These lines have no equipmentNumber on their equipment master, so they cannot ' +
                         'be transferred: ') +
                     skippedLines.slice(0, 4).join('; ') +
                     (skippedLines.length > 4 ? ' …' : '') +
                     '. Set equipmentNumber on the master record(s) and confirm again, or deselect ' +
                     (skippedLines.length === 1 ? 'the line' : 'those lines') +
                     '. NO Transfer Orders were created.',
        type:        'error',
        displayMode: 'persist'
      });
      return;
    }

    if (!payloadLines.length) {
      const sampleNames = skippedLines.slice(0, 3).join('; ');
      await safeNotify(context, {
        summary:     'Cannot Confirm',
        message:     'None of the eligible lines have an equipmentNumber on their equipment master. ' +
                     'Set equipmentNumber on the master record(s) and retry. Skipped: ' + sampleNames +
                     (skippedLines.length > 3 ? ' …' : ''),
        type:        'error',
        displayMode: 'persist'
      });
      return;
    }

    // 5b. Destination virtual-org role is driven by request ORIGIN.
    // formData.source is 'INTERNAL' | 'EXTERNAL' (formerly 'PROJECT' |
    // 'CUSTOMER'):
    //   INTERNAL → VIRTUAL_PROJECT  org in the source org's BU
    //   EXTERNAL → VIRTUAL_CUSTOMER org in the source org's BU
    // The virtual-org ROLE names are unchanged — only the request-origin
    // vocabulary moved — so the mapping is renamed on the input side only.
    // A blank origin still yields no destRole and the destination stays the
    // legacy default; resolving it through the app-flow owner (which accepts
    // both spellings) is what stops the vocabulary switch from silently
    // routing every Transfer Order to that default.
    const originSource = String(($page.variables.formData && $page.variables.formData.source) || '').toUpperCase();
    const destRole = !originSource
      ? null
      : (context.$application.functions.isExternalSource(originSource)
          ? 'VIRTUAL_CUSTOMER'
          : 'VIRTUAL_PROJECT');

    // ── 5c. Split S&T from F&M ──────────────────────────────────────────────
    // F&M (Fixed-asset / Maintenance tracked, isTransactable='N') lines are NOT
    // Fusion inventory items: there is no on-hand and no inventory transaction
    // to make, so a Transfer Order is meaningless for them. They are fulfilled
    // by direct assignment instead.
    //
    // They must be removed BEFORE yard grouping, not filtered later, because
    // every step below assumes a TO is coming:
    //   - buildLineYardGroups would try to resolve a source/dest org pair;
    //   - a line with no usable pair lands in unresolvedOutLines and, if that
    //     empties bySource, aborts the WHOLE confirm with "Select a Yard first"
    //     — so a single F&M line could block its S&T siblings from shipping.
    //
    // A mixed request is the expected case: S&T lines still get their TOs,
    // F&M lines are promoted alongside them (step 7b), and neither blocks the
    // other.
    //
    // classOfLine() from resources/js/requestDetailLines is the single owner of
    // this test — the same one the allocation gates use — so confirm cannot
    // disagree with the rest of the page about what F&M means. It fails to S&T
    // when isTransactable is absent, so a payload without the field behaves
    // exactly as it does today.
    // F&M set: from /plan when it answered, so ONE resolver decides the class.
    // rdl.isFAndM reads isTransactable off the grid row; the package reads
    // IS_TRANSACTABLE off the master. They agree today, but only one of them can
    // be the authority - and if /plan is deciding the buckets it must decide the
    // split too, or a line could fall into neither set and be silently dropped.
    const fAndMEntries = planFmIds
      ? payloadLines.filter(e => planFmIds.indexOf(Number(e.line.line_id)) !== -1)
      : payloadLines.filter(e => rdl.isFAndM(e.line));
    // Strict complement of fAndMEntries - NOT an independent isFAndM() test.
    // If the two tests ever disagreed, an independent filter would put a line in
    // both sets (double-confirmed) or neither (silently dropped). Deriving one
    // from the other makes that impossible by construction.
    const fmIdSet = new Set(fAndMEntries.map(e => Number(e.line.line_id)));
    const sAndTEntries = payloadLines.filter(e => !fmIdSet.has(Number(e.line.line_id)));
    if (fAndMEntries.length) {
      console.log('[request-detail confirmRequest] F&M lines excluded from Transfer Order creation:',
        fAndMEntries.map(e => e.line.line_id));
    }

    // Group each eligible line's active allocations by SOURCE YARD (see
    // buildLineYardGroups). A line whose units span two yards yields two groups.
    // 4th arg: the Yard picked in the toolbar, the SOURCE for lines that were
    // never allocated (confirm-without-allocating). Ignored for allocated lines.
    // S&T ONLY — F&M lines never reach the yard resolver.
    // Skipped entirely when /plan answered: this is one getAllocations call PER
    // LINE plus a bu-org-mappings fetch, and the package already did that work
    // as a single set-based query. This is where most of the round-trip saving
    // comes from - a 40-line request drops from ~40 calls here to zero.
    const groupsByLineId = planBuckets
      ? new Map()
      : await buildLineYardGroups(
          context, sAndTEntries.map(e => e.line), destRole,
          $page.variables.selectedYard
        );

    // 6. Bucket the per-(line, yard) supply-request lines BY the source code that
    // will actually be sent (resolved yard code, or the legacy default when the
    // allocation has no resolvable org). One bucket → one createSupplyRequest →
    // one Transfer Order. So a line allocated across Seattle + Atlanta produces
    // two buckets → two TOs, each sourced from its own yard.
    const nowIso = new Date().toISOString();
    const needByIso =
      ($page.variables.formData && $page.variables.formData.end_date)
        ? new Date($page.variables.formData.end_date + 'T23:59:59.000Z').toISOString()
        : nowIso;
    // LAYER 1 — DETERMINISTIC IDEMPOTENCY KEY.
    //
    // 🔴 Date.now() IS WHY THE FIVE DUPLICATES EXIST. The batch number was the
    // only identity travelling with the request, and stamping it with a clock made
    // every fire unique BY CONSTRUCTION — five clicks produced five distinct batch
    // numbers, so nothing downstream (not OIC, not the EQR_TO_LINE dedupe) could
    // recognise them as the same intent. Visible in paasdev: request line
    // 1000001816, five Transfer Orders, batch stamps 1786445600904 through
    // 1786445603532, all from yard '001', 2.6 seconds apart.
    //
    // The key below is a pure function of the INTENT and contains no clock. Fire
    // the same selection five times and you get one key five times.
    //
    // The KEY identifies the intent; the BATCH NUMBER keeps its existing shape
    // because OIC, EQR_TRANSFER_ORDER.SUPPLY_REQUEST_NUMBER and every downstream
    // match already depend on that format.
    //
    // Consumed by EQR_TRANSFER_ORDER_PKG.reserve_confirm(p_idempotency_key), whose
    // EQR_TO_RESV_IDEM_UK unique index makes a replay fail at the DATABASE rather
    // than in a browser tab — holding across tabs, users and sessions, which no
    // client-side guard can do. Until the Java /reserve endpoint is wired (spec
    // §6.2) this key is computed and logged but not yet sent; the re-entrancy
    // guard in the confirm dispatch is what protects the single-tab case today.
    const confirmIdempotencyKey = buildIdempotencyKey({
      requestId: requestId,
      lineIds:   payloadLines.map(e => Number(e.line.line_id)),
      leg:       'OUTBOUND'
    });
    console.log('[request-detail confirmRequest] idempotency key', confirmIdempotencyKey,
                'for', payloadLines.length, 'line(s)');

    const baseBatch = 'EQR-' + (requestNumber || requestId) + '-' + Date.now();

    // Bucket by SOURCE YARD. Both org codes must be resolved from the line's own
    // allocations — there is deliberately NO '001'/'002' fallback.
    //
    // This used to substitute PAYLOAD_DEFAULTS whenever a code could not be
    // resolved, and to invent an empty group for a line with no allocations at
    // all. Both were silent: the Transfer Order was created and looked healthy,
    // but moved real equipment from a yard it was never allocated in, to a
    // destination nobody chose. Refusing to create the TO is the safer failure —
    // it is visible, and the manager can fix the allocation and retry.
    const bySource = new Map(); // sourceCode -> [{ entry, qty, srcCode, destCode, ... }]

    // Declared HERE, not inside the client-side branch below, because the guard
    // after the if/else reads it on BOTH paths. Scoping it to the else made the
    // whole confirm die with a ReferenceError the moment /plan answered - the
    // buckets were resolved, no blocks were reported, and then nothing at all
    // happened. Empty on the /plan path by construction: the package reports an
    // unresolvable line as a NO_YARD block, which has already returned above.
    const unresolvedOutLines = [];

    // == USE THE SERVER'S BUCKETS WHEN /plan ANSWERED =========================
    // Shape them into exactly what the loop below already consumes, so the OIC
    // payload build, the reserve/record calls and the notifications are
    // identical whichever path produced them. Only the RESOLUTION moves.
    //
    // entry.line is looked up from the page rows by requestLineId: the payload
    // needs line_id and qty, and the notifications need line_no and
    // equipment_name. /plan returns lineNumber and equipmentName too, so a line
    // missing from the grid still yields a usable label rather than '?'.
    if (planBuckets) {
      const lineById = new Map(eligible.map(l => [Number(l.line_id), l]));
      planBuckets.forEach(b => {
        const items = (b.lines || []).map(pl => {
          const row = lineById.get(Number(pl.requestLineId)) || {
            line_id: pl.requestLineId, line_no: pl.lineNumber,
            equipment_name: pl.equipmentName, qty: pl.qty
          };
          return {
            entry: { line: row, itemNumber: pl.itemNumber },
            qty: pl.qty, srcCode: b.sourceOrgCode, destCode: b.destOrgCode,
            srcOrgId: b.sourceOrgId != null ? Number(b.sourceOrgId) : null,
            srcOrgName: b.sourceOrgName || null,
            destOrgId: b.destOrgId != null ? Number(b.destOrgId) : null,
            destOrgName: b.destOrgName || null,
            fromFallbackYard: b.fromFallbackYard === true
          };
        });
        if (items.length) bySource.set(b.sourceOrgCode, items);
      });
    } else {
    sAndTEntries.forEach(entry => {
      const groups = groupsByLineId.get(Number(entry.line.line_id)) || [];
      const usable = groups.filter(g => g.sourceCode && g.destCode);
      if (!usable.length) {
        unresolvedOutLines.push('Line ' + entry.line.line_no + ' (' + (entry.line.equipment_name || '?') + ')');
        return;
      }
      usable.forEach(g => {
        const srcCode  = g.sourceCode;
        const destCode = g.destCode;
        if (!bySource.has(srcCode)) bySource.set(srcCode, []);
        bySource.get(srcCode).push({
          entry: entry, qty: g.qty, srcCode: srcCode, destCode: destCode,
          // Yard identity for persistence (see the stamping step after each
          // successful createSupplyRequest). Now always populated, since a group
          // missing either end no longer reaches this point.
          srcOrgId:   g.orgId != null ? Number(g.orgId) : null,
          srcOrgName: g.sourceName || null,
          destOrgId:  g.destOrgId != null ? Number(g.destOrgId) : null,
          destOrgName: g.destName || null,
          // true when the source came from the picked Yard (no allocation) —
          // see ALLOCATION_METHOD stamping below.
          fromFallbackYard: g.fromFallbackYard === true
        });
      });
    });
    } // end client-side bucketing (used only when /plan did not answer)

    // An F&M-ONLY confirm legitimately produces no buckets — there is no TO to
    // create. That is success, not the "no yard resolved" failure below, so it
    // must not fall into that branch and abort with "Select a Yard first".
    // Skip straight to the F&M promotion step.
    const fAndMOnly = !bySource.size && fAndMEntries.length > 0 && !sAndTEntries.length;

    // ══ NO LINE IS SILENTLY DROPPED ═════════════════════════════════
    // If ANY selected line could not be resolved, confirm NOTHING and say which
    // line and why. This is §4.3 block-all, and it is what the package's /plan
    // already does — the two now agree.
    //
    // THE BUG THIS FIXES (observed 2026-09-07, request 1000001545): three lines
    // selected, two allocated and one not, no Yard picked. The two allocated
    // lines got Transfer Orders; the third was pushed onto unresolvedOutLines
    // and RETURNED past — no bucket, no payload, no OIC call, no status change.
    // It sat at IN_PROCESS looking untouched, and the only trace was a clause
    // appended to a transient success toast. The manager reasonably read that as
    // "all three confirmed".
    //
    // The old guard below only fired when bySource was COMPLETELY empty, so a
    // mixed selection — the common case — slipped straight through it.
    //
    // Refusing the whole confirm is deliberate. The remedy (pick a Yard, or
    // allocate the line) applies to the line the manager already selected, and
    // asking BEFORE creating Transfer Orders is cheap; asking after means
    // reconciling a partially shipped request in Fusion.
    if (unresolvedOutLines.length && bySource.size) {
      const noYardPickedMixed = $page.variables.selectedYard == null || $page.variables.selectedYard === '';
      await safeNotify(context, {
        summary:     'Select a Yard',
        message:     (unresolvedOutLines.length === 1
                       ? 'This line has no allocation, so nothing tells us which yard it ships FROM: '
                       : 'These lines have no allocation, so nothing tells us which yard they ship FROM: ') +
                     unresolvedOutLines.slice(0, 4).join('; ') +
                     (unresolvedOutLines.length > 4 ? ' …' : '') + '. ' +
                     (noYardPickedMixed
                       ? 'Choose a Yard in the picker above and confirm again, or allocate '
                       : 'The selected Yard does not map to a business unit with a virtual org for ' +
                         'this request type (Configuration Settings → BU & Org Mapping). Fix that, or allocate ') +
                     (unresolvedOutLines.length === 1 ? 'the line' : 'the lines') +
                     ' first. NO Transfer Orders were created — the other selected line(s) are ' +
                     'untouched and can be confirmed once this is resolved.',
        type:        'error',
        displayMode: 'persist'
      });
      return;
    }

    if (!bySource.size && !fAndMOnly) {
      // The most common cause by far is the confirm-without-allocating flow with
      // no Yard picked, so lead with that remedy — it is the one the manager can
      // act on immediately, and it is a control on this very page.
      const noYardPicked = $page.variables.selectedYard == null || $page.variables.selectedYard === '';
      await safeNotify(context, {
        summary:     'Cannot Confirm',
        message:     noYardPicked
          ? 'Select a Yard first. These line(s) have no allocation, so there is nothing to tell us ' +
            'which yard the equipment ships FROM — choose one in the Yard picker above and confirm ' +
            'again. (Allocated lines take their source yard from the allocation and are unaffected.) ' +
            'Affected: ' + unresolvedOutLines.slice(0, 3).join('; ') +
            (unresolvedOutLines.length > 3 ? ' …' : '')
          : 'Could not determine the source and destination yards for the selected line(s), so no ' +
            'Transfer Order was created. The selected Yard must map to a business unit — and that ' +
            'business unit must have a virtual org for this request type — in Configuration ' +
            'Settings → BU & Org Mapping. Unresolved: ' + unresolvedOutLines.slice(0, 3).join('; ') +
            (unresolvedOutLines.length > 3 ? ' …' : ''),
        type:        'error',
        displayMode: 'persist'
      });
      return;
    }

    // ── 6b. RESERVE, PER BUCKET, BEFORE ANY OIC CALL ──────────────────────
    // This is what actually closes the duplicate-Transfer-Order bug. The
    // idempotency key travels to EQR_TRANSFER_ORDER_PKG.reserve_confirm, whose
    // EQR_TO_RESV_IDEM_UK unique index rejects a replay AT THE DATABASE — so it
    // holds across tabs, users and sessions, which no client-side guard can.
    //
    // Reserved PER BUCKET, not once for the whole confirm: each bucket is its
    // own Transfer Order with its own batch number, and bucket 2 must still be
    // creatable if bucket 1's OIC call fails.
    //
    // The key is per-bucket too (sourceCode included), because two yards on one
    // confirm are two DIFFERENT intents — a single shared key would make the
    // second bucket look like a replay of the first and silently drop it.
    const reserveBucket = async (srcCode, items, batchNumber) => {
      const lineIds = items.map(it => Number(it.entry.line.line_id));
      const key = buildIdempotencyKey({
        requestId:  requestId,
        lineIds:    lineIds,
        leg:        'OUTBOUND',
        sourceCode: srcCode,
        // Non-zero on a retry, so /reserve sees a NEW intent rather than a replay.
        attempt:    attemptFor(items.map(it => it.entry.line))
      });
      try {
        const r = await Actions.callRest(context, {
          endpoint:  'eqp-v1/reserveConfirm',
          uriParams: { requestId: Number(requestId) },
          headers:   cu.auditHeaders(context),
          body:      { lineIds: lineIds, batchNumber: batchNumber,
                       idempotencyKey: key, leg: 'OUTBOUND' }
        });
        if (!r || !r.ok) {
          // Reserve is a guard, not the work. If it is unreachable we do NOT
          // block the confirm — that would make an outage of a safety net look
          // to the user like an outage of the feature. Degrade to the previous
          // behaviour and say so in the log.
          console.warn('[request-detail confirmRequest] reserve not ok for ' + srcCode +
                       ' (HTTP ' + (r && r.status) + ') — proceeding unreserved');
          return { proceed: true, reserved: lineIds, replayed: false, degraded: true };
        }
        const b = r.body || {};
        return {
          proceed:  b.replayed !== true && (b.reservedLineIds || []).length > 0,
          reserved: b.reservedLineIds || [],
          rejected: b.rejectedLineIds || [],
          replayed: b.replayed === true
        };
      } catch (e) {
        console.warn('[request-detail confirmRequest] reserve threw for ' + srcCode +
                     ' — proceeding unreserved:', e);
        return { proceed: true, reserved: lineIds, replayed: false, degraded: true };
      }
    };

    // 7. Fire ONE createSupplyRequest per source yard — each yields one TO. The
    // integration records one EQR TO header per call (it does not split by
    // source), so this per-yard fan-out is what produces multiple TOs.
    let successCount = 0;
    let replayedCount = 0;
    let rejectedCount = 0;
    const failures = [];
    const subinvByOrgCode = await loadSubinventoryByOrgCode(context);
    for (const [srcCode, items] of bySource) {
      const batchNumber = baseBatch + '-' + srcCode;

      const resv = await reserveBucket(srcCode, items, batchNumber);
      if (resv.replayed) {
        // THIS EXACT INTENT WAS ALREADY RECORDED. Success, not failure — the
        // Transfer Order exists (or is in flight) from the first fire. Create
        // nothing. This is what collapses a repeat-fire into one TO.
        replayedCount++;
        console.log('[request-detail confirmRequest] bucket ' + srcCode +
                    ' replayed — already recorded, creating nothing');
        continue;
      }
      if (!resv.proceed) {
        // Held by a concurrent confirm (another tab, another manager). Not a
        // replay and not our TO to create.
        rejectedCount += (resv.rejected || []).length;
        console.warn('[request-detail confirmRequest] bucket ' + srcCode +
                     ' rejected — lines held by another confirm:', resv.rejected);
        continue;
      }
      let refLine = 0;
      const body = {
        InterfaceSourceCode:        PAYLOAD_DEFAULTS.InterfaceSourceCode,
        InterfaceBatchNumber:       batchNumber,
        SupplyRequestStatus:        PAYLOAD_DEFAULTS.SupplyRequestStatus,
        SupplyRequestDate:          nowIso,
        SupplyOrderSource:          PAYLOAD_DEFAULTS.SupplyOrderSource,
        SupplyOrderReferenceNumber: batchNumber,
        SupplyOrderReferenceId:     null,
        ProcessRequestFlag:         PAYLOAD_DEFAULTS.ProcessRequestFlag,
        equipmentRequestId:         Number(requestId),
        OrderType:                  PAYLOAD_DEFAULTS.OrderType,
        supplyRequestLines: items.map(item => {
          refLine++;
          return {
            InterfaceBatchNumber:           batchNumber,
            InterfaceSourceCode:            PAYLOAD_DEFAULTS.InterfaceSourceCode,
            SupplyOrderSource:              PAYLOAD_DEFAULTS.SupplyOrderSource,
            SupplyOrderReferenceLineNumber: String(refLine),
            SupplyOrderReferenceLineId:     refLine,
            SourceOrganizationCode:         item.srcCode,
            DestinationOrganizationCode:    item.destCode,
            DestinationSubinventoryCode:    destSubinventory(subinvByOrgCode, item.destCode),
            ItemNumber:                     item.entry.itemNumber,
            Quantity:                       item.qty || 1,
            UOMCode:                        PAYLOAD_DEFAULTS.UOMCode,
            BackToBackFlag:                 PAYLOAD_DEFAULTS.BackToBackFlag,
            NeedByDate:                     needByIso,
            PreparerId:                     PAYLOAD_DEFAULTS.PreparerId,
            DeliverToRequesterId:           PAYLOAD_DEFAULTS.DeliverToRequesterId,
            SupplyType:                     PAYLOAD_DEFAULTS.SupplyType,
            SupplyOperation:                PAYLOAD_DEFAULTS.SupplyOperation,
            DestinationTypeCode:            PAYLOAD_DEFAULTS.DestinationTypeCode,
            requestLineId:                  Number(item.entry.line.line_id),
          };
        })
      };

      let oicResp;
      try {
        oicResp = await Actions.callRest(context, {
          endpoint: 'ics/createSupplyRequest',
          body:     body
        });
      } catch (e) {
        console.error('[request-detail confirmRequest] createSupplyRequest failed for source ' + srcCode + ':', e);
        failures.push('Yard ' + srcCode + ' — network error');
        await releaseReservation(context, requestId, batchNumber);
        continue;
      }
      if (!oicResp || !oicResp.ok) {
        const serverMsg =
              (oicResp && oicResp.body && oicResp.body.message) ||
              (oicResp && oicResp.body && JSON.stringify(oicResp.body));
        console.error('[request-detail confirmRequest] createSupplyRequest non-OK for source ' + srcCode + ':', oicResp && oicResp.status);
        failures.push('Yard ' + srcCode + ' — ' +
          (serverMsg ? ('HTTP ' + oicResp.status + ': ' + serverMsg) : ('HTTP ' + (oicResp && oicResp.status))));
        await releaseReservation(context, requestId, batchNumber);
        continue;
      }
      successCount++;
      // Optimistic lock — the instant this TO request is accepted, mark every
      // line in the bucket so the Confirm button disables for them right away,
      // without waiting for OIC to write to_number back on the next Refresh.
      // This is what actually stops a second click from creating a duplicate TO.
      if ($page.functions && typeof $page.functions.markToInitiated === 'function') {
        $page.functions.markToInitiated(items.map(it => Number(it.entry.line.line_id)));
      }

      // ══ WRITE-BACK ════════════════════════════════════════════
      // Server-side and transactional when available; the original per-line and
      // per-allocation PATCH loops otherwise. See USE_SERVER_RECORD.
      let recordedServerSide = false;
      if (USE_SERVER_RECORD) {
        recordedServerSide = await recordConfirmBucket(context, requestId, batchNumber, items);
        if (recordedServerSide) {
          // The server stamped and promoted in one transaction. Mirror onto the
          // in-memory rows so the grid updates without a reload — the same
          // mirroring the legacy path does after its PATCHes, and required for
          // the same reason: updateActionButtons reads line_status off these rows.
          const PROMOTE_FROM_SRV = ['IN_PROCESS', 'QUOTE_ACCEPTED', 'ALLOCATED'];
          const byId = new Map();
          items.forEach(it => {
            const id = Number(it.entry.line.line_id);
            if (!byId.has(id)) byId.set(id, it);
          });
          if (Array.isArray($page.variables.linesArray)) {
            $page.variables.linesArray = $page.variables.linesArray.map(l => {
              const it = l && byId.get(Number(l.line_id));
              if (!it) return l;
              const patch = {
                source_inv_org_id:    it.srcOrgId,
                source_org_code:      it.srcCode,
                dest_inv_org_id:      it.destOrgId,
                destination_org_code: it.destCode,
                allocation_method:    it.fromFallbackYard ? 'AUTO' : 'MANUAL'
              };
              if (PROMOTE_FROM_SRV.indexOf(String(l.line_status || '').toUpperCase()) !== -1) {
                patch.line_status = 'SCHEDULED_FOR_PICKING';
              }
              return Object.assign({}, l, patch);
            });
          }
        }
      }

      // ── LEGACY CLIENT-SIDE WRITE-BACK — kept, runs only as the fallback ─────
      if (!recordedServerSide) {
      // ── Stamp the confirmed yard pair onto each ALLOCATION ───────────────
      // Confirm is the moment the source→destination movement is decided: the
      // yards are derived here (source = the yard the units were allocated
      // from, destination = that BU's virtual org for the request origin) and
      // sent to OIC, but nothing recorded them — EQR_ALLOCATION's
      // SOURCE_/DEST_INV_ORG_* and *_ORG_CODE columns were 100% NULL.
      //
      // EQR_ALLOCATION IS THE SOURCE OF TRUTH for the confirmed yard pair.
      // EQR_TRANSFER_ORDER has matching SOURCE_/DESTINATION_ORG_ID+CODE columns
      // and they are deliberately NOT written from here: createSupplyRequest
      // returns 202 and OIC writes the TO row asynchronously, so at this point
      // there is no TO id to patch. Reaching it would mean polling
      // getTransferOrders and matching on supplyRequestNumber (= our
      // InterfaceBatchNumber) — a browser racing an integration, which silently
      // does nothing if the user navigates away. If those TO columns are ever
      // needed, OIC should populate them at TO-creation time: it already
      // receives SourceOrganizationCode/DestinationOrganizationCode on every
      // supply-request line (the source code is even embedded in the batch
      // number it stores), and it has no race.
      //
      // Written per ALLOCATION, not per line: a line split across two yards has
      // one allocation set per yard, and each set moves from its own source.
      // Stamping the line would have to pick one and lose the other.
      //
      // Only allocations that are ACTIVE and belong to THIS bucket's source org
      // are stamped, so a line split across yards gets the right pair on each
      // half. Best-effort: the TO already exists by this point, so a failed
      // PATCH is logged and never surfaced — it must not read as "the transfer
      // didn't happen".
      try {
        const allocPatches = [];
        await Promise.all(items.map(async (it) => {
          const lineId = Number(it.entry.line.line_id);
          const resp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getAllocations',
            uriParams: { requestLineId: lineId }
          }).catch(() => null);
          const allocs = (resp && resp.ok && resp.body && resp.body.data) || [];
          allocs.forEach(a => {
            const isActive = String(a.allocationStatus || '').toUpperCase() !== 'RELEASED' && !a.releasedDate;
            if (!isActive) return;
            // Match the allocation to this bucket by its own source org. When
            // the bucket has no resolvable org id (fallback code), fall back to
            // stamping every active allocation on the line — there is only one
            // bucket for that line in that case.
            if (it.srcOrgId != null && a.eqpInvOrgId != null &&
                Number(a.eqpInvOrgId) !== it.srcOrgId) return;
            allocPatches.push({ id: a.id, item: it });
          });
        }));

        await Promise.all(allocPatches.map(p =>
          Actions.callRest(context, {
            endpoint:  'eqp-v1/patchAllocation',
            uriParams: { id: Number(p.id) },
            body: {
              sourceInvOrgId:     p.item.srcOrgId,
              sourceInvOrgName:   p.item.srcOrgName,
              sourceOrgCode:      p.item.srcCode,
              destInvOrgId:       p.item.destOrgId,
              destInvOrgName:     p.item.destOrgName,
              destinationOrgCode: p.item.destCode
            }
          }).catch(e => {
            console.warn('[request-detail confirmRequest] allocation yard stamp failed for allocation',
              p.id, e);
          })
        ));
      } catch (e) {
        console.warn('[request-detail confirmRequest] allocation yard stamping failed', e);
      }

      // ── Promote the line lifecycle to ALLOCATED ─────────────────────────
      // Confirm may now be run from IN_PROCESS (and QUOTE_ACCEPTED), not just
      // from an already-ALLOCATED line. Creating the Transfer Order IS the
      // commitment of stock to this line, so the line must not stay at
      // IN_PROCESS afterwards — leaving it there would misreport a committed
      // line as merely approved, and would keep it inside the confirm-eligible
      // set for anyone reading line_status alone.
      //
      // Only lines whose bucket's createSupplyRequest actually SUCCEEDED are
      // promoted (this runs after the !ok/continue guards above), and only from
      // the pre-TO states — a line already ALLOCATED is left alone rather than
      // re-patched to the value it already holds.
      //
      // Failures are logged, not surfaced: the Transfer Order is already created
      // at this point, so the TO is the source of truth and a missed status
      // PATCH self-corrects on the next Refresh once OIC writes to_number back.
      // Aborting or erroring here would wrongly imply the TO didn't happen.
      // ── Stamp the yard pair + allocation method onto the LINE ───────────
      // Folded into the SAME PATCH as the status promotion — one round-trip per
      // line rather than three.
      //
      // WHY ON THE LINE, when EQR_ALLOCATION already carries the same six
      // columns: a line confirmed WITHOUT allocating has no allocation row to
      // stamp, so the yard pair had nowhere to live and its return leg could
      // never resolve where the equipment came from. The line always exists, so
      // it is the reliable home for both flows.
      //
      // ALLOCATION_METHOD (CK: 'MANUAL' | 'AUTO'):
      //   MANUAL — someone allocated specific units, then confirmed.
      //   AUTO   — Confirm was clicked with no allocation, so the system took
      //            the source from the picked Yard and chose the units itself.
      // Derived from fromFallbackYard, set in buildLineYardGroups at the point
      // that decision is actually made, rather than re-inferred here.
      //
      // De-dupe: a line split across yards appears in one bucket per yard, and
      // within a bucket can yield several rows. Keyed by line_id; the first
      // group wins for the org pair, which is correct because a split line's
      // groups only ever differ by SOURCE and each bucket patches its own.
      const lineStampById = new Map();
      items.forEach(it => {
        const id = Number(it.entry.line.line_id);
        if (!lineStampById.has(id)) lineStampById.set(id, it);
      });

      // Creating the Transfer Order schedules the line for picking.
      //
      // ALLOCATED IS NOW A PROMOTE-FROM STATE, not a terminus. This used to
      // promote IN_PROCESS/QUOTE_ACCEPTED → ALLOCATED and leave an
      // already-ALLOCATED line alone, because ALLOCATED was the destination.
      // It no longer is: SCHEDULED_FOR_PICKING is, so a line that WAS allocated
      // before confirm must move too — otherwise the allocate-then-confirm path
      // (the normal one) would be the only path that never reaches the new
      // status.
      //
      // ALLOCATED keeps its own meaning — "units have been assigned" — and is
      // untouched for lines that have not been confirmed.
      const PROMOTE_FROM = ['IN_PROCESS', 'QUOTE_ACCEPTED', 'ALLOCATED'];
      const promoteIds = Array.from(lineStampById.keys());
      if (promoteIds.length) {
        // ONE batch PATCH for every line (one transaction, all or nothing),
        // replacing a Promise.all of per-line PATCHes. Best-effort as before:
        // the TO already exists, so a failed batch is logged and no row is
        // mirrored as changed.
        const promoteBatch = await lineBody.updateLines(context, Actions, {
          requestId: Number(requestId),
          headers:   cu.auditHeaders(context),
          updates:   promoteIds.map(lineId => {
            const it = lineStampById.get(lineId);
            const status = String(it.entry.line.line_status || '').toUpperCase();
            const body = {
              id:                 Number(lineId),
              sourceInvOrgId:     it.srcOrgId,
              sourceInvOrgName:   it.srcOrgName,
              sourceOrgCode:      it.srcCode,
              destInvOrgId:       it.destOrgId,
              destInvOrgName:     it.destOrgName,
              destinationOrgCode: it.destCode,
              allocationMethod:   it.fromFallbackYard ? 'AUTO' : 'MANUAL'
            };
            // Covers both S&T routes in one rule: allocated-first (ALLOCATED) and
            // confirmed-without-allocating (IN_PROCESS / QUOTE_ACCEPTED, where the
            // Yard picker supplied the source). Either way the TO now exists, so
            // the line is scheduled for picking. The yard/method stamp applies
            // regardless of whether the status moved.
            if (PROMOTE_FROM.indexOf(status) !== -1) body.lineStatus = 'SCHEDULED_FOR_PICKING';
            return body;
          })
        });
        if (!promoteBatch.ok) {
          console.warn('[request-detail confirmRequest] line stamp/promote batch failed, no line changed:',
            promoteBatch.message);
        }
        const promoteResults = promoteBatch.ok ? promoteIds : [];

        // Mirror the successful PATCHes onto the in-memory rows so the grid's
        // Status column shows ALLOCATED immediately. This chain does NOT reload
        // the page, so without this the line would keep displaying IN_PROCESS
        // until the user hit Refresh — and updateActionButtons (called just
        // below) reads line_status off these same rows, so a stale value would
        // also leave the button gate disagreeing with the server.
        const patchedOk = promoteResults.filter(id => id != null);
        if (patchedOk.length && Array.isArray($page.variables.linesArray)) {
          const patchedSet = new Set(patchedOk.map(Number));
          $page.variables.linesArray = $page.variables.linesArray.map(l => {
            if (!l || !patchedSet.has(Number(l.line_id))) return l;
            const it = lineStampById.get(Number(l.line_id));
            const patch = {
              source_inv_org_id:    it ? it.srcOrgId : l.source_inv_org_id,
              source_org_code:      it ? it.srcCode  : l.source_org_code,
              dest_inv_org_id:      it ? it.destOrgId : l.dest_inv_org_id,
              destination_org_code: it ? it.destCode : l.destination_org_code,
              allocation_method:    it ? (it.fromFallbackYard ? 'AUTO' : 'MANUAL') : l.allocation_method
            };
            // Mirror the status ONLY when the PATCH actually promoted it —
            // matching the PROMOTE_FROM guard above, so a line on another track
            // isn't relabelled locally into a state the server never set.
            if (PROMOTE_FROM.indexOf(String(l.line_status || '').toUpperCase()) !== -1) {
              patch.line_status = 'SCHEDULED_FOR_PICKING';
            }
            return Object.assign({}, l, patch);
          });
        }
      }
      } // end legacy write-back fallback
    }

    // ── 7b. Promote the F&M lines ───────────────────────────────────────────
    // These created no Transfer Order (§3.3 of the spec), but confirming them is
    // still the commitment of the equipment to this line, so their lifecycle
    // must advance exactly like an S&T line's — otherwise they would sit at
    // IN_PROCESS forever and stay inside the confirm-eligible set.
    //
    // SAME destination as S&T: confirming schedules the line for picking.
    //
    //   S&T:  IN_PROCESS / QUOTE_ACCEPTED / ALLOCATED
    //           → SCHEDULED_FOR_PICKING → PICK_INITIATED → SHIP_TO_SITE
    //   F&M:  ALLOCATED (mandatory — an F&M line cannot confirm unallocated)
    //           → SCHEDULED_FOR_PICKING → PICK_INITIATED → SHIP_TO_SITE
    //
    // ALLOCATED IS THE PRIMARY PROMOTE-FROM STATE HERE. F&M lines must be fully
    // allocated to be confirmable at all (isConfirmableLine enforces it), so
    // ALLOCATED is the status virtually every F&M line arrives in — omitting it
    // would mean this promote never fired and F&M lines silently stayed put.
    // IN_PROCESS / QUOTE_ACCEPTED are kept for completeness.
    //
    // Confirm commits the line, it does not ship it. The onward hops
    // (Release for Picking → PICK_INITIATED, then Pick and Ship) happen on the
    // initiate-picking page and are deliberately NOT done here.
    //
    // NO yard stamp: sourceInvOrgId/destinationOrgCode describe a transfer that
    // is not happening. Writing the picked Yard onto an F&M line would fabricate
    // a shipment leg its return path could later try to reverse.
    //
    // Failures are logged, not surfaced — same reasoning as the S&T promote: the
    // allocation is already committed, and a missed PATCH self-corrects on the
    // next Refresh.
    let fAndMPromoted = 0;
    if (fAndMEntries.length) {
      // Server-side first: record_confirm_fm promotes the whole F&M set in ONE
      // transaction. Same endpoint as the S&T buckets — the package branches on
      // the absence of source/dest org fields, so those are omitted.
      //
      // batchNumber IS REQUIRED even though an F&M line takes no Transfer Order.
      // Omitting it returned 400 'batchNumber: must not be null' (observed
      // 2026-09-07). The DTO validates it unconditionally, so send the confirm's
      // own baseBatch with an -FM suffix: unique per confirm, obviously not a
      // yard code, and it keeps the F&M promotion traceable to the click that
      // caused it. The fallback loop below caught the 400 and promoted the lines
      // anyway, which is why this surfaced as a log line rather than a failure.
      let fmRecordedServerSide = false;
      if (USE_SERVER_RECORD) {
        const fmIds = fAndMEntries.map(e => Number(e.line.line_id));
        try {
          const r = await Actions.callRest(context, {
            endpoint:  'eqp-v1/recordConfirm',
            uriParams: { requestId: Number(requestId) },
            headers:   cu.auditHeaders(context),
            body:      { batchNumber: baseBatch + '-FM', lineIds: fmIds }
          });
          if (r && r.ok) {
            fmRecordedServerSide = true;
            fAndMPromoted = fmIds.length;
            const PROMOTE_FM_SRV = ['IN_PROCESS', 'QUOTE_ACCEPTED', 'ALLOCATED'];
            const fmSet = new Set(fmIds);
            if (Array.isArray($page.variables.linesArray)) {
              $page.variables.linesArray = $page.variables.linesArray.map(l => {
                if (!l || !fmSet.has(Number(l.line_id))) return l;
                if (PROMOTE_FM_SRV.indexOf(String(l.line_status || '').toUpperCase()) === -1) return l;
                return Object.assign({}, l, { line_status: 'SCHEDULED_FOR_PICKING' });
              });
            }
          } else {
            console.warn('[request-detail confirmRequest] F&M /record not ok (HTTP ' +
                         (r && r.status) + ') — falling back to client PATCH loop');
          }
        } catch (e) {
          console.warn('[request-detail confirmRequest] F&M /record threw — falling back:', e);
        }
      }

      if (!fmRecordedServerSide) {
      const PROMOTE_FM_FROM = ['IN_PROCESS', 'QUOTE_ACCEPTED', 'ALLOCATED'];
      // ONE batch PATCH for the F&M lines still to promote (one transaction,
      // all or nothing), replacing a per-line Promise.all. Lines already past
      // this point need no write but still count as handled, so the
      // notification doesn't under-report.
      const fmToPromote = fAndMEntries.filter(entry =>
        PROMOTE_FM_FROM.indexOf(String(entry.line.line_status || '').toUpperCase()) !== -1);
      const fmAlready = fAndMEntries.filter(entry => fmToPromote.indexOf(entry) === -1)
        .map(entry => Number(entry.line.line_id));
      const fmBatch = await lineBody.updateLines(context, Actions, {
        requestId: Number(requestId),
        headers:   cu.auditHeaders(context),
        updates:   fmToPromote.map(entry => ({
          id: Number(entry.line.line_id), lineStatus: 'SCHEDULED_FOR_PICKING'
        }))
      });
      if (!fmBatch.ok) {
        console.warn('[request-detail confirmRequest] F&M promote batch failed, no line changed:',
          fmBatch.message);
      }
      const fmResults = fmAlready.concat(
        fmBatch.ok ? fmToPromote.map(entry => Number(entry.line.line_id)) : []);

      const fmOkIds = new Set(fmResults.filter(v => v != null).map(Number));
      fAndMPromoted = fmOkIds.size;

      // Mirror onto the in-memory rows so the grid updates without a reload,
      // matching what the S&T path does after its PATCHes.
      if (fmOkIds.size && Array.isArray($page.variables.linesArray)) {
        $page.variables.linesArray = $page.variables.linesArray.map(l => {
          if (!fmOkIds.has(Number(l.line_id))) return l;
          if (PROMOTE_FM_FROM.indexOf(String(l.line_status || '').toUpperCase()) === -1) return l;
          return Object.assign({}, l, { line_status: 'SCHEDULED_FOR_PICKING' });
        });
      }
      } // end legacy F&M fallback
    }

    // Re-derive the action buttons so Confirm reflects the new locks immediately.
    if ($page.functions && typeof $page.functions.updateActionButtons === 'function') {
      $page.functions.updateActionButtons($page);
    }

    // 8. Notify — aggregate across the per-yard calls. Confirmed lines get a
    // to_number from OIC asynchronously; on the next Refresh they drop out of the
    // confirm-eligible set, so the button self-disables for them.
    const skippedSuffix = (skippedLines.length
      ? ' (' + skippedLines.length + ' line' + (skippedLines.length === 1 ? '' : 's') + ' skipped: missing item number)'
      : '')
      // Lines whose yards could not be resolved were left out of the payload
      // entirely — say so, or the manager would believe the whole selection was
      // confirmed and only notice later that some lines never got a TO.
      + (unresolvedOutLines.length
        ? ' (' + unresolvedOutLines.length + ' line' + (unresolvedOutLines.length === 1 ? '' : 's') +
          ' skipped: source/destination yard could not be determined)'
        : '');

    // F&M lines confirmed without a Transfer Order — reported explicitly, or the
    // manager sees "1 Transfer Order requested" on a 3-line selection and
    // reasonably concludes the other two silently failed.
    const fmSuffix = fAndMPromoted
      ? ' ' + fAndMPromoted + ' fixed-asset line' + (fAndMPromoted === 1 ? '' : 's') +
        ' confirmed without a Transfer Order (not inventory tracked).'
      : '';

    // Buckets skipped because the server recognised a replay, or because another
    // confirm holds the lines. Reported so the count in the toast is honest —
    // "1 Transfer Order requested" on a 3-bucket confirm otherwise reads as two
    // silent failures.
    const concurrencySuffix =
      (replayedCount
        ? ' ' + replayedCount + ' already requested (duplicate click ignored).'
        : '') +
      (rejectedCount
        ? ' ' + rejectedCount + ' line' + (rejectedCount === 1 ? '' : 's') +
          ' skipped — another user is confirming them.'
        : '');

    // An all-replayed confirm created nothing and that is CORRECT: the Transfer
    // Orders already exist from the first fire. Reporting "Confirm Failed" here
    // would tell the user their work was lost when it was in fact already done.
    if (!successCount && replayedCount && !failures.length) {
      await safeNotify(context, {
        summary:     'Already Requested',
        message:     'These Transfer Orders were already requested — nothing further was ' +
                     'created. Refresh to see them.' + fmSuffix + skippedSuffix,
        type:        'info',
        displayMode: 'transient'
      });
      return;
    }

    if (!successCount && rejectedCount && !failures.length && !replayedCount) {
      await safeNotify(context, {
        summary:     'Lines In Use',
        message:     rejectedCount + ' line' + (rejectedCount === 1 ? ' is' : 's are') +
                     ' being confirmed by another user right now, so nothing was created. ' +
                     'Refresh in a moment to see their result.' + fmSuffix + skippedSuffix,
        type:        'warning',
        displayMode: 'persist'
      });
      return;
    }

    if (successCount && !failures.length) {
      await safeNotify(context, {
        summary:     successCount === 1 ? 'Transfer Order Requested' : 'Transfer Orders Requested',
        message:     successCount + ' Transfer Order' + (successCount === 1 ? '' : 's') +
                     ' requested' + (successCount > 1 ? ' (one per source yard)' : '') + '.' +
                     fmSuffix + skippedSuffix + concurrencySuffix,
        type:        'confirmation',
        displayMode: 'transient'
      });
    } else if (successCount && failures.length) {
      await safeNotify(context, {
        summary:     'Partially Confirmed',
        message:     successCount + ' Transfer Order' + (successCount === 1 ? '' : 's') + ' requested; ' +
                     failures.length + ' failed — ' + failures.slice(0, 3).join('; ') +
                     (failures.length > 3 ? ' …' : '') + '.' + fmSuffix + skippedSuffix + concurrencySuffix,
        type:        'warning',
        displayMode: 'persist'
      });
    } else if (fAndMPromoted && !failures.length) {
      // F&M-ONLY confirm: no TO was ever going to be created, so this is a
      // success. Without this branch it fell into 'Confirm Failed' below and
      // told the manager nothing happened, while the lines had in fact been
      // committed.
      await safeNotify(context, {
        summary:     'Request Confirmed',
        message:     fAndMPromoted + ' fixed-asset line' + (fAndMPromoted === 1 ? '' : 's') +
                     ' confirmed. No Transfer Order is created for these — they are not' +
                     ' inventory tracked, so there is no stock movement to request.' + skippedSuffix,
        type:        'confirmation',
        displayMode: 'transient'
      });
    } else {
      await safeNotify(context, {
        summary:     'Confirm Failed',
        message:     failures.length
                     ? ('No Transfer Orders were created — ' + failures.slice(0, 3).join('; ') + (failures.length > 3 ? ' …' : '') + '.')
                     : 'No Transfer Orders were created.',
        type:        'error',
        displayMode: 'persist'
      });
    }
  }

  class ActionChainHandler extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const actionType    = params.actionType;
      const requestId     = $page.variables.requestId;
      const requestNumber = $page.variables.requestNumber || '';

      if (!requestId) {
        console.warn('[request-detail ActionChain] no requestId in page variables');
        return;
      }

      if (actionType === 'generateQuote') {
        // Secondary action → open the editable quote page for this request.
        // Enablement is gated on the page by $variables.quoteEnabled (CUSTOMER
        // source + every line SUBMITTED + all lines selected).
        //
        // sourcePage tells the quote page which page launched it so its Back
        // button can return here instead of hardcoding 'request-detail' — see
        // request-quote-page-chains/QuoteBackChain.js.
        await Actions.navigateToPage(context, {
          page: 'request-quote',
          params: {
            requestId:     requestId,
            requestNumber: requestNumber,
            sourcePage:    'request-detail'
          }
        });
        return;
      }

      if (actionType === 'requestPo') {
        // Build the per-line rows for the PR dialog from the SELECTED lines,
        // then open it. Submit is handled by CreatePurchaseRequisitionChain,
        // which POSTs one Fusion Purchase Requisition (N lines) directly via
        // the VBCS->fusion proxy.
        //
        // MUST MIRROR the button gate in request-detail-page.js
        // updatePoButtonEnabled (PR_ELIGIBLE_LINE_STATUSES there): a PR may only
        // be raised from a pre-supply lifecycle point. Anything already committed
        // (ALLOCATED / on a Transfer Order) or already requisitioned
        // (UNDER_PROCUREMENT) is excluded, so a line can't be double-supplied by
        // both a vendor purchase and a yard transfer, and a PR can't be raised
        // twice for the same line. Terminal (REJECTED/CANCELLED) lines fall out
        // of the same allow-list — real money must never be spent on a line that
        // was turned down.
        //
        // This is the defence-in-depth copy for an outbound write: the button is
        // already disabled for a non-qualifying selection, and terminal lines are
        // unselectable in the grid (see isLineTerminal).
        const PR_ELIGIBLE = ['IN_PROCESS', 'QUOTE_GENERATED', 'QUOTE_ACCEPTED'];
        const allLines    = $page.variables.linesArray || [];
        const selectedIdx = ($page.functions && typeof $page.functions.getSelectedRowIndexes === 'function')
          ? ($page.functions.getSelectedRowIndexes() || [])
          : [];

        const selectedLines = selectedIdx.map(i => allLines[i]).filter(Boolean);
        const chosen = selectedLines
          .filter(l => PR_ELIGIBLE.indexOf(String(l.line_status || '').toUpperCase()) !== -1);

        // ALL-of, matching the button: if any selected line is ineligible, raise
        // NO requisition and name the offenders rather than silently dropping
        // them from a submission the user believes covers their whole selection.
        // (Same BLOCK-ALL reasoning as the Confirm branch.)
        const blockingPr = selectedLines.filter(l =>
          PR_ELIGIBLE.indexOf(String(l.line_status || '').toUpperCase()) === -1);
        if (blockingPr.length) {
          const names = blockingPr.slice(0, 4)
            .map(l => 'Line ' + (l.line_no != null ? l.line_no : '?') + ' — ' + (l.equipment_name || '?'))
            .join('; ');
          await safeNotify(context, {
            summary:     'Cannot Request Purchase Requisition',
            message:     (blockingPr.length === 1 ? 'This selected line is' : 'These selected lines are') +
                         ' not eligible for a requisition (needs In Process, Quote Generated or Quote Accepted): ' +
                         names + (blockingPr.length > 4 ? ' …' : '') + '. Deselect ' +
                         (blockingPr.length === 1 ? 'it' : 'them') + ' and retry.',
            type:        'error',
            displayMode: 'persist'
          });
          return;
        }

        if (!chosen.length) {
          await safeNotify(context, {
            summary:     'Nothing Selected',
            message:     'Select one or more lines to request a purchase requisition.',
            type:        'error',
            displayMode: 'persist'
          });
          return;
        }

        // The dialog opens fresh each time with the "request-specific" switch
        // ON (the common case: a PR raised for this request should carry its
        // project/task). The switch is the single control that forks the cost
        // model — see prHeader.isRequestSpecific and the submit chain.
        const isRequestSpecific = true;

        // Customer-sourced request? A customer PR is a document between us and
        // our supplier — it has NO project applicability (a customer has many
        // projects, none relevant to a rental PR). So for a customer request we
        // suppress every project-derived field: no project/task prefill, no
        // expenditure-type LOV, no expenditure-org LOV. The request-specific
        // switch still governs date/delivery defaulting (its real job), but it
        // never drives project data here. The submit chain re-checks this flag
        // as the authoritative gate before attaching any projectDFF.
        const isCustomer = $page.variables.isCustomerRequest === true;

        // Project fields apply ONLY to a request-specific, NON-customer request.
        const useProjectFields = isRequestSpecific && !isCustomer;

        // Unit of measure now lives on the LINE (next to its quantity) and
        // defaults to the pod's DAY unit: a Rate Based Services line bills
        // quantity-of-UOM x rate, so "6 Day" is the rental where "6 Ea" said
        // nothing. (This is exactly what a Goods line could not do — DAY/WEEK
        // UOMs are rejected there, which is why the old build sent Ea.)
        //
        // The UOM *code* is pod master data and opaque (Each = 'zzu' here), so we
        // read Day's code off the same unitsOfMeasure LOV the picker uses rather
        // than hardcoding a guess. Best-effort: if the lookup fails we keep 'zzu'
        // (the only code proven valid on this pod) so the drawer still submits,
        // and the manager can pick Day from the dropdown.
        let dayUomCode = 'zzu';
        try {
          const uomResp = await Actions.callRest(context, {
            endpoint:  'ProjectLOV/getFscmRestApiResources11_13_18_05UnitsOfMeasure',
            uriParams: { q: "UOM LIKE 'Day%'", fields: 'UOMCode,UOM', limit: 25 }
          });
          const uomItems = (uomResp && uomResp.ok && uomResp.body && Array.isArray(uomResp.body.items))
            ? uomResp.body.items : [];
          const dayRow = uomItems.find(u => String(u.UOM || '').trim().toLowerCase() === 'day')
                      || uomItems.find(u => String(u.UOM || '').trim().toLowerCase() === 'days')
                      || uomItems[0];
          if (dayRow && dayRow.UOMCode) dayUomCode = dayRow.UOMCode;
          else console.warn('[request-detail ActionChain] no Day unit in unitsOfMeasure; PR lines default to', dayUomCode);
        } catch (e) {
          console.warn('[request-detail ActionChain] Day UOM lookup failed; PR lines default to', dayUomCode, e);
        }

        // Rental duration of a line, in whole days, INCLUSIVE of both dates
        // (27th -> 1st = 6 days). This is the same count EQR_RESOLVE_RATE bills
        // for a PR line ((line_end - line_start) + 1, floored at 1), so what
        // purchasing orders covers exactly the span EquipRite costs. Dates arrive
        // as 'YYYY-MM-DD' (or an ISO timestamp) — sliced and parsed at midnight
        // so no timezone shift can drop a day.
        const durationDays = (startStr, endStr) => {
          const parse = (v) => {
            if (!v) return null;
            const d = new Date(String(v).slice(0, 10) + 'T00:00:00');
            return isNaN(d.getTime()) ? null : d;
          };
          const s = parse(startStr), e = parse(endStr);
          if (!s || !e) return 1;
          return Math.max(1, Math.round((e - s) / 86400000) + 1);
        };

        // Map each selected line to an editable dialog row.
        //
        // Price defaults to 0 (post-demo decision, Sandeep): the PR price is
        // NOT the cost. The purchasing department sets the real price when they
        // turn the PR into a PO; EquipRite reads that PO price back later in
        // post-cost. The equipment's EquipRite rate (bill_rate) is a different
        // thing from the supplier's cost, so we deliberately do NOT prefill it.
        // The field stays editable — a manager may type an estimate — but
        // nothing downstream depends on the entered value.
        //
        // Project/Task are defaulted onto the line ONLY when the requisition is
        // request-specific. When it's an independent rental the request's
        // project/task are irrelevant to the PR (no distribution is sent), so
        // we leave them null. The submit chain (CreatePurchaseRequisitionChain)
        // is the authoritative gate — it re-checks the switch — but keeping the
        // prefill consistent with the switch avoids carrying stale ids.
        $page.variables.prLines = chosen.map(l => ({
          lineId:          Number(l.line_id),
          lineNo:          l.line_no,
          equipmentName:   l.equipment_name || '',
          itemDescription: l.equipment_name || 'Third-party rental',
          // Quantity = how many DAYS the equipment is needed (the request line's
          // own date span), paired with uomCode below. NOTE: a line asking for
          // more than one unit is NOT multiplied in here — the quantity is the
          // duration, per requirement. Multiply by l.qty if a multi-unit line
          // should order units x days.
          quantity:        durationDays(l.line_start_date, l.line_end_date),
          uomCode:         dayUomCode,
          price:           0,
          // Requested delivery date on the PR = the rental START date (when the
          // equipment is needed on site), per Sandeep. lineEndDate is retained
          // only for reference. lineStartDate drives RequestedDeliveryDate in
          // the submit chain.
          lineStartDate:   l.line_start_date || null,
          lineEndDate:     l.line_end_date || null,
          // Fusion Project/Task IDs for the PPM distribution on the PR line
          // (projectDFF _PROJECT_ID/_TASK_ID). Request-level today, carried
          // per-line so the submit chain can build one distribution per line.
          // Left null for a customer request — no project applies to a customer PR.
          projectRefId:    useProjectFields && l.project_ref_id != null ? Number(l.project_ref_id) : null,
          taskId:          useProjectFields && l.task_id        != null ? Number(l.task_id)        : null,
          // Per-line expenditure type (projectDFF _EXPENDITURE_TYPE_ID). User must
          // pick one in the dialog from the project-scoped expenditureTypes LOV —
          // NOT pre-filled (the manager chooses the type deliberately).
          expenditureTypeId: null,
          // Per-line expenditure organization (projectDFF _ORGANIZATION_ID). User
          // must pick one in the dialog from the BU-scoped org LOV — NOT pre-filled
          // from the project's owning org.
          expenditureOrgId:   null,
          expenditureOrgName: ''
        }));

        // Reset header defaults each open (keeps a clean dialog). The switch
        // starts ON; toggling it OFF in the dialog makes the submit chain drop
        // the project distribution.
        $page.variables.prHeader = {
          // A third-party rental is billed as a rate (qty x rate), not a bought
          // good, so the dialog opens on the "Rate Based Services" line type.
          // Still fully changeable in the Line Type dropdown.
          //
          // NOTE the value is the CODE, and on this pod the code is NOT the
          // label: LineType "Rate Based Services" has LineTypeCode
          // "ORA_Rate Based Services". Getting this wrong doesn't error — the
          // select simply can't resolve the key and renders EMPTY. (Same trap
          // elsewhere in the LOV: label "Fixed Price Goods" -> code "Fixed
          // Priced Goods".) Verified against purchasingLineTypes, 10 rows.
          lineTypeCode:          'ORA_Rate Based Services',
          categoryName:          'Capital Equipment',
          destinationTypeCode:   'EXPENSE',
          // uomCode intentionally absent — UOM is per line now (prLines[].uomCode).
          deliverToLocationId:   $page.variables.selectedYard || null,
          deliverToLocationType: 'INTERNAL',
          description:           'Third-party rental - ' + (requestNumber || requestId),
          isRequestSpecific:     isRequestSpecific
        };

        // Pre-fill the "Request Site" (one-time) delivery address from the
        // equipment request's own location, so a manager who picks Request Site
        // doesn't have to retype where the request is going. The request stores a
        // single free-text address string on its ship-to-site (already on the page
        // as formData.location); its shape VARIES — a full geocoded address
        // ("13254 Forkland Lane, Houston, Harris County, Texas 77077, United
        // States") or just a locality ("Pittsburgh, PA"). parseRequestAddress
        // (module scope) tokenizes it into address1/city/county/state/postal by
        // recognizing each component rather than by comma position, so parts land
        // in the right boxes regardless of how many segments the string has.
        // Fusion's requisitionOneTimeLocations accepts State as a code, a full
        // name, or blank (verified live), so a partial/failed parse can never make
        // the submit fail. All fields remain editable.
        $page.variables.prDeliveryAddress = parseRequestAddress(
          ($page.variables.formData && $page.variables.formData.location) || ''
        );

        $page.variables.prSubmitting = false;

        // Load the per-line expenditure-type LOV, scoped to the request's project.
        //
        // We call the SAME value set Fusion's own iProcurement 'Manage Requisitions'
        // UI uses for the Expenditure Type dropdown on a project distribution: the
        // flexfield ValidValuesFinder over the PJC expenditure-types value set
        // (Bind_DataSource ...PJCDFFPJC_5FEXPENDITURE_5FTYPES_5FEXPEND_5FVVSO),
        // bound to the line's ProjectId (flex_vst_bind3) with date-effectivity binds
        // (flex_vst_bind1/2). This is authoritative — it returns exactly what a
        // buyer sees and omits the global-catalog phantoms our old expenditureTypes
        // call surfaced (01 00 00 General Requirements, RHF_*, etc.) that rejected at
        // submit. It also SUPERSEDES the old VI-linkage filter + transaction-control
        // narrowing: the value set already applies the project's rules server-side.
        // Returns Id (numeric ExpenditureTypeId) + Value (name). All lines share the
        // request's one project, so a single shared list is correct. Best-effort: a
        // failed fetch leaves the picker empty but never blocks the dialog.
        const etProjId = (($page.variables.prLines || [])
          .map(l => l.projectRefId).filter(p => p != null)[0]) || null;
        if (useProjectFields && etProjId != null) {
          try {
            // Date binds are date-effectivity only (do not change the result on this
            // pod); pass today as YYYY-MM-DD in local time.
            const _n = new Date();
            const today = _n.getFullYear() + '-'
              + String(_n.getMonth() + 1).padStart(2, '0') + '-'
              + String(_n.getDate()).padStart(2, '0');
            const dataSource = 'oracle.apps.flex.prc.por.manageReq.restModel.'
              + 'pjcRequisitionDistributions.view.'
              + 'PJCDFFPJC_5FEXPENDITURE_5FTYPES_5FEXPEND_5FVVSO';
            const finder = 'ValidValuesFinder'
              + ';flex_vst_bind1=' + today
              + ',flex_vst_bind2=' + today
              + ',flex_vst_bind3=' + etProjId
              + ',Bind_DataSource=' + dataSource;
            const etResp = await Actions.callRest(context, {
              endpoint:  'ProjectLOV/getFscmRestApiResources11_13_18_05ExpenditureTypes',
              uriParams: { finder: finder }
            });
            const etItems = (etResp && etResp.ok && etResp.body && Array.isArray(etResp.body.items))
              ? etResp.body.items : [];
            // Shape for oj-select-single (value = numeric Id, label = Value name).
            const seen = {};
            $page.variables.expTypeList = etItems.reduce(function (acc, it) {
              var id = it.Id;
              if (id != null && !seen[id]) {
                seen[id] = true;
                acc.push({ value: Number(id), label: it.Value || String(id) });
              }
              return acc;
            }, []);
          } catch (e) {
            console.warn('[request-detail ActionChain] project expenditure-type LOV fetch failed:', e);
            $page.variables.expTypeList = [];
          }
        } else {
          // Not request-specific, or a customer request → no project distribution
          // → no expenditure-type picker needed.
          $page.variables.expTypeList = [];
        }

        // Resolve the request project's business unit, then load the BU-scoped
        // expenditure-organization LOV for the per-line picker.
        //
        // Expenditure org is a per-line PPM choice on a PR (it rides the projectDFF
        // _ORGANIZATION_ID, sent per line at submit — see CreatePurchaseRequisition
        // Chain). It is NOT pre-filled: the manager picks it per line. Fusion scopes
        // valid expenditure orgs by BUSINESS UNIT, not per project: projectOrganiza
        // tionsLOV's finder ActiveProjectExpenditureOrganizationsForBusinessUnit
        // returns the active ProjectOrganizationType=EXPENDITURES orgs for a BU
        // (verified: 88 orgs for the EquipRite BU). We read the project only to get
        // its BusinessUnitId (the owning org is no longer stamped onto lines).
        if (useProjectFields) {
          const projIds = Array.from(new Set(
            ($page.variables.prLines || []).map(l => l.projectRefId).filter(p => p != null).map(String)
          ));
          let buId = null;   // request project's BU (all lines share one project)
          await Promise.all(projIds.map(async (pid) => {
            try {
              const projResp = await Actions.callRest(context, {
                endpoint:  'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectsById',
                uriParams: { ProjectId: String(pid) }
              });
              if (projResp && projResp.ok && projResp.body && projResp.body.BusinessUnitId != null && buId == null) {
                buId = projResp.body.BusinessUnitId;
              }
            } catch (e) {
              console.warn('[request-detail ActionChain] project BU lookup failed for project', pid, e);
            }
          }));

          // Load the BU-scoped expenditure-org LOV for the per-line picker. All
          // lines share the request's one project (hence one BU), so a single
          // shared list is correct. Best-effort: a failed fetch leaves the picker
          // empty but never blocks the dialog.
          if (buId != null) {
            try {
              const orgResp = await Actions.callRest(context, {
                endpoint:  'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectExpenditureOrganizationsLOV',
                uriParams: {
                  finder: 'ActiveProjectExpenditureOrganizationsForBusinessUnit;BusinessUnitId=' + buId
                }
              });
              const orgItems = (orgResp && orgResp.ok && orgResp.body && Array.isArray(orgResp.body.items))
                ? orgResp.body.items : [];
              const seenOrg = {};
              $page.variables.expOrgList = orgItems.reduce(function (acc, it) {
                var id = it.OrganizationId;
                if (id != null && !seenOrg[id]) {
                  seenOrg[id] = true;
                  acc.push({ value: Number(id), label: it.OrganizationName || String(id) });
                }
                return acc;
              }, []);
            } catch (e) {
              console.warn('[request-detail ActionChain] expenditure-org LOV fetch failed:', e);
              $page.variables.expOrgList = [];
            }
          } else {
            $page.variables.expOrgList = [];
          }
        } else {
          // Not request-specific, or a customer request → no project distribution
          // → no expenditure-org picker needed. Reset so a prior project-PR open
          // doesn't leave a stale org list behind.
          $page.variables.expOrgList = [];
        }

        // Open the right-side drawer by flipping its bound variable (mirrors the
        // BU & Org Mapping drawer pattern — oj-drawer-popup opened="{{ ... }}").
        $page.variables.isPrDrawerOpen = true;
        return;
      }

      if (actionType === 'refresh') {
        // In-place refresh — re-fetch header + enriched lines and rebuild
        // page state via the shared module (no browser reload, so scroll
        // position and the selected yard scope are preserved). refreshRequestData
        // → rdl.applyLines also re-derives the Confirm/Reject enable flags, so
        // lines that gained a to_number drop out of the confirm-eligible set.
        await refreshRequestData(context);
        return;
      }

      if (actionType === 'createInvoice') {
        // Visibility (invoiceVisible: customer-sourced) and enablement
        // (invoiceEnabled: ≥1 selected DEPLOYED line) are wired in
        // request-detail-page.js updateActionButtons. The button is already
        // absent from the DOM on an internal request; this re-checks the origin
        // so the branch can't run if it is ever reached another way — same
        // belt-and-braces guard as the assignProject branch below.
        if (!$page.variables.invoiceVisible) {
          console.warn('[request-detail ActionChain] createInvoice ignored — invoicing is customer-only');
          return;
        }
        // The actual invoice-creation flow (endpoint/integration) doesn't
        // exist yet — this is an honest placeholder, not the old bug where
        // this button silently fired Process Return.
        await safeNotify(context, {
          summary:     'Create Invoice',
          message:     'Invoice creation is not yet implemented.',
          type:        'warning',
          displayMode: 'persist'
        });
        return;
      }

      if (actionType === 'assignProject') {
        // Feature-flagged: EXTERNAL_PROJECT_ASSIGN_ENABLED (Configuration
        // Settings → Application Flags), resolved in vbEnterChain. The button
        // is already hidden when it's off; this stops the drawer opening at all
        // if the branch is ever reached another way.
        if (!$page.variables.externalProjectAssignEnabled) {
          console.warn('[request-detail ActionChain] assignProject ignored — EXTERNAL_PROJECT_ASSIGN_ENABLED is off');
          return;
        }
        // Open the Assign Project drawer, seeded with whatever project/task the
        // request already carries so re-assignment starts from the current value
        // instead of an empty form. The ids live on the LINE rows
        // (request-detail-lines repeats the request-level project onto each
        // line); workbench-requests, which feeds formData, carries only the
        // names. See request-detail-page.js hasAssignedProject.
        //
        // Both the CUSTOMER-only rule and the allocated-lines lock are enforced
        // on the button (assignProjectVisible / assignProjectEnabled), and
        // re-checked authoritatively in AssignProjectChain before the PATCH —
        // this branch only opens the form.
        const lines   = $page.variables.linesArray || [];
        const firstOf = (field) => {
          const hit = lines.find(l => l && l[field] !== null && l[field] !== undefined && String(l[field]).trim() !== '');
          return hit ? Number(hit[field]) : null;
        };
        const curProjectId = firstOf('project_ref_id');
        const curTaskId    = firstOf('task_id');
        const fd = $page.variables.formData || {};

        $page.variables.assignProjectId = curProjectId;
        $page.variables.assignTaskId    = curTaskId;

        // Seed the display text too. The Project field is an oj-input-search
        // whose `value` IS the text, so without this the drawer would open
        // blank over a non-null id. The names come from formData (the header
        // row carries projectName/taskName even though it omits the ids).
        $page.variables.assignProjectName = curProjectId != null ? (fd.project_customer || '') : '';
        $page.variables.assignTaskName    = curTaskId    != null ? (fd.task || '') : '';
        $page.variables.assignProjectNumber = '';
        $page.variables.assignTaskNumber    = '';

        // Reset the typeahead predicate so the LOV opens listing everything
        // rather than still filtered by whatever was typed last time.
        $page.variables.projectSearchQ = "ProjectName LIKE '*'";

        $page.variables.isAssignProjectOpen = true;

        // Classify the seeded project's WBS before the user touches the Task
        // dropdown. Opening on an already-assigned request never fires
        // AssignProjectSelectedChain, so without this the drawer would open
        // with an empty tree and every task — summary nodes included — would
        // read as selectable until the user re-picked the project.
        await Actions.callChain(context, { chain: 'LoadTaskTreeChain' });
        return;
      }

      if (actionType === 'confirm') {
        // Build the OIC supplyRequest payload from ALLOCATED lines not yet
        // on a Transfer Order, POST to OIC, stay on page. OIC writes
        // EQR_TRANSFER_ORDER asynchronously; user clicks Refresh.
        // EQR_EQUIPMENT_REQUEST.status is NOT changed here (no valid CK
        // value for 'confirmed' / 'in-transit' yet).
        //
        // LAYER 1a — RE-ENTRANCY GUARD. One user interaction was observed
        // entering this branch five times, 438-477ms apart, creating five real
        // Transfer Orders for one line. beginConfirm() claims the slot on ENTRY;
        // the optimistic _toInitiatedLineIds Set could not help because it is
        // only written after createSupplyRequest returns, long after all five
        // fires were already inside.
        //
        // A refused re-entry returns SILENTLY: the user performed one action and
        // is getting one confirm. Telling them "a confirm is already running"
        // would report our own bug back to them as if it were their mistake.
        const pf = $page.functions;
        if (pf && typeof pf.beginConfirm === 'function') {
          if (!pf.beginConfirm()) {
            console.warn('[request-detail ActionChain] confirm re-entry blocked — one already in flight');
            return;
          }
          try {
            await confirmRequest(context);
          } finally {
            // MUST be finally: an exception that left the flag set would wedge
            // Confirm for the life of the page with no way back but a reload.
            pf.endConfirm();
          }
        } else {
          // Page module without the guard (older build) — behave as before
          // rather than refusing to confirm at all.
          await confirmRequest(context);
        }
        return;
      }

      if (actionType === 'shipConfirm') {
        // Ship Confirm: the inbound-leg mirror of Confirm Request. A selected
        // line that is RETURN_IN_PROCESS already has an inbound Transfer
        // Order (created by Process Return) — Ship Confirm releases it in
        // Fusion via the same OIC endpoint the initiate-picking-page's
        // "Release TO" button uses (resources/js/releaseTransferOrder),
        // scoped to the SELECTED lines instead of a TO dropdown (this page
        // has no per-request TO picker; Confirm/Reject/Process Return are
        // already selection-scoped, so this follows suit).
        //
        // NOTE on sourceOrg: the inbound leg is created with source/dest
        // ORG CODES SWAPPED vs. the outbound leg (see PAYLOAD_DEFAULTS usage
        // in processReturn below) — so release must send sourceOrg '002',
        // NOT the outbound '001' ReleaseTransferOrderChain uses, to resolve
        // the same Fusion org the inbound TO was created against.
        //
        // views/request-detail-lines does not yet expose a distinct
        // inbound-TO-number column per line (known gap — see the
        // processReturn comment below), so instead of reading a per-line
        // field we go straight to getTransferOrders/getTransferOrderLines
        // (same source ActionChain's confirmRequest and
        // openPickingDrawerChain already use) to find which inbound TO(s)
        // cover the eligible lines.
        const SOURCE_ORG_CODE_INBOUND = '002';

        const allLines    = $page.variables.linesArray || [];
        const selectedIdx = ($page.functions && typeof $page.functions.getSelectedRowIndexes === 'function')
          ? ($page.functions.getSelectedRowIndexes() || [])
          : [];
        const eligible = selectedIdx
          .map(i => allLines[i])
          .filter(Boolean)
          .filter(l => String(l.line_status || '').toUpperCase() === 'RETURN_IN_PROCESS');

        if (!eligible.length) {
          await safeNotify(context, {
            summary:     'Cannot Return Ship Confirm',
            message:     'Select one or more Return In Process lines to ship confirm.',
            type:        'error',
            displayMode: 'persist'
          });
          return;
        }

        // ── Find the releasable inbound TO(s) covering the eligible lines ──
        let inboundTOs = [];
        try {
          const toListResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getTransferOrders',
            uriParams: { equipmentRequestId: Number(requestId) }
          });
          if (toListResp && toListResp.ok) {
            inboundTOs = (toListResp.body.data || [])
              .filter(t => String(t.orderType || '').toUpperCase() === 'INBOUND' && rto.isReleasable(t.orderStatus));
          }
        } catch (e) {
          console.warn('[request-detail ActionChain] shipConfirm: failed to load TOs:', e);
        }

        // ── SPLIT BY CLASS, same as processReturn above ──────────────────────
        // An F&M line has no inbound TO to release, so everything below that
        // resolves lines THROUGH a transfer order would exclude it. Its ship
        // confirm is the status flip alone: RETURN_IN_PROCESS → SHIPPED_TO_YARD,
        // the mirror of how it shipped outbound (PICK_INITIATED → SHIP_TO_SITE
        // in ShipConfirmStuckLinesChain, also a PATCH with no TO).
        const fAndMShip = eligible.filter(l => rdl.isFAndM(l));
        const sAndTShip = eligible.filter(l => !rdl.isFAndM(l));

        // Only an S&T line needs a TO. Bail solely when there is no F&M work to
        // fall back on — otherwise an F&M-only return dead-ends here, which is
        // exactly the gap this fixes.
        if (!inboundTOs.length && !fAndMShip.length) {
          await safeNotify(context, {
            summary:     'Cannot Return Ship Confirm',
            message:     'No releasable inbound Transfer Order was found for this request.',
            type:        'error',
            displayMode: 'persist'
          });
          return;
        }

        const requestLineIdToTO = new Map();
        const toLineFetches = await Promise.all(
          inboundTOs.map(t => Actions.callRest(context, {
            endpoint:  'eqp-v1/getTransferOrderLines',
            uriParams: { transferOrderId: Number(t.id) }
          }).catch(() => null))
        );
        toLineFetches.forEach((resp, idx) => {
          if (!resp || !resp.ok) return;
          const to = inboundTOs[idx];
          (resp.body.data || []).forEach(tl => {
            if (tl.requestLineId != null) requestLineIdToTO.set(Number(tl.requestLineId), to);
          });
        });

        // S&T ONLY — an F&M line is never on a TO, so matching it here would
        // always land it in uncoveredLines and report it as an error.
        const eligibleByTOId = new Map();
        const uncoveredLines = [];
        sAndTShip.forEach(l => {
          const to = requestLineIdToTO.get(Number(l.line_id));
          if (!to) {
            uncoveredLines.push(l.line_no);
            return;
          }
          if (!eligibleByTOId.has(to.id)) eligibleByTOId.set(to.id, { to: to, lines: [] });
          eligibleByTOId.get(to.id).lines.push(l);
        });

        if (!eligibleByTOId.size && !fAndMShip.length) {
          await safeNotify(context, {
            summary:     'Cannot Return Ship Confirm',
            message:     'None of the selected lines are on a releasable inbound Transfer Order.',
            type:        'error',
            displayMode: 'persist'
          });
          return;
        }

        // ── Release each distinct TO, then advance ITS lines to SHIPPED_TO_YARD ──
        const released = [];
        const alreadyReleased = [];
        const failed = [];

        for (const { to, lines } of eligibleByTOId.values()) {
          const toNumber = to.orderNumber || '';
          if (!toNumber) {
            failed.push('TO for line(s) ' + lines.map(l => l.line_no).join(', ') + ' (no order number yet)');
            continue;
          }

          const releaseResult = await rto.releaseTransferOrder(context, Actions, toNumber, SOURCE_ORG_CODE_INBOUND);

          if (releaseResult.outcome === 'alreadyReleased') {
            alreadyReleased.push(toNumber);
            continue;
          }
          if (releaseResult.outcome === 'failed') {
            console.warn('[request-detail ActionChain] shipConfirm release failed for', toNumber, releaseResult.message);
            failed.push(toNumber);
            continue;
          }

          released.push(toNumber);

          // Direct RETURN_IN_PROCESS → SHIPPED_TO_YARD, no intermediate step
          // (the outbound leg's PICK_INITIATED → SHIP_TO_SITE timer models a
          // real intermediate milestone; the return leg has none — and per
          // [[project_request_line_status_cascade]] we deliberately removed
          // the fake-timer pattern rather than add another one here).
          // One batch PATCH for this TO's lines (all or nothing), replacing a
          // per-line Promise.all. Best-effort as before: the TO is released.
          const toLinesBatch = await lineBody.updateLines(context, Actions, {
            requestId: Number(requestId),
            headers:   cu.auditHeaders(context),
            updates:   lines.map(l => ({ id: Number(l.line_id), lineStatus: 'SHIPPED_TO_YARD' }))
          });
          if (!toLinesBatch.ok) {
            console.warn('[request-detail ActionChain] shipConfirm line batch failed for', toNumber,
              toLinesBatch.message);
          }
        }

        // ── F&M lines: the status flip IS the ship confirm ───────────────────
        // No TO to release, so nothing above applied to them. Advanced here to
        // the same target state the S&T lines reach, so both classes converge
        // on SHIPPED_TO_YARD and the yard-side Accept — which gates on status
        // alone and is already class-agnostic — closes them identically.
        let fmShipped = 0;
        const fmShipFailed = [];
        if (fAndMShip.length) {
          // One batch PATCH for every F&M line (all or nothing).
          const fmShipBatch = await lineBody.updateLines(context, Actions, {
            requestId: Number(requestId),
            headers:   cu.auditHeaders(context),
            updates:   fAndMShip.map(l => ({ id: Number(l.line_id), lineStatus: 'SHIPPED_TO_YARD' }))
          });
          if (fmShipBatch.ok) {
            fmShipped = fAndMShip.length;
          } else {
            console.warn('[request-detail ActionChain] shipConfirm F&M batch failed:', fmShipBatch.message);
            fAndMShip.forEach(l => fmShipFailed.push(l.line_no));
          }
        }

        // Refresh in place so shipped lines show SHIPPED_TO_YARD and the
        // ship-confirm-eligible set re-derives.
        await refreshRequestData(context);

        const parts = [];
        if (released.length)       parts.push(released.length + ' TO' + (released.length === 1 ? '' : 's') + ' released (' + released.join(', ') + ')');
        if (alreadyReleased.length) parts.push(alreadyReleased.length + ' already released (' + alreadyReleased.join(', ') + ')');
        if (failed.length)         parts.push(failed.length + ' failed (' + failed.join(', ') + ')');
        if (uncoveredLines.length) parts.push(uncoveredLines.length + ' line(s) had no matching inbound TO: ' + uncoveredLines.join(', '));
        // F&M lines have no TO, so they are reported by what actually happened
        // to them — otherwise an all-F&M ship confirm reads "Nothing to
        // release." despite having shipped every line successfully.
        if (fmShipped)          parts.push(fmShipped + ' fixed-asset line' + (fmShipped === 1 ? '' : 's') + ' shipped to yard (no TO required)');
        if (fmShipFailed.length) parts.push('fixed-asset line(s) ' + fmShipFailed.join(', ') + ' failed to update');

        const anyOk = released.length || fmShipped;
        const anyFail = failed.length || fmShipFailed.length;
        await safeNotify(context, {
          summary:     anyOk ? 'Return Ship Confirmed' : (anyFail ? 'Return Ship Confirm Failed' : 'Return Ship Confirm'),
          message:     parts.join('; ') || 'Nothing to release.',
          type:        anyOk ? 'confirmation' : (anyFail ? 'error' : 'warning'),
          displayMode: 'persist'
        });
        return;
      }

      if (actionType === 'reject') {
        // Per-line reject. The button is enabled only when ≥1 selected line is
        // still rejectable, so we act on exactly the selected, rejectable lines
        // — NOT the whole request header. Each line's lineStatus is set to
        // 'REJECTED' via patchRequestLine (the same per-line PATCH saveLineChain
        // uses to cascade lineStatus). 'REJECTED' is in the known status
        // vocabulary. We stay on the page and refresh in place so the user can
        // keep working the remaining lines.
        // REJECTED and CANCELLED are here because they are TERMINAL — a line in
        // either state takes no further action at all, re-rejection included.
        const NON_REJECTABLE = ['PICK_INITIATED', 'SHIP_TO_SITE', 'DEPLOYED', 'UNDER_PROCUREMENT',
          'RETURN_INITIATED', 'SHIPPED_TO_YARD', 'CLOSED', 'REJECTED', 'CANCELLED'];
        const hasTo = l => !!(l && l.to_number && String(l.to_number).trim() !== '');

        const allLines    = $page.variables.linesArray || [];
        const selectedIdx = ($page.functions && typeof $page.functions.getSelectedRowIndexes === 'function')
          ? ($page.functions.getSelectedRowIndexes() || [])
          : [];
        const toReject = selectedIdx
          .map(i => allLines[i])
          .filter(Boolean)
          .filter(l => NON_REJECTABLE.indexOf(String(l.line_status || '').toUpperCase()) === -1 && !hasTo(l));

        if (!toReject.length) {
          await safeNotify(context, {
            summary:     'Cannot Reject',
            message:     'Select one or more lines that have not been confirmed or shipped.',
            type:        'error',
            displayMode: 'persist'
          });
          return;
        }

        // ONE batch PATCH for every selected line (one transaction, all or
        // nothing), replacing a per-line Promise.all: either every line is
        // rejected or none is.
        const rejectBatch = await lineBody.updateLines(context, Actions, {
          requestId: Number(requestId),
          headers:   cu.auditHeaders(context),
          updates:   toReject.map(l => ({ id: Number(l.line_id), lineStatus: 'REJECTED' }))
        });
        const results = toReject.map(l => ({ line: l, ok: rejectBatch.ok, error: rejectBatch.message }));

        const succeeded = results.filter(r => r.ok);
        const failed    = results.filter(r => !r.ok);

        if (succeeded.length) {
          await safeNotify(context, {
            summary:     'Line' + (succeeded.length === 1 ? '' : 's') + ' Rejected',
            message:     succeeded.length + ' line' + (succeeded.length === 1 ? '' : 's') + ' rejected' +
                         (failed.length ? (' — ' + failed.length + ' failed') : '') + '.',
            type:        'warning',
            displayMode: 'transient'
          });
        }
        if (failed.length && !succeeded.length) {
          const f0 = failed[0];
          console.error('[request-detail ActionChain] per-line reject failed:',
                        failed.map(f => ({ lineId: f.line && f.line.line_id, status: f.status, error: f.error })));
          await safeNotify(context, {
            summary:     'Reject Failed',
            message:     'Failed to reject the selected line' + (failed.length === 1 ? '' : 's') +
                         (f0 && f0.error ? (': ' + f0.error) : '') + ' No line was changed.',
            type:        'error',
            displayMode: 'persist'
          });
          return;
        }

        // Refresh in place so the rejected lines show their new status and the
        // enable flags re-derive (rejected lines drop out of the rejectable set).
        await refreshRequestData(context);
      }

      if (actionType === 'processReturn') {
        // Process Return: for selected lines that are DEPLOYED or already
        // marked RETURN_INITIATED by the requestor, create the inbound-leg
        // Transfer Order by re-POSTing createSupplyRequest with the outbound
        // leg's source/destination yards swapped, resolved per-line via
        // buildLineReturnGroups (no hardcoded org-code constants). Eligibility
        // is by line_status only — independent of the request header status.
        //
        // On a successful OIC response the eligible lines are PATCHed to
        // RETURN_IN_PROCESS (below) — the inbound TO has been requested but
        // not yet received. That status intentionally does NOT advance
        // further here: flipping to SHIPPED_TO_YARD happens on actual
        // receipt at the yard, a separate/future step, not at request time.
        //
        // KNOWN GAP (deferred pending backend): views/request-detail-lines
        // still exposes a single `to_number` per line — the VB side is wired
        // for a distinct inbound number (OrderType on the create call,
        // inbound_to_number column on the grid) but the backend view hasn't
        // added the corresponding field yet.
        const RETURN_SOURCE_STATES = ['DEPLOYED', 'RETURN_INITIATED'];

        const allLines    = $page.variables.linesArray || [];
        const selectedIdx = ($page.functions && typeof $page.functions.getSelectedRowIndexes === 'function')
          ? ($page.functions.getSelectedRowIndexes() || [])
          : [];

        // ══ RESET A FAILED RETURN BEFORE RE-ATTEMPTING IT ═══════════════════
        // A return whose inbound Transfer Order failed in Fusion left the line at
        // RETURN_IN_PROCESS — which is NOT in RETURN_SOURCE_STATES, so the Return
        // button will not enable and the line is stuck. 13 lines are in exactly
        // this state today.
        //
        // Roll them back to DEPLOYED first, then let the normal return flow run.
        // Same button, no second control — the reset is a precondition of the
        // retry, not an action the user chooses.
        //
        // The endpoint REFUSES with 409 when any inbound TO for the line
        // succeeded: the equipment is genuinely in transit and rolling back would
        // assert it is still on site. That 409 carries a readable sentence from
        // the package itself — surface it verbatim rather than a generic error,
        // because it explains exactly why the reset was refused.
        // SERVER-TOLD, not inferred. `to_needs_reset` comes from
        // needsReturnResetLineIds on the failed-TO sweep. Testing line_status
        // here instead would re-flag a line whose return was ALREADY reset — it
        // still appears in the failed list (its TO did fail) but sits at DEPLOYED
        // and needs nothing, so the reset would fire and answer 0.
        const resetCandidates = selectedIdx
          .map(i => allLines[i])
          .filter(l => l && l.to_needs_reset === true);
        if (resetCandidates.length) {
          try {
            const rs = await Actions.callRest(context, {
              endpoint:  'eqp-v1/resetFailedReturn',
              uriParams: { requestId: Number(requestId) },
              headers:   cu.auditHeaders(context),
              body:      { lineIds: resetCandidates.map(l => Number(l.line_id)) }
            });
            if (rs && rs.ok) {
              console.log('[request-detail processReturn] reset',
                          (rs.body && rs.body.linesReset), 'failed return line(s) to DEPLOYED');
              // Mirror locally so the eligibility filter below sees DEPLOYED
              // without waiting for a refresh.
              const resetIds = new Set(resetCandidates.map(l => Number(l.line_id)));
              allLines.forEach(l => {
                if (l && resetIds.has(Number(l.line_id))) l.line_status = 'DEPLOYED';
              });
            } else {
              const msg = (rs && rs.body && (rs.body.detail || rs.body.message)) || '';
              await safeNotify(context, {
                summary:     rs && rs.status === 409 ? 'Cannot Retry Return' : 'Reset Failed',
                message:     msg || ('Could not reset the failed return (HTTP ' +
                                     (rs && rs.status) + '). Refresh and try again.'),
                type:        'error',
                displayMode: 'persist'
              });
              return;
            }
          } catch (e) {
            console.warn('[request-detail processReturn] reset threw:', e);
            await safeNotify(context, {
              summary:     'Reset Failed',
              message:     'Could not reset the failed return. Refresh and try again.',
              type:        'error',
              displayMode: 'persist'
            });
            return;
          }
        }
        const eligible = selectedIdx
          .map(i => allLines[i])
          .filter(Boolean)
          .filter(l => RETURN_SOURCE_STATES.indexOf(String(l.line_status || '').toUpperCase()) !== -1);

        if (!eligible.length) {
          await safeNotify(context, {
            summary:     'Cannot Process Return',
            message:     'Select one or more lines with status Deployed or Return Initiated.',
            type:        'error',
            displayMode: 'persist'
          });
          return;
        }

        // ── SPLIT BY CLASS, exactly as confirmRequest does on the way out ────
        // An F&M line is fixed-asset / maintenance tracked and NOT a Fusion
        // inventory item, so it has no INVENTORY_ITEM_REF_ID and therefore no
        // itemNumber. The outbound leg never created a Transfer Order for it,
        // so there is no inbound TO to mirror either — the return is a status
        // flip, the same shape as ReleaseTransferOrderChain's F&M branch and
        // ShipConfirmStuckLinesChain's.
        //
        //   S&T: DEPLOYED → [inbound TO] → RETURN_IN_PROCESS
        //   F&M: DEPLOYED →               RETURN_IN_PROCESS   (PATCH only)
        //
        // Split BEFORE buildMasterIdToItemNumberMap: an F&M line has no item
        // number by definition, so it would otherwise fall into skippedLines
        // and be reported as "missing equipmentNumber" — a misleading error for
        // a line that is behaving correctly. On an all-F&M request that message
        // was the ONLY outcome; the return simply never happened.
        //
        // rdl.isFAndM() is the single owner of this test (resources/js/
        // requestDetailLines), the same resolver the allocation gates and
        // confirm use, so the return cannot disagree with the rest of the page
        // about what F&M means. It fails to S&T when isTransactable is absent,
        // so a payload without the field behaves exactly as it does today.
        const fAndMReturnLines = eligible.filter(l => rdl.isFAndM(l));
        const sAndTReturnLines = eligible.filter(l => !rdl.isFAndM(l));

        if (fAndMReturnLines.length) {
          console.log('[request-detail processReturn] F&M lines excluded from inbound Transfer Order:',
            fAndMReturnLines.map(l => l.line_id));
        }

        const masterIdToItemNumber = sAndTReturnLines.length
          ? await buildMasterIdToItemNumberMap(context, sAndTReturnLines)
          : new Map();

        const payloadLines = [];
        const skippedLines = [];
        sAndTReturnLines.forEach(l => {
          const itemNumber = masterIdToItemNumber.get(Number(l.equipment_master_id));
          if (!itemNumber) {
            skippedLines.push('Line ' + l.line_no + ' (' + (l.equipment_name || '?') + ')');
            return;
          }
          payloadLines.push({ line: l, itemNumber: itemNumber });
        });

        // Only an S&T line can fail for a missing item number, and only when
        // there were S&T lines to begin with. A request whose returnable lines
        // are ALL F&M skips this entirely and goes straight to the status flip.
        if (!payloadLines.length && !fAndMReturnLines.length) {
          const sampleNames = skippedLines.slice(0, 3).join('; ');
          await safeNotify(context, {
            summary:     'Cannot Process Return',
            message:     'None of the selected lines have an equipmentNumber on their equipment master. ' +
                         'Set equipmentNumber on the master record(s) and retry. Skipped: ' + sampleNames +
                         (skippedLines.length > 3 ? ' …' : ''),
            type:        'error',
            displayMode: 'persist'
          });
          return;
        }

        const nowIso     = new Date().toISOString();
        // LAYER 1 — same deterministic key as the outbound leg, leg='INBOUND'
        // so an outbound and a return over the same lines never collide.
        // Computed and logged now; sent once the Java /returns/reserve endpoint
        // exists (spec §6.5).
        const returnIdempotencyKey = buildIdempotencyKey({
          requestId: requestId,
          lineIds:   payloadLines.map(e => Number(e.line.line_id)),
          leg:       'INBOUND'
        });
        console.log('[request-detail processReturn] idempotency key', returnIdempotencyKey,
                    'for', payloadLines.length, 'line(s)');

        const baseBatch  = 'EQR-RET-' + (requestNumber || requestId) + '-' + Date.now();

        // Destination virtual-org role, driven by the request's CUSTOMER TYPE —
        // the same rule the outbound leg uses (5b in confirmRequest):
        //   INTERNAL → VIRTUAL_PROJECT  ('005')
        //   EXTERNAL → VIRTUAL_CUSTOMER ('006')
        // On the return this is the org the equipment travels FROM. Only used
        // for lines whose allocations were never stamped; the stamped ones
        // already carry the exact code that went out.
        const retOriginSource = String(($page.variables.formData && $page.variables.formData.source) || '').toUpperCase();
        const retDestRole = !retOriginSource
          ? null
          : (context.$application.functions.isExternalSource(retOriginSource)
              ? 'VIRTUAL_CUSTOMER'
              : 'VIRTUAL_PROJECT');

        // == SERVER-SIDE RETURN PLAN - authoritative when it answers =========
        // get_return_routes inverts the outbound movement per line and buckets
        // by the (source, destination) PAIR. Replaces buildLineReturnGroups and
        // its three-path fallback (allocation stamp -> line stamp -> re-derive),
        // each of which cost a getAllocations call per line.
        //
        // !! NO BLOCK-ALL ON THE RETURN LEG !!
        // The outbound /plan refuses everything if any line is blocked, because
        // a wrong-status line must not ship while its siblings do. The return is
        // the OPPOSITE: refusing the whole return because one line lost its yard
        // stamp would STRAND REAL EQUIPMENT ON SITE. So blocked lines are named
        // and skipped, and the resolvable ones still travel. Verified on request
        // 1000001470, where line ...2021 routes to Atlanta while ...2022 blocks.
        let planRoutes = null;   // non-null => authoritative
        let planReturnBlocks = [];
        if (USE_SERVER_PLAN) {
          try {
            const rp = await Actions.callRest(context, {
              endpoint:  'eqp-v1/planReturn',
              uriParams: { requestId: Number(requestId) },
              body:      { lineIds: payloadLines.map(e => Number(e.line.line_id)) }
            });
            if (rp && rp.ok) {
              const rb = rp.body || {};
              planRoutes = rb.buckets || [];
              planReturnBlocks = rb.blocks || [];
              // Lines the server says return WITHOUT a Transfer Order join the
              // F&M status-only return instead of being blocked as "no yard".
              const planFm = new Set((rb.fAndMLineIds || []).map(Number));
              if (planFm.size) {
                for (let i = payloadLines.length - 1; i >= 0; i--) {
                  if (planFm.has(Number(payloadLines[i].line.line_id))) {
                    fAndMReturnLines.push(payloadLines[i].line);
                    payloadLines.splice(i, 1);
                  }
                }
                planReturnBlocks = planReturnBlocks.filter(b => !planFm.has(Number(b.requestLineId)));
              }
              console.log('[request-detail processReturn] /returns/plan authoritative:',
                planRoutes.length, 'route(s),', planReturnBlocks.length, 'block(s)');
            } else {
              console.warn('[request-detail processReturn] /returns/plan not ok (HTTP ' +
                           (rp && rp.status) + ') - resolving client-side');
            }
          } catch (e) {
            console.warn('[request-detail processReturn] /returns/plan threw - resolving client-side:', e);
          }
        }

        const returnGroups = planRoutes
          ? new Map()
          : await buildLineReturnGroups(
              context, payloadLines.map(e => e.line), retDestRole, requestId
            );

        // Bucket by the (source, destination) PAIR, not by source alone.
        // On a return the source is usually the single virtual org, so
        // bucketing by source would collapse every line into ONE Transfer
        // Order — which is the bug this replaces: lines returning to different
        // yards were all sent to whichever destination the constant named.
        // Keying on the pair splits them, so equipment goes back to the yard it
        // actually came from — one inbound TO per (virtual org → yard) route.
        const byRoute = new Map();
        const unresolvedLines = [];

        if (planRoutes) {
          // Shape the server's routes into what the OIC loop already consumes,
          // so the payload build, reserve/record calls and notifications are
          // identical whichever path produced them.
          const retLineById = new Map(payloadLines.map(e => [Number(e.line.line_id), e]));
          planRoutes.forEach(b => {
            const key = b.sourceOrgCode + '|' + b.destOrgCode;
            const items = (b.lines || []).map(pl => {
              const known = retLineById.get(Number(pl.requestLineId));
              const entry = known || {
                line: { line_id: pl.requestLineId, line_no: pl.lineNumber,
                        equipment_name: pl.equipmentName, qty: pl.qty },
                itemNumber: pl.itemNumber
              };
              return { entry: entry, qty: pl.qty,
                       srcCode: b.sourceOrgCode, destCode: b.destOrgCode };
            });
            if (items.length) byRoute.set(key, items);
          });
          // Blocked lines are NAMED, not fatal - see the no-block-all note above.
          planReturnBlocks.forEach(b => unresolvedLines.push(
            'Line ' + (b.lineNumber != null ? b.lineNumber : '?') +
            ' (' + (b.equipmentName || '?') + ')'));
        } else {
        payloadLines.forEach(entry => {
          const groups = returnGroups.get(Number(entry.line.line_id)) || [];
          if (!groups.length) {
            // No stamped allocation and nothing derivable — skip rather than
            // guess. Shipping to a hardcoded yard would move real equipment to
            // the wrong place.
            unresolvedLines.push('Line ' + entry.line.line_no + ' (' + (entry.line.equipment_name || '?') + ')');
            return;
          }
          groups.forEach(g => {
            const key = g.sourceCode + '|' + g.destCode;
            if (!byRoute.has(key)) byRoute.set(key, []);
            byRoute.get(key).push({ entry: entry, qty: g.qty, srcCode: g.sourceCode, destCode: g.destCode });
          });
        });

        } // end client-side return grouping (used only when /returns/plan did not answer)

        // Only bail when there is NOTHING to do at all. An F&M-only return has
        // no routes by design (no TO), so aborting here would kill the very
        // case this branch exists for.
        if (!byRoute.size && !fAndMReturnLines.length) {
          await safeNotify(context, {
            summary:     'Cannot Process Return',
            message:     'Could not determine the source and destination yards for the selected line(s), ' +
                         'so no Transfer Order was created. This happens when a line has no active ' +
                         'allocation to return from. Unresolved: ' + unresolvedLines.slice(0, 3).join('; ') +
                         (unresolvedLines.length > 3 ? ' …' : ''),
            type:        'error',
            displayMode: 'persist'
          });
          return;
        }

        // One createSupplyRequest per route → one inbound TO per route, exactly
        // as confirmRequest fans out per source yard on the way out.
        let retSuccessCount = 0;
        const retFailures = [];
        const returnedEntries = [];
        // Reserve per ROUTE, before the inbound OIC call - same protocol as the
        // outbound leg. leg='INBOUND' keeps it clear of any outbound reservation
        // on the same line: the unique index is on (request_line_id, leg) while
        // PENDING, so both legs coexist.
        let retReplayedCount = 0;
        let retRejectedCount = 0;
        const reserveReturnRoute = async (routeKey, items, batchNumber) => {
          const lineIds = items.map(it => Number(it.entry.line.line_id));
          const key = buildIdempotencyKey({
            requestId:  requestId,
            lineIds:    lineIds,
            leg:        'INBOUND',
            sourceCode: routeKey,       // 'source|dest' - the route IS the intent
            attempt:    attemptFor(items.map(it => it.entry.line))
          });
          try {
            const r = await Actions.callRest(context, {
              endpoint:  'eqp-v1/reserveReturn',
              uriParams: { requestId: Number(requestId) },
              headers:   cu.auditHeaders(context),
              body:      { lineIds: lineIds, batchNumber: batchNumber,
                           idempotencyKey: key, leg: 'INBOUND' }
            });
            if (!r || !r.ok) {
              console.warn('[request-detail processReturn] reserve not ok for ' + routeKey +
                           ' (HTTP ' + (r && r.status) + ') - proceeding unreserved');
              return { proceed: true, replayed: false };
            }
            const b = r.body || {};
            return {
              proceed:  b.replayed !== true && (b.reservedLineIds || []).length > 0,
              rejected: b.rejectedLineIds || [],
              replayed: b.replayed === true
            };
          } catch (e) {
            console.warn('[request-detail processReturn] reserve threw for ' + routeKey +
                         ' - proceeding unreserved:', e);
            return { proceed: true, replayed: false };
          }
        };

        const subinvByOrgCode = await loadSubinventoryByOrgCode(context);
        for (const [routeKey, items] of byRoute) {
          // ONE org code, exactly as the outbound leg does it (line ~863:
          // baseBatch + '-' + srcCode). Outbound proves the shape is fine —
          // e.g. request 1000001439 fired two calls, '…-1787119045249-001' and
          // '…-002', and both resolved (TO 197080 / 197081). So the suffix is
          // not what breaks the return leg's downstream match.
          //
          // Outbound fans out by SOURCE and suffixes with the source code;
          // the return fans out by DESTINATION (source is the single virtual
          // org '005'/'006'), so the destination code is the mirror-image
          // discriminator — it is what varies per route, and it keeps the
          // numbers unique when a return spans two yards.
          const batchNumber = baseBatch + '-' + routeKey.split('|')[1];

          const rres = await reserveReturnRoute(routeKey, items, batchNumber);
          if (rres.replayed) {
            // Already recorded - the inbound TO exists from the first fire.
            // Success, not failure: create nothing.
            retReplayedCount++;
            console.log('[request-detail processReturn] route ' + routeKey +
                        ' replayed - already recorded, creating nothing');
            continue;
          }
          if (!rres.proceed) {
            retRejectedCount += (rres.rejected || []).length;
            console.warn('[request-detail processReturn] route ' + routeKey +
                         ' rejected - lines held by another return:', rres.rejected);
            continue;
          }
          let refLine = 0;
          const body = {
            InterfaceSourceCode:        PAYLOAD_DEFAULTS.InterfaceSourceCode,
            InterfaceBatchNumber:       batchNumber,
            SupplyRequestStatus:        PAYLOAD_DEFAULTS.SupplyRequestStatus,
            SupplyRequestDate:          nowIso,
            SupplyOrderSource:          PAYLOAD_DEFAULTS.SupplyOrderSource,
            SupplyOrderReferenceNumber: batchNumber,
            SupplyOrderReferenceId:     null,
            ProcessRequestFlag:         PAYLOAD_DEFAULTS.ProcessRequestFlag,
            equipmentRequestId:         Number(requestId),
            // Return leg: tags the new EQR_TRANSFER_ORDER row as INBOUND so it
            // can be distinguished from the original outbound TO.
            //
            // The OIC CREATE flow's OrderType field + processor_508 mapping has
            // SHIPPED — verified 2026-09-06: EQR_TRANSFER_ORDER.ORDER_TYPE now
            // records the leg (21 INBOUND / 244 OUTBOUND in paasdev). This no
            // longer silently defaults to OUTBOUND.
            OrderType:                  'INBOUND',
            supplyRequestLines: items.map(item => {
              refLine++;
              return {
                InterfaceBatchNumber:           batchNumber,
                InterfaceSourceCode:            PAYLOAD_DEFAULTS.InterfaceSourceCode,
                SupplyOrderSource:              PAYLOAD_DEFAULTS.SupplyOrderSource,
                SupplyOrderReferenceLineNumber: String(refLine),
                SupplyOrderReferenceLineId:     refLine,
                // Resolved PER LINE from the outbound movement by
                // buildLineReturnGroups: the return travels the outbound leg
                // backwards, so its source is the outbound DESTINATION (the
                // virtual org the equipment was deployed to) and its
                // destination is the outbound SOURCE (the yard it came from).
                //
                // A 2026-08-19 diagnostic hardcoded these to '001' -> '002' to
                // test whether a VIRTUAL org as SOURCE was what made every
                // return land TO_FAILED. That test has served its purpose and
                // is reverted here: equipment must go back to the yard it
                // actually originated from, and the hardcoded pair shipped
                // every return to Atlanta regardless of origin.
                SourceOrganizationCode:         item.srcCode,
                DestinationOrganizationCode:    item.destCode,
                DestinationSubinventoryCode:    destSubinventory(subinvByOrgCode, item.destCode),
                ItemNumber:                     item.entry.itemNumber,
                Quantity:                       item.qty || item.entry.line.qty || 1,
                UOMCode:                        PAYLOAD_DEFAULTS.UOMCode,
                BackToBackFlag:                 PAYLOAD_DEFAULTS.BackToBackFlag,
                NeedByDate:                     nowIso,
                PreparerId:                     PAYLOAD_DEFAULTS.PreparerId,
                DeliverToRequesterId:           PAYLOAD_DEFAULTS.DeliverToRequesterId,
                SupplyType:                     PAYLOAD_DEFAULTS.SupplyType,
                SupplyOperation:                PAYLOAD_DEFAULTS.SupplyOperation,
                DestinationTypeCode:            PAYLOAD_DEFAULTS.DestinationTypeCode,
                requestLineId:                  Number(item.entry.line.line_id),
              };
            })
          };

          let oicResp;
          try {
            oicResp = await Actions.callRest(context, {
              endpoint: 'ics/createSupplyRequest',
              body:     body
            });
          } catch (e) {
            console.error('[request-detail ActionChain] OIC createSupplyRequest (return) failed for route ' + routeKey + ':', e);
            retFailures.push(routeKey.replace('|', ' → ') + ' — network error');
            await releaseReturnReservation(context, requestId, batchNumber);
            continue;
          }

          if (!oicResp || !oicResp.ok) {
            const serverMsg =
                   (oicResp && oicResp.body && oicResp.body.message) ||
                   (oicResp && oicResp.body && JSON.stringify(oicResp.body));
            console.error('[request-detail ActionChain] createSupplyRequest (return) non-OK for route ' + routeKey + ':', oicResp && oicResp.status);
            retFailures.push(routeKey.replace('|', ' → ') + ' — ' +
              (serverMsg ? ('HTTP ' + oicResp.status + ': ' + serverMsg) : ('HTTP ' + (oicResp && oicResp.status))));
            await releaseReturnReservation(context, requestId, batchNumber);
            continue;
          }

          retSuccessCount++;
          // Only lines whose route actually succeeded advance to
          // RETURN_IN_PROCESS below — a failed route must leave its lines
          // returnable so the manager can retry.
          items.forEach(it => returnedEntries.push(it.entry));
        }

        // Only a genuine failure when TOs were actually attempted. With F&M
        // lines present there is real work still to do below, so a zero TO
        // count is the expected outcome, not an error.
        if (!retSuccessCount && byRoute.size) {
          await safeNotify(context, {
            summary:     'Process Return Failed',
            message:     'No Transfer Orders were created — ' +
                         retFailures.slice(0, 3).join('; ') + (retFailures.length > 3 ? ' …' : ''),
            type:        'error',
            displayMode: 'persist'
          });
          return;
        }

        // TO requested successfully — advance the lines that were actually
        // included in the payload to RETURN_IN_PROCESS. Best-effort per line
        // (same pattern as ReleaseTransferOrderChain): one line's PATCH
        // failure doesn't block the others or the success toast, since the
        // TO itself was already created regardless.
        // De-duped: a line split across two routes appears in returnedEntries
        // once per route, but must only be patched once.
        // F&M lines join the SAME advance. They had no TO to wait on, so they
        // are simply appended to the set being patched — the status flip IS
        // their whole return, exactly as it is their whole release and ship.
        // Wrapped in the {line} shape the loop below expects.
        const statusFailedLines = [];
        const patchedLineIds = new Set();
        const allReturnedEntries = returnedEntries.concat(
          fAndMReturnLines.map(l => ({ line: l }))
        );
        const dedupedReturned = allReturnedEntries.filter(entry => {
          const id = Number(entry.line.line_id);
          if (patchedLineIds.has(id)) return false;
          patchedLineIds.add(id);
          return true;
        });

        // == SERVER-SIDE RECORD - one transaction for the whole return ========
        // record_return promotes DEPLOYED / RETURN_INITIATED -> RETURN_IN_PROCESS
        // for BOTH classes: S&T and F&M are promoted identically here, which is
        // why there is no split (and why /returns/plan always returns
        // fAndMLineIds as []).
        //
        // NO yard stamp: the return reverses a movement already recorded on the
        // line, and writing one would fabricate a second shipment leg.
        //
        // batchNumber is OPTIONAL on this endpoint and deliberately NOT sent -
        // record_return neither consumes nor settles a batch, and inventing a
        // value that gets discarded is the kind of theatre the outbound '-FM'
        // suffix exists to work around.
        //
        // Re-recording an already-returned line yields linesPromoted 0: skipped,
        // never reversed. Falls back to the per-line PATCH loop on any failure.
        let returnRecordedServerSide = false;
        if (USE_SERVER_RECORD && dedupedReturned.length) {
          try {
            const rr = await Actions.callRest(context, {
              endpoint:  'eqp-v1/recordReturn',
              uriParams: { requestId: Number(requestId) },
              headers:   cu.auditHeaders(context),
              body:      { lineIds: dedupedReturned.map(e => Number(e.line.line_id)) }
            });
            if (rr && rr.ok) {
              returnRecordedServerSide = true;
              console.log('[request-detail processReturn] /returns/record promoted',
                          (rr.body && rr.body.linesPromoted), 'line(s)');
            } else {
              console.warn('[request-detail processReturn] /returns/record not ok (HTTP ' +
                           (rr && rr.status) + ') - falling back to client PATCH loop');
            }
          } catch (e) {
            console.warn('[request-detail processReturn] /returns/record threw - falling back:', e);
          }
        }

        // == LEGACY CLIENT-SIDE PATCH LOOP - kept, runs only as the fallback ===
        if (!returnRecordedServerSide) {
        // One batch PATCH for every returned line (all or nothing), replacing
        // a per-line Promise.all.
        const returnBatch = await lineBody.updateLines(context, Actions, {
          requestId: Number(requestId),
          headers:   cu.auditHeaders(context),
          updates:   dedupedReturned.map(entry => ({
            id: Number(entry.line.line_id), lineStatus: 'RETURN_IN_PROCESS'
          }))
        });
        if (!returnBatch.ok) {
          console.warn('[request-detail ActionChain] processReturn line batch failed:', returnBatch.message);
          dedupedReturned.forEach(entry => statusFailedLines.push(entry.line.line_no));
        }
        } // end legacy return write-back fallback

        // Refresh in place so the lines show RETURN_IN_PROCESS immediately
        // and the return-eligible set (and returnEnabled) re-derive.
        await refreshRequestData(context);

        const skippedSuffix = skippedLines.length
          ? ' (' + skippedLines.length + ' line' + (skippedLines.length === 1 ? '' : 's') + ' skipped: missing item number)'
          : '';
        const statusFailedSuffix = statusFailedLines.length
          ? ' (status update failed for line' + (statusFailedLines.length === 1 ? '' : 's') + ' ' + statusFailedLines.join(', ') + ')'
          : '';
        // Lines whose yards could not be resolved were left out entirely — say
        // so, or the manager would believe the whole selection was returned.
        const unresolvedSuffix = unresolvedLines.length
          ? ' (' + unresolvedLines.length + ' line' + (unresolvedLines.length === 1 ? '' : 's') +
            ' skipped: source/destination yard could not be determined)'
          : '';
        // Routes skipped as replays, or held by another return. Reported so the
        // count is honest - "1 return Transfer Order requested" on a 3-route
        // return otherwise reads as two silent failures.
        const retConcurrencySuffix =
          (retReplayedCount
            ? ' ' + retReplayedCount + ' already requested (duplicate click ignored).'
            : '') +
          (retRejectedCount
            ? ' ' + retRejectedCount + ' line' + (retRejectedCount === 1 ? '' : 's') +
              ' skipped - another user is returning them.'
            : '');
        const routeFailSuffix = retFailures.length
          ? ' (' + retFailures.length + ' route' + (retFailures.length === 1 ? '' : 's') + ' failed: ' +
            retFailures.slice(0, 2).join('; ') + (retFailures.length > 2 ? ' …' : '') + ')'
          : '';
        // F&M lines produce no Transfer Order, so a message that counts only
        // TOs would read "0 return Transfer Orders requested" on a perfectly
        // successful F&M return. Report what actually happened for each class.
        const fmCount = fAndMReturnLines.length;
        const fmSuffix = fmCount
          ? ' ' + fmCount + ' fixed-asset line' + (fmCount === 1 ? '' : 's') +
            ' returned directly (no Transfer Order required).'
          : '';
        await safeNotify(context, {
          summary:     retSuccessCount === 0
                         ? 'Return Processed'
                         : (retSuccessCount === 1
                             ? 'Return Transfer Order Requested'
                             : 'Return Transfer Orders Requested'),
          // One TO per (virtual org → yard) route, so the count is reported:
          // returning two lines to two different yards now yields two TOs.
          message:     (retSuccessCount
                         ? retSuccessCount + ' return Transfer Order' + (retSuccessCount === 1 ? '' : 's') +
                           ' requested for ' + (patchedLineIds.size - fmCount) +
                           ' line' + (patchedLineIds.size - fmCount === 1 ? '' : 's') +
                           (retSuccessCount > 1 ? ' (one per source/destination route)' : '') + '.'
                         : patchedLineIds.size + ' line' + (patchedLineIds.size === 1 ? '' : 's') +
                           ' moved to Return In Process.') +
                       fmSuffix +
                       skippedSuffix + unresolvedSuffix + routeFailSuffix + statusFailedSuffix +
                       retConcurrencySuffix,
          type:        retFailures.length ? 'warning' : 'confirmation',
          displayMode: retFailures.length ? 'persist' : 'transient'
        });
      }
    }
  }

  return ActionChainHandler;
});
