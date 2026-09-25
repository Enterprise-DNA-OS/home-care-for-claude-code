#!/usr/bin/env node
// home-care-for-claude-code: the one CLI. Claude Code slash commands call
// this; so can you.
//
//   node scripts/care.mjs <command> [args] [--flags] [--json]
//
// Run with no arguments (or `help`) for the command list.
//
// This system is an Australian NDIS / home care provider's operating record
// the way ShiftCare sells it: clients (participants), service agreements,
// support workers with their clearances, the roster, progress notes, the
// incident register, and payment requests. It sends nothing and connects to
// nothing: claims export to a file you upload, letters draft to drafts/.
//
// The gates, and there are no force flags:
//   * no rostering a worker whose NDIS Worker Screening clearance is missing
//     or expired on the shift date (NDIS (Practice Standards - Worker
//     Screening) Rules 2018)
//   * no rostering outside a signed, in-date service agreement
//   * no agreement rate above the support item's price limit (NDIS Pricing
//     Arrangements and Price Limits)
//   * no completing a shift without a progress note: the note is the record
//     that the support was delivered
//   * no closing a reportable incident without its NDIS Commission
//     notification date (NDIS (Incident Management and Reportable Incidents)
//     Rules 2018)
//
// Deliberately NOT here: clinical records. No medications, no diagnoses.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table, money as moneyRaw, hours as fmtHours, isoDate, truncate, heading } from './lib/format.mjs';

const money = (cents) => moneyRaw(cents, 'AUD');

// ---------------------------------------------------------------------------
// Argument parsing

const BOOL_FLAGS = new Set(['json', 'help', 'all', 'dry-run', 'reportable', 'past', 'open']);

function parseArgv(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      flags.help = true;
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let name;
      let value;
      if (eq > -1) {
        name = a.slice(2, eq);
        value = a.slice(eq + 1);
      } else {
        name = a.slice(2);
        const next = argv[i + 1];
        if (BOOL_FLAGS.has(name) || next === undefined || next.startsWith('--')) value = true;
        else value = argv[++i];
      }
      flags[name] = value;
    } else {
      args.push(a);
    }
  }
  return { args, flags };
}

class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

const num = (v) => Number(v ?? 0);
const str = (v) => (v === true || v === undefined || v === null ? '' : String(v));

// ---------------------------------------------------------------------------
// Dates, times, money

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(v, what = 'date') {
  if (!v || v === true) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const lower = s.toLowerCase();
  if (lower === 'today') return today();
  if (lower === 'yesterday') return addDays(today(), -1);
  if (lower === 'tomorrow') return addDays(today(), 1);
  // Australian exports write DD/MM/YYYY: the first number is the day unless
  // the second is too big to be a month.
  const slash = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const [day, month] = b > 12 ? [b, a] : [a, b];
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new CliError(`"${v}" is not a ${what}. Use YYYY-MM-DD.`);
  return isoDate(d);
}

function parseTime(v, what = 'time') {
  if (!v || v === true) throw new CliError(`A ${what} is required (HH:MM, 24 hour).`);
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) throw new CliError(`"${v}" is not a ${what}. Use HH:MM, 24 hour.`);
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) throw new CliError(`"${v}" is not a ${what}.`);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function minutesBetween(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) throw new CliError(`The shift ends (${end}) before it starts (${start}). Overnight shifts: split them at midnight.`);
  return mins;
}

function parseMoney(v, what = 'amount') {
  if (v === undefined || v === null || v === '' || v === true) return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  if (Number.isNaN(n)) throw new CliError(`"${v}" is not a ${what}. Money in dollars: 67.56 means $67.56.`);
  return Math.round(n * 100);
}

// ---------------------------------------------------------------------------
// Lookups: partial, case-insensitive, loud when ambiguous

async function resolveRow(db, sql, params, label, name) {
  const rows = await db.query(sql, params);
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new CliError(`No ${label} matches "${name}".`);
  const list = rows.slice(0, 10).map((r) => `  ${r.ref ? r.ref + '  ' : ''}${r.name || r.description || ''}`).join('\n');
  throw new CliError(`"${name}" matches ${rows.length} ${label} records. Which one?\n${list}`);
}

async function resolveClient(db, name) {
  if (!name) throw new CliError('Which client? Give a name (partial is fine) or an NDIS number.');
  const n = String(name).trim();
  const exact = await db.query('select * from clients where lower(name) = lower($1) or ndis_number = $1', [n]);
  if (exact.length === 1) return exact[0];
  return resolveRow(db, 'select * from clients where name ilike $1 order by name', [`%${n}%`], 'client', n);
}

async function resolveWorker(db, name) {
  if (!name) throw new CliError('Which worker? Give a name (partial is fine).');
  const n = String(name).trim();
  const exact = await db.query('select * from workers where lower(name) = lower($1)', [n]);
  if (exact.length === 1) return exact[0];
  return resolveRow(db, 'select * from workers where name ilike $1 order by name', [`%${n}%`], 'worker', n);
}

async function resolveByRef(db, tableName, prefix, ref, label) {
  if (!ref) throw new CliError(`Which ${label}? Give its ref, like ${prefix}-101.`);
  let r = String(ref).trim().toUpperCase();
  if (/^\d+$/.test(r)) r = `${prefix}-${r}`;
  const rows = await db.query(`select * from ${tableName} where upper(ref) = $1`, [r]);
  if (rows.length === 1) return rows[0];
  throw new CliError(`No ${label} with ref "${r}".`);
}

async function nextRef(db, tableName, prefix, start) {
  const [row] = await db.query(
    `select coalesce(max(substring(ref from '${prefix}-(\\d+)')::int), $1) + 1 as n from ${tableName} where ref like '${prefix}-%'`,
    [start - 1],
  );
  return `${prefix}-${row.n}`;
}

async function activeAgreementFor(db, clientId, onDate, itemHint) {
  const rows = await db.query(
    `select a.*, si.item_number, si.name as support, si.price_cap_cents
       from agreements a join support_items si on si.id = a.support_item_id
      where a.client_id = $1 and a.status = 'active' and a.starts_on <= $2 and a.ends_on >= $2
      order by a.ref`,
    [clientId, onDate],
  );
  if (itemHint) {
    const hint = String(itemHint).toLowerCase();
    const hit = rows.filter((a) => a.ref.toLowerCase() === hint || a.item_number.toLowerCase() === hint || a.support.toLowerCase().includes(hint));
    if (hit.length === 1) return hit[0];
    if (hit.length > 1) throw new CliError(`"${itemHint}" matches ${hit.length} agreements. Use the SA ref.`);
    throw new CliError(`No agreement matching "${itemHint}" covers ${onDate} for this client.`);
  }
  if (rows.length === 1) return rows[0];
  if (!rows.length) return null;
  const list = rows.map((a) => `  ${a.ref}  ${a.support}`).join('\n');
  throw new CliError(`This client has ${rows.length} agreements covering ${onDate}. Say which with --agreement=:\n${list}`);
}

// ---------------------------------------------------------------------------
// Output

function out(flags, jsonValue, textFn) {
  if (flags.json) {
    console.log(JSON.stringify(jsonValue, null, 2));
  } else {
    textFn();
  }
}

const AUD = (c) => (c === null || c === undefined ? '' : money(num(c)));
const mins = (m) => (m === null || m === undefined ? '' : fmtHours(num(m)));

// ---------------------------------------------------------------------------
// Commands: the business

async function cmdStats(db, flags) {
  const [s] = await db.query(`
    select (select count(*) from clients where status = 'active') as active_clients,
           (select count(*) from clients) as clients,
           (select count(*) from workers where status = 'active') as active_workers,
           (select count(*) from agreements where status = 'active') as agreements,
           (select count(*) from shifts) as shifts,
           (select count(*) from shifts where status = 'scheduled' and shift_on between current_date and current_date + 7) as shifts_next_7d,
           (select count(*) from progress_notes) as notes,
           (select count(*) from incidents where status = 'open') as open_incidents,
           (select count(*) from claims) as claims,
           (select coalesce(sum(value_cents), 0) from v_unclaimed) as unclaimed_cents
  `);
  const stats = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Number(v)]));
  out(flags, stats, () => {
    console.log(heading('Fernbank at a glance'));
    console.log(`  ${stats.active_clients} active clients, ${stats.active_workers} active workers, ${stats.agreements} live agreements`);
    console.log(`  ${stats.shifts_next_7d} shifts rostered in the next 7 days`);
    console.log(`  ${money(stats.unclaimed_cents)} delivered and not yet claimed`);
    console.log(`  ${stats.open_incidents} open incident(s)`);
  });
}

