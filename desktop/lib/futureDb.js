'use strict';
/**
 * EquipRite Future's demo story in DuckDB (the desktop app's data folder, future.duckdb).
 *
 * The story (the simulated group, its requests and every transaction) is saved on every change:
 *   - story            the current story, whole (JSON), for an exact reload
 *   - story_history    the last 50 saves, so nothing is lost by a mistake (restore from Snapshots)
 *   - snapshots        named save points ("after scenario 1"), restorable at any time
 *   - and the story as tables you can query with SQL: companies, business_units, units, agreements,
 *     agreement_rates, requests, request_lines, hours, charges, statements, fusion_tx, fusion_tx_lines, customs,
 *     notifications, audit_log (rebuilt from the story on each save; the JSON stays the source of truth)
 *
 * open(file) → store { info, load, save, snapshots, saveSnapshot, loadSnapshot, deleteSnapshot, history, query, close }.
 * When DuckDB cannot load (no binary for this platform), the same store keeps the story in a JSON file beside it,
 * without the tables or SQL.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

let duck = null;
try { duck = require('@duckdb/node-api'); } catch (e) { duck = null; }

const KEEP_HISTORY = 50;

// The story as flat rows per table (what SQL sees).
const TABLES = {
  companies: (s) => (s.companies || []).map((c) => ({ id: c.id, name: c.name, short: c.short, country: c.country, currency: c.currency, tax_reg: c.taxReg, ic_org: c.icOrg, role: c.role })),
  business_units: (s) => (s.bus || []).map((b) => ({ id: b.id, name: b.name, legal_entity: b.le, roles: (b.roles || []).join(',') })),
  units: (s) => (s.units || []).map((u) => ({ id: u.id, serial: u.serial, name: u.name, class: u.cls, owner_bu: u.owner, holding: u.hold, home_org: u.home, status: u.status, country: u.country,
    custody: u.custody && u.custody.kind, custody_label: u.custody && u.custody.label, asset_number: u.asset && u.asset.number, asset_cost: u.asset && u.asset.cost,
    accumulated_depreciation: u.asset && u.asset.accDep, stock_item: u.stock && u.stock.item, book_value: u.stock && u.stock.bookValue })),
  agreements: (s) => (s.agreements || []).map((a) => ({ id: a.id, number: a.number, kind: a.kind, provider_bu: a.provider, receiver_bu: a.receiver || null, customer: a.customer || null,
    currency: a.currency, billing: a.billing || 'DAILY', version: a.version, tax: a.tax, withholding: a.wht || 0, transport: a.transport, standby_pct: a.standbyPct, min_days: a.minDays, min_hours: a.minHours || 0, status: a.status })),
  agreement_rates: (s) => (s.agreements || []).reduce((out, a) => out.concat(Object.keys(a.rates || {}).map((k) => ({ agreement: a.id, class: k, day: a.rates[k].day, week: a.rates[k].week, hour: a.rates[k].hour || null }))), []),
  requests: (s) => (s.requests || []).map((r) => ({ id: r.id, number: r.number, type: r.type, requesting_bu: r.requestingBu, requesting_le: r.requestingLe, project: r.projectId || null, task: r.task || null,
    customer: r.customerId || null, site: r.site, country: r.country, date_from: r.from, date_to: r.to, status: r.status, created_by: r.createdBy, created_at: r.createdAt,
    deposit: r.deposit ? r.deposit.amount : null })),
  request_lines: (s) => (s.requests || []).reduce((out, r) => out.concat((r.lines || []).map((l) => ({ id: l.id, request: r.id, request_number: r.number, class: l.cls, unit: l.unitId || null,
    sourcing_bu: l.provider, sourcing_le: l.providerLe, relation: l.relation, agreement: l.agreementId || null, agreement_version: l.agreementVersion || null, status: l.status,
    billing: l.price && l.price.billing, currency: l.price && l.price.currency, day_rate: l.price && l.price.day, week_rate: l.price && l.price.week, hour_rate: l.price && l.price.hour,
    approved_on: l.events.approved || null, approved_by: l.approvedBy || null, shipped_on: l.events.shipped || null, on_hire: l.events.onHire || null, returned_on: l.events.offHire || null,
    back_at_yard: l.events.returned || null, planned_return: l.plannedReturn || null, damage: l.inspection ? l.inspection.damage : null, loss_value: l.loss ? l.loss.value : null }))), []),
  hours: (s) => (s.hours || []).map((h) => ({ request: h.requestId, line: h.lineId, day: h.date, usage: h.usage, standby: h.standby, approved: !!h.approved, approved_by: h.approvedBy || null, entered_by: h.by || null })),
  charges: (s) => (s.charges || []).map((c) => ({ id: c.id, period: c.period, request: c.requestId, request_number: c.requestNumber, line: c.lineId, unit: c.serial, kind: c.kind, relation: c.relation,
    sourcing_bu: c.provider, receiving_bu: c.receiver, customer: c.customerId || null, project: c.projectId || null, task: c.task || null, qty: c.qty, uom: c.uom, rate: c.rate, amount: c.amount,
    currency: c.currency, status: c.status, statement: c.statementId || null, ar_number: c.arNumber || null, ap_number: c.apNumber || null })),
  statements: (s) => (s.statements || []).map((st) => ({ id: st.id, number: st.number, period: st.period, sourcing_bu: st.provider, receiving_bu: st.receiver, relation: st.relation, currency: st.currency,
    status: st.status, due_by: st.dueBy || null, agreed_by: st.agreedBy || null, invoice_number: st.pair && st.pair.number || null, settled_on: st.pair && st.pair.settled ? st.pair.settled.at : null,
    accrued: !!st.accrued })),
  fusion_tx: (s) => (s.tx || []).map((t) => ({ id: t.id, number: t.number, kind: t.kind, legal_entity: t.le, tx_date: t.date, currency: t.currency, total: t.total || t.amount || 0, status: t.status,
    title: t.title, source: t.source, request: t.refs && t.refs.requestId || null, statement: t.refs && t.refs.statementId || null, project: t.refs && t.refs.projectId || null })),
  fusion_tx_lines: (s) => (s.tx || []).reduce((out, t) => out.concat((t.lines || []).map((l, i) => ({ tx: t.id, tx_number: t.number, legal_entity: t.le, line_no: i + 1, account: l.account, account_name: l.name,
    debit: l.dr || 0, credit: l.cr || 0, currency: t.currency, memo: l.memo || null }))), []),
  customs: (s) => (s.customs || []).map((c) => ({ id: c.id, permit: c.permit, unit: c.serial, from_country: c.from, to_country: c.to, regime: c.regime, entry: c.entry, reexport_by: c.reexportBy, status: c.status })),
  notifications: (s) => (s.notifications || []).map((n) => ({ id: n.id, on_day: n.at, text: n.text, kind: n.kind, to_bu: n.to && n.to.bu || null, to_roles: n.to && n.to.roles ? n.to.roles.join(',') : null })),
  audit_log: (s) => (s.log || []).map((x) => ({ id: x.id, on_day: x.at, who: x.who, title: x.whoTitle, what: x.what, request: x.refs && x.refs.requestId || null }))
};

const READ_ONLY = /^\s*(select|with|describe|summarize|show|pragma\s+table_info|from)\b/i;
const FORBIDDEN = /\b(insert|update|delete|drop|create|alter|copy|attach|detach|install|load|export|import|call|set|pragma\s+(?!table_info))\b/i;

function jsonOk(text) { try { const s = JSON.parse(text); return s && typeof s === 'object' && Array.isArray(s.requests) ? s : null; } catch (e) { return null; } }
function sqlStr(x) { return "'" + String(x).replace(/'/g, "''") + "'"; }

/** A store kept in a JSON file (when DuckDB cannot load). */
function jsonStore(file) {
  const dir = path.dirname(file);
  const storyFile = file.replace(/\.duckdb$/, '') + '.story.json';
  const snapFile = file.replace(/\.duckdb$/, '') + '.snapshots.json';
  const readSnaps = () => { try { return JSON.parse(fs.readFileSync(snapFile, 'utf8')); } catch (e) { return []; } };
  const writeAtomic = (f, text) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f + '.tmp', text); fs.renameSync(f + '.tmp', f); };
  return {
    info: async () => ({ engine: 'json', file: storyFile, tables: [], note: 'DuckDB is not available on this computer: the story is kept in a JSON file.' }),
    load: async () => (fs.existsSync(storyFile) ? fs.readFileSync(storyFile, 'utf8') : null),
    save: async (text) => { if (!jsonOk(text)) throw new Error('Not a story'); writeAtomic(storyFile, text); return { saved: true }; },
    snapshots: async () => readSnaps().map((x) => ({ id: x.id, name: x.name, saved_at: x.saved_at, demo_today: x.demo_today, requests: x.requests })),
    saveSnapshot: async (name, text) => {
      const s = jsonOk(text); if (!s) throw new Error('Not a story');
      const list = readSnaps(); const id = list.reduce((m, x) => Math.max(m, x.id), 0) + 1;
      list.push({ id, name: name || 'Snapshot ' + id, saved_at: new Date().toISOString(), demo_today: s.today, requests: s.requests.length, json: text });
      writeAtomic(snapFile, JSON.stringify(list)); return { id };
    },
    loadSnapshot: async (id) => { const x = readSnaps().find((q) => q.id === Number(id)); return x ? x.json : null; },
    deleteSnapshot: async (id) => { writeAtomic(snapFile, JSON.stringify(readSnaps().filter((q) => q.id !== Number(id)))); return { deleted: true }; },
    history: async () => [],
    query: async () => { throw new Error('SQL needs DuckDB, which is not available on this computer.'); },
    close: async () => {}
  };
}

