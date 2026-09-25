-- home-care-for-claude-code: core schema.
-- An Australian NDIS and home care provider's operating record: the clients
-- (participants), the service agreements that fund their supports, the support
-- workers with their clearances, the roster of shifts, the progress notes that
-- prove supports were delivered, the incident register, and the payment
-- requests (claims) that turn delivered hours into money.
--
-- Runs unchanged on PGlite (embedded) and on Postgres / Supabase.
-- Money is in cents, AUD. Durations are in minutes.
--
-- Deliberately NOT here: clinical records. No medications, no diagnoses, no
-- health notes. This is the operations record. Clinical records belong in a
-- clinical system under clinical governance.
--
-- The sharp edges are deliberate:
--   * a worker without a current NDIS Worker Screening clearance on the shift
--     date does not go on the roster, and there is no force flag
--     (NDIS (Practice Standards - Worker Screening) Rules 2018)
--   * a shift is not rostered outside a signed, in-date service agreement
--   * an agreement rate never passes the support item's price limit
--     (NDIS Pricing Arrangements and Price Limits)
--   * a completed shift without a progress note cannot be claimed: the note
--     is the record that the support was delivered
--   * a reportable incident does not close until its notification to the
--     NDIS Commission is on record
--     (NDIS (Incident Management and Reportable Incidents) Rules 2018)

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- Clients ------------------------------------------------------------------------
-- The participants. Every shift, note, incident and dollar claimed traces to
-- one of these rows. Funding shape decides who the invoice goes to: the NDIA
-- portal, a plan manager, or the participant themselves.

