-- Demo data for home-care-for-claude-code.
-- Fernbank Community Care, a fictional Geelong NDIS provider: seven clients,
-- seven support workers, five price guide items, seven service agreements,
-- a month of shifts, progress notes, an incident register and two claim runs.
--
-- Deliberately messy, so the attention list has something to say:
--   a serious injury incident 3 days old with NO Commission notification (24 hour rule)
--   Dana Kovac rostered three shifts next week with worker screening expired 12 days ago
--   about $1,900 of delivered support with no payment request built, oldest 16 days
--   three completed shifts with no progress note (no note, no evidence, no claim)
--   two past shifts never confirmed or cancelled
--   two rejected claims sitting unresolved in batch PR-002
--   Vincent Okafor's service agreement ends in 24 days
--   Elsie Novak's budget 23% used with 67% of the period gone (plan review risk)
--   Ruby Calder's NDIS plan ends in 21 days
--   Harriet Lowe funded but with no shift rostered in the next 7 days
--   Liam O'Shea's screening expiring in 21 days, Grace Mburu's first aid expired
--
-- Dates are relative to current_date. Ids are derived from names with
-- seed_uuid, and every insert is ON CONFLICT DO NOTHING, so running it twice
-- changes nothing.
--
-- Clients, workers, price caps and events are DEMO VALUES for a fictional
-- business. No real person or provider is depicted. Price caps are
-- illustrative: set yours from the current NDIS Pricing Arrangements and
-- Price Limits.

create or replace function seed_uuid(seed text) returns uuid language sql immutable as $$
  select (substr(m, 1, 8) || '-' || substr(m, 9, 4) || '-4' || substr(m, 13, 3)
          || '-8' || substr(m, 16, 3) || '-' || substr(m, 19, 12))::uuid
  from (select md5(seed) as m) s
$$;

-- Clients ------------------------------------------------------------------------

insert into clients (id, name, ndis_number, dob, address, suburb, phone, email, funding, plan_manager, plan_ends_on, emergency_name, emergency_phone, status) values
  (seed_uuid('client:lowe'),    'Harriet Lowe',   '430118204', '1961-04-12', '18 Clarence Street',   'Belmont',       '0403 555 101', 'harriet.lowe@example.au',   'plan_managed', 'Leap Plan Management', current_date + 150, 'Peter Lowe',    '0403 555 901', 'active'),
  (seed_uuid('client:tran'),    'Marcus Tran',    '430227315', '1994-09-03', '7 Kilgour Street',     'Geelong',       '0403 555 102', 'marcus.tran@example.au',    'self_managed', null,                   current_date + 200, 'Anh Tran',      '0403 555 902', 'active'),
  (seed_uuid('client:calder'),  'Ruby Calder',    '430331426', '1988-01-27', '92 Autumn Street',     'Herne Hill',    '0403 555 103', 'ruby.calder@example.au',    'ndia_managed', null,                   current_date + 21,  'June Calder',   '0403 555 903', 'active'),
  (seed_uuid('client:okafor'),  'Vincent Okafor', '430446537', '1972-07-19', '3 Ballarat Road',      'Bell Post Hill','0403 555 104', 'v.okafor@example.au',       'plan_managed', 'Leap Plan Management', current_date + 130, 'Ada Okafor',    '0403 555 904', 'active'),
  (seed_uuid('client:novak'),   'Elsie Novak',    '430558648', '1955-11-30', '41 The Esplanade',     'Ocean Grove',   '0403 555 105', 'elsie.novak@example.au',    'plan_managed', 'BrightPath Plans',     current_date + 170, 'Karl Novak',    '0403 555 905', 'active'),
  (seed_uuid('client:shaw'),    'Dominic Shaw',   null,        '1949-02-08', '12 Marlin Court',      'Clifton Springs','0403 555 106','d.shaw@example.au',         'private',      null,                   null,               'Fay Shaw',      '0403 555 906', 'active'),
  (seed_uuid('client:britton'), 'Noah Britton',   '430663759', '1990-05-15', '28 Pakington Street',  'Geelong West',  '0403 555 107', 'noah.britton@example.au',   'plan_managed', 'Leap Plan Management', null,               'Kim Britton',   '0403 555 907', 'exited')