async function cmdClients(db, flags) {
  const rows = await db.query(
    `select * from v_clients ${flags.all ? '' : "where status = 'active'"} order by name`,
  );
  out(flags, rows, () => {
    console.log(heading(flags.all ? 'All clients' : 'Active clients'));
    console.log(table(rows, [
      { key: 'name', label: 'client' },
      { key: 'ndis_number', label: 'ndis no.' },
      { key: 'funding', label: 'funding' },
      { key: 'funded_hours_week', label: 'h/wk', align: 'right' },
      { key: 'minutes_last_28d', label: 'last 28d', align: 'right', format: mins },
      { key: 'last_shift_on', label: 'last shift', format: isoDate },
      { key: 'next_shift_on', label: 'next shift', format: isoDate },
      { key: 'unclaimed_cents', label: 'unclaimed', align: 'right', format: AUD },
      { key: 'plan_ends_on', label: 'plan ends', format: isoDate },
    ]));
  });
}

async function cmdClient(db, flags, name) {
  const c = await resolveClient(db, name);
  const [card] = await db.query('select * from v_clients where client_id = $1', [c.id]);
  const agreements = await db.query('select * from v_agreements where client_id = $1 order by ref', [c.id]);
  const recent = await db.query(
    `select * from v_shifts where client_id = $1 and shift_on <= current_date order by shift_on desc, starts_at limit 12`, [c.id]);
  const upcoming = await db.query(
    `select * from v_shifts where client_id = $1 and shift_on > current_date and status = 'scheduled' order by shift_on, starts_at`, [c.id]);
  const notes = await db.query(
    `select n.noted_on, w.name as worker, s.ref as shift_ref, n.note
       from progress_notes n left join workers w on w.id = n.worker_id left join shifts s on s.id = n.shift_id
      where n.client_id = $1 order by n.noted_on desc, n.created_at desc limit 8`, [c.id]);
  const incidents = await db.query('select * from v_incidents where client = $1 order by occurred_on desc', [c.name]);
  out(flags, { client: card, agreements, recent, upcoming, notes, incidents }, () => {
    console.log(heading(`${card.name}${card.ndis_number ? '  (NDIS ' + card.ndis_number + ')' : ''}`));
    console.log(`  ${card.funding}${card.plan_manager ? ' via ' + card.plan_manager : ''}  ·  ${c.suburb || ''}  ·  plan ends ${isoDate(card.plan_ends_on) || 'n/a'}`);
    console.log(`  last shift ${isoDate(card.last_shift_on) || 'never'}, next ${isoDate(card.next_shift_on) || 'NONE ROSTERED'}, unclaimed ${money(card.unclaimed_cents)}`);
    console.log(heading('Agreements'));
    console.log(table(agreements, [
      { key: 'ref', label: 'ref' },
      { key: 'support', label: 'support', width: 44 },
      { key: 'rate_cents', label: 'rate/h', align: 'right', format: AUD },
      { key: 'hours_per_week', label: 'h/wk', align: 'right' },
      { key: 'used_cents', label: 'used', align: 'right', format: AUD },
      { key: 'budget_cents', label: 'budget', align: 'right', format: AUD },
      { key: 'ends_on', label: 'ends', format: isoDate },
      { key: 'state', label: 'state' },
    ]));
    console.log(heading('Recent shifts'));
    console.log(table(recent, [
      { key: 'ref', label: 'ref' },
      { key: 'shift_on', label: 'date', format: isoDate },
      { key: 'worker', label: 'worker' },
      { key: 'scheduled_minutes', label: 'length', align: 'right', format: mins },
      { key: 'value_cents', label: 'value', align: 'right', format: AUD },
      { key: 'state', label: 'state' },
    ]));
    if (upcoming.length) {
      console.log(heading('Upcoming'));
      console.log(table(upcoming, [
        { key: 'ref', label: 'ref' },
        { key: 'shift_on', label: 'date', format: isoDate },
        { key: 'starts_at', label: 'start' },
        { key: 'worker', label: 'worker' },
        { key: 'support', label: 'support', width: 40 },
      ]));
    }
    console.log(heading('Progress notes (latest)'));
    console.log(table(notes, [
      { key: 'noted_on', label: 'date', format: isoDate },
      { key: 'worker', label: 'worker' },
      { key: 'note', label: 'note', width: 90 },
    ]));
    if (incidents.length) {
      console.log(heading('Incidents'));
      console.log(table(incidents, [
        { key: 'ref', label: 'ref' },
        { key: 'occurred_on', label: 'date', format: isoDate },
        { key: 'category', label: 'category' },
        { key: 'severity', label: 'severity' },
        { key: 'state', label: 'state' },
      ]));
    }
  });
}

async function cmdWorkers(db, flags) {
  const rows = await db.query(`select * from v_workers ${flags.all ? '' : "where status = 'active'"} order by name`);
  out(flags, rows, () => {
    console.log(heading(flags.all ? 'Everyone' : 'The team'));
    console.log(table(rows, [
      { key: 'name', label: 'worker' },
      { key: 'role', label: 'role' },
      { key: 'employment', label: 'employment' },
      { key: 'screening', label: 'screening' },
      { key: 'screening_expires_on', label: 'expires', format: isoDate },
      { key: 'first_aid', label: 'first aid' },
      { key: 'shifts_next_7d', label: 'next 7d', align: 'right' },
      { key: 'minutes_last_14d', label: 'last 14d', align: 'right', format: mins },
      { key: 'clients_last_28d', label: 'clients', align: 'right' },
    ]));
  });
}

async function cmdWorker(db, flags, name) {
  const w = await resolveWorker(db, name);
  const [card] = await db.query('select * from v_workers where worker_id = $1', [w.id]);
  const upcoming = await db.query(
    `select * from v_shifts where worker_id = $1 and shift_on >= current_date and status = 'scheduled' order by shift_on, starts_at`, [w.id]);
  const recent = await db.query(
    `select * from v_shifts where worker_id = $1 and shift_on < current_date order by shift_on desc limit 10`, [w.id]);
  out(flags, { worker: card, upcoming, recent }, () => {
    console.log(heading(`${card.name}  ·  ${card.role}, ${card.employment}`));
    console.log(`  screening ${card.screening} (expires ${isoDate(card.screening_expires_on) || 'not on record'}), first aid ${card.first_aid} (expires ${isoDate(card.first_aid_expires_on) || 'not on record'})`);
    console.log(heading('Upcoming shifts'));
    console.log(table(upcoming, [
      { key: 'ref', label: 'ref' },
      { key: 'shift_on', label: 'date', format: isoDate },
      { key: 'starts_at', label: 'start' },
      { key: 'client', label: 'client' },
      { key: 'support', label: 'support', width: 40 },
    ]));
    console.log(heading('Recent'));
    console.log(table(recent, [
      { key: 'ref', label: 'ref' },
      { key: 'shift_on', label: 'date', format: isoDate },
      { key: 'client', label: 'client' },
      { key: 'state', label: 'state' },
    ]));
  });
}

async function cmdRoster(db, flags) {
  const where = ['1=1'];
  const params = [];
  if (flags.client) {
    const c = await resolveClient(db, flags.client);
    params.push(c.id);
    where.push(`client_id = $${params.length}`);
  }
  if (flags.worker) {
    const w = await resolveWorker(db, flags.worker);
    params.push(w.id);
    where.push(`worker_id = $${params.length}`);
  }
  if (flags.day) {
    params.push(parseDate(flags.day, 'day'));
    where.push(`shift_on = $${params.length}`);
  } else if (flags.past) {
    where.push(`shift_on between current_date - 14 and current_date`);
  } else if (!flags.all) {
    where.push(`(shift_on between current_date and current_date + 7 or state in ('UNCONFIRMED', 'NO NOTE'))`);
  }
  const rows = await db.query(`select * from v_shifts where ${where.join(' and ')} order by shift_on, starts_at`, params);
  out(flags, rows, () => {
    console.log(heading(flags.day ? `Roster, ${parseDate(flags.day)}` : flags.past ? 'The last fortnight' : flags.all ? 'Every shift' : 'The week ahead (plus anything unresolved)'));
    console.log(table(rows, [
      { key: 'ref', label: 'ref' },
      { key: 'shift_on', label: 'date', format: isoDate },
      { key: 'starts_at', label: 'start' },
      { key: 'ends_at', label: 'end' },
      { key: 'client', label: 'client' },
      { key: 'worker', label: 'worker' },
      { key: 'support', label: 'support', width: 38 },
      { key: 'state', label: 'state' },
    ]));
  });
}