create table if not exists clients (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  ndis_number      text unique,                   -- 43xxxxxxx, blank for private clients
  dob              date,
  address          text,
  suburb           text,
  phone            text,
  email            text,
  funding          text not null default 'plan_managed',  -- ndia_managed | plan_managed | self_managed | private
  plan_manager     text,                          -- who the invoice goes to when plan managed
  plan_ends_on     date,                          -- the NDIS plan's end date: the reassessment clock
  emergency_name   text,
  emergency_phone  text,
  status           text not null default 'active',  -- active | exited
  exited_on        date,
  note             text,
  external_ref     text unique,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists clients_name_lower_idx on clients (lower(name));

-- Support items ---------------------------------------------------------------------------
-- The NDIS price guide lines this business delivers, with each item's price
-- limit. The caps here are DEMO values: set your own from the current NDIS
-- Pricing Arrangements and Price Limits, and update them when the guide does.

create table if not exists support_items (
  id               uuid primary key default gen_random_uuid(),
  item_number      text not null unique,          -- 01_011_0107_1_1
  name             text not null,
  unit             text not null default 'hour',
  price_cap_cents  bigint not null,               -- the price limit; agreements cannot exceed it
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Workers ---------------------------------------------------------------------------
-- The support workers and coordinators. The clearances live here because an
-- unscreened worker delivering NDIS supports is the breach that ends a
-- registration: the roster gate reads these dates.

create table if not exists workers (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  role                  text not null default 'support_worker',  -- support_worker | coordinator
  employment            text not null default 'casual',          -- permanent | part_time | casual
  phone                 text,
  email                 text,
  screening_number      text,                     -- NDIS Worker Screening clearance number
  screening_expires_on  date,                     -- the roster gate reads this
  first_aid_expires_on  date,
  wwcc_expires_on       date,                     -- working with children check, where required
  status                text not null default 'active',  -- active | former
  note                  text,
  external_ref          text unique,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists workers_name_lower_idx on workers (lower(name));

-- Service agreements ---------------------------------------------------------------------------
-- The funded line every shift hangs off: this client, this support item, this
-- rate (at or under the cap), this many hours a week, this much budget,
-- between these dates, signed on this date. No agreement, no roster.

create table if not exists agreements (
  id               uuid primary key default gen_random_uuid(),
  ref              text unique,                   -- SA-11
  client_id        uuid not null references clients(id) on delete cascade,
  support_item_id  uuid not null references support_items(id),
  rate_cents       bigint not null,               -- <= the item's price cap, enforced at the gate
  hours_per_week   numeric not null default 0,
  budget_cents     bigint not null default 0,     -- the funding allocated to this line
  starts_on        date not null,
  ends_on          date not null,
  signed_on        date,                          -- unsigned agreements do not roster
  status           text not null default 'active',  -- active | ended
  note             text,
  external_ref     text unique,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists agreements_client_idx on agreements (client_id);

-- Shifts ---------------------------------------------------------------------------
-- The roster. A shift is scheduled, then completed (with its minutes and its
-- progress note) or cancelled (with the notice period, which decides whether
-- the NDIS short-notice cancellation rules make it claimable).

create table if not exists shifts (
  id                  uuid primary key default gen_random_uuid(),
  ref                 text unique,                -- SH-1001
  client_id           uuid not null references clients(id) on delete cascade,
  worker_id           uuid not null references workers(id),
  agreement_id        uuid not null references agreements(id),
  shift_on            date not null,
  starts_at           time not null,
  ends_at             time not null,
  scheduled_minutes   int not null,
  status              text not null default 'scheduled',  -- scheduled | completed | cancelled
  completed_minutes   int,
  cancelled_on        date,
  cancel_reason       text,
  cancel_notice_days  int,                        -- days of notice the client gave
  claimable           boolean not null default false,  -- short-notice cancellation: still billable
  note                text,
  external_ref        text unique,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists shifts_client_idx on shifts (client_id);
create index if not exists shifts_worker_idx on shifts (worker_id);
create index if not exists shifts_on_idx on shifts (shift_on);

-- Progress notes ---------------------------------------------------------------------------
-- The record that the support happened and what was done. A completed shift
-- with no note cannot be claimed, because in an audit the note IS the
-- evidence of delivery. Operational language only: no clinical content.

create table if not exists progress_notes (
  id          uuid primary key default gen_random_uuid(),
  shift_id    uuid references shifts(id) on delete set null,
  client_id   uuid not null references clients(id) on delete cascade,
  worker_id   uuid references workers(id) on delete set null,
  noted_on    date not null default current_date,
  note        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists progress_notes_client_idx on progress_notes (client_id);
create index if not exists progress_notes_shift_idx on progress_notes (shift_id);

-- Incidents ---------------------------------------------------------------------------
-- The incident register the NDIS (Incident Management and Reportable
-- Incidents) Rules 2018 require. A reportable incident carries a notification
-- clock: 24 hours for the serious kinds, five business days for the rest.
-- Closing a reportable incident without a notification date is refused.

create table if not exists incidents (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique,                      -- INC-01
  client_id     uuid not null references clients(id) on delete cascade,
  worker_id     uuid references workers(id) on delete set null,
  occurred_on   date not null,
  category      text not null,                    -- injury | medication | behaviour | property | near_miss | unauthorised_restrictive_practice | abuse_neglect | other
  severity      text not null default 'minor',    -- minor | serious
  reportable    boolean not null default false,   -- must it go to the NDIS Commission
  description   text not null,
  notified_on   date,                             -- when the Commission was notified
  status        text not null default 'open',     -- open | closed
  closed_on     date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists incidents_client_idx on incidents (client_id);

-- Claims ---------------------------------------------------------------------------
-- Payment requests. One claim per delivered (or claimably cancelled) shift:
-- the minutes, the agreement's rate, the amount. Built in batches, exported
-- in the NDIA bulk payment request shape, then marked paid or rejected.

create table if not exists claims (
  id               uuid primary key default gen_random_uuid(),
  ref              text unique,                   -- CLM-1001
  shift_id         uuid not null unique references shifts(id) on delete cascade,
  client_id        uuid not null references clients(id) on delete cascade,
  agreement_id     uuid not null references agreements(id),
  batch_ref        text,                          -- PR-001: the bulk upload this went out in
  claimed_on       date not null default current_date,
  minutes          int not null,
  rate_cents       bigint not null,
  amount_cents     bigint not null,
  status           text not null default 'claimed',  -- claimed | paid | rejected
  paid_on          date,
  rejected_reason  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists claims_client_idx on claims (client_id);
create index if not exists claims_batch_idx on claims (batch_ref);

-- updated_at triggers ------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['clients','support_items','workers','agreements','shifts','incidents','claims']
  loop
    execute format('drop trigger if exists %I on %I', t || '_updated_at', t);
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated_at', t);
  end loop;
end
$$;

-- =====================================================================================
-- Views: the questions a provider asks every Monday, as SQL anyone can read.
-- =====================================================================================

-- Shifts with the whole story on one line: who, where, worth what, in what
-- state. The states are loud where money or evidence is missing.
create or replace view v_shifts as
select
  sh.id as shift_id,
  sh.ref,
  c.name as client,
  c.id as client_id,
  w.name as worker,
  w.id as worker_id,
  si.item_number,
  si.name as support,
  sh.shift_on,
  sh.starts_at,
  sh.ends_at,
  sh.scheduled_minutes,
  sh.completed_minutes,
  sh.status,
  sh.cancel_reason,
  sh.cancel_notice_days,
  sh.claimable,
  a.rate_cents,
  a.id as agreement_id,
  case
    when sh.status = 'completed' then round(coalesce(sh.completed_minutes, sh.scheduled_minutes) / 60.0 * a.rate_cents)::bigint
    when sh.status = 'cancelled' and sh.claimable then round(sh.scheduled_minutes / 60.0 * a.rate_cents)::bigint
    else round(sh.scheduled_minutes / 60.0 * a.rate_cents)::bigint
  end as value_cents,
  exists (select 1 from progress_notes n where n.shift_id = sh.id) as has_note,
  exists (select 1 from claims cl where cl.shift_id = sh.id) as claimed,
  case
    when sh.status = 'completed' and not exists (select 1 from progress_notes n where n.shift_id = sh.id) then 'NO NOTE'
    when (sh.status = 'completed' or (sh.status = 'cancelled' and sh.claimable))
         and exists (select 1 from claims cl where cl.shift_id = sh.id) then 'claimed'
    when sh.status = 'completed' then 'unclaimed'
    when sh.status = 'cancelled' and sh.claimable then 'cancelled, claimable'
    when sh.status = 'cancelled' then 'cancelled'
    when sh.shift_on < current_date then 'UNCONFIRMED'
    when sh.shift_on = current_date then 'today'
    else 'scheduled'
  end as state
from shifts sh
join clients c on c.id = sh.client_id
join workers w on w.id = sh.worker_id
join agreements a on a.id = sh.agreement_id
join support_items si on si.id = a.support_item_id;

-- Workers with the clearance state loud and the roster load visible.
create or replace view v_workers as
select
  w.id as worker_id,
  w.name,
  w.role,
  w.employment,
  w.phone,
  w.email,
  w.screening_number,
  w.screening_expires_on,
  (w.screening_expires_on - current_date) as screening_days_left,
  case
    when w.screening_expires_on is null then 'NONE'
    when w.screening_expires_on < current_date then 'EXPIRED'
    when w.screening_expires_on <= current_date + 30 then 'expiring'
    else 'current'
  end as screening,
  w.first_aid_expires_on,
  case
    when w.first_aid_expires_on is null then 'NONE'
    when w.first_aid_expires_on < current_date then 'EXPIRED'
    when w.first_aid_expires_on <= current_date + 30 then 'expiring'
    else 'current'
  end as first_aid,
  w.status,
  (select count(*) from shifts sh where sh.worker_id = w.id and sh.status = 'scheduled' and sh.shift_on between current_date and current_date + 7) as shifts_next_7d,
  (select coalesce(sum(sh.scheduled_minutes), 0) from shifts sh where sh.worker_id = w.id and sh.status = 'scheduled' and sh.shift_on between current_date and current_date + 7) as minutes_next_7d,
  (select coalesce(sum(coalesce(sh.completed_minutes, sh.scheduled_minutes)), 0) from shifts sh where sh.worker_id = w.id and sh.status = 'completed' and sh.shift_on >= current_date - 14) as minutes_last_14d,
  (select count(distinct sh.client_id) from shifts sh where sh.worker_id = w.id and sh.shift_on >= current_date - 28) as clients_last_28d
from workers w;

-- Clients with the delivery pulse: what is funded, what is landing, when we
-- were last there, and when we are next there. A funded client with no next
-- shift is a gap in someone's week.
create or replace view v_clients as
select
  c.id as client_id,
  c.name,
  c.ndis_number,
  c.funding,
  c.plan_manager,
  c.plan_ends_on,
  (c.plan_ends_on - current_date) as plan_days_left,
  c.suburb,
  c.status,
  (select count(*) from agreements a where a.client_id = c.id and a.status = 'active' and a.ends_on >= current_date) as active_agreements,
  (select coalesce(sum(a.hours_per_week), 0) from agreements a where a.client_id = c.id and a.status = 'active' and a.ends_on >= current_date) as funded_hours_week,
  (select coalesce(sum(coalesce(sh.completed_minutes, sh.scheduled_minutes)), 0) from shifts sh where sh.client_id = c.id and sh.status = 'completed' and sh.shift_on >= current_date - 28) as minutes_last_28d,
  (select max(sh.shift_on) from shifts sh where sh.client_id = c.id and sh.status = 'completed') as last_shift_on,
  (select min(sh.shift_on) from shifts sh where sh.client_id = c.id and sh.status = 'scheduled' and sh.shift_on >= current_date) as next_shift_on,
  (select max(n.noted_on) from progress_notes n where n.client_id = c.id) as last_note_on,
  (select coalesce(sum(v.value_cents), 0) from v_shifts v where v.client_id = c.id and v.state = 'unclaimed') as unclaimed_cents,
  (select count(*) from incidents i where i.client_id = c.id and i.status = 'open') as open_incidents
from clients c;

-- Agreements with the money and the pace: budget, what has been delivered
-- against it, and whether the delivery pace will land the budget or strand
-- it. An under-delivered plan is the polite name for a client someone else
-- will be serving next plan period.
create or replace view v_agreements as
select
  a.id as agreement_id,
  a.ref,
  c.name as client,
  c.id as client_id,
  si.item_number,
  si.name as support,
  si.price_cap_cents,
  a.rate_cents,
  a.hours_per_week,
  a.budget_cents,
  a.starts_on,
  a.ends_on,
  a.signed_on,
  a.status,
  (a.ends_on - current_date) as days_left,
  (select coalesce(sum(coalesce(sh.completed_minutes, sh.scheduled_minutes)), 0)
     from shifts sh where sh.agreement_id = a.id and sh.status = 'completed') as delivered_minutes,
  (select coalesce(sum(v.value_cents), 0) from v_shifts v
     where v.agreement_id = a.id and v.state in ('claimed', 'unclaimed', 'NO NOTE', 'cancelled, claimable')) as used_cents,
  case when a.budget_cents > 0 then
    round((select coalesce(sum(v.value_cents), 0) from v_shifts v
       where v.agreement_id = a.id and v.state in ('claimed', 'unclaimed', 'NO NOTE', 'cancelled, claimable')) * 100.0 / a.budget_cents)
  end as used_pct,
  case when a.ends_on > a.starts_on then
    round(least(100, greatest(0, (current_date - a.starts_on) * 100.0 / (a.ends_on - a.starts_on))))
  end as elapsed_pct,
  (select count(*) from shifts sh where sh.agreement_id = a.id and sh.status = 'scheduled' and sh.shift_on > a.ends_on) as shifts_past_end,
  case
    when a.signed_on is null then 'UNSIGNED'
    when a.ends_on < current_date and a.status = 'active' then 'EXPIRED'
    when a.budget_cents > 0 and (select coalesce(sum(v.value_cents), 0) from v_shifts v
       where v.agreement_id = a.id and v.state in ('claimed', 'unclaimed', 'NO NOTE', 'cancelled, claimable')) > a.budget_cents then 'OVER BUDGET'
    when a.ends_on <= current_date + 28 and a.status = 'active' then 'expiring'
    when a.budget_cents > 0 and a.ends_on > a.starts_on
      and (current_date - a.starts_on) * 100.0 / (a.ends_on - a.starts_on) between 25 and 100
      and (select coalesce(sum(v.value_cents), 0) from v_shifts v
             where v.agreement_id = a.id and v.state in ('claimed', 'unclaimed', 'NO NOTE', 'cancelled, claimable')) * 100.0 / a.budget_cents
          < ((current_date - a.starts_on) * 100.0 / (a.ends_on - a.starts_on)) * 0.7 then 'under pace'
    else 'ok'
  end as state
from agreements a
join clients c on c.id = a.client_id
join support_items si on si.id = a.support_item_id;

-- Claims with the ledger state loud.
create or replace view v_claims as
select
  cl.id as claim_id,
  cl.ref,
  cl.batch_ref,
  c.name as client,
  sh.ref as shift_ref,
  sh.shift_on,
  cl.claimed_on,
  (current_date - cl.claimed_on) as days_out,
  cl.minutes,
  cl.rate_cents,
  cl.amount_cents,
  cl.status,
  cl.paid_on,
  cl.rejected_reason,
  case when cl.status = 'rejected' then 'REJECTED' else cl.status end as state
from claims cl
join clients c on c.id = cl.client_id
join shifts sh on sh.id = cl.shift_id;

-- Delivered work no payment request has been built for: the provider's
-- interest-free loan to everyone else. Includes claimable short-notice
-- cancellations, which the pricing arrangements let you bill.
create or replace view v_unclaimed as
select
  v.shift_id,
  v.ref,
  v.client,
  v.client_id,
  v.worker,
  v.support,
  v.item_number,
  v.shift_on,
  (current_date - v.shift_on) as days_waiting,
  coalesce(v.completed_minutes, v.scheduled_minutes) as minutes,
  v.value_cents,
  v.state
from v_shifts v
where v.state in ('unclaimed', 'cancelled, claimable') and not v.claimed;

-- Incidents with the Commission clock running. Serious reportable incidents
-- carry a 24 hour notification deadline; other reportable incidents five
-- business days (checked here as 7 calendar days).
create or replace view v_incidents as
select
  i.id as incident_id,
  i.ref,
  c.name as client,
  w.name as worker,
  i.occurred_on,
  (current_date - i.occurred_on) as days_ago,
  i.category,
  i.severity,
  i.reportable,
  i.description,
  i.notified_on,
  i.status,
  i.closed_on,
  case
    when i.reportable and i.notified_on is null and i.severity = 'serious' and i.occurred_on < current_date then 'NOTIFY OVERDUE'
    when i.reportable and i.notified_on is null and i.occurred_on < current_date - 7 then 'NOTIFY OVERDUE'
    when i.reportable and i.notified_on is null then 'notify due'
    when i.status = 'open' then 'open'
    else 'closed'
  end as state
from incidents i
join clients c on c.id = i.client_id
left join workers w on w.id = i.worker_id;

-- Everything that wants a decision, one union, worst first. An unreported
-- reportable incident outranks everything: that clock belongs to the NDIS
-- Commission, not to you.
create or replace view v_attention as
-- A reportable incident whose notification is missing.
select 1 as rank, 'incident_unreported' as reason, i.ref as label, i.client, i.category as place,
       i.days_ago as days,
       i.severity || ' ' || i.category || ' incident on ' || to_char(i.occurred_on, 'YYYY-MM-DD') ||
       ', no Commission notification on record: the deadline is ' ||
       case when i.severity = 'serious' then '24 hours' else '5 business days' end ||
       ' (Incident Management Rules 2018)' as detail
from v_incidents i
where i.reportable and i.notified_on is null
union all
-- An unscreened or expired worker holding future shifts.
select 2, 'screening_expired', w.name, '', 'rostered ' || count(*) || ' upcoming shift(s)',
       max(abs(coalesce(w.screening_days_left, 0))),
       'NDIS Worker Screening ' || case when w.screening_expires_on is null then 'NOT ON RECORD'
         else 'expired ' || to_char(w.screening_expires_on, 'YYYY-MM-DD') end ||
       ' and still rostered: reassign every shift today, an unscreened worker cannot deliver supports'
from v_workers w
join shifts sh on sh.worker_id = w.worker_id and sh.status = 'scheduled' and sh.shift_on >= current_date
where w.screening in ('EXPIRED', 'NONE') and w.status = 'active'
group by w.name, w.screening_expires_on, w.screening_days_left
union all
-- A past shift nobody confirmed or cancelled: it cannot be claimed as it stands.
select 3, 'shift_unconfirmed', v.ref, v.client, v.worker,
       (current_date - v.shift_on),
       'rostered ' || to_char(v.shift_on, 'YYYY-MM-DD') || ' ' || to_char(v.starts_at, 'HH24:MI') ||
       ' and never completed or cancelled: confirm what happened, unconfirmed work cannot be claimed'
from v_shifts v
where v.state = 'UNCONFIRMED'
union all
-- A completed shift with no progress note: undocumented support.
select 4, 'note_missing', v.ref, v.client, v.worker,
       (current_date - v.shift_on),
       'completed ' || to_char(v.shift_on, 'YYYY-MM-DD') || ' with no progress note: no note, no evidence, no claim. Get the worker''s note in today'
from v_shifts v
where v.state = 'NO NOTE'
union all
-- Delivered money nobody has asked to be paid for.
select 5, 'money_sitting', u.client, '', count(*) || ' shift(s)',
       max(u.days_waiting),
       '$' || to_char(sum(u.value_cents) / 100.0, 'FM999,999,990') || ' delivered and not yet claimed, oldest ' ||
       max(u.days_waiting) || ' days: build the payment request'
from v_unclaimed u
where u.days_waiting > 7
group by u.client
union all
-- A rejected claim is money until it is fixed and resubmitted.
select 6, 'claim_rejected', cl.ref, cl.client, cl.shift_ref,
       cl.days_out,
       '$' || to_char(cl.amount_cents / 100.0, 'FM999,999,990') || ' rejected: ' || coalesce(cl.rejected_reason, 'no reason recorded') ||
       '. Fix it and resubmit, rejected money does not chase itself'
from v_claims cl
where cl.status = 'rejected'
union all
-- An agreement past its end date with shifts still landing on it.
select 7, 'agreement_lapsed', a.ref, a.client, a.support,
       abs(a.days_left),
       'ended ' || to_char(a.ends_on, 'YYYY-MM-DD') || ' and still carries scheduled shifts: renew it or stand the shifts down, supports outside an agreement are unclaimable'
from v_agreements a
where a.state = 'EXPIRED' and (select count(*) from shifts sh where sh.agreement_id = a.agreement_id and sh.status = 'scheduled' and sh.shift_on >= current_date) > 0
union all
-- An agreement inside its last four weeks.
select 8, 'agreement_expiring', a.ref, a.client, a.support,
       a.days_left,
       'ends ' || to_char(a.ends_on, 'YYYY-MM-DD') || ' (' || a.days_left || ' days): get the renewal signed before the roster runs off the edge'
from v_agreements a
where a.state = 'expiring'
union all
-- A budget being delivered too slowly: the plan review will notice.
select 9, 'under_pace', a.ref, a.client, a.support,
       a.days_left,
       'only ' || coalesce(a.used_pct, 0) || '% of the budget used with ' || a.elapsed_pct ||
       '% of the period gone: unused funding reads as unneeded funding at plan reassessment'
from v_agreements a
where a.state = 'under pace'
union all
-- A budget already blown.
select 9, 'over_budget', a.ref, a.client, a.support,
       a.days_left,
       '$' || to_char(a.used_cents / 100.0, 'FM999,999,990') || ' delivered against ' || '$' || to_char(a.budget_cents / 100.0, 'FM999,999,990') ||
       ' budgeted: stop and talk to the plan manager before delivering more unfunded hours'
from v_agreements a
where a.state = 'OVER BUDGET'
union all
-- An active client with nothing in the next seven days.
select 10, 'client_uncovered', c.name, '', coalesce(c.suburb, ''),
       (current_date - coalesce(c.last_shift_on, current_date)),
       'no shift rostered in the next 7 days (last support ' ||
       coalesce(to_char(c.last_shift_on, 'YYYY-MM-DD'), 'never') || '): a funded client with an empty week is a gap someone else will fill'
from v_clients c
where c.status = 'active' and c.active_agreements > 0 and (c.next_shift_on is null or c.next_shift_on > current_date + 7)
union all
-- First aid lapsed on someone still working.
select 11, 'first_aid_expired', w.name, '', w.role,
       null,
       'first aid ' || case when w.first_aid_expires_on is null then 'NOT ON RECORD' else 'expired ' || to_char(w.first_aid_expires_on, 'YYYY-MM-DD') end ||
       ' on an active worker: book the refresher'
from v_workers w
where w.first_aid in ('EXPIRED', 'NONE') and w.status = 'active'
union all
-- A screening clearance inside its last 30 days.
select 12, 'screening_expiring', w.name, '', w.role,
       w.screening_days_left,
       'NDIS Worker Screening expires ' || to_char(w.screening_expires_on, 'YYYY-MM-DD') ||
       ' (' || w.screening_days_left || ' days): renewals take weeks, start now'
from v_workers w
where w.screening = 'expiring' and w.status = 'active'
union all
-- An NDIS plan ending within six weeks.
select 13, 'plan_ending', c.name, '', coalesce(c.funding, ''),
       c.plan_days_left,
       'NDIS plan ends ' || to_char(c.plan_ends_on, 'YYYY-MM-DD') || ' (' || c.plan_days_left ||
       ' days): the delivery record decides the next plan, make sure it is complete and claimed'
from v_clients c
where c.status = 'active' and c.plan_ends_on is not null and c.plan_ends_on between current_date and current_date + 42;
