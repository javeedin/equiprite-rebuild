define([], () => {
  'use strict';

  class PageModule {}

  PageModule.prototype.formatCurrency = function(value) {
    if (value == null) return '$0';
    return '$' + Number(value).toLocaleString();
  };

  // Kept for compatibility with any caller still computing inline. The table
  // now reads the precomputed `allocation_pct` mapped in WorkbenchInitChain,
  // which is the single place the percentage is derived.
  PageModule.prototype.getAllocationPct = function(allocated, total) {
    const t = Number(total);
    const a = Number(allocated);
    if (!Number.isFinite(t) || t <= 0) return 0;
    if (!Number.isFinite(a) || a <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((a / t) * 100)));
  };

  // Allocation tone buckets — 'complete' (fully allocated), 'partial' (some
  // lines allocated) and 'none' (nothing allocated yet, needs attention).
  // Declared standalone rather than via `this` so it stays correct when the
  // table template invokes it detached from the module instance.
  const allocationTone = (pct) => {
    const p = Number(pct);
    if (!Number.isFinite(p) || p <= 0) return 'none';
    return p >= 100 ? 'complete' : 'partial';
  };

  PageModule.prototype.allocationTone = function(pct) {
    return allocationTone(pct);
  };

  PageModule.prototype.allocationToneClass = function(pct) {
    return 'wb-alloc-pct--' + allocationTone(pct);
  };

  return PageModule;
});