on conflict do nothing;

update clients set exited_on = current_date - 60 where id = seed_uuid('client:britton') and exited_on is null;

-- Support items ---------------------------------------------------------------------------
-- DEMO price caps. Replace with the current NDIS Pricing Arrangements and
-- Price Limits for your registration groups, and keep them updated.

insert into support_items (id, item_number, name, unit, price_cap_cents, note) values
  (seed_uuid('item:selfcare-day'), '01_011_0107_1_1', 'Assistance With Self-Care Activities - Weekday Daytime', 'hour', 6756, 'Demo cap. Set from the current price guide.'),
  (seed_uuid('item:selfcare-eve'), '01_015_0107_1_1', 'Assistance With Self-Care Activities - Weekday Evening', 'hour', 7444, 'Demo cap. Set from the current price guide.'),
  (seed_uuid('item:selfcare-sat'), '01_013_0107_1_1', 'Assistance With Self-Care Activities - Saturday',        'hour', 9507, 'Demo cap. Set from the current price guide.'),
  (seed_uuid('item:community'),    '04_104_0125_6_1', 'Access Community, Social and Recreational Activities',   'hour', 6756, 'Demo cap. Set from the current price guide.'),
  (seed_uuid('item:household'),    '01_020_0120_1_1', 'Household Tasks',                                        'hour', 5830, 'Demo cap. Set from the current price guide.')
on conflict do nothing;

-- Workers ---------------------------------------------------------------------------
-- Dana Kovac's screening expired 12 days ago and she is still rostered next
-- week: that is the breach the attention list exists to shout about.

insert into workers (id, name, role, employment, phone, email, screening_number, screening_expires_on, first_aid_expires_on, status) values
  (seed_uuid('worker:raman'), 'Priya Raman', 'coordinator',    'permanent', '0404 555 201', 'priya@fernbankcare.example.au', 'WS-1187203', current_date + 400, current_date + 300, 'active'),
  (seed_uuid('worker:kovac'), 'Dana Kovac',  'support_worker', 'casual',    '0404 555 202', 'dana@fernbankcare.example.au',  'WS-1187204', current_date - 12,  current_date + 220, 'active'),
  (seed_uuid('worker:oshea'), 'Liam O''Shea','support_worker', 'part_time', '0404 555 203', 'liam@fernbankcare.example.au',  'WS-1187205', current_date + 21,  current_date + 180, 'active'),
  (seed_uuid('worker:mburu'), 'Grace Mburu', 'support_worker', 'casual',    '0404 555 204', 'grace@fernbankcare.example.au', 'WS-1187206', current_date + 250, current_date - 40,  'active'),
  (seed_uuid('worker:feld'),  'Tom Feld',    'support_worker', 'casual',    '0404 555 205', 'tom@fernbankcare.example.au',   'WS-1187207', current_date + 320, current_date + 140, 'active'),
  (seed_uuid('worker:ricci'), 'Sofia Ricci', 'support_worker', 'permanent', '0404 555 206', 'sofia@fernbankcare.example.au', 'WS-1187208', current_date + 500, current_date + 260, 'active'),
  (seed_uuid('worker:dean'),  'Jack Dean',   'support_worker', 'casual',    '0404 555 207', 'jack.dean@example.au',          'WS-1187209', current_date + 100, current_date + 100, 'former')
on conflict do nothing;

-- Service agreements ---------------------------------------------------------------------------
-- SA-15 ends in 24 days with shifts still landing. SA-16 is the under-pace
-- budget: 67% of the period gone, about a quarter of the money used.

