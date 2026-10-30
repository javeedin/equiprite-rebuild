/**
 * Line-detail unit builder — single source of truth for turning
 * `views/line-detail-units` rows into the Bryntum resource shape the
 * line-detail scheduler + renderers expect.
 *
 * The endpoint returns one row per physical unit (serial / lot / inventory)
 * of a request line, each carrying server-computed availabilityStatus +
 * availableToReserve (ATR) over the line's window, this line's allocation
 * (allocationId / allocatedQty), and location. Pass `yardId` upstream to
 * filter the rows to one inventory org (the view filters server-side).
 *
 * Shared by:
 *   - line-detail/vbEnterChain.js      (initial load)
 *   - line-detail/RescopeYardChain.js  (yard re-scope → rebuild picker)
 *
 * resource.status mapping (drives the Assign / Booked / Assigned pill):
 *   allocationId present                  → 'allocated_to_this_line'
 *   else availabilityStatus === AVAILABLE  → 'available'   (serial)
 *        / availableToReserve >= 1         → 'available'   (lot / inventory)
 *   else                                   → 'allocated_elsewhere'
 *
 * We show ATR only — never on-hand. (availableToReserve is the reservable
 * base, computed by EQR_AVAILABILITY_PKG over the line window.)
 */
define([], function () {
  'use strict';

  function statusForSerial(u) {
    if (u.allocationId != null) return 'allocated_to_this_line';
    return ((u.availabilityStatus || '').toUpperCase() === 'AVAILABLE') ? 'available' : 'allocated_elsewhere';
  }

  function statusForQty(u, available) {
    if (u.allocationId != null) return 'allocated_to_this_line';
    return (available >= 1) ? 'available' : 'allocated_elsewhere';
  }

  function buildSerial(units, eqpInfo, eqpMasterId) {
    var resources = [];
    var allocated = [];
    units.forEach(function (u) {
      if (u.allocationId != null) {
        allocated.push({
          allocationId:   u.allocationId,
          // Prefer the view's own serialRefId (V357 derived column) and fall
          // back to unitRefId, which carries the same value for a SERIAL row.
          // The typed name is what the write path accepts.
          eqrSerialRefId: u.serialRefId != null ? u.serialRefId : u.unitRefId,
          serialNumber:   u.unitNumber || '',
          status:       u.allocationStatus,
        });
      }
      resources.push({
        // `id` is the row identity the page selects on. V357 restored
        // serialRefId / lotRefId / inventoryItemRefId to
        // views/line-detail-units as derived columns - each is unitRefId
        // exposed under its per-type name, populated only for that unitType,
        // so unitRefId stays a valid row key and the typed name is what the
        // write path accepts. Keep reading unitRefId here; the typed field is
        // picked up where an allocation is written.
        id:              u.unitRefId,
        unitRefId:       u.unitRefId,
        // The write id, carried on the resource row so the page module can
        // stage it without re-deriving the per-type name.
        eqrSerialRefId:  u.serialRefId != null ? u.serialRefId : u.unitRefId,
        name:            u.unitNumber || ('SN-' + u.unitRefId),
        serialNumber:    u.unitNumber || '',
        status:          statusForSerial(u),
        rawStatus:       (u.unitStatus || '').toUpperCase(),
        allocationId:    u.allocationId != null ? u.allocationId : null,
        equipment_id:    eqpMasterId,
        equipment_name:  eqpInfo.equipmentName,
        equipment_class: eqpInfo.className,
        eqpClass:        (eqpInfo.className || '').toLowerCase(),
        invOrgId:        u.invOrgId != null ? u.invOrgId : null,
        invOrgCode:      u.invOrgCode || '',
        invOrgName:      u.invOrgName || '',
        location:        u.invOrgName || '',
        location_code:   u.invOrgCode || '',
        latitude:        u.latitude  != null ? u.latitude  : null,
        longitude:       u.longitude != null ? u.longitude : null,
      });
    });
    return { resources: resources, allocated: allocated };
  }

  function buildLot(units, eqpInfo, eqpMasterId) {
    var resources = [];
    var allocated = [];
    units.forEach(function (u) {
      var available = (u.availableToReserve != null) ? Math.max(0, Number(u.availableToReserve)) : 0;
      var rawStatus = (u.unitStatus || '').toUpperCase();
      if (u.allocationId != null) {
        allocated.push({
          allocationId: u.allocationId,
          eqrLotRefId:  u.lotRefId != null ? u.lotRefId : u.unitRefId,
          lotNumber:    u.unitNumber || '',
          allocatedQty: Number(u.allocatedQty || 0),
          status:       u.allocationStatus,
        });
      }
      resources.push({
        id:              u.unitRefId,
        unitRefId:       u.unitRefId,
        eqrLotRefId:     u.lotRefId != null ? u.lotRefId : u.unitRefId,
        name:            u.unitNumber || ('LOT-' + u.unitRefId),
        lotNumber:       u.unitNumber || '',
        availableQty:    available,
        uomCode:         u.uomCode    || '',
        lotStatus:       rawStatus,
        status:          statusForQty(u, available),
        rawStatus:       rawStatus,
        allocationId:    u.allocationId != null ? u.allocationId : null,
        allocatedQty:    u.allocationId != null ? Number(u.allocatedQty || 0) : 0,
        equipment_id:    eqpMasterId,
        equipment_name:  eqpInfo.equipmentName,
        equipment_class: eqpInfo.className,
        eqpClass:        (eqpInfo.className || '').toLowerCase(),
        invOrgId:        u.invOrgId != null ? u.invOrgId : null,
        invOrgCode:      u.invOrgCode || '',
        invOrgName:      u.invOrgName || '',
        location:        u.invOrgName || '',
        location_code:   u.invOrgCode || '',
        latitude:        u.latitude  != null ? u.latitude  : null,
        longitude:       u.longitude != null ? u.longitude : null,
      });
    });
    return { resources: resources, allocated: allocated };
  }

  function buildInventory(units, eqpInfo, eqpMasterId) {
    var resources = [];
    var allocated = [];
    units.forEach(function (u) {
      var available = (u.availableToReserve != null) ? Math.max(0, Number(u.availableToReserve)) : 0;
      var rawStatus = (u.unitStatus || '').toUpperCase();
      var displayName = u.unitNumber || ('INV-' + u.unitRefId);
      if (u.allocationId != null) {
        allocated.push({
          allocationId:       u.allocationId,
          inventoryItemRefId: u.inventoryItemRefId != null ? u.inventoryItemRefId : u.unitRefId,
          itemNumber:         u.unitNumber || '',
          lotNumber:          displayName,            // renderer reuse
          allocatedQty:       Number(u.allocatedQty || 0),
          status:             u.allocationStatus,
        });
      }
      resources.push({
        id:                  u.unitRefId,
        unitRefId:           u.unitRefId,
        inventoryItemRefId:  u.inventoryItemRefId != null ? u.inventoryItemRefId : u.unitRefId,
        name:                displayName,
        itemNumber:          u.unitNumber || '',
        itemDescription:     u.itemDescription || '',
        itemType:            u.itemType || '',
        invOrgId:            u.invOrgId != null ? u.invOrgId : null,
        invOrgCode:          u.invOrgCode || '',
        invOrgName:          u.invOrgName || '',
        lotNumber:           displayName,
        availableQty:        available,
        uomCode:             u.uomCode || '',
        lotStatus:           rawStatus,
        status:              statusForQty(u, available),
        rawStatus:           rawStatus,
        allocationId:        u.allocationId != null ? u.allocationId : null,
        allocatedQty:        u.allocationId != null ? Number(u.allocatedQty || 0) : 0,
        equipment_id:        eqpMasterId,
        equipment_name:      eqpInfo.equipmentName,
        equipment_class:     eqpInfo.className,
        eqpClass:            (eqpInfo.className || '').toLowerCase(),
        location:            u.locationName || u.invOrgName || u.invOrgCode || '',
        location_code:       u.locationCode || u.invOrgCode || '',
        latitude:            u.latitude  != null ? u.latitude  : null,
        longitude:           u.longitude != null ? u.longitude : null,
      });
    });
    return { resources: resources, allocated: allocated };
  }

  /**
   * Build resources + allocated[] from raw line-detail-units rows for a mode.
   * @param allRows  the endpoint's body.data (mixed unit types)
   * @param mode     'serial' | 'lot' | 'inventory'
   * @param eqpInfo  { equipmentName, className }
   * @param eqpMasterId  the line's equipment master id
   * @returns { resources, allocated }
   */
  function buildResources(allRows, mode, eqpInfo, eqpMasterId) {
    var info = eqpInfo || { equipmentName: '', className: '' };
    // The view emits unitType 'ITEM' for inventory rows, NOT 'INVENTORY' -
    // verified live. Matching only 'INVENTORY' filtered every inventory row
    // out, so buildResources returned 0 resources and the picker rendered
    // empty for any inventory-tracked line. Both are accepted because the
    // page-level `controlType` param still uses the word INVENTORY.
    var isInv = (mode === 'inventory');
    var matchesWantType = function (u) {
      var t = String(u && u.unitType).toUpperCase();
      if (mode === 'lot') return t === 'LOT';
      if (isInv)          return t === 'ITEM' || t === 'INVENTORY';
      return t === 'SERIAL';
    };
    var units = (allRows || []).filter(matchesWantType);
    if (mode === 'lot')       return buildLot(units, info, eqpMasterId);
    if (mode === 'inventory') return buildInventory(units, info, eqpMasterId);
    return buildSerial(units, info, eqpMasterId);
  }

  /**
   * Stamp authoritative allocation state onto line-detail-units rows.
   *
   * WHY: `views/line-detail-units?yardId=X` DROPS allocationId (returns null)
   * when scoped to a yard — verified in the network log: the same allocated
   * serial shows allocationId=1000000561 unscoped but allocationId=null when
   * yardId is passed (even the yard that owns it). getAllocations is the
   * authoritative, yard-independent source (keyed by requestLineId), so we join
   * its rows back onto the visible units by ref-id before buildResources runs.
   * Without this the allocated unit shows an "Assign" button on re-scope and the
   * user can over-allocate.
   *
   * Mutates+returns `rows` (the raw units array) so the existing buildResources
   * path picks up the restored allocationId/allocatedQty.
   *
   * @param rows         raw line-detail-units body.data
   * @param allocations  ACTIVE allocations (RELEASED already filtered out)
   * @param mode         'serial' | 'lot' | 'inventory'
   */
  function patchAllocations(rows, allocations, mode) {
    if (!Array.isArray(rows) || !Array.isArray(allocations)) return rows || [];
    // The view emits unitType 'ITEM' for inventory rows, NOT 'INVENTORY' -
    // verified live. Matching only 'INVENTORY' filtered every inventory row
    // out, so buildResources returned 0 resources and the picker rendered
    // empty for any inventory-tracked line. Both are accepted because the
    // page-level `controlType` param still uses the word INVENTORY.
    var isInv = (mode === 'inventory');
    var matchesWantType = function (u) {
      var t = String(u && u.unitType).toUpperCase();
      if (mode === 'lot') return t === 'LOT';
      if (isInv)          return t === 'ITEM' || t === 'INVENTORY';
      return t === 'SERIAL';
    };
    // Join the allocation's per-type FK against the view's unitRefId, which
    // holds that same per-type ref id. Both sides must use the same space:
    // the serial / lot / item id spaces are disjoint, so a mismatch matches
    // nothing and every row silently loses its allocation.
    var byRef = new Map();
    allocations.forEach(function (a) {
      // getAllocations returns serialRefId / lotRefId / inventoryItemRefId.
      // The eqr-prefixed aliases are this module's internal names and are
      // NOT on the API row - accept both so the join works whether the caller
      // passes raw API rows or already-shaped ones.
      var refId = a.serialRefId       != null ? a.serialRefId
                : a.eqrSerialRefId    != null ? a.eqrSerialRefId
                : a.lotRefId          != null ? a.lotRefId
                : a.eqrLotRefId       != null ? a.eqrLotRefId
                : a.inventoryItemRefId;
      if (refId != null) byRef.set(Number(refId), a);
    });
    rows.forEach(function (u) {
      if (!matchesWantType(u)) return;
      var a = byRef.get(Number(u.unitRefId));
      if (!a) return;
      u.allocationId     = a.id;
      u.allocationStatus = a.allocationStatus;
      if (a.allocatedQty != null) u.allocatedQty = a.allocatedQty;
    });
    return rows;
  }

  /**
   * Build the whole-LINE allocated[] from the authoritative allocation list
   * (NOT just the units visible in the current yard). Capacity / progress must
   * count every active allocation on the line — including ones whose unit lives
   * in a yard that isn't currently shown — or the user can over-allocate by
   * switching yards. Shape matches buildResources' allocated[] for the mode so
   * _remainingLineCapacity()/_updateAllocationProgress() read it unchanged
   * (serial counts .length; lot/inventory sum .allocatedQty).
   *
   * @param allocations  ACTIVE allocations (RELEASED already filtered out)
   * @param mode         'serial' | 'lot' | 'inventory'
   */
  function buildAllocatedFromList(allocations, mode) {
    return (allocations || []).map(function (a) {
      // An allocation carries exactly one of the three ref FKs; which one is
      // populated is the discriminator. Surface it under the typed name the
      // write chains send back to EQR_ALLOCATION.
      // NOTE the name change across the boundary: getAllocations returns
      // serialRefId / lotRefId (verified live), NOT the eqr-prefixed names
      // the write chains use internally. Reading a.eqrSerialRefId here gave
      // undefined on every row.
      if (mode === 'lot') {
        return { allocationId: a.id, eqrLotRefId: a.lotRefId, allocatedQty: Number(a.allocatedQty || 0), status: a.allocationStatus };
      }
      if (mode === 'inventory') {
        return { allocationId: a.id, inventoryItemRefId: a.inventoryItemRefId, allocatedQty: Number(a.allocatedQty || 0), status: a.allocationStatus };
      }
      return { allocationId: a.id, eqrSerialRefId: a.serialRefId, allocatedQty: Number(a.allocatedQty || 1), status: a.allocationStatus };
    });
  }

  return {
    buildResources: buildResources,
    patchAllocations: patchAllocations,
    buildAllocatedFromList: buildAllocatedFromList
  };
});
