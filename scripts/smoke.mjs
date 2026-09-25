#!/usr/bin/env node
// End-to-end smoke test on a throwaway embedded database.
// Runs migrate, seed, then every CLI command that matters, and asserts on the JSON.
// Passes on Windows and Linux. No network, no Postgres install.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'care-smoke-'));
const env = { ...process.env, DATA_DIR: dataDir };
delete env.DATABASE_URL; // the smoke test always runs embedded

let step = 0;
function run(label, args, { json = true, expectFail = false } = {}) {
  step++;
  const argv = [path.join(root, 'scripts', args[0]), ...args.slice(1), ...(json ? ['--json'] : [])];
  const res = spawnSync(process.execPath, argv, { cwd: root, env, encoding: 'utf8' });
  const ok = expectFail ? res.status !== 0 : res.status === 0;
  if (!ok) {
    console.error(`\nFAIL step ${step} (${label}): exit ${res.status}\n--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`);
    process.exit(1);
  }
  console.log(`  ok  ${String(step).padStart(2)}  ${label}`);
  if (!json || expectFail) return { stdout: res.stdout, stderr: res.stderr };
  try {
    return JSON.parse(res.stdout);
  } catch {
    console.error(`\nFAIL step ${step} (${label}): output is not JSON\n${res.stdout}\n${res.stderr}`);
    process.exit(1);
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`\nFAIL assertion: ${msg}`);
    process.exit(1);
  }
}