insert into agreements (id, ref, client_id, support_item_id, rate_cents, hours_per_week, budget_cents, starts_on, ends_on, signed_on, status) values
  (seed_uuid('sa:11'), 'SA-11', seed_uuid('client:lowe'),   seed_uuid('item:selfcare-day'), 6756, 4, 480000, current_date - 30,  current_date + 95,  current_date - 35,  'active'),
  (seed_uuid('sa:12'), 'SA-12', seed_uuid('client:tran'),   seed_uuid('item:community'),    6500, 3, 390000, current_date - 30,  current_date + 110, current_date - 34,  'active'),
  (seed_uuid('sa:13'), 'SA-13', seed_uuid('client:calder'), seed_uuid('item:selfcare-eve'), 7444, 8, 700000, current_date - 30,  current_date + 80,  current_date - 34,  'active'),
  (seed_uuid('sa:14'), 'SA-14', seed_uuid('client:calder'), seed_uuid('item:selfcare-sat'), 9507, 4, 360000, current_date - 30,  current_date + 80,  current_date - 34,  'active'),
  (seed_uuid('sa:15'), 'SA-15', seed_uuid('client:okafor'), seed_uuid('item:selfcare-day'), 6700, 4, 180000, current_date - 40,  current_date + 24,  current_date - 45,  'active'),
  (seed_uuid('sa:16'), 'SA-16', seed_uuid('client:novak'),  seed_uuid('item:household'),    5830, 3, 600000, current_date - 120, current_date + 60,  current_date - 122, 'active'),
  (seed_uuid('sa:17'), 'SA-17', seed_uuid('client:shaw'),   seed_uuid('item:household'),    5500, 3, 420000, current_date - 30,  current_date + 150, current_date - 30,  'active')
on conflict do nothing;

-- Shifts ---------------------------------------------------------------------------
-- A month of roster. The past is mostly completed and noted; the gaps are
-- the story. Dana Kovac holds SH-1026, SH-1028 and SH-1032 next week with an
-- expired clearance (rostered before it lapsed; nobody looked since).

