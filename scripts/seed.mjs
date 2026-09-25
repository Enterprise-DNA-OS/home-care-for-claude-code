#!/usr/bin/env node
// Loads supabase/seed.sql: Fernbank Community Care, a fictional Geelong NDIS
// provider with seven clients, seven workers, five price guide items, seven
// service agreements, a month of shifts with progress notes, an incident
// register and two claim runs. Every row has a derived id and inserts with
// ON CONFLICT DO NOTHING, so re-running it is harmless.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';

export async function seed(db) {
  const sql = readFileSync(path.join(REPO_ROOT, 'supabase', 'seed.sql'), 'utf8');
  await db.exec(sql);
  const [c] = await db.query(`
    select (select count(*) from clients)        as clients,
           (select count(*) from support_items)  as support_items,
           (select count(*) from workers)        as workers,
           (select count(*) from agreements)     as agreements,
           (select count(*) from shifts)         as shifts,
           (select count(*) from progress_notes) as progress_notes,
           (select count(*) from incidents)      as incidents,
           (select count(*) from claims)         as claims
  `);
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const db = await getDb();
  try {
    const counts = await seed(db);
    console.log('seeded:', Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '));
  } finally {
    await db.close();
  }
}