const n = (v) => Number(v ?? 0);

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// Local date, the same way the CLI computes "today". Never UTC.
const todayIso = (() => {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();

console.log(`smoke: data dir ${dataDir}`);
try {
  run('migrate', ['migrate.mjs'], { json: false });
  run('migrate again (idempotent)', ['migrate.mjs'], { json: false });
  run('seed', ['seed.mjs'], { json: false });
  run('seed again (idempotent)', ['seed.mjs'], { json: false });

  // ---- the business ---------------------------------------------------------

  const stats = run('stats', ['care.mjs', 'stats']);
  assert(stats.active_clients === 6, `six active clients (${stats.active_clients})`);
  assert(stats.active_workers === 6, `six active workers (${stats.active_workers})`);
  assert(stats.agreements === 7, `seven live agreements (${stats.agreements})`);
  assert(n(stats.unclaimed_cents) > 200000, `unclaimed money is visible (${stats.unclaimed_cents})`);

  const clients = run('clients', ['care.mjs', 'clients']);
  assert(clients.length === 6, `active clients list (${clients.length})`);
  const harrietRow = clients.find((c) => c.name === 'Harriet Lowe');
  assert(harrietRow && harrietRow.next_shift_on === null, 'Harriet has no upcoming shift (the uncovered client)');

  const allClients = run('clients --all includes the exited', ['care.mjs', 'clients', '--all']);
  assert(allClients.length === 7, `all clients (${allClients.length})`);

  const ruby = run('client card by partial name', ['care.mjs', 'client', 'ruby']);
  assert(ruby.client.name === 'Ruby Calder', 'resolved by partial name');
  assert(ruby.agreements.length === 2, 'Ruby holds two agreements');
  assert(ruby.incidents.length === 1 && ruby.incidents[0].state === 'NOTIFY OVERDUE', 'her incident is loud on the card');

  const byNdis = run('client card by NDIS number', ['care.mjs', 'client', '430331426']);
  assert(byNdis.client.name === 'Ruby Calder', 'NDIS number resolves');

  const noSuch = run('an unknown client exits 1', ['care.mjs', 'client', 'nobody at all'], { json: false, expectFail: true });
  assert(/No client matches/.test(noSuch.stderr), 'and says so plainly');

  const workers = run('workers', ['care.mjs', 'workers']);
  assert(workers.length === 6, `six active workers (${workers.length})`);
  const dana = workers.find((w) => w.name === 'Dana Kovac');
  assert(dana.screening === 'EXPIRED' && n(dana.shifts_next_7d) === 3, 'Dana: expired screening, three shifts next week');
  assert(workers.find((w) => w.name === "Liam O'Shea").screening === 'expiring', 'Liam is expiring');
  assert(workers.find((w) => w.name === 'Grace Mburu').first_aid === 'EXPIRED', 'Grace first aid expired');

  const roster = run('roster (week ahead + unresolved)', ['care.mjs', 'roster']);
  assert(roster.some((r) => r.state === 'UNCONFIRMED'), 'unconfirmed past shifts surface in the default roster');
  assert(roster.some((r) => r.state === 'NO NOTE'), 'so do completed shifts with no note');
  assert(roster.filter((r) => r.worker === 'Dana Kovac' && r.state === 'scheduled').length >= 2, 'Dana holds upcoming shifts');

  const rosterByClient = run('roster filtered by client', ['care.mjs', 'roster', '--client=okafor', '--all']);
  assert(rosterByClient.length > 0 && rosterByClient.every((r) => r.client === 'Vincent Okafor'), 'client filter works');

  const agreements = run('agreements', ['care.mjs', 'agreements']);
  assert(agreements.length === 7, `seven agreements (${agreements.length})`);
  assert(agreements.find((a) => a.ref === 'SA-15').state === 'expiring', 'SA-15 is expiring');
  assert(agreements.find((a) => a.ref === 'SA-16').state === 'under pace', 'SA-16 is under pace');
  assert(agreements.filter((a) => a.state === 'ok').length === 5, 'the other five are healthy');

  const items = run('items', ['care.mjs', 'items']);
  assert(items.length === 5, `five support items (${items.length})`);

  // ---- attention and compliance ---------------------------------------------

  const attention = run('attention', ['care.mjs', 'attention']);
  assert(attention.length >= 15, `the attention list is loud (${attention.length})`);
  assert(attention[0].reason === 'incident_unreported', 'the unreported incident outranks everything');
  for (const reason of ['incident_unreported', 'screening_expired', 'shift_unconfirmed', 'note_missing', 'money_sitting',
    'claim_rejected', 'agreement_expiring', 'under_pace', 'client_uncovered', 'first_aid_expired', 'screening_expiring', 'plan_ending']) {
    assert(attention.some((a) => a.reason === reason), `attention carries ${reason}`);
  }
  assert(attention.some((a) => a.reason === 'screening_expired' && a.label === 'Dana Kovac'), 'the screening breach names Dana');

  const compliance = run('compliance', ['care.mjs', 'compliance']);
  assert(compliance.length === 9, `nine rules in the book (${compliance.length})`);
  const failed = compliance.filter((r) => r.breaches.length).map((r) => r.key).sort();
  assert(failed.join(',') === 'first-aid,incidents,notes,screening,utilisation',
    `the seeded breaches are exactly the story (${failed.join(',')})`);
  const oneRule = run('one compliance rule', ['care.mjs', 'compliance', 'notes']);
  assert(oneRule.length === 1 && oneRule[0].breaches.length === 3, 'three unnoted shifts');

  // ---- the roster gates ------------------------------------------------------

  const gateScreening = run('rostering Dana is refused', ['care.mjs', 'shift', 'add', 'Ruby', '--worker=Dana', `--on=${addDays(todayIso, 4)}`, '--start=16:00', '--end=20:00'], { json: false, expectFail: true });
  assert(/Worker Screening/.test(gateScreening.stderr) && /No force flag/.test(gateScreening.stderr), 'and cites the Rules');

  const gateAgreement = run('rostering without an agreement is refused', ['care.mjs', 'shift', 'add', 'Ruby', '--worker=Sofia', `--on=${addDays(todayIso, 120)}`, '--start=09:00', '--end=12:00'], { json: false, expectFail: true });
  assert(/no active service agreement covering/.test(gateAgreement.stderr), 'no agreement, no roster');

  const added = run('roster a valid shift', ['care.mjs', 'shift', 'add', 'Ruby', '--worker=Sofia', `--on=${addDays(todayIso, 4)}`, '--start=16:00', '--end=20:00', '--agreement=SA-13']);
  assert(/^SH-\d+$/.test(added.ref), `the ref is minted (${added.ref})`);
  assert(n(added.scheduled_minutes) === 240, 'four hours scheduled');

  const clash = run('double-booking Sofia is refused', ['care.mjs', 'shift', 'add', 'Elsie', '--worker=Sofia', `--on=${addDays(todayIso, 4)}`, '--start=17:00', '--end=19:00'], { json: false, expectFail: true });
  assert(/already rostered/.test(clash.stderr), 'workers are not in two places at once');

  const noNote = run('completing without a note is refused', ['care.mjs', 'shift', 'done', added.ref], { json: false, expectFail: true });
  assert(/progress note/.test(noNote.stderr) && /No force flag/.test(noNote.stderr), 'the note is not optional');

  const done = run('complete it with the note', ['care.mjs', 'shift', 'done', added.ref, '--note=Evening routine support, all well.', '--minutes=250']);
  assert(done.status === 'completed' && n(done.completed_minutes) === 250, 'completed with actual minutes');

  const noCancelReason = run('cancelling without a reason is refused', ['care.mjs', 'shift', 'cancel', 'SH-1026'], { json: false, expectFail: true });
  assert(/reason/.test(noCancelReason.stderr), 'the reason is written down');
  const cancelNoNotice = run('cancelling without notice days is refused', ['care.mjs', 'shift', 'cancel', 'SH-1026', '--reason=Client away'], { json: false, expectFail: true });
  assert(/notice/.test(cancelNoNotice.stderr), 'notice days decide claimability');
  const cancelled = run('cancel a shift at short notice', ['care.mjs', 'shift', 'cancel', 'SH-1026', '--reason=Client away, told us this morning', '--notice=1']);
  assert(cancelled.claimable === true, 'one day of notice is claimable');
  const cancelled2 = run('cancel a shift with plenty of notice', ['care.mjs', 'shift', 'cancel', 'SH-1032', '--reason=Family holiday booked', '--notice=14']);
  assert(cancelled2.claimable === false, 'fourteen days of notice is not');

  // ---- agreements and price limits -------------------------------------------

  const overCap = run('an over-cap rate is refused', ['care.mjs', 'agreement', 'add', 'Harriet', '--item=01_011_0107_1_1', '--rate=75', `--starts=${todayIso}`, `--ends=${addDays(todayIso, 180)}`, `--signed=${todayIso}`], { json: false, expectFail: true });
  assert(/price limit/.test(overCap.stderr) && /No force flag/.test(overCap.stderr), 'the Pricing Arrangements hold');

  const newAgreement = run('add an agreement under the cap', ['care.mjs', 'agreement', 'add', 'Harriet', '--item=01_020_0120_1_1', '--rate=58.30', '--hours=2', '--budget=3000', `--starts=${todayIso}`, `--ends=${addDays(todayIso, 180)}`]);
  assert(/^SA-\d+$/.test(newAgreement.ref), `agreement minted (${newAgreement.ref})`);
  assert(newAgreement.signed_on === null, 'unsigned so far');

  const unsignedGate = run('an unsigned agreement does not roster', ['care.mjs', 'shift', 'add', 'Harriet', '--worker=Sofia', `--on=${addDays(todayIso, 2)}`, '--start=10:00', '--end=12:00', `--agreement=${newAgreement.ref}`], { json: false, expectFail: true });
  assert(/not signed/.test(unsignedGate.stderr), 'signature first');
  run('sign it', ['care.mjs', 'agreement', 'sign', newAgreement.ref, `--on=${todayIso}`]);
  run('now it rosters', ['care.mjs', 'shift', 'add', 'Harriet', '--worker=Sofia', `--on=${addDays(todayIso, 2)}`, '--start=10:00', '--end=12:00', `--agreement=${newAgreement.ref}`]);

  // ---- incidents --------------------------------------------------------------

  const inc = run('record a reportable incident', ['care.mjs', 'incident', 'add', 'Marcus', 'Unexplained bruise noticed during support; family informed.', '--category=injury', '--severity=serious', '--worker=Tom']);
  assert(inc.reportable === true, 'serious injuries are reportable by default');
  const closeGate = run('closing it unnotified is refused', ['care.mjs', 'incident', 'close', inc.ref], { json: false, expectFail: true });
  assert(/notification/.test(closeGate.stderr) && /Incident Management/.test(closeGate.stderr), 'and cites the Rules');
  run('notify the Commission', ['care.mjs', 'incident', 'notify', inc.ref]);
  const closed = run('now it closes', ['care.mjs', 'incident', 'close', inc.ref]);
  assert(closed.status === 'closed', 'closed with the notification on record');

  const incidents = run('incidents --all', ['care.mjs', 'incidents', '--all']);
  assert(incidents.length === 4, `four incidents on the register (${incidents.length})`);
  assert(incidents.some((i) => i.ref === 'INC-01' && i.state === 'NOTIFY OVERDUE'), 'INC-01 is still loud');

  // ---- notes -------------------------------------------------------------------

  run('a standalone note', ['care.mjs', 'note', 'add', 'Harriet', 'Peter confirmed Thursday afternoons from next week.', '--worker=Priya']);
  const notes = run('notes read back', ['care.mjs', 'notes', 'Harriet']);
  assert(notes.some((x) => /Thursday afternoons/.test(x.note)), 'the note landed');

  // ---- money: unclaimed -> build -> export -> paid/reject ----------------------

  const unclaimed = run('unclaimed', ['care.mjs', 'unclaimed']);
  assert(unclaimed.length >= 10, `unclaimed work is visible (${unclaimed.length})`);
  assert(unclaimed.some((u) => u.state === 'cancelled, claimable'), 'short-notice cancellations are claimable');
  assert(!unclaimed.some((u) => u.ref === 'SH-1019'), 'a shift with no note is NOT claimable');

  const dryBuild = run('claim build --dry-run', ['care.mjs', 'claim', 'build', '--dry-run']);
  assert(n(dryBuild.claims) === unclaimed.length, 'the dry run counts what it would claim');

  const built = run('claim build', ['care.mjs', 'claim', 'build']);
  assert(built.batch_ref === 'PR-003', `the next batch ref is minted (${built.batch_ref})`);
  assert(n(built.claims) === unclaimed.length && n(built.amount_cents) === unclaimed.reduce((s, u) => s + n(u.value_cents), 0), 'every unclaimed shift claimed, totals match');

  const emptyBuild = run('a second build finds nothing', ['care.mjs', 'claim', 'build']);
  assert(emptyBuild.claims === 0, 'nothing left to claim');

  const exported = run('claim export', ['care.mjs', 'claim', 'export', '--batch=PR-003', '--registration=4-3000-1234']);
  const csvFile = path.join(root, 'exports', 'PR-003.csv');
  assert(existsSync(csvFile), 'the upload file is on disk');
  const csv = readFileSync(csvFile, 'utf8').trim().split('\n');
  assert(csv[0].startsWith('RegistrationNumber,NDISNumber,'), 'with the bulk payment request header');
  assert(csv.length === n(exported.claims) + 1, 'one line per claim');
  assert(csv.some((l) => l.includes('CANC') && l.includes('NSDH')), 'cancellation claims carry the claim type');
  rmSync(csvFile);

  const paid = run('mark the batch paid', ['care.mjs', 'claim', 'paid', 'PR-003']);
  assert(n(paid.paid) === n(built.claims), 'the whole batch pays');

  const rejected = run('reject a claim with a reason', ['care.mjs', 'claim', 'reject', 'CLM-1007', '--reason=Support item not active on the service booking']);
  assert(rejected.status === 'rejected', 'rejected and recorded');
  const noReason = run('rejecting without a reason is refused', ['care.mjs', 'claim', 'reject', 'CLM-1009'], { json: false, expectFail: true });
  assert(/reason/.test(noReason.stderr), 'the reason is the fix instruction');
  const resubmitted = run('resubmit it', ['care.mjs', 'claim', 'resubmit', 'CLM-1007']);
  assert(resubmitted.status === 'claimed' && resubmitted.rejected_reason === null, 'back in flight');

  const claims = run('claims by batch', ['care.mjs', 'claims', '--batch=PR-002']);
  assert(claims.length === 5, `five claims in PR-002 (${claims.length})`);
  assert(claims.filter((c) => c.state === 'REJECTED').length === 2, 'the two seeded rejections');

  // ---- import: ShiftCare CSVs --------------------------------------------------

  const clientsCsv = path.join(dataDir, 'clients.csv');
  const workersCsv = path.join(dataDir, 'staff.csv');
  const shiftsCsv = path.join(dataDir, 'shifts.csv');
  writeFileSync(clientsCsv, [
    'Id,Name,NDIS Number,Date of Birth,Address,Suburb,Mobile,Email,Funding',
    'C-901,Nadia Ferreira,430771860,12/03/1979,5 Corio Quay Road,Norlane,0403 555 199,nadia.f@example.au,Plan Managed',
    'C-902,Harriet Lowe,430118204,,,,0403 555 101,,Plan Managed',
  ].join('\n'));
  writeFileSync(workersCsv, [
    'Id,Name,Mobile,Email,NDIS Check Expiry',
    `S-901,Ben Okri,0404 555 299,ben@fernbankcare.example.au,${addDays(todayIso, 300)}`,
  ].join('\n'));
  writeFileSync(shiftsCsv, [
    'Id,Date,Start Time,End Time,Client,Staff,Status',
    `SC-901,${addDays(todayIso, -35)},09:00,12:00,Harriet Lowe,Sofia Ricci,Completed`,
    `SC-902,${addDays(todayIso, -3)},09:00,11:00,Nadia Ferreira,Ben Okri,Completed`,
  ].join('\n'));

  const dry = run('import dry run writes nothing', ['care.mjs', 'import', 'shiftcare', `--clients=${clientsCsv}`, `--workers=${workersCsv}`, `--shifts=${shiftsCsv}`, '--dry-run']);
  assert(n(dry.clients) === 1 && n(dry.clients_updated) === 1, 'one new client, Harriet matched');
  assert(dry.skips.length === 2, `Nadia's shift and the pre-agreement shift are named skips (${dry.skips.length}: ${dry.skips.join(' | ')})`);

  const imported = run('import for real', ['care.mjs', 'import', 'shiftcare', `--clients=${clientsCsv}`, `--workers=${workersCsv}`, `--shifts=${shiftsCsv}`]);
  assert(n(imported.clients) === 1 && n(imported.workers) === 1, 'Nadia and Ben are in');
  assert(imported.skips.length === 2, 'the shifts still skip: no agreements cover them, and the report says so');

  const reimport = run('re-importing updates rather than duplicating', ['care.mjs', 'import', 'shiftcare', `--clients=${clientsCsv}`, `--workers=${workersCsv}`]);
  assert(n(reimport.clients) === 0 && n(reimport.clients_updated) === 2 && n(reimport.workers) === 0 && n(reimport.workers_updated) === 1, 'the second run creates nothing new');

  const missingFile = run('a missing import file fails loudly', ['care.mjs', 'import', 'shiftcare', `--clients=${path.join(dataDir, 'not-there.csv')}`], { json: false, expectFail: true });
  assert(/No clients file/.test(missingFile.stderr), 'rather than importing nothing quietly');

  // ---- export ------------------------------------------------------------------

  const outFile = path.join(dataDir, 'dump.json');
  const dump = run('export', ['care.mjs', 'export', `--out=${outFile}`]);
  assert(existsSync(outFile), 'the export file is on disk');
  const parsed = JSON.parse(readFileSync(outFile, 'utf8'));
  assert(parsed.shifts.length === n(dump.counts.shifts), 'the counts match the file');
  assert(parsed.progress_notes.length >= 20, 'the notes come out too');

  // ---- the branded HTML -----------------------------------------------------------

  const views = run('npm run view', ['view.mjs'], { json: false });
  assert(/views[\\/]week\.html/.test(views.stdout) && /views[\\/]money\.html/.test(views.stdout), 'both views rendered');
  const weekHtml = readFileSync(path.join(root, 'views', 'week.html'), 'utf8');
  assert(weekHtml.includes('Needs a decision') && weekHtml.includes('The week ahead'), 'the week view has its sections');

  const docsOut = run('npm run docs', ['docs.mjs'], { json: false });
  assert(/client-statement/.test(docsOut.stdout), 'client statements rendered');
  assert(/incident-report/.test(docsOut.stdout), 'incident reports rendered');
  assert(/worker-file/.test(docsOut.stdout), 'worker files rendered');

  // ---- the human readable side ------------------------------------------------------

  run('stats (text)', ['care.mjs', 'stats'], { json: false });
  run('clients (text)', ['care.mjs', 'clients'], { json: false });
  run('client (text)', ['care.mjs', 'client', 'Vincent'], { json: false });
  run('workers (text)', ['care.mjs', 'workers'], { json: false });
  run('worker (text)', ['care.mjs', 'worker', 'Dana'], { json: false });
  run('roster (text)', ['care.mjs', 'roster'], { json: false });
  run('agreements (text)', ['care.mjs', 'agreements'], { json: false });
  run('items (text)', ['care.mjs', 'items'], { json: false });
  run('incidents (text)', ['care.mjs', 'incidents', '--all'], { json: false });
  run('unclaimed (text)', ['care.mjs', 'unclaimed'], { json: false });
  run('claims (text)', ['care.mjs', 'claims'], { json: false });
  run('attention (text)', ['care.mjs', 'attention'], { json: false });
  run('compliance (text)', ['care.mjs', 'compliance'], { json: false });
  run('help', ['care.mjs', 'help'], { json: false });
  run('an unknown command exits 1', ['care.mjs', 'nonsense'], { json: false, expectFail: true });

  console.log(`\n${step} checks, PASS`);
} finally {
  if (existsSync(dataDir)) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Windows can hold the handle briefly; a leftover temp dir is harmless.
    }
  }
}