insert into shifts (id, ref, client_id, worker_id, agreement_id, shift_on, starts_at, ends_at, scheduled_minutes, status, completed_minutes) values
  -- claimed in PR-001, paid
  (seed_uuid('sh:1001'), 'SH-1001', seed_uuid('client:lowe'),   seed_uuid('worker:ricci'), seed_uuid('sa:11'), current_date - 28, '09:00', '13:00', 240, 'completed', 240),
  (seed_uuid('sh:1002'), 'SH-1002', seed_uuid('client:lowe'),   seed_uuid('worker:ricci'), seed_uuid('sa:11'), current_date - 25, '09:00', '13:00', 240, 'completed', 240),
  (seed_uuid('sh:1003'), 'SH-1003', seed_uuid('client:calder'), seed_uuid('worker:kovac'), seed_uuid('sa:13'), current_date - 27, '16:00', '20:00', 240, 'completed', 240),
  (seed_uuid('sh:1004'), 'SH-1004', seed_uuid('client:calder'), seed_uuid('worker:feld'),  seed_uuid('sa:14'), current_date - 26, '09:00', '13:00', 240, 'completed', 240),
  (seed_uuid('sh:1005'), 'SH-1005', seed_uuid('client:okafor'), seed_uuid('worker:oshea'), seed_uuid('sa:15'), current_date - 24, '08:00', '12:00', 240, 'completed', 240),
  (seed_uuid('sh:1006'), 'SH-1006', seed_uuid('client:novak'),  seed_uuid('worker:mburu'), seed_uuid('sa:16'), current_date - 23, '10:00', '13:00', 180, 'completed', 180),
  -- claimed in PR-002 (two of these came back rejected)
  (seed_uuid('sh:1007'), 'SH-1007', seed_uuid('client:lowe'),   seed_uuid('worker:ricci'), seed_uuid('sa:11'), current_date - 14, '09:00', '13:00', 240, 'completed', 240),
  (seed_uuid('sh:1008'), 'SH-1008', seed_uuid('client:calder'), seed_uuid('worker:kovac'), seed_uuid('sa:13'), current_date - 13, '16:00', '20:00', 240, 'completed', 240),
  (seed_uuid('sh:1009'), 'SH-1009', seed_uuid('client:tran'),   seed_uuid('worker:feld'),  seed_uuid('sa:12'), current_date - 12, '13:00', '16:00', 180, 'completed', 180),
  (seed_uuid('sh:1010'), 'SH-1010', seed_uuid('client:okafor'), seed_uuid('worker:oshea'), seed_uuid('sa:15'), current_date - 11, '08:00', '12:00', 240, 'completed', 240),
  (seed_uuid('sh:1011'), 'SH-1011', seed_uuid('client:novak'),  seed_uuid('worker:mburu'), seed_uuid('sa:16'), current_date - 10, '10:00', '13:00', 180, 'completed', 180),
  -- completed, noted, no payment request yet: the money sitting
  (seed_uuid('sh:1012'), 'SH-1012', seed_uuid('client:calder'), seed_uuid('worker:kovac'), seed_uuid('sa:13'), current_date - 16, '16:00', '20:00', 240, 'completed', 240),
  (seed_uuid('sh:1013'), 'SH-1013', seed_uuid('client:lowe'),   seed_uuid('worker:ricci'), seed_uuid('sa:11'), current_date - 9,  '09:00', '13:00', 240, 'completed', 240),
  (seed_uuid('sh:1014'), 'SH-1014', seed_uuid('client:tran'),   seed_uuid('worker:feld'),  seed_uuid('sa:12'), current_date - 8,  '13:00', '16:00', 180, 'completed', 180),
  (seed_uuid('sh:1015'), 'SH-1015', seed_uuid('client:calder'), seed_uuid('worker:feld'),  seed_uuid('sa:14'), current_date - 6,  '09:00', '13:00', 240, 'completed', 240),
  (seed_uuid('sh:1016'), 'SH-1016', seed_uuid('client:okafor'), seed_uuid('worker:oshea'), seed_uuid('sa:15'), current_date - 5,  '08:00', '12:00', 240, 'completed', 240),
  (seed_uuid('sh:1017'), 'SH-1017', seed_uuid('client:novak'),  seed_uuid('worker:mburu'), seed_uuid('sa:16'), current_date - 4,  '10:00', '13:00', 180, 'completed', 180),
  (seed_uuid('sh:1018'), 'SH-1018', seed_uuid('client:lowe'),   seed_uuid('worker:ricci'), seed_uuid('sa:11'), current_date - 2,  '09:00', '13:00', 240, 'completed', 240),
  (seed_uuid('sh:1034'), 'SH-1034', seed_uuid('client:shaw'),   seed_uuid('worker:ricci'), seed_uuid('sa:17'), current_date - 3,  '14:00', '17:00', 180, 'completed', 180),
  -- completed with NO progress note: undocumented, unclaimable as they stand
  (seed_uuid('sh:1019'), 'SH-1019', seed_uuid('client:novak'),  seed_uuid('worker:mburu'), seed_uuid('sa:16'), current_date - 3,  '10:00', '13:00', 180, 'completed', 180),
  (seed_uuid('sh:1020'), 'SH-1020', seed_uuid('client:tran'),   seed_uuid('worker:feld'),  seed_uuid('sa:12'), current_date - 2,  '13:00', '16:00', 180, 'completed', 180),
  (seed_uuid('sh:1021'), 'SH-1021', seed_uuid('client:calder'), seed_uuid('worker:kovac'), seed_uuid('sa:13'), current_date - 1,  '16:00', '20:00', 240, 'completed', 240),
  -- past and never confirmed
  (seed_uuid('sh:1022'), 'SH-1022', seed_uuid('client:okafor'), seed_uuid('worker:kovac'), seed_uuid('sa:15'), current_date - 7,  '08:00', '12:00', 240, 'scheduled', null),
  (seed_uuid('sh:1023'), 'SH-1023', seed_uuid('client:lowe'),   seed_uuid('worker:ricci'), seed_uuid('sa:11'), current_date - 1,  '09:00', '13:00', 240, 'scheduled', null),
  -- the week ahead (Dana Kovac should not be on any of these)
  (seed_uuid('sh:1026'), 'SH-1026', seed_uuid('client:calder'), seed_uuid('worker:kovac'), seed_uuid('sa:13'), current_date + 1,  '16:00', '20:00', 240, 'scheduled', null),
  (seed_uuid('sh:1027'), 'SH-1027', seed_uuid('client:calder'), seed_uuid('worker:feld'),  seed_uuid('sa:14'), current_date + 3,  '09:00', '13:00', 240, 'scheduled', null),
  (seed_uuid('sh:1028'), 'SH-1028', seed_uuid('client:okafor'), seed_uuid('worker:kovac'), seed_uuid('sa:15'), current_date + 2,  '08:00', '12:00', 240, 'scheduled', null),
  (seed_uuid('sh:1029'), 'SH-1029', seed_uuid('client:novak'),  seed_uuid('worker:ricci'), seed_uuid('sa:16'), current_date + 4,  '10:00', '13:00', 180, 'scheduled', null),
  (seed_uuid('sh:1030'), 'SH-1030', seed_uuid('client:tran'),   seed_uuid('worker:feld'),  seed_uuid('sa:12'), current_date + 5,  '13:00', '16:00', 180, 'scheduled', null),
  (seed_uuid('sh:1031'), 'SH-1031', seed_uuid('client:okafor'), seed_uuid('worker:oshea'), seed_uuid('sa:15'), current_date + 6,  '08:00', '12:00', 240, 'scheduled', null),
  (seed_uuid('sh:1032'), 'SH-1032', seed_uuid('client:calder'), seed_uuid('worker:kovac'), seed_uuid('sa:13'), current_date + 6,  '16:00', '20:00', 240, 'scheduled', null),
  (seed_uuid('sh:1033'), 'SH-1033', seed_uuid('client:shaw'),   seed_uuid('worker:ricci'), seed_uuid('sa:17'), current_date + 2,  '14:00', '17:00', 180, 'scheduled', null)
