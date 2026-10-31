define([], function () {
  'use strict';

  /**
   * EquipRite Future: the demo group (FDD v2.0). Three legal entities in two countries:
   *   FleetCo (UAE) holds the fleet (Company 2) and rents to its own customers;
   *   ProjectCo (UAE) does projects (Company 1), with a second BU (Facilities) in the same legal entity that owns a few
   *     units of its own, so own-fleet (SAME_BU) and cross-charge (SAME_LE) cases exist too;
   *   ProjectCo Arabia (KSA) does projects across the border (IC_CROSS_BORDER).
   * Everything is example data: rates, tax and exchange rates are editable in Setup and confirmed by Finance and Tax
   * before any real use. seed() returns a fresh state every time.
   */
  function seed() {
    var start = '2026-11-02';
    return {
      version: 3,
      today: start,
      startDate: start,
      personaId: 'p-pm',
      seq: { request: 1000, line: 0, charge: 0, statement: 0, tx: 0, invoice: 100, note: 0, log: 0, customs: 0, dispute: 0, move: 0 },
      settings: {
        requesterApproval: false,      // OD-12: only the sourcing BU approves (the user's choice); a threshold when on
        requesterThreshold: 50000,
        invoicing: 'PAIR',             // OD-01: the invoice pair from EquipRite (AR in the owner, AP in the user)
        billingFrequency: 'MONTHLY',   // OD-06
        onHire: 'RECEIPT',             // OD-05: on hire at receipt on site, off hire at the site's release
        disputeDays: 3,                // MC-FR-23
        cutoffDay: 4,                  // OD-06: invoices by day 4 of the next month, else accrued
        s2Billing: 'PPM',              // OD-07: ProjectCo bills Customer X through its project contract
        netting: true,                 // OD-10
        damageThreshold: 5000,         // OD-11: damage above this needs the user's acceptance
        lossMarkupPct: 0.1,            // OD-11: loss value = net book value + 10 %
        groupCurrency: 'AED',
        simulateFailure: false         // the next invoice pair fails once (to show retry)
      },
      countries: [
        { code: 'AE', name: 'United Arab Emirates', currency: 'AED', vat: 0.05, wht: 0, weekend: [6, 0], tz: 'Asia/Dubai', eInvoicing: 'Planned (Fusion localisation)' },
        { code: 'SA', name: 'Saudi Arabia', currency: 'SAR', vat: 0.15, wht: 0.05, weekend: [5, 6], tz: 'Asia/Riyadh', eInvoicing: 'Mandatory (Fusion localisation)' }
      ],
      // Exchange rates to the group currency (AED) per 1 unit; the AED↔SAR peg with a small daily drift (fx.rate).
      fx: { base: { AED: 1, SAR: 0.9793 }, drift: 0.0006 },
      companies: [
        { id: 'LE-FC', name: 'FleetCo Equipment LLC', short: 'FleetCo', country: 'AE', currency: 'AED', taxReg: 'AE-TRN-100200300', icOrg: 'IC-FLEETCO', role: 'Company 2: holds the fleet' },
        { id: 'LE-PC', name: 'ProjectCo Contracting LLC', short: 'ProjectCo', country: 'AE', currency: 'AED', taxReg: 'AE-TRN-100400500', icOrg: 'IC-PROJECTCO', role: 'Company 1: does projects' },
        { id: 'LE-PK', name: 'ProjectCo Arabia Ltd', short: 'ProjectCo KSA', country: 'SA', currency: 'SAR', taxReg: 'SA-VAT-300600900', icOrg: 'IC-PROJECTCO-KSA', role: 'Company 3: projects in KSA' }
      ],
      bus: [
        { id: 'BU-FC', name: 'FleetCo Fleet', le: 'LE-FC', roles: ['fleet', 'rental'] },
        { id: 'BU-PC', name: 'ProjectCo Projects', le: 'LE-PC', roles: ['projects'] },
        { id: 'BU-PF', name: 'ProjectCo Facilities', le: 'LE-PC', roles: ['fleet', 'projects'] },
        { id: 'BU-PK', name: 'ProjectCo KSA Projects', le: 'LE-PK', roles: ['projects'] }
      ],
      orgs: [
        { id: 'FC-YARD', name: 'FleetCo Jebel Ali Yard', bu: 'BU-FC', le: 'LE-FC', country: 'AE', kind: 'yard' },
        { id: 'FC-DEP-AE', name: 'FleetCo deployed · UAE sites', bu: 'BU-FC', le: 'LE-FC', country: 'AE', kind: 'deploy' },
        { id: 'FC-DEP-SA', name: 'FleetCo deployed · KSA sites', bu: 'BU-FC', le: 'LE-FC', country: 'SA', kind: 'deploy' },
        { id: 'FC-CUST-AE', name: 'FleetCo at customer sites · UAE', bu: 'BU-FC', le: 'LE-FC', country: 'AE', kind: 'customer' },
        { id: 'PF-STORE', name: 'ProjectCo Facilities store', bu: 'BU-PF', le: 'LE-PC', country: 'AE', kind: 'yard' },
        { id: 'PC-SITE', name: 'ProjectCo site store', bu: 'BU-PC', le: 'LE-PC', country: 'AE', kind: 'site' }
      ],
      classes: [
        { id: 'EXC', name: 'Excavators', icon: 'oj-ux-ico-truck' },
        { id: 'CRN', name: 'Cranes', icon: 'oj-ux-ico-crane' },
        { id: 'GEN', name: 'Generators', icon: 'oj-ux-ico-lightning' },
        { id: 'LFT', name: 'Access platforms', icon: 'oj-ux-ico-arrow-up' },
        { id: 'TWR', name: 'Light towers', icon: 'oj-ux-ico-lightbulb' }
      ],
      units: [
        unit('U-EX1', 'EX-1001', 'CAT 320 Excavator', 'EXC', 'BU-FC', 'ASSET', 'FC-YARD', { number: 'FA-10021', cost: 600000, accDep: 120000, depMonthly: 5000 }, [cert('AE', 'Third-party inspection', '2027-06-30'), cert('SA', 'SASO conformity', '2027-02-28')]),
        unit('U-EX2', 'EX-1002', 'CAT 320 Excavator', 'EXC', 'BU-FC', 'ASSET', 'FC-YARD', { number: 'FA-10022', cost: 600000, accDep: 150000, depMonthly: 5000 }, [cert('AE', 'Third-party inspection', '2027-01-31')]),
        unit('U-EX3', 'EX-1003', 'Komatsu PC210 Excavator', 'EXC', 'BU-FC', 'STOCK', 'FC-YARD', { item: 'EQ-EXC-210', bookValue: 420000 }, [cert('AE', 'Third-party inspection', '2027-04-30'), cert('SA', 'SASO conformity', '2026-11-20')]),
        unit('U-CR1', 'CR-2001', 'Liebherr 60t Mobile Crane', 'CRN', 'BU-FC', 'ASSET', 'FC-YARD', { number: 'FA-20011', cost: 1800000, accDep: 300000, depMonthly: 15000 }, [cert('AE', 'Lifting certificate', '2027-03-31'), cert('SA', 'Lifting certificate (KSA)', '2027-05-31')]),
        unit('U-GN1', 'GN-3001', 'Atlas 200 kVA Generator', 'GEN', 'BU-FC', 'STOCK', 'FC-YARD', { item: 'EQ-GEN-200', bookValue: 95000 }, [cert('AE', 'Electrical test', '2027-08-31'), cert('SA', 'Electrical test', '2027-08-31')]),
        unit('U-GN2', 'GN-3002', 'Atlas 200 kVA Generator', 'GEN', 'BU-FC', 'STOCK', 'FC-YARD', { item: 'EQ-GEN-200', bookValue: 95000 }, [cert('AE', 'Electrical test', '2027-08-31')]),
        unit('U-LF1', 'LF-4001', 'JLG 18m Boom Lift', 'LFT', 'BU-FC', 'ASSET', 'FC-YARD', { number: 'FA-40011', cost: 260000, accDep: 40000, depMonthly: 2200 }, [cert('AE', 'Lifting certificate', '2027-02-28')]),
        unit('U-LF2', 'LF-4002', 'Genie 12m Scissor Lift', 'LFT', 'BU-FC', 'ASSET', 'FC-YARD', { number: 'FA-40012', cost: 140000, accDep: 30000, depMonthly: 1200 }, [cert('AE', 'Lifting certificate', '2027-05-31'), cert('SA', 'Lifting certificate (KSA)', '2027-05-31')]),
        unit('U-TW1', 'TW-5001', 'Light Tower 4×1000W', 'TWR', 'BU-PF', 'ASSET', 'PF-STORE', { number: 'FA-PF-0701', cost: 45000, accDep: 9000, depMonthly: 375 }, [cert('AE', 'Electrical test', '2027-09-30')]),
        unit('U-GN9', 'GN-3901', 'Small 60 kVA Generator', 'GEN', 'BU-PC', 'ASSET', 'PC-SITE', { number: 'FA-PC-0099', cost: 38000, accDep: 12000, depMonthly: 320 }, [cert('AE', 'Electrical test', '2027-07-31')])
      ],
      projects: [
        { id: 'P-INT', number: 'PC-INT-014', name: 'ProjectCo head office fit-out', bu: 'BU-PC', type: 'internal', capital: true, tasks: ['1.1 Site works', '1.2 MEP'], country: 'AE', site: 'Business Bay, Dubai' },
        { id: 'P-EXT', number: 'PC-C-2207', name: 'Marina Tower (Customer X)', bu: 'BU-PC', type: 'contract', customer: 'C-X', markupPct: 0.4, tasks: ['2.1 Excavation', '2.2 Structure'], country: 'AE', site: 'Dubai Marina' },
        { id: 'P-KSA', number: 'PK-C-0310', name: 'Riyadh Metro Depot (Customer Z)', bu: 'BU-PK', type: 'contract', customer: 'C-Z', markupPct: 0.35, tasks: ['3.1 Earthworks', '3.2 Lifting'], country: 'SA', site: 'Riyadh' },
        { id: 'P-FAC', number: 'PF-INT-003', name: 'Facilities: warehouse upgrade', bu: 'BU-PF', type: 'internal', capital: false, tasks: ['1 Works'], country: 'AE', site: 'Al Quoz, Dubai' }
      ],
      customers: [
        { id: 'C-X', name: 'Customer X · Marina Developments', of: 'LE-PC', country: 'AE', creditLimit: 2000000 },
        { id: 'C-Y', name: 'Customer Y · Gulf Builders', of: 'LE-FC', country: 'AE', creditLimit: 150000, depositPct: 0.25 },
        { id: 'C-W', name: 'Customer W · Oman Roads (credit hold)', of: 'LE-FC', country: 'AE', creditLimit: 0, onHold: true },
        { id: 'C-Z', name: 'Customer Z · Riyadh Transit', of: 'LE-PK', country: 'SA', creditLimit: 3000000 }
      ],
      // MC-FR-04: who may source from whom, and how they settle.
      icRelations: [
        { id: 'R1', provider: 'BU-FC', receiver: 'BU-PC', allowed: true, priority: 2, leadDays: 2, crossBorder: false, mechanism: 'PAIR', netting: true },
        { id: 'R2', provider: 'BU-FC', receiver: 'BU-PK', allowed: true, priority: 2, leadDays: 7, crossBorder: true, mechanism: 'PAIR', netting: true },
        { id: 'R3', provider: 'BU-PF', receiver: 'BU-PC', allowed: true, priority: 1, leadDays: 1, crossBorder: false, mechanism: 'CROSS_CHARGE', netting: false },
        { id: 'R4', provider: 'BU-FC', receiver: 'BU-PF', allowed: true, priority: 2, leadDays: 2, crossBorder: false, mechanism: 'PAIR', netting: true }
      ],
      // MC-FR-05: intercompany agreements (versioned); rates per class per day and per week, in the agreement's currency.
      agreements: [
        icAgreement('ICA-01', 'ICA-FC-PC-2026', 'BU-FC', 'BU-PC', 'AED', 'DOMESTIC', 0),
        icAgreement('ICA-02', 'ICA-FC-PK-2026', 'BU-FC', 'BU-PK', 'AED', 'REVERSE_CHARGE', 0.05),
        icAgreement('ICA-03', 'ICA-FC-PF-2026', 'BU-FC', 'BU-PF', 'AED', 'DOMESTIC', 0),
        { id: 'XCA-01', number: 'XC-PF-PC-2026', kind: 'CROSS_CHARGE', provider: 'BU-PF', receiver: 'BU-PC', currency: 'AED', status: 'ACTIVE', version: 1, versions: [{ version: 1, from: '2026-01-01', approvedBy: 'ProjectCo finance', note: 'Internal cost rates 2026' }],
          rates: { TWR: { day: 90, week: 450 }, GEN: { day: 150, week: 750 } }, transport: 0, standbyPct: 0, minDays: 1, breakdownCredit: true, tax: 'NONE', wht: 0,
          terms: 'Same legal entity: PPM cross-charge, no invoices, no tax (OD-14).' },
        { id: 'RA-01', number: 'RA-FC-Y-2026', kind: 'CUSTOMER', provider: 'BU-FC', customer: 'C-Y', currency: 'AED', status: 'ACTIVE', version: 1, versions: [{ version: 1, from: '2026-01-01', approvedBy: 'FleetCo rental desk', note: 'Customer price list 2026' }],
          rates: { EXC: { day: 1100, week: 5200 }, CRN: { day: 4200, week: 21000 }, GEN: { day: 420, week: 2100 }, LFT: { day: 520, week: 2600 } },
          transport: 2200, standbyPct: 0.5, minDays: 7, breakdownCredit: true, tax: 'DOMESTIC', wht: 0, depositPct: 0.25,
          terms: 'FleetCo rental terms: weekly billing in arrears, deposit 25 % of a month.' },
        { id: 'RA-02', number: 'RA-FC-W-2026', kind: 'CUSTOMER', provider: 'BU-FC', customer: 'C-W', currency: 'AED', status: 'ACTIVE', version: 1, versions: [{ version: 1, from: '2026-01-01', approvedBy: 'FleetCo rental desk', note: 'Customer price list 2026' }],
          rates: { GEN: { day: 420, week: 2100 } }, transport: 2200, standbyPct: 0.5, minDays: 7, breakdownCredit: true, tax: 'DOMESTIC', wht: 0, depositPct: 0.25, terms: 'On credit hold.' }
      ],
      requests: [],
      hours: [],
      breakdowns: [],
      charges: [],
      statements: [],
      tx: [],
      customs: [],
      notifications: [],
      log: []
    };
  }

  function unit(id, serial, name, cls, owner, hold, home, fin, certs) {
    return { id: id, serial: serial, name: name, cls: cls, owner: owner, hold: hold, home: home, asset: hold === 'ASSET' ? fin : null,
      stock: hold === 'STOCK' ? fin : null, custody: { kind: 'yard', org: home, label: '' }, country: 'AE', certs: certs || [], status: 'AVAILABLE' };
  }
  function cert(country, type, expiry) { return { country: country, type: type, expiry: expiry }; }
  function icAgreement(id, number, provider, receiver, currency, tax, wht) {
    return { id: id, number: number, kind: 'INTERCOMPANY', provider: provider, receiver: receiver, currency: currency, status: 'ACTIVE', version: 1,
      versions: [{ version: 1, from: '2026-01-01', approvedBy: 'Group Finance and both companies', note: 'Market rate card 2026 (OD-04)' }],
      rates: { EXC: { day: 800, week: 3500 }, CRN: { day: 3000, week: 15000 }, GEN: { day: 300, week: 1400 }, LFT: { day: 380, week: 1800 }, TWR: { day: 110, week: 520 } },
      transport: 1500, standbyPct: 0.5, minDays: 7, breakdownCredit: true, tax: tax, wht: wht,
      terms: tax === 'REVERSE_CHARGE' ? 'Cross-border: invoiced without VAT, the user self-assesses (reverse charge) and withholds tax at payment.' : 'Domestic: VAT at the owner\'s country rate.' };
  }

  // The people you can play (MC-BR-12: each sees and acts in their business units only).
  var PERSONAS = [
    { id: 'p-pm', name: 'Priya Raman', initials: 'PR', title: 'Project Manager · ProjectCo', bus: ['BU-PC'], roles: ['requester', 'site', 'receiver-review'] },
    { id: 'p-site', name: 'Omar Haddad', initials: 'OH', title: 'Site supervisor · ProjectCo', bus: ['BU-PC'], roles: ['site'] },
    { id: 'p-pcem', name: 'Yusuf Rahman', initials: 'YR', title: 'Equipment coordinator · ProjectCo (own fleet)', bus: ['BU-PC'], roles: ['owner-em', 'yard'] },
    { id: 'p-pcfin', name: 'Mark Lee', initials: 'ML', title: 'Finance · ProjectCo and ProjectCo KSA', bus: ['BU-PC', 'BU-PF', 'BU-PK'], roles: ['receiver-review', 'finance'] },
    { id: 'p-pk', name: 'Faisal Al-Qahtani', initials: 'FQ', title: 'Project Manager · ProjectCo KSA', bus: ['BU-PK'], roles: ['requester', 'site', 'receiver-review'] },
    { id: 'p-pf', name: 'Huda Saleh', initials: 'HS', title: 'Facilities Manager · ProjectCo', bus: ['BU-PF'], roles: ['requester', 'site', 'owner-em', 'yard'] },
    { id: 'p-em', name: 'Ana Costa', initials: 'AC', title: 'Equipment Manager · FleetCo', bus: ['BU-FC'], roles: ['owner-em', 'yard'] },
    { id: 'p-yard', name: 'Ravi Kumar', initials: 'RK', title: 'Yard lead · FleetCo', bus: ['BU-FC'], roles: ['yard'] },
    { id: 'p-desk', name: 'Lena Novak', initials: 'LN', title: 'Rental desk · FleetCo', bus: ['BU-FC'], roles: ['requester', 'desk', 'owner-finance'] },
    { id: 'p-fin', name: 'Sara Ahmed', initials: 'SA', title: 'Group intercompany finance', bus: ['BU-FC', 'BU-PC', 'BU-PF', 'BU-PK'], roles: ['ic-finance', 'owner-finance', 'finance'] },
    { id: 'p-admin', name: 'Admin', initials: 'AD', title: 'Sees everything (demo)', bus: ['BU-FC', 'BU-PC', 'BU-PF', 'BU-PK'], roles: ['admin'] }
  ];

  // A chart of accounts shared by the demo companies (generic names: map to your own, FDD v2.0 section 7).
  var ACCOUNTS = {
    '1100': 'Bank', '1150': 'Netting clearing', '1200': 'Accounts receivable · customers', '1210': 'Intercompany receivable', '1220': 'Unbilled intercompany receivable',
    '1300': 'Inventory · home yard', '1310': 'Inventory in transit', '1320': 'Inventory · deployed at sites', '1400': 'Input VAT', '1410': 'Withholding tax credit',
    '1500': 'Rental fleet · cost', '1510': 'Accumulated depreciation', '1520': 'Asset sale proceeds clearing', '1600': 'Construction in progress (CIP)',
    '2110': 'Intercompany payable', '2120': 'Accrued intercompany payable', '2200': 'Output VAT', '2210': 'Withholding tax payable', '2300': 'Customer deposits',
    '4100': 'Rental revenue · external', '4110': 'Intercompany rental revenue', '4120': 'Intercompany recharge · transport', '4130': 'Damage and loss recovery',
    '4140': 'Delivery revenue', '4150': 'Damage and loss recovery · customers', '4200': 'Project revenue', '4300': 'Equipment cost recovery (cross-charge)', '4900': 'Exchange gain', '5900': 'Exchange loss',
    '5100': 'Project cost · IC equipment rental', '5110': 'Project cost · IC transport', '5120': 'Project cost · IC damage and loss', '5130': 'Project cost · accrued (IC)',
    '5140': 'Project cost · own equipment', '5150': 'Project cost · cross-charged equipment', '5300': 'Loss on disposal', '4310': 'Gain on disposal'
  };

  return { seed: seed, PERSONAS: PERSONAS, ACCOUNTS: ACCOUNTS };
});