async function cmdAgreements(db, flags) {
  const rows = await db.query(`select * from v_agreements ${flags.all ? '' : "where status = 'active'"} order by ref`);
  out(flags, rows, () => {
    console.log(heading('Service agreements: the money and the pace'));
    console.log(table(rows, [
      { key: 'ref', label: 'ref' },
      { key: 'client', label: 'client' },
      { key: 'support', label: 'support', width: 40 },
      { key: 'rate_cents', label: 'rate/h', align: 'right', format: AUD },
      { key: 'used_cents', label: 'used', align: 'right', format: AUD },
      { key: 'budget_cents', label: 'budget', align: 'right', format: AUD },
      { key: 'used_pct', label: 'used%', align: 'right' },
      { key: 'elapsed_pct', label: 'time%', align: 'right' },
      { key: 'ends_on', label: 'ends', format: isoDate },
      { key: 'state', label: 'state' },
    ]));
    console.log('\n  used% far below time% is money the plan review will take back.');
  });
}

async function cmdItems(db, flags) {
  const rows = await db.query('select item_number, name, unit, price_cap_cents, note from support_items order by item_number');
  out(flags, rows, () => {
    console.log(heading('Support items and price limits'));
    console.log(table(rows, [
      { key: 'item_number', label: 'item' },
      { key: 'name', label: 'name', width: 56 },
      { key: 'price_cap_cents', label: 'price limit', align: 'right', format: AUD },
    ]));
    console.log('\n  Caps are what YOU set from the current NDIS Pricing Arrangements and Price Limits.');
  });
}

// ---------------------------------------------------------------------------
// Commands: adding records

async function cmdAdd(db, flags, kind, name) {
  if (kind === 'client') {
    if (!name) throw new CliError('add client needs a name: add client "Jane Citizen" --ndis=430000000 --funding=plan_managed');
    const ref = await db.query('select id from clients where lower(name) = lower($1)', [name]);
    if (ref.length) throw new CliError(`A client named "${name}" already exists.`);
    const funding = str(flags.funding) || 'plan_managed';
    if (!['ndia_managed', 'plan_managed', 'self_managed', 'private'].includes(funding)) {
      throw new CliError('funding must be ndia_managed, plan_managed, self_managed or private.');
    }
    const [row] = await db.query(
      `insert into clients (name, ndis_number, dob, address, suburb, phone, email, funding, plan_manager, plan_ends_on, emergency_name, emergency_phone)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [name, str(flags.ndis) || null, parseDate(flags.dob, 'date of birth'), str(flags.address) || null, str(flags.suburb) || null,
       str(flags.phone) || null, str(flags.email) || null, funding, str(flags['plan-manager']) || null,
       parseDate(flags['plan-ends'], 'plan end date'), str(flags.emergency) || null, str(flags['emergency-phone']) || null],
    );
    return out(flags, row, () => console.log(`  added client ${row.name}${row.ndis_number ? ' (NDIS ' + row.ndis_number + ')' : ''}`));
  }
  if (kind === 'worker') {
    if (!name) throw new CliError('add worker needs a name: add worker "Sam Field" --screening=2027-05-01 --screening-number=WS-123');
    const ref = await db.query('select id from workers where lower(name) = lower($1)', [name]);
    if (ref.length) throw new CliError(`A worker named "${name}" already exists.`);
    const [row] = await db.query(
      `insert into workers (name, role, employment, phone, email, screening_number, screening_expires_on, first_aid_expires_on, wwcc_expires_on)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [name, str(flags.role) || 'support_worker', str(flags.employment) || 'casual', str(flags.phone) || null, str(flags.email) || null,
       str(flags['screening-number']) || null, parseDate(flags.screening, 'screening expiry'), parseDate(flags['first-aid'], 'first aid expiry'),
       parseDate(flags.wwcc, 'WWCC expiry')],
    );
    return out(flags, row, () => console.log(`  added worker ${row.name} (screening expires ${isoDate(row.screening_expires_on) || 'NOT ON RECORD: they cannot be rostered until it is'})`));
  }
  throw new CliError('add what? add client "..." or add worker "..."');
}

async function cmdScreening(db, flags, name) {
  const w = await resolveWorker(db, name);
  const expires = parseDate(flags.expires, 'expiry date');
  if (!expires) throw new CliError('screening needs --expires=YYYY-MM-DD (the clearance expiry on the certificate).');
  const [row] = await db.query(
    'update workers set screening_expires_on = $1, screening_number = coalesce($2, screening_number) where id = $3 returning *',
    [expires, str(flags.number) || null, w.id],
  );
  out(flags, row, () => console.log(`  ${row.name}: screening now expires ${isoDate(row.screening_expires_on)}`));
}

async function cmdFirstAid(db, flags, name) {
  const w = await resolveWorker(db, name);
  const expires = parseDate(flags.expires, 'expiry date');
  if (!expires) throw new CliError('firstaid needs --expires=YYYY-MM-DD.');
  const [row] = await db.query('update workers set first_aid_expires_on = $1 where id = $2 returning *', [expires, w.id]);
  out(flags, row, () => console.log(`  ${row.name}: first aid now expires ${isoDate(row.first_aid_expires_on)}`));
}