on conflict do nothing;

-- Cancellations: Ruby's evening cancelled the day before (short notice, so
-- the pricing arrangements let it be claimed); Marcus's outing cancelled
-- with 10 days notice (not claimable, and that is correct).

insert into shifts (id, ref, client_id, worker_id, agreement_id, shift_on, starts_at, ends_at, scheduled_minutes, status, cancelled_on, cancel_reason, cancel_notice_days, claimable) values
  (seed_uuid('sh:1024'), 'SH-1024', seed_uuid('client:calder'), seed_uuid('worker:kovac'), seed_uuid('sa:13'), current_date - 5, '16:00', '20:00', 240, 'cancelled', current_date - 6, 'Client unwell, cancelled the evening before', 1,  true),
  (seed_uuid('sh:1025'), 'SH-1025', seed_uuid('client:tran'),   seed_uuid('worker:feld'),  seed_uuid('sa:12'), current_date - 9, '13:00', '16:00', 180, 'cancelled', current_date - 19, 'Family visiting that week, rescheduled in advance', 10, false)
on conflict do nothing;

-- Progress notes ---------------------------------------------------------------------------
-- One per completed shift, except SH-1019, SH-1020 and SH-1021: those are the
-- documentation gap the attention list names. Operational language only.

insert into progress_notes (id, shift_id, client_id, worker_id, noted_on, note) values
  (seed_uuid('pn:1001'), seed_uuid('sh:1001'), seed_uuid('client:lowe'),   seed_uuid('worker:ricci'), current_date - 28, 'Morning routine and shower support. Walked to the shops together, Harriet chose groceries for the week. Mood bright.'),
  (seed_uuid('pn:1002'), seed_uuid('sh:1002'), seed_uuid('client:lowe'),   seed_uuid('worker:ricci'), current_date - 25, 'Self-care support and meal preparation for the weekend. Harriet mentioned her rails in the bathroom feel loose; logged for maintenance follow-up.'),
  (seed_uuid('pn:1003'), seed_uuid('sh:1003'), seed_uuid('client:calder'), seed_uuid('worker:kovac'), current_date - 27, 'Evening routine support. Prepared dinner together, Ruby managed most steps independently with prompting.'),
  (seed_uuid('pn:1004'), seed_uuid('sh:1004'), seed_uuid('client:calder'), seed_uuid('worker:feld'),  current_date - 26, 'Saturday morning support. Market trip and lunch preparation. Ruby keen to try the community art class next month.'),
  (seed_uuid('pn:1005'), seed_uuid('sh:1005'), seed_uuid('client:okafor'), seed_uuid('worker:oshea'), current_date - 24, 'Morning personal care and exercises per the routine Vincent prefers. Short walk to the letterbox and back, steady.'),
  (seed_uuid('pn:1006'), seed_uuid('sh:1006'), seed_uuid('client:novak'),  seed_uuid('worker:mburu'), current_date - 23, 'Laundry, kitchen and bathroom clean. Elsie supervised and directed; she likes the towels folded in thirds.'),
  (seed_uuid('pn:1007'), seed_uuid('sh:1007'), seed_uuid('client:lowe'),   seed_uuid('worker:ricci'), current_date - 14, 'Morning support as usual. Harriet tired today, kept the walk short. Peter (son) visiting on the weekend.'),
  (seed_uuid('pn:1008'), seed_uuid('sh:1008'), seed_uuid('client:calder'), seed_uuid('worker:kovac'), current_date - 13, 'Evening routine support. Ruby cooked independently, I prompted for the stove check before we sat down.'),
  (seed_uuid('pn:1009'), seed_uuid('sh:1009'), seed_uuid('client:tran'),   seed_uuid('worker:feld'),  current_date - 12, 'Community access: library session then the pool. Marcus swam 20 minutes, longest yet.'),
  (seed_uuid('pn:1010'), seed_uuid('sh:1010'), seed_uuid('client:okafor'), seed_uuid('worker:oshea'), current_date - 11, 'Morning care and breakfast. Vincent asked about the agreement renewal; told him Priya would call this week.'),
  (seed_uuid('pn:1011'), seed_uuid('sh:1011'), seed_uuid('client:novak'),  seed_uuid('worker:mburu'), current_date - 10, 'Household tasks completed. Elsie would like the windows added to the fortnightly rotation.'),
  (seed_uuid('pn:1012'), seed_uuid('sh:1012'), seed_uuid('client:calder'), seed_uuid('worker:kovac'), current_date - 16, 'Evening support. Ruby practised the bus route to her sister''s place on the planner for Saturday.'),
  (seed_uuid('pn:1013'), seed_uuid('sh:1013'), seed_uuid('client:lowe'),   seed_uuid('worker:ricci'), current_date - 9,  'Morning routine support and pharmacy pickup together. Harriet steady on the new walker.'),
  (seed_uuid('pn:1014'), seed_uuid('sh:1014'), seed_uuid('client:tran'),   seed_uuid('worker:feld'),  current_date - 8,  'Community access: art supplies shopping, then the men''s shed open day. Marcus stayed a full hour, spoke with two members.'),
  (seed_uuid('pn:1015'), seed_uuid('sh:1015'), seed_uuid('client:calder'), seed_uuid('worker:feld'),  current_date - 6,  'Saturday support. Market and meal prep for the week. Ruby paid at the register herself, cash handling improving.'),
  (seed_uuid('pn:1016'), seed_uuid('sh:1016'), seed_uuid('client:okafor'), seed_uuid('worker:oshea'), current_date - 5,  'Morning care. Vincent''s brother visiting from Lagos next month; he wants to plan outings for that fortnight.'),
  (seed_uuid('pn:1017'), seed_uuid('sh:1017'), seed_uuid('client:novak'),  seed_uuid('worker:mburu'), current_date - 4,  'Full house clean. Elsie mentioned the hot water is intermittent; suggested she ring the landlord, she asked us to note it.'),
  (seed_uuid('pn:1018'), seed_uuid('sh:1018'), seed_uuid('client:lowe'),   seed_uuid('worker:ricci'), current_date - 2,  'Morning support. Harriet asked to move Thursday shifts to afternoons once the renewal is sorted.'),
  (seed_uuid('pn:1034'), seed_uuid('sh:1034'), seed_uuid('client:shaw'),   seed_uuid('worker:ricci'), current_date - 3,  'Fortnightly clean and linen change. Dominic well, garden tidy-up requested for next visit.'),
  (seed_uuid('pn:gen1'), null,                 seed_uuid('client:lowe'),   seed_uuid('worker:raman'), current_date - 6,  'Phone call with Peter Lowe re moving Thursday support to afternoons. Waiting on Harriet''s confirmation before changing the roster template.')
