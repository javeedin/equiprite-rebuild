define([], function () {
  'use strict';

  /**
   * Record Cost - PROOF OF CONCEPT. Nothing here calls a server.
   *
   * equipment-record-cost-page records a cost against ONE unit (the serial
   * page's "Record Cost" button) in one of four ways. Record builds the
   * Fusion REST request it WOULD send (not shown on screen - removed from the
   * page 2026-10-13) and "submits" by returning a mock 201. The real build should post through the eqpt backend / OIC like
   * every other Fusion write in this app, never straight from the browser.
   *
   * ── WHERE EACH PAYLOAD SHAPE COMES FROM ─────────────────────────────────
   *   Raw Cost        unprocessedProjectCosts. PROVEN - old EquipRite's
   *                   production builder (MD/Fusion Rates/04_OLD_EQUIPRITE_
   *                   AUDIT.md §2). 'Equiprite Source' x3 is the source /
   *                   document / entry configured on dev9.
   *   Material Issue  inventoryStagedTransactions, 'Project Issue', NEGATIVE
   *                   quantity, projectCostingDFFs. PROVEN - old EquipRite's
   *                   postinventory() (MD/Consumeable/_SESSION_HANDOFF_
   *                   consumables.md §10).
   *   Expense Report  expenseReports. NOT PROVEN - modelled from Oracle's
   *                   Expenses REST; EquipRite has never posted one. The real
   *                   resource wants PersonId / ExpenseTypeId, not the names.
   *   AP Invoice      invoices. NOT PROVEN - modelled from Oracle's Payables
   *                   REST; EquipRite has never posted one.
   *
   * All four carry project / task / expenditure type / expenditure org the
   * same way: the PJC descriptive flexfield with *_Display segments, which
   * Fusion resolves from numbers and names. That is the proven PR / material
   * issue mechanism; on the two unproven resources the child name is a guess.
   */

  const BASE = '/fscmRestApi/resources/11.13.18.05/';

  const TABS = [
    {
      id: 'rawCost', label: 'RAW COST', icon: 'oj-ux-ico-calculator',
      title: 'Raw Cost', resource: 'unprocessedProjectCosts',
      blurb: 'A cost amount imported straight into Project Costing against this unit.'
    },
    {
      id: 'materialIssue', label: 'MATERIAL ISSUE', icon: 'oj-ux-ico-box',
      title: 'Material Issue', resource: 'inventoryStagedTransactions',
      blurb: 'Parts or consumables issued from stock to the project for this unit. Fusion costs it at the item\'s current cost.'
    },
    {
      id: 'expenseReport', label: 'EXPENSE REPORT', icon: 'oj-ux-ico-wallet',
      title: 'Expense Report', resource: 'expenseReports',
      blurb: 'An employee-paid expense for this unit (fuel, tolls, small repairs) charged to the project.'
    },
    {
      id: 'apInvoice', label: 'AP INVOICE', icon: 'oj-ux-ico-invoice',
      title: 'AP Invoice', resource: 'invoices',
      blurb: 'A supplier invoice for this unit (third-party repair, rental, freight) with a project-coded line.'
    }
  ];

  const REQUIRED = {
    rawCost: [
      ['businessUnit', 'Business Unit'], ['transactionSource', 'Transaction Source'],
      ['document', 'Document'], ['documentEntry', 'Document Entry'],
      ['quantity', 'Quantity'], ['rawCost', 'Raw Cost']
    ],
    materialIssue: [
      ['organizationName', 'Inventory Organization'], ['transactionType', 'Transaction Type'],
      ['itemNumber', 'Item'], ['subinventory', 'Subinventory'],
      ['quantity', 'Quantity'], ['uom', 'Unit of Measure'], ['transactionDate', 'Transaction Date']
    ],
    expenseReport: [
      ['personNumber', 'Employee Number'], ['purpose', 'Purpose'],
      ['expenseDate', 'Expense Date'], ['expenseType', 'Expense Type'],
      ['receiptAmount', 'Receipt Amount'], ['receiptCurrency', 'Receipt Currency']
    ],
    apInvoice: [
      ['businessUnit', 'Business Unit'], ['supplier', 'Supplier'], ['supplierSite', 'Supplier Site'],
      ['invoiceNumber', 'Invoice Number'], ['invoiceDate', 'Invoice Date'],
      ['currency', 'Currency'], ['lineAmount', 'Line Amount']
    ]
  };

  // Every tab needs the project coding - it is what makes the cost land on
  // the project rather than in a clearing account.
  const PROJECT_REQUIRED = [
    ['projectNumber', 'Project Number'], ['taskNumber', 'Task Number'],
    ['expenditureType', 'Expenditure Type'], ['expenditureOrganization', 'Expenditure Organization'],
    ['expenditureItemDate', 'Expenditure Item Date']
  ];

  // Numeric fields that must be a real, positive amount.
  const POSITIVE = ['quantity', 'rawCost', 'receiptAmount', 'lineAmount'];

  // ── helpers ──────────────────────────────────────────────────────────────
  function pad(n) { return String(n).padStart(2, '0'); }

  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function ymd(iso) { return String(iso || today()).substring(0, 10).replace(/-/g, ''); }

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }

  function blank(v) { return v === null || v === undefined || (typeof v === 'string' && v.trim() === ''); }

  // Drop blank optional values so the preview shows only what would be sent.
  function clean(obj) {
    const out = {};
    Object.keys(obj).forEach(k => { if (!blank(obj[k])) out[k] = obj[k]; });
    return out;
  }

  function pjc(p) {
    return clean({
      _PROJECT_ID_Display:          p.projectNumber,
      _TASK_ID_Display:             p.taskNumber,
      _EXPENDITURE_TYPE_ID_Display: p.expenditureType,
      _ORGANIZATION_ID_Display:     p.expenditureOrganization,
      _EXPENDITURE_ITEM_DATE:       p.expenditureItemDate
    });
  }

  function money(v, cur) {
    const n = num(v);
    if (n === null) return '';
    try {
      return n.toLocaleString(undefined, { style: 'currency', currency: cur || 'USD' });
    } catch (e) {
      return (cur || '') + ' ' + n.toFixed(2);
    }
  }

  // ── context: who the cost is for ─────────────────────────────────────────
  // Built from the same two records the serial page reads. Project and task
  // are laid over the unit by unitProjectStore.apply() before this runs (the
  // serial DTO has no such fields yet); decal stays blank until the backend
  // adds it.
  function buildContext(unit, master, ids) {
    const u = unit || {};
    const m = master || {};
    return {
      serialRefId:     ids.serialRefId || '',
      equipmentId:     ids.equipmentId || u.equipmentId || '',
      controlType:     ids.controlType || 'SERIAL',
      serialNumber:    u.serialNumber || u.lotNumber || '',
      equipmentNumber: u.unitTagNumber || m.equipmentNumber || '',
      equipmentName:   m.equipmentName || '',
      itemNumber:      u.attribute5 || '',
      invOrgName:      u.eqpInvOrgName || '',
      subinventory:    u.currentSubinventory || '',
      locator:         u.currentLocator || '',
      expenditureOrg:  u.attributeCategory || '',
      maintAssetNumber: u.maintenanceAssetNumber || '',
      projectNumber:   u.projectNumber || '',
      taskNumber:      u.taskNumber || '',
      decalNumber:     u.decalNumber || ''
    };
  }

  // ── form defaults ────────────────────────────────────────────────────────
  // The project coding is ONE form shared by all four tabs ("Charge To"):
  // it is the same five values whichever way the cost is recorded. Project
  // and task are copied from the unit and are NOT editable on the page - only
  // the expenditure type / org and item date are keyed in.
  function projectDefaults(ctx) {
    const c = ctx || {};
    return {
      projectNumber: c.projectNumber || '',
      taskNumber: c.taskNumber || '',
      expenditureType: '',
      expenditureOrganization: c.expenditureOrg || '',
      expenditureItemDate: today()
    };
  }

  function defaults(tab, ctx) {
    const c = ctx || {};
    const t = today();
    const serial = c.serialNumber || '';

    switch (tab) {
      case 'rawCost':
        return {
          businessUnit: '',
          transactionSource: 'Equiprite Source',
          document: 'Equiprite Source',
          documentEntry: 'Equiprite Source',
          expenditureBatch: 'EQR-' + serial + '-' + ymd(t),
          quantity: 1,
          rawCost: null,
          currency: 'USD',
          nonlaborResource: '',
          nonlaborResourceOrganization: c.expenditureOrg || '',
          billable: 'Y',
          comment: ''
        };

      case 'materialIssue':
        return {
          organizationName: c.invOrgName || '',
          transactionType: 'Project Issue',
          itemNumber: '',
          subinventory: c.subinventory || '',
          locator: c.locator || '',
          quantity: 1,
          uom: 'Each',
          transactionDate: t,
          reason: '',
          reference: serial ? 'Serial ' + serial : ''
        };

      case 'expenseReport':
        return {
          personNumber: '',
          purpose: serial ? 'Equipment costs - ' + serial : 'Equipment costs',
          reportDate: t,
          currency: 'USD',
          expenseDate: t,
          expenseType: 'Fuel',
          merchant: '',
          receiptAmount: null,
          receiptCurrency: 'USD',
          location: '',
          description: serial ? 'Serial ' + serial : ''
        };

      case 'apInvoice':
        return {
          businessUnit: '',
          supplier: '',
          supplierSite: '',
          invoiceNumber: '',
          invoiceDate: t,
          invoiceType: 'Standard',
          currency: 'USD',
          paymentTerms: 'Net 30',
          description: serial ? 'Equipment ' + serial : '',
          lineType: 'Item',
          lineAmount: null,
          lineDescription: serial ? 'Serial ' + serial : ''
        };

      default:
        return {};
    }
  }

  // ── validation ───────────────────────────────────────────────────────────
  // Labels of the required fields that are empty (or not a positive amount).
  function missingFields(tab, form, project) {
    const f = form || {};
    const p = project || {};
    const bad = (obj) => ([key]) => blank(obj[key]) || (POSITIVE.indexOf(key) >= 0 && !(num(obj[key]) > 0));
    return (REQUIRED[tab] || []).filter(bad(f))
      .concat(PROJECT_REQUIRED.filter(bad(p)))
      .map(([, label]) => label);
  }

  // ── the request each tab would send ──────────────────────────────────────
  function buildRequest(tab, form, project, ctx) {
    const f = form || {};
    const p = project || {};
    const c = ctx || {};
    const serial = c.serialNumber || '';
    const meta = TABS.find(t => t.id === tab) || TABS[0];
    let body;

    switch (tab) {
      case 'rawCost':
        body = clean({
          BusinessUnit:                 f.businessUnit,
          TransactionSource:            f.transactionSource,
          Document:                     f.document,
          DocumentEntry:                f.documentEntry,
          ExpenditureBatch:             f.expenditureBatch,
          // Fusion rejects a duplicate reference, so it has to be unique per
          // posting. The real build adds a sequence; the mock uses the date.
          OriginalTransactionReference: 'EQR-' + serial + '-RC-' + ymd(p.expenditureItemDate),
          Quantity:                     num(f.quantity),
          RawCostInTransactionCurrency: num(f.rawCost),
          TransactionCurrencyCode:      f.currency,
          NonlaborResource:             f.nonlaborResource,
          NonlaborResourceOrganization: f.nonlaborResourceOrganization,
          BillableFlag:                 f.billable === 'Y',
          ExpenditureComment:           f.comment,
          AccountingDate:               p.expenditureItemDate,
          ProjectStandardCostCollectionFlexfields: [pjc(p)]
        });
        break;

      case 'materialIssue':
        body = clean({
          OrganizationName:         f.organizationName,
          ItemNumber:               f.itemNumber,
          TransactionTypeName:      f.transactionType,
          // An issue DECREASES stock, so Fusion wants it negative.
          TransactionQuantity:      num(f.quantity) === null ? null : -Math.abs(num(f.quantity)),
          TransactionUnitOfMeasure: f.uom,
          TransactionDate:          f.transactionDate,
          SubinventoryCode:         f.subinventory,
          LocatorName:              f.locator,
          ReasonName:               f.reason,
          TransactionReference:     f.reference,
          UseCurrentCostFlag:       'Y',
          TransactionMode:          '2',
          SourceCode:               'EQUIPRITE',
          SourceHeaderId:           String(c.serialRefId || ''),
          SourceLineId:             String(c.serialRefId || ''),
          projectCostingDFFs:       [pjc(p)]
        });
        break;

      case 'expenseReport':
        body = clean({
          PersonNumber:              f.personNumber,
          Purpose:                   f.purpose,
          ExpenseReportDate:         f.reportDate,
          ReimbursementCurrencyCode: f.currency,
          Expense: [clean({
            StartDate:           f.expenseDate,
            ExpenseType:         f.expenseType,
            MerchantName:        f.merchant,
            ReceiptAmount:       num(f.receiptAmount),
            ReceiptCurrencyCode: f.receiptCurrency,
            Location:            f.location,
            Description:         f.description,
            ExpenseDistribution: [{ PJCDFF: [pjc(p)] }]
          })]
        });
        break;

      case 'apInvoice': {
        // A credit memo carries negative amounts; everything else positive.
        const sign = f.invoiceType === 'Credit Memo' ? -1 : 1;
        const amount = num(f.lineAmount) === null ? null : sign * Math.abs(num(f.lineAmount));
        body = clean({
          InvoiceNumber:   f.invoiceNumber,
          InvoiceType:     f.invoiceType,
          InvoiceDate:     f.invoiceDate,
          InvoiceCurrency: f.currency,
          InvoiceAmount:   amount,
          BusinessUnit:    f.businessUnit,
          Supplier:        f.supplier,
          SupplierSite:    f.supplierSite,
          PaymentTerms:    f.paymentTerms,
          Description:     f.description,
          invoiceLines: [clean({
            LineNumber:            1,
            LineType:              f.lineType,
            LineAmount:            amount,
            Description:           f.lineDescription,
            invoiceLineProjectDFF: [pjc(p)]
          })]
        });
        break;
      }

      default:
        body = {};
    }

    return { method: 'POST', path: BASE + meta.resource, body: body };
  }

  // ── the mock answer ──────────────────────────────────────────────────────
  // Deliberately generic: no invented Fusion response fields, just a mock id
  // and an echo of what identifies the record.
  function mockResponse(tab, request, seq) {
    const b = request.body || {};
    const prefix = { rawCost: 'RC', materialIssue: 'MI', expenseReport: 'EX', apInvoice: 'AP' }[tab] || 'XX';
    const echo = {
      rawCost:       { OriginalTransactionReference: b.OriginalTransactionReference, ExpenditureBatch: b.ExpenditureBatch },
      materialIssue: { ItemNumber: b.ItemNumber, TransactionQuantity: b.TransactionQuantity, TransactionTypeName: b.TransactionTypeName },
      expenseReport: { Purpose: b.Purpose },
      apInvoice:     { InvoiceNumber: b.InvoiceNumber, InvoiceAmount: b.InvoiceAmount }
    }[tab] || {};
    return {
      status: 201,
      body: Object.assign({ MockId: prefix + '-' + String(seq).padStart(4, '0') }, clean(echo), {
        _note: 'Mock response - nothing was sent to Fusion.'
      })
    };
  }

  // One row for the "Recorded this session" list.
  function toRecordedRow(tab, form, project, request, response, seq) {
    const f = form || {};
    const p = project || {};
    const b = request.body || {};
    const meta = TABS.find(t => t.id === tab) || {};
    const amount = {
      rawCost:       money(f.rawCost, f.currency),
      materialIssue: (num(f.quantity) || 0) + ' ' + (f.uom || '') + ' at item cost',
      expenseReport: money(f.receiptAmount, f.receiptCurrency),
      apInvoice:     money(b.InvoiceAmount, f.currency)
    }[tab] || '';
    const reference = {
      rawCost:       b.OriginalTransactionReference,
      materialIssue: f.itemNumber,
      expenseReport: f.purpose,
      apInvoice:     f.invoiceNumber
    }[tab] || '';
    const d = new Date();
    return {
      id: seq,
      mockId: response.body.MockId,
      type: meta.title || tab,
      reference: reference || '',
      projectTask: [p.projectNumber, p.taskNumber].filter(Boolean).join(' / '),
      amount: amount,
      recordedAt: pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
    };
  }

  return {
    TABS: TABS,
    buildContext: buildContext,
    projectDefaults: projectDefaults,
    defaults: defaults,
    missingFields: missingFields,
    buildRequest: buildRequest,
    mockResponse: mockResponse,
    toRecordedRow: toRecordedRow
  };
});