async function cmdAgreementAdd(db, flags, clientName) {
  const c = await resolveClient(db, clientName);
  const itemNo = str(flags.item);
  if (!itemNo) throw new CliError('agreement add needs --item=<item number> (see: items).');
  const [item] = await db.query('select * from support_items where lower(item_number) = lower($1)', [itemNo]);
  if (!item) throw new CliError(`No support item "${itemNo}". List them with: items. Add one with: item add.`);
  const rate = parseMoney(flags.rate, 'hourly rate');
  if (rate === null) throw new CliError('agreement add needs --rate= (dollars per hour).');
  if (rate > num(item.price_cap_cents)) {
    throw new CliError(
      `${money(rate)}/h exceeds the price limit for ${item.item_number} (${money(item.price_cap_cents)}/h).\n` +
      'The NDIS Pricing Arrangements and Price Limits cap what can be charged for this support. ' +
      'Either the rate is wrong, or the cap in `items` is out of date: update it from the current price guide first. No force flag.',
    );
  }
  const starts = parseDate(flags.starts, 'start date');
  const ends = parseDate(flags.ends, 'end date');
  if (!starts || !ends) throw new CliError('agreement add needs --starts= and --ends= (YYYY-MM-DD).');
  if (ends <= starts) throw new CliError('The agreement ends before it starts.');
  const ref = await nextRef(db, 'agreements', 'SA', 11);
  const [row] = await db.query(
    `insert into agreements (ref, client_id, support_item_id, rate_cents, hours_per_week, budget_cents, starts_on, ends_on, signed_on)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [ref, c.id, item.id, rate, Number(flags.hours || 0), parseMoney(flags.budget, 'budget') || 0, starts, ends, parseDate(flags.signed, 'signed date')],
  );
  out(flags, row, () => {
    console.log(`  ${row.ref}: ${c.name}, ${item.name} at ${money(row.rate_cents)}/h, ${isoDate(row.starts_on)} to ${isoDate(row.ends_on)}`);
    if (!row.signed_on) console.log('  UNSIGNED: it will not roster until --signed is recorded (agreement sign).');
  });
}

async function cmdAgreementSign(db, flags, ref) {
  const a = await resolveByRef(db, 'agreements', 'SA', ref, 'agreement');
  const signed = parseDate(flags.on, 'signed date') || today();
  const [row] = await db.query('update agreements set signed_on = $1 where id = $2 returning *', [signed, a.id]);
  out(flags, row, () => console.log(`  ${row.ref} signed ${isoDate(row.signed_on)}`));
}

async function cmdItemAdd(db, flags, itemNumber) {
  if (!itemNumber) throw new CliError('item add needs the item number: item add 01_011_0107_1_1 --name="..." --cap=67.56');
  const cap = parseMoney(flags.cap, 'price limit');
  if (!flags.name || cap === null) throw new CliError('item add needs --name= and --cap= (dollars, from the current price guide).');
  const [row] = await db.query(
    `insert into support_items (item_number, name, unit, price_cap_cents, note) values ($1,$2,$3,$4,$5)
     on conflict (item_number) do update set name = $2, price_cap_cents = $4, note = $5 returning *`,
    [itemNumber, str(flags.name), str(flags.unit) || 'hour', cap, str(flags.note) || null],
  );
  out(flags, row, () => console.log(`  ${row.item_number}: ${row.name}, limit ${money(row.price_cap_cents)}/${row.unit}`));
}

// ---------------------------------------------------------------------------
// Commands: the roster verbs (where the gates live)

async function cmdShiftAdd(db, flags, clientName) {
  const c = await resolveClient(db, clientName);
  if (c.status !== 'active') throw new CliError(`${c.name} exited on ${isoDate(c.exited_on)}. Reactivate the client record first if that is wrong.`);
  const w = await resolveWorker(db, str(flags.worker));
  const on = parseDate(flags.on, 'shift date');
  if (!on) throw new CliError('shift add needs --on=YYYY-MM-DD (or today/tomorrow).');
  const start = parseTime(flags.start, 'start time');
  const end = parseTime(flags.end, 'end time');
  const minutes = minutesBetween(start, end);

  // Gate 1: the worker's screening clearance must be current ON THE SHIFT DATE.
  if (w.status !== 'active') throw new CliError(`${w.name} is a former worker.`);
  const screeningExpiry = isoDate(w.screening_expires_on);
  if (!screeningExpiry || screeningExpiry < on) {
    throw new CliError(
      `${w.name} has no current NDIS Worker Screening clearance on ${on}` +
      (screeningExpiry ? ` (expired ${screeningExpiry}).` : ' (none on record).') +
      '\nA worker without a clearance cannot deliver NDIS supports (NDIS (Practice Standards - Worker Screening) Rules 2018). ' +
      'Record the renewal with `screening "' + w.name + '" --expires=` or roster someone else. No force flag.',
    );
  }

  // Gate 2: the shift must sit inside a SIGNED, in-date service agreement.
  const agreement = await activeAgreementFor(db, c.id, on, flags.agreement);
  if (!agreement) {
    throw new CliError(
      `${c.name} has no active service agreement covering ${on}. Supports delivered outside an agreement cannot be claimed.\n` +
      'Add one first: agreement add "' + c.name + '" --item= --rate= --starts= --ends= --signed=',
    );
  }
  if (!agreement.signed_on) {
    throw new CliError(
      `${agreement.ref} is not signed. An unsigned agreement does not roster: get the signature, record it with \`agreement sign ${agreement.ref} --on=\`, then roster.`,
    );
  }

  // Gate 3: the worker cannot be in two places at once.
  const clash = await db.query(
    `select ref, starts_at, ends_at, client_id from shifts
      where worker_id = $1 and shift_on = $2 and status in ('scheduled', 'completed')
        and starts_at < $4 and ends_at > $3`,
    [w.id, on, start, end],
  );
  if (clash.length) {
    throw new CliError(`${w.name} is already rostered ${on} ${String(clash[0].starts_at).slice(0, 5)}-${String(clash[0].ends_at).slice(0, 5)} (${clash[0].ref}).`);
  }

  const ref = await nextRef(db, 'shifts', 'SH', 1001);
  const [row] = await db.query(
    `insert into shifts (ref, client_id, worker_id, agreement_id, shift_on, starts_at, ends_at, scheduled_minutes)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [ref, c.id, w.id, agreement.id, on, start, end, minutes],
  );
  out(flags, row, () => console.log(`  ${row.ref}: ${c.name} with ${w.name}, ${on} ${start}-${end} (${fmtHours(minutes)}, ${agreement.ref} ${agreement.support})`));
}

async function cmdShiftDone(db, flags, ref) {
  const sh = await resolveByRef(db, 'shifts', 'SH', ref, 'shift');
  if (sh.status === 'cancelled') throw new CliError(`${sh.ref} was cancelled. A cancelled shift cannot be completed.`);
  const noteText = str(flags.note);
  if (!noteText) {
    throw new CliError(
      `${sh.ref} needs a progress note to complete: shift done ${sh.ref} --note="what happened, in the worker's words".\n` +
      'The note is the record that the support was delivered. No note, no evidence, no claim. No force flag.',
    );
  }
  const minutes = flags.minutes ? Number(flags.minutes) : num(sh.scheduled_minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new CliError('--minutes must be a positive number of minutes actually worked.');
  const [row] = await db.query(
    `update shifts set status = 'completed', completed_minutes = $1 where id = $2 returning *`,
    [Math.round(minutes), sh.id],
  );
  await db.query(
    'insert into progress_notes (shift_id, client_id, worker_id, noted_on, note) values ($1,$2,$3,$4,$5)',
    [sh.id, sh.client_id, sh.worker_id, isoDate(sh.shift_on), noteText],
  );
  out(flags, row, () => console.log(`  ${row.ref} completed, ${fmtHours(row.completed_minutes)}, note recorded.`));
}

async function cmdShiftCancel(db, flags, ref) {
  const sh = await resolveByRef(db, 'shifts', 'SH', ref, 'shift');
  if (sh.status === 'completed') throw new CliError(`${sh.ref} is already completed.`);
  const reason = str(flags.reason);
  if (!reason) throw new CliError('shift cancel needs --reason= (written down now, argued about never).');
  const notice = Number(flags.notice);
  if (!Number.isFinite(notice) || notice < 0) {
    throw new CliError('shift cancel needs --notice=<days> : how many days before the shift the client cancelled. It decides claimability.');
  }
  // NDIS Pricing Arrangements: a cancellation at short notice (less than 7
  // days) can be claimed at 100% of the agreed price. More notice: no claim.
  const claimable = notice < 7;
  const [row] = await db.query(
    `update shifts set status = 'cancelled', cancelled_on = $1, cancel_reason = $2, cancel_notice_days = $3, claimable = $4
      where id = $5 returning *`,
    [today(), reason, Math.round(notice), claimable, sh.id],
  );
  out(flags, row, () => {
    console.log(`  ${row.ref} cancelled (${notice} days notice): ${claimable
      ? 'SHORT NOTICE, claimable at 100% under the NDIS Pricing Arrangements. It will appear in `unclaimed`.'
      : 'enough notice, not claimable, and that is correct.'}`);
  });
}

async function cmdNoteAdd(db, flags, clientName, noteText) {
  const c = await resolveClient(db, clientName);
  const text = str(noteText || flags.note);
  if (!text) throw new CliError('note add needs the note text: note add "Harriet" "Phone call with ..."');
  const w = flags.worker ? await resolveWorker(db, str(flags.worker)) : null;
  let shiftId = null;
  if (flags.shift) {
    const sh = await resolveByRef(db, 'shifts', 'SH', str(flags.shift), 'shift');
    shiftId = sh.id;
  }
  const [row] = await db.query(
    'insert into progress_notes (shift_id, client_id, worker_id, noted_on, note) values ($1,$2,$3,$4,$5) returning *',
    [shiftId, c.id, w ? w.id : null, parseDate(flags.on, 'date') || today(), text],
  );
  out(flags, row, () => console.log(`  noted on ${c.name}, ${isoDate(row.noted_on)}`));
}

async function cmdNotes(db, flags, clientName) {
  const c = await resolveClient(db, clientName);
  const rows = await db.query(
    `select n.noted_on, w.name as worker, s.ref as shift_ref, n.note
       from progress_notes n left join workers w on w.id = n.worker_id left join shifts s on s.id = n.shift_id
      where n.client_id = $1 order by n.noted_on desc, n.created_at desc limit $2`,
    [c.id, Number(flags.limit || 20)],
  );
  out(flags, rows, () => {
    console.log(heading(`Progress notes: ${c.name}`));
    console.log(table(rows, [
      { key: 'noted_on', label: 'date', format: isoDate },
      { key: 'worker', label: 'worker' },
      { key: 'shift_ref', label: 'shift' },
      { key: 'note', label: 'note', width: 100 },
    ]));
  });
}

// ---------------------------------------------------------------------------
// Commands: incidents

async function cmdIncidentAdd(db, flags, clientName, description) {
  const c = await resolveClient(db, clientName);
  const desc = str(description);
  if (!desc) throw new CliError('incident add needs the description: incident add "Ruby" "Fall in the bathroom ..." --category=injury --severity=serious --reportable');
  const category = str(flags.category);
  const CATS = ['injury', 'medication', 'behaviour', 'property', 'near_miss', 'unauthorised_restrictive_practice', 'abuse_neglect', 'other'];
  if (!CATS.includes(category)) throw new CliError(`--category must be one of: ${CATS.join(', ')}`);
  const severity = str(flags.severity) || 'minor';
  if (!['minor', 'serious'].includes(severity)) throw new CliError('--severity is minor or serious.');
  const reportable = Boolean(flags.reportable) || ['unauthorised_restrictive_practice', 'abuse_neglect'].includes(category) || severity === 'serious';
  const w = flags.worker ? await resolveWorker(db, str(flags.worker)) : null;
  const ref = await nextRef(db, 'incidents', 'INC', 1);
  const [row] = await db.query(
    `insert into incidents (ref, client_id, worker_id, occurred_on, category, severity, reportable, description)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [ref, c.id, w ? w.id : null, parseDate(flags.on, 'date') || today(), category, severity, reportable, desc],
  );
  out(flags, row, () => {
    console.log(`  ${row.ref} recorded: ${severity} ${category}, ${c.name}`);
    if (reportable) {
      console.log(`  REPORTABLE. Notify the NDIS Commission within ${severity === 'serious' ? '24 HOURS' : '5 business days'} `
        + '(Incident Management and Reportable Incidents Rules 2018), then record it: incident notify ' + row.ref);
    }
  });
}