on conflict do nothing;

-- Incidents ---------------------------------------------------------------------------
-- INC-01 is the register's loudest row: a serious injury three days old with
-- no Commission notification recorded. The 24 hour clock ran out two days ago.

insert into incidents (id, ref, client_id, worker_id, occurred_on, category, severity, reportable, description, notified_on, status, closed_on) values
  (seed_uuid('inc:01'), 'INC-01', seed_uuid('client:calder'), seed_uuid('worker:kovac'), current_date - 3,  'injury',    'serious', true,  'Fall in the bathroom during evening support. Ambulance attended; Ruby kept overnight for observation and discharged the next morning. Family informed at the time.', null, 'open', null),
  (seed_uuid('inc:02'), 'INC-02', seed_uuid('client:lowe'),   seed_uuid('worker:ricci'), current_date - 20, 'property',  'minor',   false, 'Kitchen shelf came away from the wall while being wiped down. No one near it. Reported to Peter Lowe; handyman repaired it two days later.', null, 'closed', current_date - 18),
  (seed_uuid('inc:03'), 'INC-03', seed_uuid('client:tran'),   seed_uuid('worker:feld'),  current_date - 6,  'near_miss', 'minor',   false, 'Loose paver at the front step, trip hazard on exit. Taped and photographed; Marcus to raise with the landlord, follow up next visit.', null, 'open', null)