async function open(file) {
  if (!duck) return jsonStore(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let instance;
  try { instance = await duck.DuckDBInstance.create(file); } catch (e) { console.warn('[futureDb] DuckDB could not open', file, e.message); return jsonStore(file); }
  const con = await instance.connect();
  let queue = Promise.resolve();
  const serial = (fn) => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };
  const rows = async (sql, params) => (await con.runAndReadAll(sql, params)).getRowObjectsJson();

  await con.run(`CREATE TABLE IF NOT EXISTS story (id VARCHAR PRIMARY KEY, version INTEGER, saved_at TIMESTAMP, demo_today DATE, requests INTEGER, json VARCHAR)`);
  await con.run(`CREATE SEQUENCE IF NOT EXISTS story_seq`);
  await con.run(`CREATE TABLE IF NOT EXISTS story_history (seq BIGINT PRIMARY KEY, saved_at TIMESTAMP, demo_today DATE, requests INTEGER, json VARCHAR)`);
  await con.run(`CREATE SEQUENCE IF NOT EXISTS snapshot_seq`);
  await con.run(`CREATE TABLE IF NOT EXISTS snapshots (id BIGINT PRIMARY KEY, name VARCHAR, saved_at TIMESTAMP, demo_today DATE, requests INTEGER, json VARCHAR)`);

  // The story as tables: rebuilt from the JSON on each save (through newline-delimited JSON files DuckDB reads itself).
  async function rebuildTables(s) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqf-'));
    try {
      for (const name of Object.keys(TABLES)) {
        const list = TABLES[name](s);
        if (!list.length) { await con.run(`DROP TABLE IF EXISTS ${name}`); await con.run(`CREATE TABLE ${name} (empty BOOLEAN)`); continue; }
        const f = path.join(tmp, name + '.ndjson');
        fs.writeFileSync(f, list.map((r) => JSON.stringify(r)).join('\n'));
        await con.run(`CREATE OR REPLACE TABLE ${name} AS SELECT * FROM read_json_auto(${sqlStr(f.replace(/\\/g, '/'))}, format = 'newline_delimited', sample_size = -1)`);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  return {
    info: () => serial(async () => {
      const v = (await rows('SELECT version() AS v'))[0].v;
      const t = await rows(`SELECT table_name AS name, estimated_size AS rows FROM duckdb_tables() ORDER BY table_name`);
      return { engine: 'duckdb', version: v, file, tables: t };
    }),
    load: () => serial(async () => { const r = await rows(`SELECT json FROM story WHERE id = 'current'`); return r.length ? r[0].json : null; }),
    save: (text) => serial(async () => {
      const s = jsonOk(text);
      if (!s) throw new Error('Not a story');
      await con.run('BEGIN TRANSACTION');
      try {
        await con.run(`INSERT OR REPLACE INTO story VALUES ('current', $1, now(), $2::DATE, $3, $4)`, [s.version || 0, s.today, s.requests.length, text]);
        await con.run(`INSERT INTO story_history VALUES (nextval('story_seq'), now(), $1::DATE, $2, $3)`, [s.today, s.requests.length, text]);
        await con.run(`DELETE FROM story_history WHERE seq NOT IN (SELECT seq FROM story_history ORDER BY seq DESC LIMIT ${KEEP_HISTORY})`);
        await rebuildTables(s);
        await con.run('COMMIT');
      } catch (e) {
        await con.run('ROLLBACK').catch(() => {});
        throw e;
      }
      return { saved: true };
    }),
    snapshots: () => serial(() => rows(`SELECT id, name, CAST(saved_at AS VARCHAR) AS saved_at, CAST(demo_today AS VARCHAR) AS demo_today, requests FROM snapshots ORDER BY id DESC`)),
    saveSnapshot: (name, text) => serial(async () => {
      const s = jsonOk(text);
      if (!s) throw new Error('Not a story');
      const r = await rows(`INSERT INTO snapshots VALUES (nextval('snapshot_seq'), $1, now(), $2::DATE, $3, $4) RETURNING id`, [String(name || 'Snapshot').slice(0, 120), s.today, s.requests.length, text]);
      return { id: Number(r[0].id) };
    }),
    loadSnapshot: (id) => serial(async () => { const r = await rows(`SELECT json FROM snapshots WHERE id = $1`, [Number(id)]); return r.length ? r[0].json : null; }),
    deleteSnapshot: (id) => serial(async () => { await con.run(`DELETE FROM snapshots WHERE id = $1`, [Number(id)]); return { deleted: true }; }),
    history: () => serial(() => rows(`SELECT seq, CAST(saved_at AS VARCHAR) AS saved_at, CAST(demo_today AS VARCHAR) AS demo_today, requests FROM story_history ORDER BY seq DESC`)),
    loadHistory: (seq) => serial(async () => { const r = await rows(`SELECT json FROM story_history WHERE seq = $1`, [Number(seq)]); return r.length ? r[0].json : null; }),
    /** Read-only SQL over the story's tables (SELECT, WITH, DESCRIBE, SUMMARIZE, SHOW): at most 1,000 rows. */
    query: (sql) => serial(async () => {
      const q = String(sql || '').trim().replace(/;+\s*$/, '');
      if (!READ_ONLY.test(q) || FORBIDDEN.test(q) || q.indexOf(';') !== -1) throw new Error('Only one read-only query: SELECT, WITH, DESCRIBE, SUMMARIZE or SHOW.');
      const reader = await con.runAndReadAll(q);
      const out = reader.getRowObjectsJson();
      return { columns: reader.columnNames(), rows: out.slice(0, 1000), total: out.length };
    }),
    close: async () => { try { con.closeSync && con.closeSync(); } catch (e) { /* closing */ } try { instance.closeSync && instance.closeSync(); } catch (e) { /* closing */ } }
  };
}

module.exports = { open, TABLES, available: !!duck };
