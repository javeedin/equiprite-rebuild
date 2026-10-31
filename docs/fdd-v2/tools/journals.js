'use strict';
/**
 * The worked accounting example of EquipRite FDD v2.0, as one pure function so the PDF's tables and the HTML's
 * "journal explorer" compute the same numbers from the same assumptions. Browser-safe (no Node APIs): the builder
 * embeds journals.toString() in the HTML.
 *
 * p (all optional): weeks, icRate, transport, carrier, dep, bookValue, custRate, custTransport, rentRate, delivery,
 *   vat (0.05 = 5 %), fx (ProjectCo's currency per 1 FleetCo currency at the invoice date), fxPay (at payment),
 *   wht (withholding, 0.05), damage, repair, deposit, lossValue, assetCost, accDep.
 * Returns { p, totals, entries }. Each entry: { id, sc: [scenarios], ledger: 'FleetCo' | 'ProjectCo' | 'Group',
 *   variant: 'all' | 'asset' | 'stock' | 'xb' | 'accrual' | 'loss' | 'alt', when, source, lines: [[side, account, amount]],
 *   note }. Every entry balances (Dr = Cr); the unit test checks it.
 */
function journals(input) {
  var d = { weeks: 4, icRate: 1000, transport: 600, carrier: 500, dep: 2000, bookValue: 180000, custRate: 1400, custTransport: 700,
    rentRate: 1500, delivery: 700, vat: 0.05, fx: 0.92, fxPay: 0.93, wht: 0.05, damage: 1500, repair: 1200, deposit: 5000,
    lossValue: 150000, assetCost: 240000, accDep: 60000 };
  var p = {};
  Object.keys(d).forEach(function (k) {
    var v = input && input[k] != null && input[k] !== '' ? Number(input[k]) : d[k];
    p[k] = isFinite(v) ? v : d[k];
  });
  function r2(x) { return Math.round(x * 100) / 100; }
  var icRent = r2(p.weeks * p.icRate);
  var icNet = r2(icRent + p.transport);
  var icVat = r2(icNet * p.vat);
  var icGross = r2(icNet + icVat);
  var custRent = r2(p.weeks * p.custRate);
  var custNet = r2(custRent + p.custTransport);
  var custVat = r2(custNet * p.vat);
  var custGross = r2(custNet + custVat);
  var rent3 = r2(p.weeks * p.rentRate);
  var net3 = r2(rent3 + p.delivery);
  var vat3 = r2(net3 * p.vat);
  var gross3 = r2(net3 + vat3);
  var dmgVat = r2(p.damage * p.vat);
  var dmgGross = r2(p.damage + dmgVat);
  var lossVat = r2(p.lossValue * p.vat);
  var nbv = r2(p.assetCost - p.accDep);
  var lossGain = r2(p.lossValue - nbv);
  // Cross-border: FleetCo invoices in its own currency without VAT; ProjectCo converts at the invoice date, self-assesses
  // VAT (reverse charge), withholds tax at payment, and settles at the payment date's rate.
  var xbCost = r2(icNet * p.fx);
  var xbRc = r2(icNet * p.vat * p.fx);
  var xbWht = r2(icNet * p.wht);
  var xbPayFc = r2(icNet - xbWht);
  var xbAtPay = r2(icNet * p.fxPay);
  var xbBank = r2(xbPayFc * p.fxPay);
  var xbWhtLocal = r2(xbAtPay - xbBank);
  var xbFx = r2(xbAtPay - xbCost);

  var S12 = ['S1', 'S2'];
  var E = [];
  function add(e) { E.push(e); }

  // ── FleetCo (Company 2, the owner) ─────────────────────────────────────────────────────────────────────────────
  add({ id: 'F1', sc: ['S1', 'S2', 'S3'], ledger: 'FleetCo', variant: 'asset', when: 'Every month, hired out or not', source: 'Fusion Assets (depreciation run)',
    lines: [['Dr', 'Depreciation expense – rental fleet', p.dep], ['Cr', 'Accumulated depreciation – rental fleet', p.dep]],
    note: 'Ownership never moves, so the owner depreciates the unit all its life. Being on hire changes nothing here.' });
  add({ id: 'F2', sc: ['S1', 'S2', 'S3'], ledger: 'FleetCo', variant: 'all', when: 'The carrier\'s invoice for the transport out and back', source: 'Fusion Payables',
    lines: [['Dr', 'Freight and mobilization cost', p.carrier], ['Cr', 'Accounts payable – carrier', p.carrier]],
    note: 'FleetCo pays the carrier and recharges transport to the user (F6) or the customer (R2).' });
  add({ id: 'F3', sc: ['S1', 'S2', 'S3'], ledger: 'FleetCo', variant: 'stock', when: 'Shipped on the transfer order (home yard → FleetCo\'s deployment org)', source: 'Fusion Cost Management',
    lines: [['Dr', 'Inventory in transit', p.bookValue], ['Cr', 'Inventory – home yard', p.bookValue]],
    note: 'Stock only. Both orgs belong to FleetCo, so this is an inter-org move inside one legal entity: no sale, no profit, no intercompany.' });
  add({ id: 'F4', sc: ['S1', 'S2', 'S3'], ledger: 'FleetCo', variant: 'stock', when: 'Received at the site (FleetCo\'s deployment org, locator = project or customer site)', source: 'Fusion Cost Management',
    lines: [['Dr', 'Inventory – deployed at sites', p.bookValue], ['Cr', 'Inventory in transit', p.bookValue]],
    note: 'Stock only. On the return the two entries run backwards (deployed → in transit → home yard). FOB point: decision OD-05.' });
  add({ id: 'F5', sc: S12, ledger: 'FleetCo', variant: 'accrual', when: 'Month end, only if the statement is not invoiced by the IC cut-off', source: 'Fusion GL journal from EquipRite (INT-24), reverses on day 1',
    lines: [['Dr', 'Unbilled intercompany receivable – ProjectCo', icNet], ['Cr', 'Intercompany rental revenue', icRent], ['Cr', 'Intercompany recharge revenue – transport', p.transport]],
    note: 'Mirrored by P1 in ProjectCo with the same amount, so both ledgers close the month on the same number.' });
  add({ id: 'F6', sc: S12, ledger: 'FleetCo', variant: 'all', when: 'Intercompany invoice for the month', source: 'Fusion Receivables (INT-10, invoice pair)',
    lines: [['Dr', 'Intercompany receivable – ProjectCo', icGross], ['Cr', 'Intercompany rental revenue', icRent], ['Cr', 'Intercompany recharge revenue – transport', p.transport], ['Cr', 'Output VAT', icVat]],
    note: 'Customer = ProjectCo\'s intercompany customer account. Each invoice line carries the EquipRite charge id.' });
  add({ id: 'F7', sc: S12, ledger: 'FleetCo', variant: 'all', when: 'Settled (monthly netting or payment)', source: 'Fusion Receivables / netting',
    lines: [['Dr', 'Bank (or netting clearing)', icGross], ['Cr', 'Intercompany receivable – ProjectCo', icGross]], note: '' });
  add({ id: 'XF6', sc: S12, ledger: 'FleetCo', variant: 'xb', when: 'Cross-border: the intercompany invoice', source: 'Fusion Receivables (INT-10)',
    lines: [['Dr', 'Intercompany receivable – ProjectCo', icNet], ['Cr', 'Intercompany rental revenue', icRent], ['Cr', 'Intercompany recharge revenue – transport', p.transport]],
    note: 'In FleetCo\'s currency; no output VAT where the service is taxed in ProjectCo\'s country (reverse charge). The tax team confirms per country pair (OD-09).' });
  add({ id: 'XF7', sc: S12, ledger: 'FleetCo', variant: 'xb', when: 'Cross-border: paid net of withholding tax', source: 'Fusion Receivables',
    lines: [['Dr', 'Bank', xbPayFc], ['Dr', 'Withholding tax credit (or expense)', xbWht], ['Cr', 'Intercompany receivable – ProjectCo', icNet]],
    note: 'ProjectCo withheld ' + Math.round(p.wht * 100) + ' % for its tax authority; FleetCo claims it as a credit where a tax treaty allows, else it is a cost.' });

  // ── ProjectCo (Company 1, the user) ────────────────────────────────────────────────────────────────────────────
  add({ id: 'P1', sc: S12, ledger: 'ProjectCo', variant: 'accrual', when: 'Month end, mirror of F5', source: 'Fusion GL journal from EquipRite (INT-24), reverses on day 1',
    lines: [['Dr', 'Project equipment cost (accrued) – intercompany', icNet], ['Cr', 'Accrued intercompany payable – FleetCo', icNet]],
    note: 'The project gets its cost from the AP invoice (P2); the accrual only keeps the month\'s GL right.' });
  add({ id: 'P2', sc: S12, ledger: 'ProjectCo', variant: 'all', when: 'Intercompany invoice received (the mirror of F6)', source: 'Fusion Payables (INT-10); PPM imports the project-coded lines',
    lines: [['Dr', 'Project cost – IC equipment rental (project, task, expenditure type)', icRent], ['Dr', 'Project cost – IC transport', p.transport], ['Dr', 'Input VAT', icVat], ['Cr', 'Intercompany payable – FleetCo', icGross]],
    note: 'Supplier = FleetCo\'s intercompany supplier. S1: the internal project (capital → CIP, or overhead → expense). S2: the customer project, where the cost meets the revenue.' });
  add({ id: 'P3', sc: ['S1'], ledger: 'ProjectCo', variant: 'alt', when: 'S1 with a capital project: the asset the project builds goes into service', source: 'Fusion PPM capitalization → Assets',
    lines: [['Dr', 'Construction in progress (CIP)', icNet], ['Cr', 'Project cost clearing', icNet]],
    note: 'Only when the internal project is capital. An overhead project leaves the cost in expense.' });
  add({ id: 'P4', sc: S12, ledger: 'ProjectCo', variant: 'all', when: 'Settled (monthly netting or payment)', source: 'Fusion Payables / netting',
    lines: [['Dr', 'Intercompany payable – FleetCo', icGross], ['Cr', 'Bank (or netting clearing)', icGross]], note: '' });
  add({ id: 'XP2', sc: S12, ledger: 'ProjectCo', variant: 'xb', when: 'Cross-border: the invoice, converted at the invoice date (' + p.fx + ')', source: 'Fusion Payables + Tax (reverse charge)',
    lines: [['Dr', 'Project cost – IC equipment rental and transport', xbCost], ['Dr', 'Input VAT (self-assessed)', xbRc], ['Cr', 'Output VAT (self-assessed)', xbRc], ['Cr', 'Intercompany payable – FleetCo', xbCost]],
    note: 'Amounts in ProjectCo\'s currency. Reverse charge nets to zero where the VAT is fully recoverable.' });
  add({ id: 'XP4', sc: S12, ledger: 'ProjectCo', variant: 'xb', when: 'Cross-border: paid at the payment date (' + p.fxPay + '), withholding kept back', source: 'Fusion Payables (withholding tax)',
    lines: [['Dr', 'Intercompany payable – FleetCo', xbCost], xbFx >= 0 ? ['Dr', 'Realized exchange loss', xbFx] : ['Cr', 'Realized exchange gain', -xbFx], ['Cr', 'Bank', xbBank], ['Cr', 'Withholding tax payable', xbWhtLocal]],
    note: 'The rate moved between invoice and payment, so ProjectCo books the difference. The withholding goes to ProjectCo\'s tax authority.' });

  // ── S2: ProjectCo bills its customer ───────────────────────────────────────────────────────────────────────────
  add({ id: 'P5', sc: ['S2'], ledger: 'ProjectCo', variant: 'all', when: 'Project revenue as the equipment is used (bill rates of the contract)', source: 'Fusion PPM (Project Billing: revenue)',
    lines: [['Dr', 'Unbilled receivable – Customer X', custNet], ['Cr', 'Project revenue – equipment', custNet]],
    note: 'Recommended way (OD-07 a): the IC equipment cost lines are billable on the customer contract at its bill rates.' });
  add({ id: 'P6', sc: ['S2'], ledger: 'ProjectCo', variant: 'all', when: 'Customer invoice', source: 'Fusion PPM (Project Billing) → Receivables',
    lines: [['Dr', 'Accounts receivable – Customer X', custGross], ['Cr', 'Unbilled receivable – Customer X', custNet], ['Cr', 'Output VAT', custVat]], note: '' });
  add({ id: 'P7', sc: ['S2'], ledger: 'ProjectCo', variant: 'all', when: 'Customer pays', source: 'Fusion Receivables',
    lines: [['Dr', 'Bank', custGross], ['Cr', 'Accounts receivable – Customer X', custGross]], note: '' });
  add({ id: 'P8', sc: ['S2'], ledger: 'ProjectCo', variant: 'alt', when: 'Alternative (OD-07 b): EquipRite rental invoice from ProjectCo instead of P5–P6', source: 'Fusion Receivables (INT-11)',
    lines: [['Dr', 'Accounts receivable – Customer X', custGross], ['Cr', 'Equipment rental revenue (sub-hire)', custNet], ['Cr', 'Output VAT', custVat]],
    note: 'Then the IC expenditure types are non-billable on the contract, so the customer is never billed twice.' });

  // ── S3: FleetCo rents to its own customer ─────────────────────────────────────────────────────────────────────
  add({ id: 'R1', sc: ['S3'], ledger: 'FleetCo', variant: 'all', when: 'Deposit, when the agreement asks for one', source: 'Fusion Receivables (receipt)',
    lines: [['Dr', 'Bank', p.deposit], ['Cr', 'Customer deposits (liability)', p.deposit]], note: '' });
  add({ id: 'R2', sc: ['S3'], ledger: 'FleetCo', variant: 'all', when: 'Rental invoice for the period', source: 'Fusion Receivables (INT-11)',
    lines: [['Dr', 'Accounts receivable – Customer Y', gross3], ['Cr', 'Rental revenue – external', rent3], ['Cr', 'Delivery revenue', p.delivery], ['Cr', 'Output VAT', vat3]], note: 'No intercompany anywhere in S3.' });
  add({ id: 'R3', sc: ['S3'], ledger: 'FleetCo', variant: 'all', when: 'Customer pays', source: 'Fusion Receivables',
    lines: [['Dr', 'Bank', gross3], ['Cr', 'Accounts receivable – Customer Y', gross3]], note: '' });
  add({ id: 'R4', sc: ['S3'], ledger: 'FleetCo', variant: 'all', when: 'Damage found at the return inspection', source: 'Fusion Receivables; repair through Maintenance / Payables',
    lines: [['Dr', 'Accounts receivable – Customer Y', dmgGross], ['Cr', 'Damage recovery income', p.damage], ['Cr', 'Output VAT', dmgVat], ['Dr', 'Repairs and maintenance', p.repair], ['Cr', 'Accounts payable – repairer (or work order cost)', p.repair]],
    note: 'Two entries in one: the charge to the customer and the repair cost.' });
  add({ id: 'R5', sc: ['S3'], ledger: 'FleetCo', variant: 'all', when: 'Deposit settled: damage taken from it, the rest refunded', source: 'Fusion Receivables / Payables',
    lines: [['Dr', 'Customer deposits (liability)', p.deposit], ['Cr', 'Accounts receivable – Customer Y', Math.min(dmgGross, p.deposit)], ['Cr', 'Bank (refund)', r2(Math.max(0, p.deposit - dmgGross))]], note: '' });
  add({ id: 'R6', sc: ['S3', 'S1', 'S2'], ledger: 'FleetCo', variant: 'loss', when: 'Lost or destroyed: charged at the agreed loss value, the asset retired', source: 'Fusion Receivables + Assets (retirement)',
    lines: [['Dr', 'Accounts receivable – the user (Customer Y, or ProjectCo as intercompany)', r2(p.lossValue + lossVat)], ['Cr', 'Asset sale proceeds clearing', p.lossValue], ['Cr', 'Output VAT', lossVat],
      ['Dr', 'Accumulated depreciation', p.accDep], ['Dr', 'Asset sale proceeds clearing', p.lossValue],
      lossGain < 0 ? ['Dr', 'Loss on disposal', -lossGain] : ['Cr', 'Gain on disposal', lossGain],
      ['Cr', 'Rental fleet – cost', p.assetCost]],
    note: 'Net book value ' + nbv + '. A stock unit is issued instead (cost of sales against inventory). In S1/S2 ProjectCo books the charge as project cost or an insurance claim.' });

  // ── Group consolidation ───────────────────────────────────────────────────────────────────────────────────────
  add({ id: 'G1', sc: S12, ledger: 'Group', variant: 'all', when: 'Consolidation: intercompany revenue against intercompany cost', source: 'Fusion GL consolidation / elimination rules',
    lines: [['Dr', 'Intercompany rental revenue (FleetCo)', icRent], ['Dr', 'Intercompany recharge revenue – transport (FleetCo)', p.transport], ['Cr', 'Project cost – intercompany (ProjectCo)', icNet]],
    note: 'S1 with a capital project: the IC margin sits in CIP and is eliminated from it instead (Cr CIP for the margin over FleetCo\'s own cost).' });
  add({ id: 'G2', sc: S12, ledger: 'Group', variant: 'all', when: 'Consolidation: open intercompany balances', source: 'Fusion GL elimination',
    lines: [['Dr', 'Intercompany payable – FleetCo (ProjectCo)', icGross], ['Cr', 'Intercompany receivable – ProjectCo (FleetCo)', icGross]],
    note: 'Only for what is unsettled at month end. The VAT in it is real (owed to or by tax authorities) and stays.' });

  return {
    p: p,
    totals: { icRent: icRent, icNet: icNet, icVat: icVat, icGross: icGross, custRent: custRent, custNet: custNet, custVat: custVat, custGross: custGross,
      rent3: rent3, net3: net3, vat3: vat3, gross3: gross3, xbCost: xbCost, xbFx: xbFx, xbWht: xbWht, nbv: nbv,
      margin2: r2(custNet - icNet), groupMargin2: r2(custNet - p.carrier - p.dep * p.weeks / 4.33), margin3: r2(net3 - p.carrier - p.dep * p.weeks / 4.33) },
    entries: E
  };
}

if (typeof module !== 'undefined') module.exports = journals;
