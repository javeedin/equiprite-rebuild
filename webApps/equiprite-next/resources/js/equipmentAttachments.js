define([], function () {
  'use strict';

  /**
   * Equipment attachments - shared rules for the Attachments dialog, used by
   * two pages with identical chains:
   *
   *   equipment-units-page        HEADER  the equipment master (any control type)
   *   equipment-unit-detail-page  LINE    one serial unit - and it also shows the
   *                                       master's documents read-only
   *
   * ── WHERE THINGS LIVE ───────────────────────────────────────────────────
   * The attachment RECORD is EquipRite's: EQR_ATTACHMENT (name, category,
   * validity dates, notes, status, uploader in CREATED_BY), served by eqpt
   * /equiprite/v1/equipment-attachments. The FILE is in Rite common-service
   * (OCI bucket document-library-dev); EQR_ATTACHMENT.COMMON_DOC_ID links to
   * it. Upload goes through eqpt, which stores the file in common-service
   * and the row in EquipRite in one call (and discards the file if the row
   * fails). View / Download still mint a 15-minute link from common-service
   * by commonDocId - nothing binary passes through VB.
   *
   * ── CATEGORIES DRIVE THE FORM ──────────────────────────────────────────
   * EQR_CONF_ATTACHMENT_CATEGORY (Configurations > Attachment Categories):
   * appliesTo HEADER | LINE | BOTH decides where a category is offered;
   * validityRequired Y shows Valid from / to and makes them required, N hides
   * them (the backend stores NULL). defaultValidityMonths pre-fills Valid to.
   *
   * Design + backend contract: MD/Equipment Master/Attachments/.
   */

  const ENTITY = { HEADER: 'EQR_EQUIPMENT_MASTER', LINE: 'EQR_SERIAL_REF' };

  // The backend's limit is 20 MB (413 above it); check before sending so the
  // user is told on pick, not after the upload.
  const MAX_BYTES = 20 * 1024 * 1024;
  const ACCEPT    = ['.pdf', '.docx', '.xlsx', '.png', '.jpg', '.jpeg'];

  /**
   * Which record this page's dialog attaches to. Both pages carry
   * equipmentId from the URL; the unit page also carries serialRefId.
   * Returns ids as numbers, or 0 when the URL did not supply one.
   */
  function target(page) {
    const v = page.variables;
    if (v.attLevel === 'LINE') {
      return {
        level: 'LINE',
        entityName: ENTITY.LINE,
        entityId: Number(v.serialRefId) || 0,
        // The serial's own master - its HEADER documents are shown read-only.
        inheritMasterId: Number(v.equipmentId) || 0
      };
    }
    return { level: 'HEADER', entityName: ENTITY.HEADER, entityId: Number(v.equipmentId) || 0, inheritMasterId: 0 };
  }

  // ── categories ─────────────────────────────────────────────────────────
  // {value,label,...} so the list binds straight into oj-select-single.
  function toCategoryOption(c) {
    return {
      value: c.id,
      label: c.categoryLabel || c.categoryCode,
      code: c.categoryCode,
      validityRequired: c.validityRequired === 'Y',
      defaultValidityMonths: c.defaultValidityMonths || null
    };
  }

  function findCategory(options, id) {
    if (id === null || id === undefined || id === '') return null;
    return (options || []).find(o => Number(o.value) === Number(id)) || null;
  }

  // ── dates ──────────────────────────────────────────────────────────────
  // Calendar dates ('YYYY-MM-DD'), compared as strings against the user's
  // LOCAL today. Never through new Date('YYYY-MM-DD'), which parses as UTC
  // midnight and lands on the previous day west of Greenwich.
  function todayIso() {
    const n = new Date();
    return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' +
           String(n.getDate()).padStart(2, '0');
  }

  function isoDate(v) { return v ? String(v).substring(0, 10) : ''; }

  // 'YYYY-MM-DD' + n months, minus one day: a 12-month certificate issued on
  // 2026-10-01 is valid to 2027-09-30. A month-end start is clamped to the
  // target month's last day before the day is taken off. Only a pre-fill -
  // the user can change it.
  function addMonthsIso(iso, months) {
    const p = String(iso || '').split('-').map(Number);
    if (p.length !== 3 || p.some(isNaN) || !months) return '';
    let y = p[0], m = p[1] - 1 + Number(months);
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    const lastDay = new Date(y, m + 1, 0).getDate();
    const d = new Date(y, m, Math.min(p[2], lastDay));
    d.setDate(d.getDate() - 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  // 'valid' | 'expired' | 'upcoming' | 'none' (category has no validity)
  function validityStatus(validityRequired, validFrom, validTo) {
    if (!validityRequired) return 'none';
    const f = isoDate(validFrom), t = isoDate(validTo), n = todayIso();
    if (!f && !t) return 'none';
    if (t && t < n) return 'expired';
    if (f && f > n) return 'upcoming';
    return 'valid';
  }

  const STATUS_LABEL = { valid: 'Valid', expired: 'Expired', upcoming: 'Upcoming', none: '' };

  // ── files ──────────────────────────────────────────────────────────────
  function extOf(name) {
    const m = /\.([A-Za-z0-9]+)$/.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }

  function fileTypeLabel(contentType, fileName) {
    const ext = extOf(fileName);
    if (ext) return ext === 'jpeg' ? 'JPG' : ext.toUpperCase();
    const ct = String(contentType || '').toLowerCase();
    if (ct.indexOf('pdf') > -1) return 'PDF';
    if (ct.indexOf('png') > -1) return 'PNG';
    if (ct.indexOf('jpeg') > -1 || ct.indexOf('jpg') > -1) return 'JPG';
    return ct ? ct.split('/').pop().toUpperCase() : 'FILE';
  }

  // What the dialog can preview in place. Everything else: Open / Download.
  function previewKind(typeLabel) {
    if (typeLabel === 'PDF') return 'pdf';
    if (typeLabel === 'PNG' || typeLabel === 'JPG') return 'image';
    return 'none';
  }

  function formatSize(bytes) {
    const b = Number(bytes);
    if (!b || isNaN(b)) return '';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB';
    return (b / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function acceptsFile(file) {
    if (!file) return 'Choose a file to upload.';
    if (ACCEPT.indexOf('.' + extOf(file.name)) === -1) {
      return 'Only PDF, Word, Excel, PNG and JPG files can be attached.';
    }
    if (!file.size) return 'That file is empty.';
    if (file.size > MAX_BYTES) {
      return 'The file is ' + formatSize(file.size) + '. The limit is ' + formatSize(MAX_BYTES) + '.';
    }
    return '';
  }

  // ── the picked File ────────────────────────────────────────────────────
  // Held here, not in a page variable: VB copies values assigned to page
  // variables and a browser File does not survive the copy. The page keeps
  // only {name,size,type} for display. RequireJS makes this one instance.
  let pendingFile = null;
  function setPendingFile(f) { pendingFile = f || null; }
  function getPendingFile()  { return pendingFile; }

  // ── backend errors ─────────────────────────────────────────────────────
  // eqpt answers Spring ProblemDetail plus a `message` copy of `detail`.
  function errorText(response, fallback) {
    const b = response && response.body;
    const text = b && (b.message || b.detail);
    return text ? String(text) : (fallback + (response && response.status ? ' (HTTP ' + response.status + ')' : ''));
  }

  function listBody(response) {
    const b = response && response.body;
    if (b && Array.isArray(b.data)) return b.data;
    return Array.isArray(b) ? b : [];
  }

  /** One EquipmentAttachmentDto -> the row shape the dialog binds to. */
  function toRow(dto) {
    const type = fileTypeLabel(dto.contentType, dto.fileName);
    const validityRequired = dto.validityRequired === 'Y';
    const status = validityStatus(validityRequired, dto.validFromDate, dto.validToDate);
    return {
      id:               dto.id,
      commonDocId:      dto.commonDocId,
      entityName:       dto.entityName,
      name:             dto.attachmentName || dto.fileName || ('Attachment ' + dto.id),
      fileName:         dto.fileName || '',
      fileType:         type,
      fileSize:         formatSize(dto.fileSize),
      preview:          previewKind(type),
      categoryId:       dto.categoryId,
      categoryLabel:    dto.categoryLabel || dto.categoryCode || 'Uncategorised',
      validityRequired: validityRequired,
      validFrom:        isoDate(dto.validFromDate),
      validTo:          isoDate(dto.validToDate),
      status:           status,
      statusLabel:      STATUS_LABEL[status],
      // Never show the backend's fallback stamp as if it were a person.
      uploadedBy:       dto.createdBy && dto.createdBy !== 'SYSTEM' ? dto.createdBy : '',
      uploadDate:       isoDate(dto.createdDate),
      notes:            dto.notes || '',
      objectVersionNumber: dto.objectVersionNumber
    };
  }

  return {
    ENTITY: ENTITY,
    MAX_BYTES: MAX_BYTES,
    ACCEPT: ACCEPT,
    target: target,
    toCategoryOption: toCategoryOption,
    findCategory: findCategory,
    todayIso: todayIso,
    addMonthsIso: addMonthsIso,
    validityStatus: validityStatus,
    fileTypeLabel: fileTypeLabel,
    formatSize: formatSize,
    acceptsFile: acceptsFile,
    setPendingFile: setPendingFile,
    getPendingFile: getPendingFile,
    errorText: errorText,
    listBody: listBody,
    toRow: toRow
  };
});