async function cmdIncidentNotify(db, flags, ref) {
  const i = await resolveByRef(db, 'incidents', 'INC', ref, 'incident');
  const on = parseDate(flags.on, 'notification date') || today();
  const [row] = await db.query('update incidents set notified_on = $1 where id = $2 returning *', [on, i.id]);
  out(flags, row, () => console.log(`  ${row.ref}: Commission notification recorded ${isoDate(row.notified_on)}`));
}

async function cmdIncidentClose(db, flags, ref) {
  const i = await resolveByRef(db, 'incidents', 'INC', ref, 'incident');
  if (i.reportable && !i.notified_on) {
    throw new CliError(
      `${i.ref} is a reportable incident with no Commission notification on record. It does not close until the notification date is recorded ` +
      '(NDIS (Incident Management and Reportable Incidents) Rules 2018). Record it first: incident notify ' + i.ref,
    );
  }
  const [row] = await db.query(
    `update incidents set status = 'closed', closed_on = $1 where id = $2 returning *`,
    [parseDate(flags.on, 'closed date') || today(), i.id],
  );
  out(flags, row, () => console.log(`  ${row.ref} closed ${isoDate(row.closed_on)}`));
}

async function cmdIncidents(db, flags) {
  const rows = await db.query(`select * from v_incidents ${flags.all ? '' : "where status = 'open'"} order by occurred_on desc`);
  out(flags, rows, () => {
    console.log(heading(flags.all ? 'The incident register' : 'Open incidents'));
    console.log(table(rows, [
      { key: 'ref', label: 'ref' },
      { key: 'occurred_on', label: 'date', format: isoDate },
      { key: 'client', label: 'client' },
      { key: 'worker', label: 'worker' },
      { key: 'category', label: 'category' },
      { key: 'severity', label: 'severity' },
      { key: 'reportable', label: 'reportable', format: (v) => (v ? 'YES' : '') },
      { key: 'notified_on', label: 'notified', format: isoDate },
      { key: 'state', label: 'state' },
    ]));
  });
}

// ---------------------------------------------------------------------------
// Commands: money

async function cmdUnclaimed(db, flags) {
  const rows = await db.query('select * from v_unclaimed order by shift_on');
  const total = rows.reduce((s, r) => s + num(r.value_cents), 0);
  out(flags, rows, () => {
    console.log(heading(`Delivered and not yet claimed: ${money(total)}`));
    console.log(table(rows, [
      { key: 'ref', label: 'shift' },
      { key: 'shift_on', label: 'date', format: isoDate },
      { key: 'client', label: 'client' },
      { key: 'support', label: 'support', width: 40 },
      { key: 'minutes', label: 'length', align: 'right', format: mins },
      { key: 'value_cents', label: 'value', align: 'right', format: AUD },
      { key: 'days_waiting', label: 'days', align: 'right' },
      { key: 'state', label: 'state' },
    ]));
    console.log('\n  Build the payment request: claim build   (completed shifts with no note are NOT here: fix those first, see attention)');
  });
}

async function cmdClaimBuild(db, flags) {
  const params = [];
  let where = '';
  if (flags.client) {
    const c = await resolveClient(db, str(flags.client));
    params.push(c.id);
    where = ` where client_id = $${params.length}`;
  }
  const rows = await db.query(`select * from v_unclaimed${where} order by shift_on`, params);
  if (!rows.length) {
    return out(flags, { batch_ref: null, claims: 0, amount_cents: 0 }, () => console.log('  Nothing to claim: every completed, noted shift already has a payment request.'));
  }
  const total = rows.reduce((s, r) => s + num(r.value_cents), 0);
  if (flags['dry-run']) {
    return out(flags, { batch_ref: '(dry run)', claims: rows.length, amount_cents: total, shifts: rows.map((r) => r.ref) }, () => {
      console.log(`  Would claim ${rows.length} shift(s) for ${money(total)}. Run without --dry-run to build the batch.`);
    });
  }
  const [b] = await db.query(`select coalesce(max(substring(batch_ref from 'PR-(\\d+)')::int), 0) + 1 as n from claims where batch_ref like 'PR-%'`);
  const batch = `PR-${String(b.n).padStart(3, '0')}`;
  const made = [];
  for (const r of rows) {
    const ref = await nextRef(db, 'claims', 'CLM', 1001);
    const [claim] = await db.query(
      `insert into claims (ref, shift_id, client_id, agreement_id, batch_ref, claimed_on, minutes, rate_cents, amount_cents)
       select $1, sh.id, sh.client_id, sh.agreement_id, $2, current_date, $3, a.rate_cents, $4
         from shifts sh join agreements a on a.id = sh.agreement_id where sh.id = $5
       returning *`,
      [ref, batch, num(r.minutes), num(r.value_cents), r.shift_id],
    );
    made.push(claim);
  }
  out(flags, { batch_ref: batch, claims: made.length, amount_cents: total }, () => {
    console.log(`  ${batch}: ${made.length} claim(s), ${money(total)}.`);
    console.log(`  Export the upload file: claim export --batch=${batch}`);
  });
}

async function cmdClaims(db, flags) {
  const where = [];
  const params = [];
  if (flags.batch) {
    params.push(str(flags.batch).toUpperCase());
    where.push(`upper(batch_ref) = $${params.length}`);
  }
  if (flags.status) {
    params.push(str(flags.status));
    where.push(`status = $${params.length}`);
  }
  const rows = await db.query(
    `select * from v_claims ${where.length ? 'where ' + where.join(' and ') : ''} order by claimed_on desc, ref`, params);
  out(flags, rows, () => {
    console.log(heading('Payment requests'));
    console.log(table(rows, [
      { key: 'ref', label: 'claim' },
      { key: 'batch_ref', label: 'batch' },
      { key: 'client', label: 'client' },
      { key: 'shift_on', label: 'support date', format: isoDate },
      { key: 'amount_cents', label: 'amount', align: 'right', format: AUD },
      { key: 'claimed_on', label: 'claimed', format: isoDate },
      { key: 'state', label: 'state' },
      { key: 'rejected_reason', label: 'why', width: 44 },
    ]));
  });
}

async function cmdClaimPaid(db, flags, ref) {
  if (!ref) throw new CliError('claim paid needs a claim ref (CLM-1007) or a batch ref (PR-002).');
  const r = String(ref).toUpperCase();
  const on = parseDate(flags.on, 'paid date') || today();
  const rows = r.startsWith('PR-')
    ? await db.query(`update claims set status = 'paid', paid_on = $1 where batch_ref = $2 and status = 'claimed' returning ref`, [on, r])
    : await db.query(`update claims set status = 'paid', paid_on = $1 where upper(ref) = $2 returning ref`, [on, /^\d+$/.test(r) ? `CLM-${r}` : r]);
  if (!rows.length) throw new CliError(`Nothing matched "${ref}" in a payable state.`);
  out(flags, { paid: rows.length }, () => console.log(`  ${rows.length} claim(s) marked paid ${on}.`));
}

async function cmdClaimReject(db, flags, ref) {
  const reason = str(flags.reason);
  if (!reason) throw new CliError('claim reject needs --reason= (write down what the portal said: it is the fix instruction).');
  const claim = await resolveByRef(db, 'claims', 'CLM', ref, 'claim');
  const [row] = await db.query(
    `update claims set status = 'rejected', rejected_reason = $1 where id = $2 returning *`, [reason, claim.id]);
  out(flags, row, () => console.log(`  ${row.ref} marked rejected: ${reason}`));
}

async function cmdClaimResubmit(db, flags, ref) {
  const claim = await resolveByRef(db, 'claims', 'CLM', ref, 'claim');
  if (claim.status !== 'rejected') throw new CliError(`${claim.ref} is ${claim.status}, not rejected.`);
  const [row] = await db.query(
    `update claims set status = 'claimed', claimed_on = current_date, rejected_reason = null, batch_ref = coalesce($1, batch_ref) where id = $2 returning *`,
    [str(flags.batch) || null, claim.id],
  );
  out(flags, row, () => console.log(`  ${row.ref} back to claimed (batch ${row.batch_ref}). Export and upload it again.`));
}

