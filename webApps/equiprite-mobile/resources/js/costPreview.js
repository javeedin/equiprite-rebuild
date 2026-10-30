define(['resources/js/prPassThrough', 'resources/js/usageWeeks', 'resources/js/fmt'], (prPassThrough, usageWeeks, nxFmt) => {
  'use strict';

  // EquipRite Next, Post costs: what a request has cost, what is ready to post and what was posted.
  //
  // CostRules below is New EquipRite's Post costs page module (webApps/equiprite/flows/usage/pages/post-costs-page.js)
  // COPIED UNCHANGED, so the list, the preview tree, which weeks are ready (a rental week once it has ended, a one-time
  // charge from its start), the ledger body and the posting plan are New's, figure for figure. tests/next-usage.test.js
  // holds every method to New's source text. EquipRite Next posts nothing: the CostPreview class at the end only reads
  // these to show what is ready and what would be posted, and Posting stays in New EquipRite.

  /*
   * ── New's header, as it stands ──
   * Post costs (wireframe: Post costs; FDD 7.14A, S24). One page for the four old pages: post-cost-test and
   * post-cost-test-detail (the ledger-backed drill-down the menu opened, with re-tier, project split, misc charges,
   * blackout days and the per-equipment expenditure type) and post-cost / post-cost-detail (their list and a
   * one-shot post, superseded by the drill-down; see postSelectedChain for why its post is not offered here).
   *
   * The money rule the old page lived by is kept: the cost engine and the views are AUTHORITATIVE and the client
   * does no cost arithmetic (anti-V190). Every amount shown or posted is a view figure; a split sends percentages and
   * the server apportions. The only arithmetic here is summing view figures for totals, and the blackout preview,
   * which the next read replaces with the server's own figure.
   *
   * buildList and buildPreview are the old list and detail vbEnterChains' row building, moved here so they are pure
   * and testable; the chains do the fetching. The tree helpers (visibleRows, restampGroups, split*, projectCells …)
   * are the old post-cost-test-detail-page.js functions.
   */

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
  const parseD = (s) => {
    if (!s) return null;
    const d = new Date(String(s).slice(0, 10) + 'T00:00:00Z');
    return isNaN(d.getTime()) ? null : d;
  };
  const fmt = (d) => (d ? MON[d.getUTCMonth()] + ' ' + d.getUTCDate() : '');
  const utcToday = (now) => {
    const n = now || new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
  };
  const arrOf = (body) => ((body && Array.isArray(body.data)) ? body.data
    : (Array.isArray(body) ? body : ((body && Array.isArray(body.items)) ? body.items : [])));

  function money(n) {
    if (n == null || isNaN(Number(n))) return '—';
    const v = Number(n);
    const s = '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
    return v < 0 ? '−' + s : s;
  }

  class CostRules {
    money(n) {
      return money(n);
    }

    arrOf(body) {
      return arrOf(body);
    }

    // ── the request list (old post-cost-test vbEnterChain) ───────────────────

    /**
     * One row per REQUEST from the per-(request x week) view, summed, with future weeks left out of the money (a
     * week is future when it starts after today; a request with only future weeks keeps its row at $0), plus its
     * miscellaneous charges, newest request first.
     */
    buildList(viewRows, miscRows, now) {
      const today = utcToday(now);
      const isFuture = (r) => {
        const ws = parseD(r.weekStartDate);
        return !!ws && ws > today;
      };
      const by = {};
      const order = [];
      (Array.isArray(viewRows) ? viewRows : []).forEach((r) => {
        const key = r.requestNumber || '';
        if (!by[key]) {
          by[key] = {
            rowKey: key,
            eqrEquipmentRequestId: r.eqrEquipmentRequestId,
            requestNumber: key,
            projectName: r.projectName || '—',
            taskName: r.taskName || '—',
            agreementNumber: r.agreementNumber || '—',
            startDate: r.requestedStartDate ? String(r.requestedStartDate).slice(0, 10) : '',
            endDate: r.requestedEndDate ? String(r.requestedEndDate).slice(0, 10) : '',
            timesheets: 0,
            totalHours: 0,
            totalBillCost: 0,
            ppmProjectNumber: r.ppmProjectNumber || '',
            ppmTaskNumber: r.ppmTaskNumber || '',
            ppmBusinessUnit: r.ppmBusinessUnit || '',
            ppmProjectRefId: r.ppmProjectRefId || 0,
            ppmTaskRefId: r.ppmTaskRefId || 0,
            rateScheduleId: r.rateScheduleId || 0,
          };
          order.push(key);
        }
        if (isFuture(r)) return;
        const g = by[key];
        g.timesheets += Number(r.timesheets || 0);
        g.totalHours += Number(r.totalHours || 0);
        g.totalBillCost += Number(r.totalBillCost || 0);
      });
      (Array.isArray(miscRows) ? miscRows : []).forEach((m) => {
        const g = by[m && m.requestNumber];
        if (g) g.totalBillCost += Number(m.rawCost || 0);
      });
      const data = order.map((k) => by[k]);
      data.forEach((g) => { g.totalBillCost = round2(g.totalBillCost); g.totalHours = round2(g.totalHours); });
      data.sort((a, b) => (Number(b.eqrEquipmentRequestId) || 0) - (Number(a.eqrEquipmentRequestId) || 0));
      return data;
    }

    filterList(list, text) {
      const q = String(text || '').trim().toLowerCase();
      return (Array.isArray(list) ? list : []).filter((r) => !q || [r.requestNumber, r.projectName, r.taskName, r.agreementNumber,
        r.ppmProjectNumber, r.ppmTaskNumber].some((v) => v && String(v).toLowerCase().includes(q)));
    }

    period(r) {
      const a = parseD(r && r.startDate);
      const b = parseD(r && r.endDate);
      if (!a && !b) return '—';
      return (a ? fmt(a) : '?') + ' – ' + (b ? fmt(b) + ' ' + b.getUTCFullYear() : '?');
    }

    // ── the preview (old post-cost-test-detail vbEnterChain) ─────────────────

    /**
     * The equipment → week → day tree of one request, from views/post-cost-details and its companion reads.
     *
     * @param src   views/post-cost-details rows
     * @param c     { retier, blackout, misc, splits } companion response bodies (any envelope), and
     *              prLineIds / prPoPrices from prPassThrough (the PR pass-through lines)
     * @param hdr   { plannedStartDate, plannedEndDate, projectNumber, projectName, taskNumber, taskName }
     * @returns { rowsAll, totalCost, postedCost, incurredToDate, netAdjustment, lastPostedLabel, headerStatus,
     *            isEarlyReturn, startDate, endDate, prScaled }
     */
    buildPreview(src, c, hdr, now) {
      const comp = c || {};
      const h = hdr || {};
      const today = utcToday(now);
      const prLineIds = comp.prLineIds || {};
      const prPoPrices = comp.prPoPrices || {};

      // re-tiered per-week amounts (EQP_LINE_RETIER_WEEKS), keyed by the bare row key and by line + week; never by
      // week alone, which would hand one line's re-tier to another
      const retierByKey = {};
      arrOf(comp.retier).forEach((m) => {
        if (!m) return;
        const info = { cost: Number(m.retierCost || 0), rate: Number(m.retierRate || 0), period: String(m.retierPeriod || ''),
          lineId: m.requestLineId != null ? m.requestLineId : null };
        const wISO = String(m.weekStartDate || '').slice(0, 10);
        if (m.rowKey) retierByKey[String(m.rowKey).split(':').slice(0, 3).join(':')] = info;
        if (m.requestLineId != null && wISO) retierByKey['LW|' + m.requestLineId + '|' + wISO] = info;
      });
      const retierFor = (r) => {
        const k = r && r.rowKey ? String(r.rowKey).split(':').slice(0, 3).join(':') : '';
        const wISO = r ? String(r.weekStartDate || '').slice(0, 10) : '';
        const lineId = r && r.requestLineId != null ? r.requestLineId : null;
        return (k && retierByKey[k]) || (lineId != null && wISO ? retierByKey['LW|' + lineId + '|' + wISO] : null) || null;
      };

      // blackout days per (line, week): sparse, so absence means "no exceptions"
      const blackoutByKey = {};
      arrOf(comp.blackout).forEach((b) => {
        if (b.requestLineId == null || !b.weekStartDate) return;
        blackoutByKey[b.requestLineId + '|' + String(b.weekStartDate).slice(0, 10)] = {
          dates: Array.isArray(b.blackoutDates) ? b.blackoutDates.map((x) => String(x).slice(0, 10)) : [],
          ignored: Array.isArray(b.ignoredDates) ? b.ignoredDates.map((x) => String(x).slice(0, 10)) : [],
          days: Number(b.blackoutDays || 0),
          applicability: String(b.applicability || 'EDITABLE').toUpperCase(),
        };
      });

      // misc charges per line, rendered exactly as stored
      const miscByLine = {};
      arrOf(comp.misc).forEach((m) => {
        if (!m || m.requestLineId == null) return;
        (miscByLine[m.requestLineId] = miscByLine[m.requestLineId] || []).push(m);
      });

      // authored project splits per (line, week)
      const splitKey = (lineId, weekISO) => String(lineId) + '|' + String(weekISO || '').slice(0, 10);
      const splitsByLineWeek = {};
      arrOf(comp.splits).forEach((s) => {
        if (!s || s.requestLineId == null || !s.weekStartDate) return;
        const k = splitKey(s.requestLineId, s.weekStartDate);
        (splitsByLineWeek[k] = splitsByLineWeek[k] || []).push(s);
      });

      // INTERIM: a PR row's amount scaled by its day span while PO_QUANTITY is null (prPassThrough.prDayMultiplier);
      // copies, never a mutation of the fetched rows
      let prScaled = 0;
      const rows = (Array.isArray(src) ? src : []).map((r) => {
        const mult = prPassThrough.prDayMultiplier(r, !!prLineIds[String(Number(r.requestLineId))]);
        if (mult <= 1) return r;
        prScaled++;
        return Object.assign({}, r, { costAmount: Number(r.costAmount || 0) * mult, billAmount: Number(r.billAmount || 0) * mult, prDays: mult });
      });

      const spanStartISO = String(h.plannedStartDate || '').slice(0, 10) || null;
      const spanEndISO = String(h.plannedEndDate || '').slice(0, 10) || null;
      const periodEquiv = (rate, period) => {
        const p = String(period || '').toUpperCase();
        if (rate > 0 && p === 'WEEKLY') return '  ($' + (rate * 7).toLocaleString() + '/wk)';
        if (rate > 0 && p === 'MONTHLY') return '  ($' + (rate * 30).toLocaleString() + '/mo)';
        return '';
      };
      // A DIRECT row is a one-time charge, postable from its start; a rental week only once it has ended.
      const readyToPost = (ws, we, direct) => (direct ? !!(ws && ws <= today) : !!(we && we < today));
      const classify = (postStatus, ws, we, direct) => {
        const s = String(postStatus || '').toUpperCase();
        if (s === 'POSTED') return { posted: true, reversed: false, postable: false, tag: 'Posted' };
        if (s === 'REVERSED') return { posted: false, reversed: true, postable: false, tag: 'Reversed' };
        if (s === 'IN_PROGRESS') {
          // a consumable waiting for its Fusion material issue: never posted from here (Fusion costs it)
          return { posted: false, reversed: false, postable: false, isConsumablePending: true, countsAsIncurred: readyToPost(ws, we, direct), tag: 'Pending' };
        }
        const postable = readyToPost(ws, we, direct);
        const inProgress = !postable && !!(ws && we && ws <= today && we >= today);
        const tag = postable ? 'Draft' : (inProgress ? 'In progress' : 'Future');
        return s === 'DRAFT' ? { posted: false, reversed: false, postable, isRepost: true, tag } : { posted: false, reversed: false, postable, tag };
      };

      const groups = [];
      const byName = {};
      rows.forEach((r) => {
        const name = r.equipmentName || 'Equipment';
        if (!byName[name]) {
          byName[name] = { key: 'g' + groups.length, name, rows: [] };
          groups.push(byName[name]);
        }
        byName[name].rows.push(r);
      });

      const rowsAll = [];
      let totalCost = 0;
      let postedCost = 0;
      let incurred = 0;
      let netAdjustment = 0;
      let lastPostedDate = null;
      let anyReversed = false;

      groups.forEach((g, gi) => {
        const weekRows = g.rows.slice().sort((a, b) => String(a.weekStartDate || '').localeCompare(String(b.weekStartDate || '')));
        const weekInfo = weekRows.map((r) => {
          const ws = parseD(r.weekStartDate);
          const we = parseD(r.weekEndDate);
          const direct = r.lineType === 'DIRECT';
          return { r, ws, we, direct, st: classify(r.postStatus, ws, we, direct) };
        });
        // Future weeks are a projection: dropped before any rollup, unless the ledger holds them.
        const kept = weekInfo.filter((x) => x.st.tag !== 'Future' || x.st.posted || x.st.reversed || x.st.isRepost || x.st.isConsumablePending);
        const shown = kept.map((x) => x.r);
        const notStarted = !shown.length;
        const basis = shown.length ? shown : weekRows;
        const isConsumable = basis.every((r) => r.lineType === 'DIRECT');
        const groupCost = shown.reduce((s, r) => s + (String(r.postStatus || '').toUpperCase() === 'REVERSED' ? 0 : Number(r.costAmount || 0)), 0);
        const groupHours = shown.reduce((s, r) => s + Number(r.totalHours || 0), 0);

        const groupLineIds = {};
        weekRows.forEach((r) => { if (r.requestLineId != null) groupLineIds[r.requestLineId] = 1; });
        const miscRows = Object.keys(groupLineIds).reduce((acc, lid) => acc.concat(miscByLine[lid] || []), []);
        const miscTotal = miscRows.reduce((s, m) => s + Number(m.rawCost || 0), 0);

        const head = basis[0] || {};
        const headRate = Number(head.applicableRate || 0);
        const headQty = Number(head.qty || 1);
        const headPeriod = isConsumable ? 'Not Applicable' : (head.ratePeriod || '—');
        const qtySuffix = headQty > 1 ? ('  × ' + headQty + ' units') : '';
        const headRateText = (headRate > 0 && !isConsumable)
          ? ('$' + headRate.toLocaleString() + '/day' + periodEquiv(headRate, headPeriod) + qtySuffix)
          : (headRate > 0 ? ('$' + headRate.toLocaleString() + qtySuffix) : '—');
        const groupDays = isConsumable ? 0 : shown.reduce((s, r) => {
          if (String(r.postStatus || '').toUpperCase() === 'REVERSED') return s;
          const rt = Number(r.applicableRate || 0) * Number(r.qty || 1);
          return s + (rt > 0 ? Math.round(Number(r.costAmount || 0) / rt) : 0);
        }, 0);
        totalCost += groupCost + miscTotal;

        let groupHasReversal = false;
        let groupTierChanged = false;
        shown.forEach((r) => {
          const s = String(r.postStatus || '').toUpperCase();
          const rt = retierFor(r);
          if (s === 'REVERSED') { groupHasReversal = true; anyReversed = true; }
          if (r.lineType === 'DIRECT') return; // a one-time charge never re-tiers
          if (s === 'POSTED' && rt && rt.period && String(r.ratePeriod || '').toUpperCase() !== rt.period.toUpperCase()) groupTierChanged = true;
        });

        const expSet = {};
        weekRows.forEach((r) => { if (r.lineExpenditureType) expSet[String(r.lineExpenditureType)] = 1; });
        const expNames = Object.keys(expSet);
        const groupExpLocked = weekRows.length > 0 && weekRows.every((r) => prPassThrough.isBaseRow(r.rowKey));

        rowsAll.push({
          rowKey: g.key,
          kind: 'group',
          groupKey: g.key,
          splitWeekCount: 0,
          splitWeekLabels: [],
          expenditureTypeLocked: groupExpLocked,
          requestLineId: head.requestLineId || (retierFor(head) && retierFor(head).lineId) || null,
          requestLineIds: Object.keys(groupLineIds).map(Number),
          expenditureType: expNames.length === 1 ? expNames[0] : '',
          expenditureTypeMixed: expNames.length > 1,
          expanded: gi === 0,
          label: g.name,
          weekCount: shown.length,
          notStarted,
          rateType: '',
          rateText: headRateText,
          ratePeriod: headPeriod,
          whenTag: '',
          hours: groupHours,
          days: groupDays,
          cost: round2(groupCost + miscTotal),
          hasReversal: groupHasReversal,
          tierChanged: groupTierChanged,
        });

        kept.forEach((x, wi) => {
          const r = x.r;
          const ws = x.ws;
          const we = x.we;
          const st = x.st;
          const direct = x.direct;
          const cost = Number(r.costAmount || 0);
          const rate = Number(r.applicableRate || 0);
          const wkQty = Number(r.qty || 1);
          const wkQtySuffix = wkQty > 1 ? ('  × ' + wkQty + ' units') : '';
          const ratePeriod = direct ? 'Not Applicable' : (r.ratePeriod || '—');
          const rateText = (rate > 0 && !direct)
            ? ('$' + rate.toLocaleString() + '/day' + periodEquiv(rate, ratePeriod) + wkQtySuffix)
            : (rate > 0 ? ('$' + rate.toLocaleString() + wkQtySuffix) : '—');
          const wkRateTot = rate * wkQty;
          const wkDays = (direct || wkRateTot <= 0) ? 0 : Math.round(cost / wkRateTot);

          if (st.posted) {
            postedCost += cost;
            if (we && (!lastPostedDate || we > lastPostedDate)) lastPostedDate = we;
          } else if ((st.postable || st.countsAsIncurred) && !st.reversed) {
            incurred += cost;
          }
          const s = String(r.postStatus || '').toUpperCase();
          if (s === 'REVERSED') netAdjustment -= cost;
          if (s === 'DRAFT' && st.isRepost) netAdjustment += cost;

          const rt = retierFor(r);
          const wkLineKey = String(Number(r.requestLineId));
          const wkIsPrLine = !!prLineIds[wkLineKey];
          const prMarginRow = prPassThrough.isPrMarginRow({ rowKey: r.rowKey, isPrLine: wkIsPrLine, applicableRate: r.applicableRate, postStatus: r.postStatus },
            prPoPrices[wkLineKey]);
          const splitLockRow = { rowKey: r.rowKey, posted: st.posted, reversed: st.reversed, isPrLine: wkIsPrLine };
          const wkLineId = r.requestLineId || (rt && rt.lineId) || null;
          const wkISOKey = String(r.weekStartDate || '').slice(0, 10);
          const bw = (wkLineId != null && wkISOKey) ? blackoutByKey[wkLineId + '|' + wkISOKey] : null;
          const bwApplicability = bw ? bw.applicability : (direct ? 'NOT_APPLICABLE' : 'EDITABLE');
          const bwApplicable = bwApplicability !== 'NOT_APPLICABLE';
          const lineSpanStart = String(r.spanStart || spanStartISO || '').slice(0, 10) || null;
          const lineSpanEnd = String(r.spanEnd || spanEndISO || '').slice(0, 10) || null;
          const splits = splitsByLineWeek[splitKey(r.requestLineId, r.weekStartDate)] || [];
          const weekKey = r.rowKey || (g.key + '_w' + wi);

          rowsAll.push({
            rowKey: weekKey,
            kind: 'week',
            groupKey: g.key,
            equipmentName: g.name,
            requestLineId: wkLineId,
            lineExpenditureType: r.lineExpenditureType || '',
            splits,
            splitCount: splits.length,
            splitPcts: splits.map((y) => Number(y.splitPct)),
            isPrLine: wkIsPrLine,
            splitLocked: prPassThrough.isSplitLocked(splitLockRow),
            splitLockReason: prPassThrough.splitLockReason(splitLockRow),
            splitLockedByPr: prPassThrough.isPrLineRow(splitLockRow),
            weekStartISO: r.weekStartDate ? String(r.weekStartDate).slice(0, 10) : '',
            label: direct ? ((prMarginRow ? 'Margin' : 'One-time') + (wkQty > 1 ? (' · qty ' + wkQty) : ''))
              : ((ws && we) ? (fmt(ws) + ' – ' + fmt(we)) : (r.weekStartDate || '—')),
            labelTitle: prMarginRow ? 'EquipRite markup on the purchase order. The order carries its own cost on the other row for this '
              + 'equipment, and that cost reaches the project through the PO distribution rather than through EquipRite.' : '',
            rateType: direct ? '' : 'USAGE',
            isRepost: !!st.isRepost,
            direct: !!direct,
            rateText,
            ratePeriod,
            days: r.prDays ? Number(r.prDays) : wkDays,
            prDays: r.prDays ? Number(r.prDays) : 0,
            qty: wkQty,
            postable: !!st.postable,
            posted: !!st.posted,
            reversed: !!st.reversed,
            inProgress: st.tag === 'In progress',
            pending: !!st.isConsumablePending,
            selected: false,
            whenTag: st.tag,
            hours: Number(r.totalHours || 0),
            cost,
            retierCost: rt ? rt.cost : null,
            retierRate: rt ? rt.rate : null,
            retierPeriod: rt ? rt.period : null,
            postedRate: rate,
            postedPeriod: (r.ratePeriod || ''),
            weekExpanded: false,
            canBlackout: bwApplicable,
            blackoutDays: bwApplicable ? (bw ? bw.days : 0) : 0,
          });

          if (bwApplicable && ws) {
            for (let dOff = 0; dOff < 7; dOff++) {
              const dDate = new Date(ws.getTime());
              dDate.setUTCDate(dDate.getUTCDate() + dOff);
              const dISO = dDate.toISOString().slice(0, 10);
              const inSpan = (!lineSpanStart || dISO >= lineSpanStart) && (!lineSpanEnd || dISO <= lineSpanEnd);
              const marked = bw ? bw.dates.indexOf(dISO) >= 0 : false;
              const ignored = bw ? bw.ignored.indexOf(dISO) >= 0 : false;
              if (!inSpan && !ignored) continue;
              rowsAll.push({
                rowKey: weekKey + '_d' + dOff,
                kind: 'day',
                groupKey: g.key,
                weekKey,
                requestLineId: wkLineId,
                dayISO: dISO,
                label: DAY_NAMES[dDate.getUTCDay()] + ' ' + fmt(dDate),
                blackout: marked || ignored,
                inert: ignored,
                inSpan,
                locked: bwApplicability === 'POSTED' || !!st.posted || !!st.reversed,
                dayCost: (marked || ignored || !inSpan) ? 0 : (wkDays > 0 ? round2(cost / wkDays) : 0),
              });
            }
          }
        });

        if (miscRows.length) {
          const miscGroupKey = g.key + '_miscgrp';
          rowsAll.push({ rowKey: miscGroupKey, kind: 'miscGroup', groupKey: g.key, label: 'Misc charges', miscCount: miscRows.length,
            miscExpanded: false, rateType: '', rateText: '', ratePeriod: '', whenTag: '', hours: 0, days: 0, cost: round2(miscTotal) });
          miscRows.forEach((m) => {
            const mCost = Number(m.rawCost || 0);
            const mQty = Number(m.quantity || 1);
            const mPosted = String(m.status || 'DRAFT').toUpperCase() === 'POSTED';
            const mDate = String(m.expenditureItemDate || '').slice(0, 10);
            const mUnit = mQty > 1 ? round2(mCost / mQty) : null;
            if (mPosted) {
              postedCost += mCost;
              const pd = parseD(mDate);
              if (pd && (!lastPostedDate || pd > lastPostedDate)) lastPostedDate = pd;
            } else {
              incurred += mCost;
            }
            rowsAll.push({
              rowKey: 'misc_' + m.eqrLineMiscTxnId,
              kind: 'misc',
              groupKey: g.key,
              miscGroupKey,
              miscId: m.eqrLineMiscTxnId,
              requestLineId: m.requestLineId,
              equipmentName: g.name,
              expenditureType: m.expenditureType || '',
              expenditureOrg: m.expenditureOrg || '',
              expItemDate: mDate,
              quantity: mQty,
              rawCost: mCost,
              currency: m.currencyCode || 'USD',
              comments: m.comments || '',
              label: this.miscLabel(m),
              rateType: '',
              rateText: mUnit != null ? ('$' + mUnit.toLocaleString() + ' each') : '—',
              ratePeriod: '—',
              days: 0,
              hours: 0,
              cost: mCost,
              whenTag: mPosted ? 'Posted' : 'Draft',
              status: mPosted ? 'POSTED' : 'DRAFT',
              postable: !mPosted,
              posted: mPosted,
              reversed: false,
              selected: false,
            });
          });
        }
      });

      const plannedStart = parseD(h.plannedStartDate);
      const plannedEnd = parseD(h.plannedEndDate);
      const allStarts = rows.map((r) => parseD(r.weekStartDate)).filter(Boolean);
      const allEnds = rows.map((r) => parseD(r.weekEndDate)).filter(Boolean);
      const spanStart = plannedStart || (allStarts.length ? new Date(Math.min.apply(null, allStarts.map((d) => d.getTime()))) : null);
      const spanEnd = plannedEnd || (allEnds.length ? new Date(Math.max.apply(null, allEnds.map((d) => d.getTime()))) : null);

      const annotated = rowsAll.map((r) => {
        if (r.kind !== 'group') return r;
        const wk = rowsAll.filter((x) => x.kind === 'week' && x.groupKey === r.groupKey && x.postable && !x.posted && !x.reversed);
        const hasP = wk.length > 0;
        return Object.assign({}, r, { hasPostable: hasP, allSelected: hasP && wk.every((x) => x.selected) });
      });

      return {
        rowsAll: this.applySplitDerived(annotated, h),
        totalCost: round2(totalCost),
        postedCost: round2(postedCost),
        incurredToDate: round2(incurred),
        netAdjustment: round2(netAdjustment),
        lastPostedLabel: lastPostedDate ? fmt(lastPostedDate) : '—',
        headerStatus: (rows[0] && rows[0].postStatus) || 'APPROVED',
        isEarlyReturn: anyReversed,
        startDate: fmt(spanStart),
        endDate: fmt(spanEnd),
        prScaled,
      };
    }

    // ── selection and the posting plan ───────────────────────────────────────

    /** Re-stamp each equipment's "select all weeks" state after a selection change. */
    restampSelection(all) {
      return (all || []).map((r) => {
        if (r.kind !== 'group') return r;
        const wk = all.filter((x) => x.kind === 'week' && x.groupKey === r.groupKey && x.postable && !x.posted);
        const hasP = wk.length > 0;
        return Object.assign({}, r, { hasPostable: hasP, allSelected: hasP && wk.every((x) => x.selected) });
      });
    }

    selectedKeys(all) {
      return (all || []).filter((r) => r.kind === 'week' && r.selected).map((r) => r.rowKey);
    }

    /** The weeks a post would write: selected, postable, not posted, not reversed (postSelectedChain's filter). */
    weeksToPost(all, sel) {
      const keys = Array.isArray(sel) ? sel : this.selectedKeys(all);
      return (all || []).filter((r) => r.kind === 'week' && keys.indexOf(r.rowKey) >= 0 && r.postable && !r.posted && !r.reversed);
    }

    miscToPost(all) {
      return (all || []).filter((r) => r.kind === 'misc' && r.selected && r.status !== 'POSTED' && r.miscId);
    }

    /** { weeks, misc, items, cost } for the band button and the review. */
    selection(all) {
      const w = this.weeksToPost(all);
      const m = this.miscToPost(all);
      return { weeks: w.length, misc: m.length, items: w.length + m.length,
        cost: round2(w.reduce((s, r) => s + Number(r.cost || 0), 0) + m.reduce((s, r) => s + Number(r.cost || 0), 0)) };
    }

    selectionText(all) {
      const s = this.selection(all);
      const parts = [];
      if (s.weeks) parts.push(s.weeks + (s.weeks === 1 ? ' week' : ' weeks'));
      if (s.misc) parts.push(s.misc + (s.misc === 1 ? ' charge' : ' charges'));
      return parts.length ? parts.join(' + ') + ' · ' + money(s.cost) : 'Nothing selected';
    }

    /** The splits a week posts with: 2+ slices that are saved and not on a PR line (else it posts whole). */
    postedSplits(r) {
      const splits = (Array.isArray(r.splits) ? r.splits : []).filter((s) => s && s.projectNumber && s.splitPct != null);
      const previewOnly = splits.length >= 2 && r.splitPersisted === false;
      const prSplitBlocked = splits.length >= 2 && prPassThrough.isPrLineRow(r);
      return { splits, isSplit: splits.length >= 2 && !previewOnly && !prSplitBlocked, previewOnly, prSplitBlocked };
    }

    /**
     * The EQR_POSTED_WEEK ledger body for one week: postSelectedChain's body, field for field. Every amount is the
     * row's view figure. A split ADDS splits[] (percentages only) and nulls reversalRef; an unsplit week is the
     * request it always was.
     */
    ledgerBody(r, rateScheduleId) {
      const lineId = r.requestLineId;
      const weekISO = r.weekStartISO;
      const weekCompact = String(weekISO || '').replace(/-/g, '');
      const bareKey = String(lineId) + ':0:' + weekCompact;
      const ledgerKey = r.rowKey && String(r.rowKey).indexOf(':') >= 0 ? String(r.rowKey) : bareKey;
      const body = {
        requestLineId: Number(lineId),
        weekStartDate: weekISO + 'T00:00:00Z',
        rowKey: ledgerKey,
        status: 'POSTED',
        entryKind: 'ORIGINAL',
        postedSource: r.direct ? 'DIRECT' : 'CP',
        postedCostAmount: Number(r.cost || 0),
        costRate: Number(r.postedRate || 0),
        periodType: r.direct ? 'EACH' : String(r.postedPeriod || ''),
        billableDuration: r.direct ? Number(r.prDays || r.qty || 1) : Number(r.days || 0),
        rateScheduleId: Number(rateScheduleId) || null,
        expenditureType: r.lineExpenditureType ? String(r.lineExpenditureType) : null,
        reversalRef: 'EQR-' + lineId + '-' + weekCompact,
        ppmBatchName: null,
      };
      const sp = this.postedSplits(r);
      if (sp.isSplit) {
        body.reversalRef = null;
        body.splits = sp.splits.map((s) => ({
          projectRefId: Number(s.projectRefId),
          projectNumber: String(s.projectNumber),
          taskId: s.taskId != null ? Number(s.taskId) : null,
          taskNumber: s.taskNumber ? String(s.taskNumber) : null,
          splitPct: Number(s.splitPct),
        }));
      }
      return body;
    }

    /**
     * Exactly what Post will send, one line per ledger row or charge, for the review before the click:
     * [{ kind, what, when, quantity, amount, expType, destination, note }].
     */
    postingPlan(all, hdr, rateScheduleId) {
      const h = hdr || {};
      const own = (h.projectNumber ? h.projectNumber + (h.projectName ? ' ' + h.projectName : '') : 'the request\'s project')
        + (h.taskNumber ? ' / task ' + h.taskNumber : '');
      const out = [];
      this.weeksToPost(all).forEach((r) => {
        const body = this.ledgerBody(r, rateScheduleId);
        const sp = this.postedSplits(r);
        out.push({
          key: r.rowKey,
          kind: 'week',
          what: (r.equipmentName || 'Equipment') + ' · ' + r.label,
          quantity: body.postedSource === 'DIRECT' ? body.billableDuration + ' each' : body.billableDuration + ' days at ' + money(body.costRate) + '/day ' + body.periodType.toLowerCase(),
          amount: body.postedCostAmount,
          expType: body.expenditureType || 'Equipment (default)',
          destination: sp.isSplit ? sp.splits.map((s) => s.splitPct + '% ' + s.projectNumber + (s.taskNumber ? ' / ' + s.taskNumber : '')).join(', ') : own,
          note: sp.previewOnly ? 'The split is not saved, so the week posts whole to the request\'s project.'
            : (sp.prSplitBlocked ? 'A purchase-order line cannot be split; it posts whole to the request\'s project.' : ''),
        });
      });
      this.miscToPost(all).forEach((m) => {
        out.push({
          key: m.rowKey,
          kind: 'misc',
          what: (m.equipmentName || 'Equipment') + ' · charge: ' + (m.comments || 'no description'),
          quantity: m.quantity + ' on ' + m.expItemDate,
          amount: m.cost,
          expType: m.expenditureType || '—',
          destination: own + (m.expenditureOrg ? ' · ' + m.expenditureOrg : ''),
          note: '',
        });
      });
      return out;
    }

    planTotal(plan) {
      return round2((plan || []).reduce((s, p) => s + Number(p.amount || 0), 0));
    }

    // ── tree rows (old post-cost-test-detail-page.js) ───────────────────────

    /** group always; week, split and miscGroup when the group is open; misc when its misc group is; day when its week is. */
    visibleRows(all) {
      const rows = all || [];
      return rows.filter((row) => {
        if (row.kind === 'group') return true;
        const g = rows.find((x) => x.kind === 'group' && x.groupKey === row.groupKey);
        if (!g || !g.expanded) return false;
        if (row.kind === 'week' || row.kind === 'split' || row.kind === 'miscGroup') return true;
        if (row.kind === 'misc') {
          const mg = rows.find((x) => x.kind === 'miscGroup' && x.rowKey === row.miscGroupKey);
          return !!(mg && mg.miscExpanded);
        }
        const w = rows.find((x) => x.kind === 'week' && x.rowKey === row.weekKey);
        return !!(w && w.weekExpanded);
      });
    }

    miscLabel(m) {
      if (!m) return 'Miscellaneous charge';
      const parts = [];
      parts.push(m.comments ? String(m.comments).slice(0, 60) : 'No description');
      if (Number(m.quantity) > 1) parts.push('qty ' + Number(m.quantity));
      if (m.expenditureOrg) parts.push(m.expenditureOrg);
      return parts.join('  ·  ');
    }

    /** "Set type" when nobody chose (it would post as Equipment); "Mixed — set one" across two lines. */
    expTypeLabel(row) {
      if (!row) return '';
      if (row.expenditureTypeMixed) return 'Mixed — set one';
      return row.expenditureType ? String(row.expenditureType) : 'Set type';
    }

    /** Percentage total in BASIS POINTS: floating-point sums of three slices miss 100 one time in twelve. */
    splitPctTotal(slices) {
      return (Array.isArray(slices) ? slices : []).reduce((sum, s) => {
        const pct = s && s.pct != null ? Number(s.pct) : 0;
        return sum + (isFinite(pct) ? Math.round(pct * 100) : 0);
      }, 0);
    }

    /** THE split rule, as one message ('' when valid): 2-5 slices, project + task + pct each, no repeats, 100%. */
    splitFormError(slices, minSlices, maxSlices) {
      const list = Array.isArray(slices) ? slices : [];
      const min = minSlices || 2;
      const max = maxSlices || 5;
      if (list.length < min) {
        return 'A split needs at least ' + min + ' projects. Add another, or close without saving to leave this week on the request\'s project.';
      }
      if (list.length > max) return 'A split can cover at most ' + max + ' projects.';
      for (let i = 0; i < list.length; i++) {
        const s = list[i] || {};
        if (!s.projectRefId) return 'Every line in the split needs a project.';
        if (!s.taskId) return 'Every line in the split needs a task. PPM can only take cost on a lowest-level task.';
        if (s.pct == null || !(Number(s.pct) > 0)) return 'Every project needs a percentage greater than zero.';
      }
      const seen = {};
      for (let i = 0; i < list.length; i++) {
        const s = list[i] || {};
        const key = String(s.projectRefId) + ':' + String(s.taskId);
        if (seen[key]) {
          return 'Project ' + (s.projectNumber || s.projectRefId) + ' / task ' + (s.taskNumber || s.taskId) + ' appears twice. Combine them into one percentage.';
        }
        seen[key] = 1;
      }
      const bp = this.splitPctTotal(list);
      if (bp !== 10000) {
        const shown = (bp / 100).toFixed(2).replace(/\.00$/, '');
        const gapShown = (Math.abs(10000 - bp) / 100).toFixed(2).replace(/\.00$/, '');
        return 'Percentages must add up to 100%. They currently total ' + shown + '% — ' + gapShown + '% ' + (bp < 10000 ? 'short' : 'over') + '.';
      }
      return '';
    }

    /** Equal shares totalling exactly 100%, in basis points; the remainder goes to the first slice. */
    splitEvenly(slices) {
      const list = Array.isArray(slices) ? slices : [];
      const n = list.length;
      if (n < 2) return list;
      const base = Math.floor(10000 / n);
      const remainder = 10000 - base * n;
      return list.map((s, i) => Object.assign({}, s, { pct: (base + (i === 0 ? remainder : 0)) / 100 }));
    }

    splitLabel(row) {
      if (!row || !row.splitCount) return '';
      const pcts = Array.isArray(row.splitPcts) ? row.splitPcts : [];
      if (pcts.length && pcts.length <= 3) return 'Split ' + pcts.map((p) => String(Number(p)).replace(/\.0+$/, '')).join(' / ');
      return 'Split across ' + row.splitCount + ' projects';
    }

    splitTitle(row) {
      if (!row) return '';
      if (row.kind === 'group') {
        const w = Array.isArray(row.splitWeekLabels) ? row.splitWeekLabels : [];
        return w.length ? ('Split: ' + w.join('\n       ')) : '';
      }
      if (!Array.isArray(row.splits) || !row.splits.length) return '';
      return row.splits.map((s) => (s.projectNumber || s.projectRefId || '?') + ' — ' + String(Number(s.splitPct != null ? s.splitPct : s.pct)) + '%'
        + (s.taskNumber ? ('  ·  task ' + s.taskNumber) : '')).join('\n');
    }

    splitWeeksLabel(row) {
      const n = row ? Number(row.splitWeekCount || 0) : 0;
      if (!n) return '';
      return n === 1 ? '1 week split' : (n + ' weeks split');
    }

    /** Where a row's cost goes: one line per destination ([] for a day, or a split week whose slices say it). */
    projectCells(row, hdr) {
      if (!row) return [];
      const h = hdr || {};
      if (row.kind === 'day') return [];
      if (row.kind === 'split') {
        const p = Number(row.splitPct);
        return [{ project: row.projectNumber || String(row.projectRefId || ''), projectName: row.projectName || '', task: row.taskNumber || '',
          taskName: row.taskName || '', pct: isFinite(p) ? p : null, inherited: false }];
      }
      if (row.kind === 'group' && Number(row.splitWeekCount || 0) > 0) {
        return [{ project: '', projectName: 'Multiple projects', task: '', taskName: '', pct: null, inherited: true, multiple: true }];
      }
      const splits = Array.isArray(row.splits) ? row.splits : [];
      if (row.kind === 'week' && splits.length >= 2) return [];
      const proj = h.projectNumber ? String(h.projectNumber) : '';
      if (!proj) return [];
      return [{ project: proj, projectName: h.projectName ? String(h.projectName) : '', task: h.taskNumber ? String(h.taskNumber) : '',
        taskName: h.taskName ? String(h.taskName) : '', pct: null, inherited: true }];
    }

    projectLabelOf(row, hdr) {
      const cells = this.projectCells(row, hdr);
      if (!cells.length) return '';
      const c = cells[0];
      const proj = c.projectName || c.project;
      const task = c.taskName || c.task;
      return proj + (task ? (' / ' + task) : '');
    }

    /** One slice row under each split week; idempotent (old slice rows are stripped first). */
    splitRows(all) {
      const rows = (all || []).filter((r) => r.kind !== 'split');
      const out = [];
      rows.forEach((r) => {
        out.push(r);
        if (r.kind !== 'week') return;
        const splits = Array.isArray(r.splits) ? r.splits : [];
        if (splits.length < 2) return;
        const weekCost = Number(r.cost || 0);
        const weekHours = Number(r.hours || 0);
        splits.forEach((s, i) => {
          const pct = Number(s.splitPct != null ? s.splitPct : s.pct);
          const share = isFinite(pct) ? pct / 100 : 0;
          out.push({ kind: 'split', rowKey: r.rowKey + ':S' + i, groupKey: r.groupKey, weekKey: r.rowKey, label: r.label,
            splitPct: isFinite(pct) ? pct : null, projectRefId: s.projectRefId, projectNumber: s.projectNumber, projectName: s.projectName,
            taskId: s.taskId, taskNumber: s.taskNumber, taskName: s.taskName, splitPersisted: r.splitPersisted,
            cost: round2(weekCost * share), hours: round2(weekHours * share), rateType: '', days: null, postable: false,
            posted: !!r.posted, reversed: !!r.reversed, selected: false });
        });
      });
      return out;
    }

    splitRollup(rowsAll, groupKey) {
      const rows = Array.isArray(rowsAll) ? rowsAll : [];
      const byGroup = {};
      rows.forEach((r) => {
        if (r.kind !== 'week' || !Array.isArray(r.splits) || !r.splits.length) return;
        const pcts = r.splits.map((s) => String(Number(s.splitPct != null ? s.splitPct : s.pct)));
        (byGroup[r.groupKey] = byGroup[r.groupKey] || []).push((r.label || '') + '  —  ' + pcts.join(' / ') + '%');
      });
      return rows.map((r) => {
        if (r.kind !== 'group' || (groupKey != null && r.groupKey !== groupKey)) return r;
        const labels = byGroup[r.groupKey] || [];
        return Object.assign({}, r, { splitWeekCount: labels.length, splitWeekLabels: labels });
      });
    }

    /** Everything derived from splits in one call: slice rows, the equipment rollup, the Project/Task label. */
    applySplitDerived(all, hdr) {
      const withRows = this.splitRows(this.splitRollup(all));
      return withRows.map((r) => (r.kind === 'day' ? r : Object.assign({}, r, { projectLabel: this.projectLabelOf(r, hdr) })));
    }

    // ── display helpers ─────────────────────────────────────────────────────

    /** Where an unsplit row posts: the request's own PPM project and task (the queue view's NVL to the header). */
    hdrOf(cur) {
      const c = cur || {};
      return {
        plannedStartDate: c.startDate || '',
        plannedEndDate: c.endDate || '',
        projectNumber: c.ppmProjectNumber || '',
        projectName: c.projectName && c.projectName !== '—' ? c.projectName : '',
        taskNumber: c.ppmTaskNumber || '',
        taskName: c.taskName && c.taskName !== '—' ? c.taskName : '',
      };
    }

    /** Chargeable tasks matching the filter (number or name), at most 30. */
    taskMatches(tasks, text) {
      const q = String(text || '').trim().toLowerCase();
      return (Array.isArray(tasks) ? tasks : [])
        .filter((t) => !q || [t.TaskNumber, t.TaskName].some((x) => x && String(x).toLowerCase().includes(q)))
        .slice(0, 30);
    }

    /** The reversal waiting for confirmation: the weeks, what they were posted at and what they re-tier to. */
    reversePreview(all, groupKey) {
      const weeks = (all || []).filter((r) => r.kind === 'week' && r.groupKey === groupKey && r.posted
        && r.retierPeriod && r.postedPeriod && String(r.retierPeriod).toUpperCase() !== String(r.postedPeriod).toUpperCase());
      const g = (all || []).find((r) => r.kind === 'group' && r.groupKey === groupKey);
      return {
        equipment: g ? g.label : '',
        weeks: weeks.length,
        credit: round2(weeks.reduce((s, r) => s + Number(r.cost || 0), 0)),
        redraft: round2(weeks.reduce((s, r) => s + Number(r.retierCost || 0), 0)),
        labels: weeks.map((r) => r.label + ' (' + String(r.postedPeriod).toLowerCase() + ' → ' + String(r.retierPeriod).toLowerCase() + ')'),
      };
    }

    tagClass(row) {
      if (!row) return 'er-status';
      if (row.posted) return 'er-status er-status--POSTED';
      if (row.reversed) return 'er-status er-status--REJECTED';
      if (row.pending || row.inProgress) return 'er-status er-status--SUBMITTED';
      if (row.postable) return 'er-status er-status--APPROVED';
      return 'er-status';
    }

    tagText(row) {
      if (!row) return '';
      if (row.postable && !row.posted && !row.reversed) return row.isRepost ? 'Ready · re-post' : 'Ready';
      return row.whenTag || '';
    }

    daysText(row) {
      if (!row) return '';
      if (row.kind === 'split' || row.kind === 'misc' || row.kind === 'miscGroup') return '—';
      if (row.kind === 'week' && row.direct && !row.prDays) return '—';
      return row.days ? String(row.days) : (row.kind === 'group' && row.notStarted ? '—' : String(row.days || 0));
    }

    /** "Monthly (160–479 h)"-style facts are not in the view; the tier name and the per-day rate are. */
    tierText(row) {
      const p = row && row.ratePeriod ? String(row.ratePeriod) : '';
      return p && p !== '—' ? p.charAt(0) + p.slice(1).toLowerCase() : '—';
    }

    expOptions(list) {
      return Array.isArray(list) ? list : [];
    }

    expMatches(list, text, limit) {
      const q = String(text || '').trim().toLowerCase();
      return (Array.isArray(list) ? list : []).filter((o) => o && (!q || String(o.label || o.value).toLowerCase().includes(q))).slice(0, limit || 40);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // EquipRite Next's own layer. Reads only: what is ready, what was posted, what would be posted. Nothing here
  // ticks, writes or posts; "would be posted" is New's postingPlan over everything New would let Finance tick.
  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════

  const LIST_CHIPS = [
    { key: 'all', label: 'All' },
    { key: 'ready', label: 'Ready to post' },
    { key: 'running', label: 'Rental running' },
    { key: 'posted', label: 'All posted' },
    { key: 'none', label: 'Nothing to post' },
  ];
  const isoOf = (v) => (v ? String(v).slice(0, 10) : '');
  const todayIso = (now) => {
    const n = now || new Date();
    return n.getUTCFullYear() + '-' + String(n.getUTCMonth() + 1).padStart(2, '0') + '-' + String(n.getUTCDate()).padStart(2, '0');
  };
  const sumCost = (list) => Math.round((list || []).reduce((s, r) => s + Number(r.cost || 0), 0) * 100) / 100;

  class CostPreview extends CostRules {
    /**
     * The preview with everything New lets Finance tick: every postable week (New's "Select all past weeks") and
     * every charge not yet posted. Fed to New's weeksToPost / miscToPost / postingPlan, it is exactly what Post would
     * write if all of it were ticked.
     */
    everythingReady(all) {
      return this.restampSelection((all || []).map((r) => {
        const week = r.kind === 'week' && r.postable && !r.posted;
        const charge = r.kind === 'misc' && r.status !== 'POSTED';
        return week || charge ? Object.assign({}, r, { selected: true }) : r;
      }));
    }

    /**
     * What would be posted if everything ready were posted: New's postingPlan, one line per ledger row or charge, with
     * a rental week named the Next way ("Generator · week of 12 – 18 Oct 2026").
     */
    readyPlan(all, hdr, rateScheduleId) {
      const byKey = {};
      (all || []).forEach((r) => { if (r.kind === 'week' || r.kind === 'misc') byKey[r.rowKey] = r; });
      return this.postingPlan(this.everythingReady(all), hdr, rateScheduleId).map((p) => {
        const r = byKey[p.key];
        if (r && r.kind === 'week' && !r.direct && r.weekStartISO) {
          return Object.assign({}, p, { what: (r.equipmentName || 'Equipment') + ' · week of ' + usageWeeks.weekLabel(r.weekStartISO) });
        }
        if (r && r.kind === 'misc' && r.expItemDate) return Object.assign({}, p, { quantity: r.quantity + ' on ' + nxFmt.date(r.expItemDate) });
        return p;
      });
    }

    /** A week's name the Next way ("12 – 18 Oct 2026"); a one-time charge keeps New's ("One-time", "Margin"). */
    weekName(r) {
      return r && r.kind === 'week' && !r.direct && r.weekStartISO ? usageWeeks.weekLabel(r.weekStartISO) : (r ? r.label : '');
    }

    /** New's "Oct 11" as Next writes a date ("11 Oct"). */
    dayName(label) {
      const m = /^([A-Z][a-z]{2}) (\d{1,2})$/.exec(String(label || ''));
      return m ? m[2] + ' ' + m[1] : String(label || '');
    }

    /**
     * One request in figures, from buildPreview's output: ready to post (the plan's total), posted, running (weeks not
     * ended yet), waiting for a Fusion material issue (consumables, which Fusion costs), the last post.
     */
    summarize(out) {
      const o = out || {};
      const all = o.rowsAll || [];
      const sel = this.selection(this.everythingReady(all));
      const weeksOf = (f) => all.filter((r) => r.kind === 'week' && f(r));
      const running = weeksOf((r) => r.inProgress && !r.posted && !r.reversed);
      const pending = weeksOf((r) => r.pending);
      const postedItems = all.filter((r) => (r.kind === 'week' || r.kind === 'misc') && r.posted).length;
      return {
        ready: sel.cost,
        readyWeeks: sel.weeks,
        readyCharges: sel.misc,
        posted: Number(o.postedCost || 0),
        postedItems,
        running: sumCost(running),
        runningWeeks: running.length,
        pending: sumCost(pending),
        pendingWeeks: pending.length,
        total: Number(o.totalCost || 0),
        lastPosted: o.lastPostedLabel && o.lastPostedLabel !== '—' ? this.dayName(o.lastPostedLabel) : '',
        netAdjustment: Number(o.netAdjustment || 0),
        retiered: !!o.isEarlyReturn,
      };
    }

    // ── a week or charge in words ──

    rowWord(r) {
      if (!r) return '';
      if (r.kind === 'misc') return r.posted ? 'Posted' : 'Ready to post';
      if (r.posted) return 'Posted';
      if (r.reversed) return 'Reversed';
      if (r.pending) return 'Waiting for the Fusion issue';
      if (r.postable) return r.isRepost ? 'Ready to post again' : 'Ready to post';
      if (r.inProgress) return 'This week, not ended';
      return 'Not ended yet';
    }

    rowTone(r) {
      if (!r) return 'draft';
      if (r.posted) return 'onsite';
      if (r.reversed) return 'stopped';
      if (r.pending) return 'approval';
      if (r.postable || r.kind === 'misc') return 'ready';
      if (r.inProgress) return 'out';
      return 'draft';
    }

    /** Where a row's cost goes, in one line: the request's project and task, or its split. */
    whereText(r, hdr) {
      if (!r) return '';
      const splits = Array.isArray(r.splits) ? r.splits.filter((s) => s && s.projectNumber && s.splitPct != null) : [];
      if (r.kind === 'week' && splits.length >= 2) {
        return splits.map((s) => Number(s.splitPct) + '% ' + s.projectNumber + (s.taskNumber ? ' / ' + s.taskNumber : '')).join(', ');
      }
      if (r.kind === 'group' && Number(r.splitWeekCount || 0) > 0) return 'Several projects (' + this.splitWeeksLabel(r) + ')';
      return this.projectLabelOf(r, hdr) || '—';
    }

    /**
     * The preview as a table a person reads: each equipment as a heading row, then its weeks and charges, with their
     * state in words. Days and split slices stay in New, where they are edited.
     */
    tableRows(all, hdr) {
      const out = [];
      (all || []).forEach((r) => {
        if (r.kind === 'group') {
          out.push({ key: r.rowKey, kind: 'group', label: r.label, equipment: r.label,
            note: r.notStarted ? 'not started' : (r.weekCount + (r.weekCount === 1 ? ' week' : ' weeks')),
            rate: r.rateText || '—', tier: this.tierText(r), days: this.daysText(r), hours: Number(r.hours || 0), cost: Number(r.cost || 0),
            expType: r.expenditureTypeLocked ? 'From the purchase order' : (r.expenditureTypeMixed ? 'Mixed' : (r.expenditureType || 'Equipment (default)')),
            where: this.whereText(r, hdr), word: '', tone: '', reversal: !!r.hasReversal, retier: !!r.tierChanged });
        } else if (r.kind === 'week' || r.kind === 'misc') {
          out.push({ key: r.rowKey, kind: r.kind, label: r.kind === 'misc' ? 'Charge: ' + r.label : this.weekName(r), equipment: r.equipmentName || '',
            note: r.kind === 'misc' ? r.expItemDate : (r.splitCount >= 2 ? this.splitLabel(r) : ''),
            rate: r.rateText || '—', tier: r.kind === 'week' ? this.tierText(r) : '', days: this.daysText(r), hours: Number(r.hours || 0),
            cost: Number(r.cost || 0), expType: r.kind === 'misc' ? (r.expenditureType || '—') : (r.lineExpenditureType || 'Equipment (default)'),
            where: this.whereText(r, hdr), word: this.rowWord(r), tone: this.rowTone(r), reversal: false, retier: false });
        }
      });
      return out;
    }

    // ── the request list ──

    /** Where the rental is today: 'over' (ended), 'running', or 'future' (not started). */
    listState(row, now) {
      const t = todayIso(now);
      const s = isoOf(row && row.startDate);
      const e = isoOf(row && row.endDate);
      if (e && e < t) return 'over';
      if (s && s > t) return 'future';
      return 'running';
    }

    stateWord(state) {
      return { over: 'Rental over', running: 'Rental running', future: 'Not started' }[state] || '';
    }

    /** A list row's chip, once its breakdown is known ('' while it is being worked out). */
    listKind(row, b, now) {
      if (!b) return '';
      if (b.ready > 0) return 'ready';
      if (this.listState(row, now) === 'running') return 'running';
      if (b.posted > 0) return 'posted';
      return 'none';
    }

    listChips(list, breakdown, now) {
      const rows = Array.isArray(list) ? list : [];
      return LIST_CHIPS.map((c) => ({
        key: c.key,
        label: c.label,
        count: c.key === 'all' ? rows.length : rows.filter((r) => this.listKind(r, (breakdown || {})[r.requestNumber], now) === c.key).length,
      }));
    }

    /** New's filterList (search), then the chip, then the sort (newest request first by default). */
    listShown(list, text, chip, breakdown, sortKey, sortDir, now) {
      const b = breakdown || {};
      const rows = this.filterList(list, text).filter((r) => !chip || chip === 'all' || this.listKind(r, b[r.requestNumber], now) === chip);
      const dir = sortDir === 'asc' ? 1 : -1;
      const val = (r) => {
        if (sortKey === 'ready') return b[r.requestNumber] ? b[r.requestNumber].ready : -1;
        if (sortKey === 'posted') return b[r.requestNumber] ? b[r.requestNumber].posted : -1;
        if (sortKey === 'cost') return Number(r.totalBillCost || 0);
        if (sortKey === 'end') return isoOf(r.endDate);
        return Number(r.eqrEquipmentRequestId) || 0;
      };
      return rows.slice().sort((x, y) => {
        const a = val(x);
        const c = val(y);
        if (a === c) return (Number(y.eqrEquipmentRequestId) || 0) - (Number(x.eqrEquipmentRequestId) || 0);
        return (a < c ? -1 : 1) * dir;
      });
    }

    /** The figures over the list: cost to date, and what is ready, posted and running over the requests worked out. */
    totals(list, breakdown) {
      const rows = Array.isArray(list) ? list : [];
      const b = breakdown || {};
      const known = rows.filter((r) => b[r.requestNumber]);
      const add = (f) => Math.round(known.reduce((s, r) => s + Number(f(b[r.requestNumber]) || 0), 0) * 100) / 100;
      return {
        requests: rows.length,
        known: known.length,
        cost: Math.round(rows.reduce((s, r) => s + Number(r.totalBillCost || 0), 0) * 100) / 100,
        ready: add((x) => x.ready),
        readyRequests: known.filter((r) => b[r.requestNumber].ready > 0).length,
        posted: add((x) => x.posted),
        running: add((x) => x.running),
        pending: add((x) => x.pending),
      };
    }

    // ── export ──

    exportColumns(kind) {
      if (kind === 'plan') {
        return [
          { key: 'what', label: 'What' },
          { key: 'quantity', label: 'Quantity' },
          { key: 'expType', label: 'Expenditure type' },
          { key: 'destination', label: 'Posts to' },
          { key: 'amount', label: 'Amount', type: 'number' },
          { key: 'note', label: 'Note' },
        ];
      }
      if (kind === 'weeks') {
        return [
          { key: 'equipment', label: 'Equipment' },
          { key: 'label', label: 'Week or charge', value: (r) => (r.kind === 'group' ? 'All weeks' : r.label) },
          { key: 'word', label: 'State' },
          { key: 'rate', label: 'Rate' },
          { key: 'tier', label: 'Tier' },
          { key: 'days', label: 'Days' },
          { key: 'hours', label: 'Hours', type: 'number' },
          { key: 'expType', label: 'Expenditure type' },
          { key: 'where', label: 'Posts to' },
          { key: 'cost', label: 'Cost', type: 'number' },
        ];
      }
      return [
        { key: 'requestNumber', label: 'Request' },
        { key: 'projectName', label: 'Project' },
        { key: 'taskName', label: 'Task' },
        { key: 'ppmProjectNumber', label: 'PPM project' },
        { key: 'ppmTaskNumber', label: 'PPM task' },
        { key: 'agreementNumber', label: 'Agreement' },
        { key: 'startDate', label: 'Start' },
        { key: 'endDate', label: 'End' },
        { key: 'state', label: 'Rental', value: (r) => this.stateWord(this.listState(r)) },
        { key: 'timesheets', label: 'Timesheets', type: 'number' },
        { key: 'totalHours', label: 'Hours', type: 'number' },
        { key: 'totalBillCost', label: 'Cost to date', type: 'number' },
        { key: 'ready', label: 'Ready to post', type: 'number', value: (r) => (r.b ? r.b.ready : '') },
        { key: 'posted', label: 'Posted', type: 'number', value: (r) => (r.b ? r.b.posted : '') },
        { key: 'running', label: 'Running, not ended', type: 'number', value: (r) => (r.b ? r.b.running : '') },
        { key: 'lastPosted', label: 'Last posted', value: (r) => (r.b ? r.b.lastPosted : '') },
      ];
    }
  }

  return { CostRules, CostPreview, LIST_CHIPS };
});