on conflict do nothing;

-- Claims ---------------------------------------------------------------------------
-- PR-001 went out three weeks ago and paid. PR-002 went out six days ago and
-- came back with two rejections nobody has resolved.

insert into claims (id, ref, shift_id, client_id, agreement_id, batch_ref, claimed_on, minutes, rate_cents, amount_cents, status, paid_on, rejected_reason) values
  (seed_uuid('clm:1001'), 'CLM-1001', seed_uuid('sh:1001'), seed_uuid('client:lowe'),   seed_uuid('sa:11'), 'PR-001', current_date - 21, 240, 6756, 27024, 'paid', current_date - 14, null),
  (seed_uuid('clm:1002'), 'CLM-1002', seed_uuid('sh:1002'), seed_uuid('client:lowe'),   seed_uuid('sa:11'), 'PR-001', current_date - 21, 240, 6756, 27024, 'paid', current_date - 14, null),
  (seed_uuid('clm:1003'), 'CLM-1003', seed_uuid('sh:1003'), seed_uuid('client:calder'), seed_uuid('sa:13'), 'PR-001', current_date - 21, 240, 7444, 29776, 'paid', current_date - 14, null),
  (seed_uuid('clm:1004'), 'CLM-1004', seed_uuid('sh:1004'), seed_uuid('client:calder'), seed_uuid('sa:14'), 'PR-001', current_date - 21, 240, 9507, 38028, 'paid', current_date - 14, null),
  (seed_uuid('clm:1005'), 'CLM-1005', seed_uuid('sh:1005'), seed_uuid('client:okafor'), seed_uuid('sa:15'), 'PR-001', current_date - 21, 240, 6700, 26800, 'paid', current_date - 14, null),
  (seed_uuid('clm:1006'), 'CLM-1006', seed_uuid('sh:1006'), seed_uuid('client:novak'),  seed_uuid('sa:16'), 'PR-001', current_date - 21, 180, 5830, 17490, 'paid', current_date - 14, null),
  (seed_uuid('clm:1007'), 'CLM-1007', seed_uuid('sh:1007'), seed_uuid('client:lowe'),   seed_uuid('sa:11'), 'PR-002', current_date - 6,  240, 6756, 27024, 'claimed', null, null),
  (seed_uuid('clm:1008'), 'CLM-1008', seed_uuid('sh:1008'), seed_uuid('client:calder'), seed_uuid('sa:13'), 'PR-002', current_date - 6,  240, 7444, 29776, 'rejected', null, 'Duplicate of an earlier payment request for the same support date'),
  (seed_uuid('clm:1009'), 'CLM-1009', seed_uuid('sh:1009'), seed_uuid('client:tran'),   seed_uuid('sa:12'), 'PR-002', current_date - 6,  180, 6500, 19500, 'claimed', null, null),
  (seed_uuid('clm:1010'), 'CLM-1010', seed_uuid('sh:1010'), seed_uuid('client:okafor'), seed_uuid('sa:15'), 'PR-002', current_date - 6,  240, 6700, 26800, 'rejected', null, 'Item number not covered by the participant''s current plan'),
  (seed_uuid('clm:1011'), 'CLM-1011', seed_uuid('sh:1011'), seed_uuid('client:novak'),  seed_uuid('sa:16'), 'PR-002', current_date - 6,  180, 5830, 17490, 'claimed', null, null)
on conflict do nothing;
