define([
  'vb/action/actionChain',
  'vb/action/actions',
], function(ActionChain, Actions) {
  'use strict';

  // Eye-preview → open the preview dialog showing the template's lines.
  // READ-ONLY: fetches the template's lines lazily (by serverId), enriches each
  // against the catalog (name / class) for display, and lists them with a
  // selection checkbox. No cart writes, no staging — the user reviews here and
  // then either "Add selected to cart" or "Show in catalog".
  class CatalogPreviewTemplateChain extends ActionChain {
    async run(context, { templateId } = {}) {
      var $page = context.$page;
      var $flow = context.$flow;

      var templates = $page.variables.templatesArray || [];
      var template = templates.find(function(t) {
        return t.templateId === templateId || String(t.templateId) === String(templateId);
      });
      if (!template) { return; }

      // Reset + open dialog in a loading state.
      $page.variables.previewTemplateName        = template.templateName || '';
      $page.variables.previewTemplateDescription = template.description || '';
      $page.variables.previewTemplateServerId    = template.serverId != null ? Number(template.serverId) : null;
      $page.variables.previewLinesArray          = [];
      $page.variables.previewSelectedKeys        = [];
      $page.variables.previewSelectionTick       = ($page.variables.previewSelectionTick || 0) + 1;
      $page.variables.isPreviewLoading           = true;

      var dialog = document.getElementById('templatePreviewDialog');
      if (dialog && typeof dialog.open === 'function') { dialog.open(); }

      try {
        var lines = await fetchTemplateLines(context, template.serverId);
        var catalogById = await fetchCatalogById(context, $flow);

        var rows = [];
        lines.forEach(function(line) {
          var masterId = line.equipmentMasterId != null ? line.equipmentMasterId : line.equipmentId;
          if (masterId == null) { return; }
          var row = catalogById[Number(masterId)];
          rows.push({
            equipmentMasterId: Number(masterId),
            name:      row ? (row.equipmentName || '') : ('Equipment #' + masterId),
            className: row ? (row.className || row.category || '') : '',
            quantity:  Number(line.quantity) || 1,
            available: !!row,                       // false → no longer in catalog
            classId:   line.equipmentClassId != null ? Number(line.equipmentClassId) : (row && row.eqrEquipmentClassId != null ? Number(row.eqrEquipmentClassId) : null),
            _row:      row || null                  // captured for the add-to-cart path
          });
        });

        $page.variables.previewLinesArray = rows;
      } catch (e) {
        console.warn('[CatalogPreviewTemplate] load failed:', e);
        $page.variables.previewLinesArray = [];
      } finally {
        $page.variables.isPreviewLoading = false;
      }
    }
  }

  // Fetch a template's lines by id (lazy). Returns [].
  async function fetchTemplateLines(context, serverId) {
    if (serverId == null) return [];
    try {
      var resp = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getTemplateLines',
        uriParams: { templateId: Number(serverId) }
      });
      return (resp && resp.ok && resp.body && Array.isArray(resp.body.data)) ? resp.body.data : [];
    } catch (e) {
      console.warn('[CatalogPreviewTemplate] line fetch failed:', e);
      return [];
    }
  }

  // Fetch the catalog for the request window and return { masterId: row } for
  // enrichment (name / class). Falls back to today → today+7 when no request
  // dates are set yet so lines still resolve.
  async function fetchCatalogById(context, $flow) {
    var out = {};
    var req = $flow.variables.request || {};
    var startDate = req.startDate, endDate = req.endDate;
    if (!startDate || !endDate) {
      var today = new Date();
      var plus7 = new Date(today.getTime() + 7 * 86400000);
      startDate = toIso(today);
      endDate   = toIso(plus7);
    }
    try {
      var resp = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1ViewsEquipmentCatalog',
        uriParams: {
          startDate: String(startDate).substring(0, 10),
          endDate:   String(endDate).substring(0, 10),
          requestedQty: 1, page: 0, size: 10000
        }
      });
      var rows = (resp && resp.ok && resp.body && Array.isArray(resp.body.data)) ? resp.body.data : [];
      rows.forEach(function(r) { out[Number(r.eqrEquipmentMasterId)] = r; });
    } catch (e) {
      console.warn('[CatalogPreviewTemplate] catalog fetch failed:', e);
    }
    return out;
  }

  function toIso(d) {
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  return CatalogPreviewTemplateChain;
});