async function cmdClaimExport(db, flags) {
  const params = [];
  let where = `status = 'claimed'`;
  if (flags.batch) {
    params.push(str(flags.batch).toUpperCase());
    where = `upper(cl.batch_ref) = $${params.length}`;
  }
  const rows = await db.query(
    `select cl.ref, cl.batch_ref, cl.minutes, cl.rate_cents, cl.amount_cents, cl.status,
            c.ndis_number, c.name as client, sh.ref as shift_ref, sh.shift_on, sh.status as shift_status, sh.claimable,
            si.item_number
       from claims cl
       join clients c on c.id = cl.client_id
       join shifts sh on sh.id = cl.shift_id
       join agreements a on a.id = cl.agreement_id
       join support_items si on si.id = a.support_item_id
      where ${where}
      order by cl.ref`, params);
  if (!rows.length) throw new CliError('No claims matched. Build a batch first: claim build');
  const brandFile = path.join(REPO_ROOT, 'brand.json');
  const brand = existsSync(brandFile) ? JSON.parse(readFileSync(brandFile, 'utf8')) : {};
  const registration = str(flags.registration) || brand.ndis_registration || '';
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // The myplace bulk payment request shape. Check the column order against the
  // current NDIA bulk upload template before your first real upload: the
  // template changes occasionally and docs/replace-shiftcare.md says where.
  const header = ['RegistrationNumber', 'NDISNumber', 'SupportsDeliveredFrom', 'SupportsDeliveredTo', 'SupportNumber',
    'ClaimReference', 'Quantity', 'Hours', 'UnitPrice', 'GSTCode', 'AuthorisedBy', 'ParticipantApproved', 'InKindFundingProgram',
    'ClaimType', 'CancellationReason'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const cancelled = r.shift_status === 'cancelled';
    lines.push([
      registration, r.ndis_number || '', isoDate(r.shift_on), isoDate(r.shift_on), r.item_number,
      r.ref, '', (num(r.minutes) / 60).toFixed(2), (num(r.rate_cents) / 100).toFixed(2), 'P2', '', '', '',
      cancelled ? 'CANC' : '', cancelled ? 'NSDH' : '',
    ].map(esc).join(','));
  }
  const dir = path.join(REPO_ROOT, 'exports');
  mkdirSync(dir, { recursive: true });
  const name = flags.batch ? `${str(flags.batch).toUpperCase()}.csv` : `claims-${today()}.csv`;
  const file = path.join(dir, name);
  writeFileSync(file, lines.join('\n') + '\n');
  const total = rows.reduce((s, r) => s + num(r.amount_cents), 0);
  out(flags, { file: path.relative(REPO_ROOT, file), claims: rows.length, amount_cents: total }, () => {
    console.log(`  ${path.relative(REPO_ROOT, file)}: ${rows.length} claim(s), ${money(total)}.`);
    console.log('  Upload it in the myplace provider portal (or hand the plan-managed lines to the plan manager). Nothing is sent from here.');
  });
}

// ---------------------------------------------------------------------------
// Commands: attention and compliance

async function cmdAttention(db, flags) {
  const rows = await db.query('select * from v_attention order by rank, days desc nulls last');
  out(flags, rows, () => {
    console.log(heading(`Needs a decision (${rows.length})`));
    console.log(table(rows, [
      { key: 'reason', label: 'why' },
      { key: 'label', label: 'record' },
      { key: 'client', label: 'client' },
      { key: 'place', label: 'where' },
      { key: 'days', label: 'days', align: 'right' },
      { key: 'detail', label: 'detail', width: 96 },
    ]));
  });
}

async function cmdCompliance(db, flags, onlyKey) {
  const rules = [];
  const add = (key, rule, source, breaches) => rules.push({ key, rule, source, breaches });

  add('screening', 'Every active worker holding shifts has a current NDIS Worker Screening clearance',
    'NDIS (Practice Standards - Worker Screening) Rules 2018',
    (await db.query(`
      select distinct w.name || ': screening ' || case when w.screening_expires_on is null then 'not on record'
             else 'expired ' || to_char(w.screening_expires_on, 'YYYY-MM-DD') end || ', ' ||
             (select count(*) from shifts sh where sh.worker_id = w.worker_id and sh.status = 'scheduled' and sh.shift_on >= current_date) || ' upcoming shift(s)' as breach
        from v_workers w
       where w.status = 'active' and w.screening in ('EXPIRED', 'NONE')
         and exists (select 1 from shifts sh where sh.worker_id = w.worker_id and sh.status = 'scheduled' and sh.shift_on >= current_date)
    `)).map((r) => r.breach));

  add('notes', 'Every completed shift has a progress note: the record that the support was delivered',
    'NDIS Practice Standards (provider governance: records of supports); NDIS (Provider Registration and Practice Standards) Rules 2018',
    (await db.query(`select ref || ' ' || client || ' ' || to_char(shift_on, 'YYYY-MM-DD') || ' (' || worker || ')' as breach from v_shifts where state = 'NO NOTE' order by shift_on`)).map((r) => r.breach));

  add('incidents', 'Every reportable incident has its NDIS Commission notification recorded inside the deadline',
    'NDIS (Incident Management and Reportable Incidents) Rules 2018 (24 hours for the serious kinds, 5 business days otherwise)',
    (await db.query(`select ref || ': ' || severity || ' ' || category || ' on ' || to_char(occurred_on, 'YYYY-MM-DD') || ', no notification recorded' as breach from v_incidents where reportable and notified_on is null`)).map((r) => r.breach));

  add('price-limits', 'No agreement rate above the support item price limit, so no claim can be either',
    'NDIS Pricing Arrangements and Price Limits (update the caps in `items` when the guide changes)',
    (await db.query(`select a.ref || ': ' || to_char(a.rate_cents / 100.0, 'FM990.00') || '/h against a ' || to_char(si.price_cap_cents / 100.0, 'FM990.00') || '/h limit for ' || si.item_number as breach
        from agreements a join support_items si on si.id = a.support_item_id where a.rate_cents > si.price_cap_cents`)).map((r) => r.breach));

  add('agreements', 'Every scheduled shift sits inside a signed, in-date service agreement',
    'NDIS Practice Standards (service agreements); your own terms of business',
    (await db.query(`
      select sh.ref || ' ' || c.name || ' ' || to_char(sh.shift_on, 'YYYY-MM-DD') || ': ' ||
             case when a.signed_on is null then a.ref || ' unsigned' else 'outside ' || a.ref || ' (' || to_char(a.starts_on, 'YYYY-MM-DD') || ' to ' || to_char(a.ends_on, 'YYYY-MM-DD') || ')' end as breach
        from shifts sh join agreements a on a.id = sh.agreement_id join clients c on c.id = sh.client_id
       where sh.status = 'scheduled' and sh.shift_on >= current_date
         and (a.signed_on is null or sh.shift_on < a.starts_on or sh.shift_on > a.ends_on)
    `)).map((r) => r.breach));

  add('cancellations', 'Every cancellation records its notice period, and claimability follows the short-notice rule',
    'NDIS Pricing Arrangements and Price Limits (short-notice cancellations: less than 7 clear days)',
    (await db.query(`
      select ref || ': ' || case when cancel_notice_days is null then 'no notice period recorded'
             else 'claimable=' || claimable || ' with ' || cancel_notice_days || ' days notice' end as breach
        from shifts where status = 'cancelled' and (cancel_notice_days is null or claimable <> (cancel_notice_days < 7))
    `)).map((r) => r.breach));

  add('first-aid', 'Every active support worker holds current first aid',
    'Your own policy (and most service agreements and audits expect it)',
    (await db.query(`select name || ': first aid ' || case when first_aid_expires_on is null then 'not on record' else 'expired ' || to_char(first_aid_expires_on, 'YYYY-MM-DD') end as breach
        from v_workers where status = 'active' and role = 'support_worker' and first_aid in ('EXPIRED', 'NONE')`)).map((r) => r.breach));

  add('utilisation', 'Every budget is delivered at roughly the pace it was planned at',
    'Your own standard: under-delivery is plan review risk, over-delivery is unfunded work',
    (await db.query(`select ref || ' ' || client || ': ' || coalesce(used_pct, 0) || '% used, ' || elapsed_pct || '% of the period gone (' || state || ')' as breach
        from v_agreements where state in ('under pace', 'OVER BUDGET')`)).map((r) => r.breach));

  add('retention', 'Records are never deleted: exited clients keep their full history',
    'NDIS (Provider Registration and Practice Standards) Rules 2018 (records kept for 7 years)',
    []);

  const report = onlyKey ? rules.filter((r) => r.key === onlyKey) : rules;
  if (onlyKey && !report.length) throw new CliError(`No compliance rule "${onlyKey}". Rules: ${rules.map((r) => r.key).join(', ')}`);
  out(flags, report, () => {
    console.log(heading('Compliance, checked against the records'));
    for (const r of report) {
      console.log(`\n  [${r.breaches.length ? 'BREACH' : '  ok  '}] ${r.key}: ${r.rule}`);
      console.log(`           ${r.source}`);
      for (const b of r.breaches) console.log(`           - ${b}`);
    }
    console.log('\n  Nothing here is legal advice: docs/compliance.md is the rule book, edit it to match your registration.');
  });
}

