define([], function () {
  'use strict';

  // ════════════════════════════════════════════════════════════════════════
  // Maintenance asset hierarchy of one serial — read-only, for the warning the
  // line-detail (allocation) page shows before a unit that is part of an asset
  // structure is assigned.
  // ════════════════════════════════════════════════════════════════════════
  //
  //   serialRefId → eqp-v1/getSerialRefById.maintenanceAssetNumber
  //               → ProjectLOV/getInstalledBaseAssets   (the unit's asset)
  //   UP:   ParentAssetId on each asset, walked to the root (ancestors)
  //   DOWN: ProjectLOV/getInstalledBaseAssetRelationships, level by level
  //         (children, grandchildren, …), plus one installedBaseAssets read per
  //         node for its number + description.
  //
  // ONE READ PER ASSET. Fusion's q accepts neither `AssetId IN (…)` nor
  // `AssetId=a or AssetId=b` on installedBaseAssets (both return nothing), and
  // ParentAssetNumber is not queryable — so there is no "whole subtree in one
  // call". Each level is fetched in parallel (capped) instead, and the walk is
  // bounded by MAX_DEPTH / MAX_NODES / MAX_ANCESTORS.
  //
  // Same source as maintAssetLocation.cascadeToChildren: installedBaseAssets'
  // own relationships child resource, not the old OIC getAssets integration.
  //
  // READ-ONLY AND CACHED. Every call is a GET, so repeating it is harmless; the
  // result is cached per serial for CACHE_MS so a second Assign click on the
  // same unit (e.g. after Cancel) opens instantly instead of re-walking Fusion.
  //
  // NEVER THROWS. It is a warning, not a gate: any failure resolves to
  // status 'ERROR' and the caller assigns anyway.
  //
  // Result:
  //   { status: 'NOT_MAINTENANCE' | 'NO_ASSET' | 'NO_RELATIONS' | 'HAS_RELATIONS' | 'ERROR',
  //     unit:            { assetId, assetNumber, description, itemNumber, serialNumber },
  //     parent:          the unit's IMMEDIATE parent asset, or null
  //     childCount:      direct children
  //     descendantCount: children + grandchildren + …
  //     truncated:       true when a cap stopped the walk
  //     partial:         true when some component's children were unreadable
  //                      (Fusion 404 — not an installedBaseAssets row)
  //     rows:            the tree, flattened top-down for display:
  //                      ancestors (root first), the unit, then descendants
  //                      depth-first. Each row: { key, role, level, indentStyle,
  //                      badge, assetNumber, description, itemNumber, serialNumber } }
  // ════════════════════════════════════════════════════════════════════════

  var MAX_DEPTH     = 5;    // descendant levels below the unit
  var MAX_NODES     = 150;  // descendants in total
  var MAX_ANCESTORS = 6;
  var PARALLEL      = 6;    // concurrent Fusion reads per level
  var CACHE_MS      = 5 * 60 * 1000;
  var INDENT_PX     = 20;

  // Fusion q values are single-quoted, so an embedded quote must be doubled.
  function qLit(v) {
    return "'" + String(v).replace(/'/g, "''") + "'";
  }

  var ASSET_FIELDS = 'AssetId,AssetNumber,Description,ItemNumber,ItemDescription,SerialNumber,ParentAssetId';

  function shape(a, fallback) {
    a = a || {};
    fallback = fallback || {};
    return {
      assetId:       a.AssetId != null ? a.AssetId : fallback.AssetId,
      assetNumber:   a.AssetNumber || fallback.AssetNumber || '',
      description:   a.Description || a.ItemDescription || '',
      itemNumber:    a.ItemNumber || fallback.ItemNumber || '',
      serialNumber:  a.SerialNumber || fallback.SerialNumber || '',
      parentAssetId: a.ParentAssetId != null ? a.ParentAssetId : null
    };
  }

  async function readAsset(context, Actions, q) {
    var resp = await Actions.callRest(context, {
      endpoint:  'ProjectLOV/getInstalledBaseAssets',
      uriParams: { q: q, fields: ASSET_FIELDS, limit: 1 }
    });
    if (!resp || !resp.ok || !resp.body) {
      throw new Error('installedBaseAssets HTTP ' + (resp && resp.status));
    }
    var items = resp.body.items || [];
    return items.length ? items[0] : null;
  }

  // Direct children of one asset. AssetId on a relationships row is the
  // CHILD's id; self-rows are dropped.
  //
  // 404 = Fusion has the component in the structure but not as an
  // installedBaseAssets row of its own (seen on dev20: a tablet's 16GB / 512GB
  // modules), so its children can't be read. Returned as null — "unknown", not
  // "none" — so the walk can keep the rest of the tree and say it's partial.
  async function childRowsOf(context, Actions, assetId) {
    var rel = await Actions.callRest(context, {
      endpoint:  'ProjectLOV/getInstalledBaseAssetRelationships',
      uriParams: { AssetId: String(assetId), limit: 200 }
    });
    if (rel && rel.status === 404) return null;
    if (!rel || !rel.ok || !rel.body) {
      throw new Error('relationships HTTP ' + (rel && rel.status));
    }
    return (rel.body.items || []).filter(function (r) {
      return r && r.AssetId != null && String(r.AssetId) !== String(assetId);
    });
  }

  // Promise.all with at most `limit` in flight.
  async function mapLimit(items, limit, fn) {
    var out = new Array(items.length);
    var next = 0;
    async function worker() {
      while (next < items.length) {
        var i = next++;
        out[i] = await fn(items[i], i);
      }
    }
    var workers = [];
    for (var w = 0; w < Math.min(limit, items.length); w++) workers.push(worker());
    await Promise.all(workers);
    return out;
  }

  function byItemThenNumber(x, y) {
    return String(x.itemNumber).localeCompare(String(y.itemNumber)) ||
           String(x.assetNumber).localeCompare(String(y.assetNumber));
  }

  // UP: immediate parent first, then its parent, … (returned root-first).
  async function ancestorsOf(context, Actions, unit) {
    var chain = [];
    var seen = {};
    seen[String(unit.assetId)] = true;
    var pid = unit.parentAssetId;
    while (pid != null && !seen[String(pid)] && chain.length < MAX_ANCESTORS) {
      seen[String(pid)] = true;
      var row = await readAsset(context, Actions, 'AssetId=' + Number(pid));
      if (!row) break;
      var a = shape(row);
      chain.push(a);
      pid = a.parentAssetId;
    }
    return chain.reverse();
  }

  // DOWN: breadth-first, one level at a time. Returns a node map and the
  // children of each node, already sorted for display.
  async function descendantsOf(context, Actions, unit) {
    var kidsOf = {};                 // assetId → [node]
    var seen = {};
    seen[String(unit.assetId)] = true;
    var frontier = [unit];
    var total = 0;
    var truncated = false;
    var partial = false;

    for (var depth = 1; depth <= MAX_DEPTH && frontier.length; depth++) {
      var lists = await mapLimit(frontier, PARALLEL, function (n) {
        return childRowsOf(context, Actions, n.assetId)
          .catch(function (e) {
            // The unit's own children are the point of the check — a real
            // failure there is an ERROR. Deeper down, show what was read.
            if (n === unit) throw e;
            console.warn('[assetChildren] children unreadable for', n.assetId, e);
            return null;
          })
          .then(function (rows) {
            if (rows === null) { partial = true; rows = []; }
            return { parent: n, rows: rows };
          });
      });

      // Claim each child once (an asset can only appear once in the tree).
      var pending = [];
      lists.forEach(function (l) {
        l.rows.forEach(function (r) {
          var k = String(r.AssetId);
          if (seen[k]) return;
          if (total >= MAX_NODES) { truncated = true; return; }
          seen[k] = true;
          total++;
          pending.push({ parent: l.parent, rel: r });
        });
      });

      // Names are display-only: a failed read keeps the relationship row.
      var nodes = await mapLimit(pending, PARALLEL, function (p) {
        return readAsset(context, Actions, 'AssetId=' + Number(p.rel.AssetId))
          .then(function (row) {
            var n = shape(row, p.rel);
            // In the structure but not an installedBaseAssets row (no number
            // or name to show) — say so rather than render a blank line.
            if (!row && !n.description) n.description = 'Component with no asset record in Fusion';
            return n;
          })
          .catch(function (e) {
            console.warn('[assetChildren] read failed for', p.rel.AssetId, e);
            return shape(null, p.rel);
          })
          .then(function (n) {
            var key = String(p.parent.assetId);
            (kidsOf[key] = kidsOf[key] || []).push(n);
            return n;
          });
      });

      if (depth === MAX_DEPTH && nodes.length) {
        // One more level might exist; say so rather than imply it doesn't.
        truncated = true;
      }
      frontier = nodes;
    }

    Object.keys(kidsOf).forEach(function (k) { kidsOf[k].sort(byItemThenNumber); });
    return { kidsOf: kidsOf, total: total, truncated: truncated, partial: partial };
  }

  function depthBadge(d) {
    if (d === 2) return 'Grandchild';
    if (d === 3) return 'Great-grandchild';
    return d > 3 ? 'Level ' + d : '';
  }

  function row(node, role, level, badge) {
    return {
      key:          role + '-' + node.assetId,
      role:         role,
      level:        level,
      indentStyle:  'padding-left:' + (level * INDENT_PX) + 'px;',
      badge:        badge || '',
      assetNumber:  node.assetNumber,
      description:  node.description,
      itemNumber:   node.itemNumber,
      serialNumber: node.serialNumber
    };
  }

  function flatten(ancestors, unit, kidsOf) {
    var rows = [];
    ancestors.forEach(function (a, i) {
      var isImmediate = i === ancestors.length - 1;
      rows.push(row(a, 'ancestor', i, isImmediate ? 'Parent' : 'Ancestor'));
    });
    var base = ancestors.length;
    rows.push(row(unit, 'unit', base, 'This unit'));
    (function walk(node, level) {
      (kidsOf[String(node.assetId)] || []).forEach(function (k) {
        rows.push(row(k, 'descendant', level, depthBadge(level - base)));
        walk(k, level + 1);
      });
    })(unit, base + 1);
    return rows;
  }

  var resultCache = {};   // serialRefId → { at, result }

  // MAINTENANCE-TRACKED MASTERS ONLY. The serial's asset number alone is not
  // enough: on dev, 125 serials of NON-maintenance masters (IS_MAINTENANCE_TRACKED
  // ='N') still carry a MAINTENANCE_ASSET_NUMBER. The line-detail-units view has
  // no maintenance flag, so the master is read once per master and cached.
  // A failed read falls through to the check — for a warning, showing it on a
  // doubtful unit beats silently skipping a real parent.
  var masterCache = {};

  async function isMaintenanceMaster(context, Actions, masterId) {
    if (masterId == null || masterId === '') return true;
    var key = String(masterId);
    if (masterCache[key] !== undefined) return masterCache[key];
    try {
      var resp = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getEquipriteV1EquipmentMasterById',
        uriParams: { id: Number(masterId) }
      });
      if (!resp || !resp.ok || !resp.body) return true;
      masterCache[key] = String(resp.body.isMaintenanceTracked || '').toUpperCase() === 'Y';
      return masterCache[key];
    } catch (e) {
      console.warn('[assetChildren] master read failed for', masterId, e);
      return true;
    }
  }

  function empty(status) {
    return { status: status, unit: null, parent: null, childCount: 0,
             descendantCount: 0, truncated: false, rows: [] };
  }

  async function lookup(context, Actions, serialRefId, masterId) {
    if (serialRefId == null) return empty('NO_ASSET');
    if (!(await isMaintenanceMaster(context, Actions, masterId))) return empty('NOT_MAINTENANCE');

    var serial = await Actions.callRest(context, {
      endpoint:  'eqp-v1/getSerialRefById',
      uriParams: { id: Number(serialRefId) }
    });
    if (!serial || !serial.ok || !serial.body) {
      throw new Error('getSerialRefById HTTP ' + (serial && serial.status));
    }
    var num = serial.body.maintenanceAssetNumber;
    if (num == null || String(num).trim() === '') return empty('NO_ASSET');

    // Seeded 'MNT-*' numbers exist nowhere in Fusion — ordinary on dev.
    var unitRow = await readAsset(context, Actions, 'AssetNumber=' + qLit(String(num).trim()));
    if (!unitRow || unitRow.AssetId == null) {
      console.log('[assetChildren] no Fusion asset matches', num, '— no hierarchy to show');
      return empty('NO_ASSET');
    }
    var unit = shape(unitRow);

    // Up and down are independent — fetch them together.
    var both = await Promise.all([
      ancestorsOf(context, Actions, unit),
      descendantsOf(context, Actions, unit)
    ]);
    var ancestors = both[0];
    var down = both[1];

    var childCount = (down.kidsOf[String(unit.assetId)] || []).length;
    if (!ancestors.length && !childCount) {
      var none = empty('NO_RELATIONS');
      none.unit = unit;
      return none;
    }

    return {
      status:          'HAS_RELATIONS',
      unit:            unit,
      parent:          ancestors.length ? ancestors[ancestors.length - 1] : null,
      childCount:      childCount,
      descendantCount: down.total,
      truncated:       down.truncated,
      partial:         down.partial,
      rows:            flatten(ancestors, unit, down.kidsOf)
    };
  }

  // A hung Fusion call must not leave the row stuck on "Checking…". Past this,
  // the check is abandoned as ERROR and the unit is staged with a warning.
  var TIMEOUT_MS = 30 * 1000;

  function withTimeout(promise) {
    var timer;
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        timer = setTimeout(function () { reject(new Error('timed out after ' + TIMEOUT_MS + 'ms')); }, TIMEOUT_MS);
      })
    ]).finally(function () { clearTimeout(timer); });
  }

  async function forSerial(context, Actions, serialRefId, masterId) {
    var key = String(serialRefId);
    var hit = resultCache[key];
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;
    try {
      var result = await withTimeout(lookup(context, Actions, serialRefId, masterId));
      resultCache[key] = { at: Date.now(), result: result };
      return result;
    } catch (e) {
      // Not cached — the next click retries.
      console.warn('[assetChildren] lookup failed for serialRefId', serialRefId, e);
      return empty('ERROR');
    }
  }

  // VB keeps prior page instances in the DOM, so an id can appear more than
  // once. Prefer the copy sitting in a visible page; fall back to the newest.
  function findDialog(id) {
    var all = document.querySelectorAll('#' + id);
    for (var i = 0; i < all.length; i++) {
      var p = all[i].parentElement;
      if (p && p.offsetParent !== null) return all[i];
    }
    return all[all.length - 1] || null;
  }

  // Tell the user when an acknowledged/checked assign could not be staged —
  // otherwise the click looks like it did nothing.
  async function notifyOutcome(context, Actions, outcome, serial) {
    if (outcome !== 'FULL' && outcome !== 'GONE') return;
    await Actions.fireNotificationEvent(context, {
      summary:     'Not assigned',
      message:     (serial || 'This unit') + (outcome === 'FULL'
                     ? ' was not assigned: the line already has its full quantity staged. Release or cancel another unit first.'
                     : ' is no longer in the list (the yard or dates changed). Assign it again.'),
      type:        'warning',
      displayMode: 'transient'
    });
  }

  return {
    forSerial:     forSerial,
    findDialog:    findDialog,
    notifyOutcome: notifyOutcome
  };
});