// ---------------------------------------------------------------------------
// Commands: import and export

async function importShiftcare(db, flags) {
  const readCsv = (flagName, label, required = false) => {
    const p = str(flags[flagName]);
    if (!p) {
      if (required) throw new CliError(`No ${label} file: --${flagName}=path.csv`);
      return null;
    }
    if (!existsSync(p)) throw new CliError(`No ${label} file at ${p}`);
    return parseCsv(readFileSync(p, 'utf8'));
  };
  const clientsCsv = readCsv('clients', 'clients');
  const workersCsv = readCsv('workers', 'workers');
  const shiftsCsv = readCsv('shifts', 'shifts');
  const notesCsv = readCsv('notes', 'notes');
  if (!clientsCsv && !workersCsv && !shiftsCsv && !notesCsv) {
    throw new CliError('import shiftcare needs at least one of --clients= --workers= --shifts= --notes= (CSV exports; see docs/replace-shiftcare.md).');
  }
  const dry = Boolean(flags['dry-run']);
  const counts = { clients: 0, clients_updated: 0, workers: 0, workers_updated: 0, shifts: 0, shifts_updated: 0, notes: 0, skips: [] };

  const fullName = (row) => pick(row, 'Name', 'Client Name', 'Full Name', 'Staff Name') ||
    [pick(row, 'First Name', 'FirstName'), pick(row, 'Last Name', 'LastName')].filter(Boolean).join(' ').trim();

  const FUNDING = { ndis: 'plan_managed', 'ndia managed': 'ndia_managed', 'agency managed': 'ndia_managed', 'plan managed': 'plan_managed', 'self managed': 'self_managed', private: 'private' };

  if (clientsCsv) {
    for (const row of clientsCsv) {
      const name = fullName(row);
      if (!name) { counts.skips.push('client row with no name'); continue; }
      const extRef = 'shiftcare:client:' + (pick(row, 'Id', 'ID', 'Client Id') || name.toLowerCase());
      const existing = await db.query('select id from clients where external_ref = $1 or lower(name) = lower($2)', [extRef, name]);
      const fundingRaw = pick(row, 'Funding', 'Funding Type', 'Payer').toLowerCase();
      const values = [
        name, pick(row, 'NDIS Number', 'NDIS No', 'NDIS#') || null,
        pick(row, 'Date of Birth', 'DOB', 'Birth Date') ? parseDate(pick(row, 'Date of Birth', 'DOB', 'Birth Date')) : null,
        pick(row, 'Address', 'Street Address') || null, pick(row, 'Suburb', 'City') || null,
        pick(row, 'Phone', 'Mobile', 'Phone Number') || null, pick(row, 'Email', 'Email Address') || null,
        FUNDING[fundingRaw] || 'plan_managed', extRef,
      ];
      if (existing.length) {
        counts.clients_updated++;
        if (!dry) await db.query(
          `update clients set ndis_number = coalesce($2, ndis_number), dob = coalesce($3, dob), address = coalesce($4, address),
                  suburb = coalesce($5, suburb), phone = coalesce($6, phone), email = coalesce($7, email), external_ref = $8
            where id = $1`,
          [existing[0].id, values[1], values[2], values[3], values[4], values[5], values[6], values[8]],
        );
      } else {
        counts.clients++;
        if (!dry) await db.query(
          `insert into clients (name, ndis_number, dob, address, suburb, phone, email, funding, external_ref) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          values,
        );
      }
    }
  }

  if (workersCsv) {
    for (const row of workersCsv) {
      const name = fullName(row);
      if (!name) { counts.skips.push('worker row with no name'); continue; }
      const extRef = 'shiftcare:worker:' + (pick(row, 'Id', 'ID', 'Staff Id') || name.toLowerCase());
      const existing = await db.query('select id from workers where external_ref = $1 or lower(name) = lower($2)', [extRef, name]);
      const values = [
        name, pick(row, 'Phone', 'Mobile') || null, pick(row, 'Email', 'Email Address') || null,
        pick(row, 'Screening Expiry', 'NDIS Check Expiry', 'NDISWC Expiry') ? parseDate(pick(row, 'Screening Expiry', 'NDIS Check Expiry', 'NDISWC Expiry')) : null,
        extRef,
      ];
      if (existing.length) {
        counts.workers_updated++;
        if (!dry) await db.query(
          `update workers set phone = coalesce($2, phone), email = coalesce($3, email),
                  screening_expires_on = coalesce($4, screening_expires_on), external_ref = $5 where id = $1`,
          [existing[0].id, ...values.slice(1)],
        );
      } else {
        counts.workers++;
        if (!dry) await db.query(
          `insert into workers (name, phone, email, screening_expires_on, external_ref) values ($1,$2,$3,$4,$5)`, values);
      }
    }
  }

  if (shiftsCsv) {
    for (const row of shiftsCsv) {
      const clientName = pick(row, 'Client', 'Client Name', 'Participant');
      const workerName = pick(row, 'Staff', 'Carer', 'Employee', 'Worker', 'Staff Name');
      const on = pick(row, 'Date', 'Shift Date', 'Start Date');
      if (!clientName || !on) { counts.skips.push(`shift row missing client or date (${clientName || '?'} ${on || '?'})`); continue; }
      const client = (await db.query('select * from clients where lower(name) = lower($1)', [clientName]))[0];
      if (!client) { counts.skips.push(`shift for unknown client "${clientName}"`); continue; }
      const worker = (await db.query('select * from workers where lower(name) = lower($1)', [workerName]))[0];
      if (!worker) { counts.skips.push(`shift for unknown worker "${workerName || '(blank)'}" (${clientName} ${on})`); continue; }
      const onIso = parseDate(on);
      const agreement = await activeAgreementFor(db, client.id, onIso, null).catch(() => null);
      if (!agreement) { counts.skips.push(`no agreement covers ${clientName} on ${onIso}: add the agreement, then re-import`); continue; }
      let start;
      let end;
      try {
        start = parseTime(pick(row, 'Start Time', 'Start', 'From') || '09:00');
        end = parseTime(pick(row, 'End Time', 'End', 'To') || '10:00');
      } catch {
        counts.skips.push(`unreadable times for ${clientName} ${onIso}`);
        continue;
      }
      const minutes = minutesBetween(start, end);
      const statusRaw = pick(row, 'Status', 'Shift Status').toLowerCase();
      const status = /complete|approved|finished/.test(statusRaw) ? 'completed' : /cancel/.test(statusRaw) ? 'cancelled' : onIso < today() ? 'completed' : 'scheduled';
      const extRef = 'shiftcare:shift:' + (pick(row, 'Id', 'ID', 'Shift Id') || `${clientName.toLowerCase()}:${onIso}:${start}`);
      const existing = await db.query('select id from shifts where external_ref = $1', [extRef]);
      if (existing.length) {
        counts.shifts_updated++;
        if (!dry) await db.query('update shifts set status = $2, completed_minutes = $3 where id = $1',
          [existing[0].id, status, status === 'completed' ? minutes : null]);
      } else {
        counts.shifts++;
        if (!dry) {
          const ref = await nextRef(db, 'shifts', 'SH', 1001);
          await db.query(
            `insert into shifts (ref, client_id, worker_id, agreement_id, shift_on, starts_at, ends_at, scheduled_minutes, status, completed_minutes, external_ref)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [ref, client.id, worker.id, agreement.id, onIso, start, end, minutes, status, status === 'completed' ? minutes : null, extRef],
          );
        }
      }
    }
  }

  if (notesCsv) {
    for (const row of notesCsv) {
      const clientName = pick(row, 'Client', 'Client Name', 'Participant');
      const text = pick(row, 'Note', 'Notes', 'Progress Note', 'Comment');
      if (!clientName || !text) { counts.skips.push('note row missing client or text'); continue; }
      const client = (await db.query('select * from clients where lower(name) = lower($1)', [clientName]))[0];
      if (!client) { counts.skips.push(`note for unknown client "${clientName}"`); continue; }
      counts.notes++;
      if (!dry) {
        const on = pick(row, 'Date', 'Created') ? parseDate(pick(row, 'Date', 'Created')) : today();
        const author = pick(row, 'Author', 'Staff', 'Created By');
        const worker = author ? (await db.query('select * from workers where lower(name) = lower($1)', [author]))[0] : null;
        await db.query('insert into progress_notes (client_id, worker_id, noted_on, note) values ($1,$2,$3,$4)',
          [client.id, worker ? worker.id : null, on, text]);
      }
    }
  }

  out(flags, counts, () => {
    console.log(heading(dry ? 'Import (dry run: nothing written)' : 'Imported from ShiftCare'));
    console.log(`  clients: ${counts.clients} new, ${counts.clients_updated} updated`);
    console.log(`  workers: ${counts.workers} new, ${counts.workers_updated} updated`);
    console.log(`  shifts:  ${counts.shifts} new, ${counts.shifts_updated} updated`);
    console.log(`  notes:   ${counts.notes}`);
    if (counts.skips.length) {
      console.log(`\n  Skipped, by name (the import is the first audit):`);
      for (const s of counts.skips.slice(0, 30)) console.log(`  - ${s}`);
      if (counts.skips.length > 30) console.log(`  ... and ${counts.skips.length - 30} more`);
    }
    console.log('\n  Historical shifts import as-is (no roster gates on the past). New rostering goes through the gates.');
  });
}

async function cmdExport(db, flags) {
  const tables = ['clients', 'support_items', 'workers', 'agreements', 'shifts', 'progress_notes', 'incidents', 'claims'];
  const dump = {};
  for (const t of tables) dump[t] = await db.query(`select * from ${t} order by created_at`);
  const dir = path.join(REPO_ROOT, 'exports');
  mkdirSync(dir, { recursive: true });
  const file = str(flags.out) || path.join(dir, 'home-care-export.json');
  writeFileSync(file, JSON.stringify(dump, (k, v) => (v instanceof Date ? isoDate(v) : v), 2));
  const counts = Object.fromEntries(tables.map((t) => [t, dump[t].length]));
  out(flags, { file: path.relative(REPO_ROOT, file), counts }, () => {
    console.log(`  ${path.relative(REPO_ROOT, file)}: ${tables.map((t) => `${t}=${counts[t]}`).join(' ')}`);
  });
}

// ---------------------------------------------------------------------------
// Help

function help() {
  console.log(`
home-care-for-claude-code: the CLI. Human tables by default, --json for machines.

  the business
    stats                                    the provider at a glance
    clients [--all]                          the participants, delivery pulse per client
    client <name>                            one client's whole card
    workers [--all]                          the team, clearance state loud
    worker <name>                            one worker's card and roster
    roster [--day=|--past|--all] [--client= --worker=]   the week ahead plus anything unresolved
    agreements [--all]  (alias: budgets)     the money and the pace per agreement
    items                                    support items and their price limits

  records
    add client "Name" [--ndis= --dob= --funding= --plan-manager= --plan-ends= ...]
    add worker "Name" [--screening= --screening-number= --first-aid= --role= ...]
    screening "Name" --expires= [--number=]  record a clearance renewal
    firstaid "Name" --expires=
    item add <item_number> --name= --cap=    a price guide line (cap in dollars)
    agreement add "Client" --item= --rate= --hours= --budget= --starts= --ends= --signed=
    agreement sign SA-xx [--on=]

  the roster (the gates live here; none have force flags)
    shift add "Client" --worker= --on= --start= --end= [--agreement=]
    shift done SH-xxxx --note="..." [--minutes=]
    shift cancel SH-xxxx --reason="..." --notice=<days>
    note add "Client" "text" [--worker= --shift= --on=]
    notes "Client" [--limit=]

  incidents
    incident add "Client" "what happened" --category= --severity= [--worker= --reportable --on=]
    incident notify INC-xx [--on=]           record the Commission notification
    incident close INC-xx                    refuses if reportable and unnotified
    incidents [--all]

  money
    unclaimed                                delivered work with no payment request
    claim build [--client=] [--dry-run]      mint the next PR batch from unclaimed work
    claims [--batch= --status=]
    claim export [--batch=]                  the bulk payment request CSV, to exports/
    claim paid <PR-xxx|CLM-xxxx> [--on=]
    claim reject CLM-xxxx --reason="..."
    claim resubmit CLM-xxxx [--batch=]

  the checks
    attention                                everything that wants a decision, worst first
    compliance [rule]                        the rule book run against the records

  in and out
    import shiftcare --clients= --workers= --shifts= [--notes=] [--dry-run]
    export [--out=]                          the whole database as JSON

Any read command takes --json. Money in dollars on the way in, formatted on the way out.
`);
}

// ---------------------------------------------------------------------------
// Main

const { args, flags } = parseArgv(process.argv.slice(2));
const [cmd, sub, ...rest] = args;

const db = await getDb();
try {
  switch (cmd) {
    case undefined:
    case 'help': help(); break;
    case 'stats': await cmdStats(db, flags); break;
    case 'clients': await cmdClients(db, flags); break;
    case 'client': await cmdClient(db, flags, args.slice(1).join(' ')); break;
    case 'workers': case 'team': await cmdWorkers(db, flags); break;
    case 'worker': await cmdWorker(db, flags, args.slice(1).join(' ')); break;
    case 'roster': await cmdRoster(db, flags); break;
    case 'agreements': case 'budgets': await cmdAgreements(db, flags); break;
    case 'items': await cmdItems(db, flags); break;
    case 'add': await cmdAdd(db, flags, sub, rest.join(' ')); break;
    case 'screening': await cmdScreening(db, flags, args.slice(1).join(' ')); break;
    case 'firstaid': await cmdFirstAid(db, flags, args.slice(1).join(' ')); break;
    case 'item':
      if (sub !== 'add') throw new CliError('item add is the only item verb.');
      await cmdItemAdd(db, flags, rest.join(' '));
      break;
    case 'agreement':
      if (sub === 'add') await cmdAgreementAdd(db, flags, rest.join(' '));
      else if (sub === 'sign') await cmdAgreementSign(db, flags, rest.join(' '));
      else throw new CliError('agreement add or agreement sign.');
      break;
    case 'shift':
      if (sub === 'add') await cmdShiftAdd(db, flags, rest.join(' '));
      else if (sub === 'done') await cmdShiftDone(db, flags, rest.join(' '));
      else if (sub === 'cancel') await cmdShiftCancel(db, flags, rest.join(' '));
      else throw new CliError('shift add, shift done or shift cancel.');
      break;
    case 'note':
      if (sub !== 'add') throw new CliError('note add is the only note verb (reading is `notes`).');
      await cmdNoteAdd(db, flags, rest[0], rest.slice(1).join(' '));
      break;
    case 'notes': await cmdNotes(db, flags, args.slice(1).join(' ')); break;
    case 'incident':
      if (sub === 'add') await cmdIncidentAdd(db, flags, rest[0], rest.slice(1).join(' '));
      else if (sub === 'notify') await cmdIncidentNotify(db, flags, rest.join(' '));
      else if (sub === 'close') await cmdIncidentClose(db, flags, rest.join(' '));
      else throw new CliError('incident add, incident notify or incident close.');
      break;
    case 'incidents': await cmdIncidents(db, flags); break;
    case 'unclaimed': await cmdUnclaimed(db, flags); break;
    case 'claim':
      if (sub === 'build') await cmdClaimBuild(db, flags);
      else if (sub === 'paid') await cmdClaimPaid(db, flags, rest.join(' '));
      else if (sub === 'reject') await cmdClaimReject(db, flags, rest.join(' '));
      else if (sub === 'resubmit') await cmdClaimResubmit(db, flags, rest.join(' '));
      else if (sub === 'export') await cmdClaimExport(db, flags);
      else throw new CliError('claim build, claims, claim export, claim paid, claim reject or claim resubmit.');
      break;
    case 'claims': await cmdClaims(db, flags); break;
    case 'attention': await cmdAttention(db, flags); break;
    case 'compliance': await cmdCompliance(db, flags, sub); break;
    case 'import':
      if (sub !== 'shiftcare') throw new CliError('import shiftcare is the import path (plain CSV works through it too; see docs/replace-shiftcare.md).');
      await importShiftcare(db, flags);
      break;
    case 'export': await cmdExport(db, flags); break;
    default:
      throw new CliError(`Unknown command "${cmd}". Run \`help\` for the list.`);
  }
} catch (e) {
  if (e instanceof CliError) {
    console.error(e.message);
    process.exitCode = e.code;
  } else {
    throw e;
  }
} finally {
  await db.close();
}
