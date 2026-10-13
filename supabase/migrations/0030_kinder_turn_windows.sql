-- ============================================================
--  0030 — windows people can actually hit
--
--  Gameweek 15 drafted over a weekend and five of nine players were
--  auto-picked. Nothing errored; the schedule was simply unhittable.
--
--  It opened Friday at 20:00 — the moment gameweek 14 kicked off, because
--  that is what draft_opens_at has always meant — and closed at the first
--  Tuesday kickoff. Three players split that evenly, so the notification
--  landed on a Friday night and the first deadline fell somewhere in
--  Saturday. Nobody is checking a football app at that hour on a weekend,
--  and the clock ran out while they weren't looking.
--
--  Two changes, plus a warning.
--
--  Opening. A midweek gameweek now opens at noon on the Sunday before it,
--  rather than whenever the previous round happened to start. A weekend
--  gameweek is unaffected: the previous kickoff is already later than that
--  Sunday, and whichever is later wins.
--
--  Deadlines. An even split put them at arbitrary hours — 06:33 on a
--  Monday is a deadline in name only. Each one is now pushed forward to
--  the next midday or evening, so a turn ends when somebody might
--  plausibly be looking at their phone. The last turn still ends at the
--  hard deadline, five minutes before the football.
--
--  And every player is now warned three hours before their own deadline,
--  not only told when their turn opens. The turn email arrives when the
--  person in front of you finishes, which may be a day and a half before
--  you are actually up against it.
-- ============================================================


-- ------------------------------------------------------------
--  A deadline at an hour somebody might see
-- ------------------------------------------------------------
--
--  Midday or eight in the evening, London time. Those are the two moments
--  in a day when a reminder has a chance: lunch, and after dinner. The
--  hours in between are work, and the ones outside are sleep.
--
--  London rather than UTC because the deadline is read by people, and a
--  "midday" that lands at 13:00 through the summer is not midday.
create or replace function public.next_pick_slot(p_at timestamptz)
returns timestamptz language plpgsql stable set search_path = public as $$
declare
  v_local timestamp;
  v_day   date;
  v_slot  timestamp;
begin
  v_local := timezone('Europe/London', p_at);
  v_day   := v_local::date;

  foreach v_slot in array array[
    v_day + time '12:00',
    v_day + time '20:00',
    (v_day + 1) + time '12:00',
    (v_day + 1) + time '20:00'
  ] loop
    if v_slot >= v_local then
      return timezone('Europe/London', v_slot);
    end if;
  end loop;

  return timezone('Europe/London', (v_day + 2) + time '12:00');
end;
$$;


-- ------------------------------------------------------------
--  When the turn in progress should expire
-- ------------------------------------------------------------
--
--  p_remaining counts the seats still to take a turn, including this one.
--
--  The share and the reserve are as they were: an equal cut of what's
--  left, capped so everybody behind keeps something back. The reserve is
--  six hours rather than one, because an hour is not a turn — it is a
--  window you have to already be holding your phone to catch.
--
--  The snap is the new part, and it is applied only when it still leaves
--  the reserve intact. Pushing a deadline forward to a civilised hour is
--  worth doing right up until it starts eating the next player's turn.
create or replace function public.turn_deadline(
  p_gameweek_id uuid,
  p_remaining   integer
)
returns timestamptz language plpgsql stable set search_path = public as $$
declare
  v_end       timestamptz := public.draft_hard_deadline(p_gameweek_id);
  v_available interval;
  v_share     interval;
  v_reserve   interval;
  v_raw       timestamptz;
  v_latest    timestamptz;
  v_snapped   timestamptz;
begin
  if v_end is null then return null; end if;
  if p_remaining is null or p_remaining <= 1 then return v_end; end if;

  v_available := greatest(v_end - now(), interval '0');
  v_share     := v_available / p_remaining;
  v_reserve   := least(interval '6 hours', v_share);

  -- The most this turn can take without stranding the seats behind it.
  v_latest := v_end - v_reserve * (p_remaining - 1);
  v_raw    := least(now() + v_share, v_latest);

  v_snapped := public.next_pick_slot(v_raw);

  -- Snapping forward is a kindness, not a licence to overrun.
  if v_snapped <= v_latest then
    return v_snapped;
  end if;

  return v_raw;
end;
$$;

revoke all on function public.next_pick_slot(timestamptz)
  from public, anon, authenticated;
revoke all on function public.turn_deadline(uuid, integer)
  from public, anon, authenticated;


-- ------------------------------------------------------------
--  Three hours' warning
-- ------------------------------------------------------------
--
--  Same shape as turn_notified_at, and compared against turn_started_at
--  the same way, so each turn warns once and a new turn warns again
--  without anything needing to be cleared.
alter table public.drafts
  add column if not exists turn_warned_at timestamptz;

comment on column public.drafts.turn_warned_at is
  'When the player on the clock was warned their deadline was close. Compared against turn_started_at, so each turn warns once.';

/**
 * Turns about to run out, whose player hasn't been warned yet.
 *
 * Only where there is still time to act on it: a warning that arrives
 * after the auto-pick has already fired is worse than none, because it
 * reads as the app having known and said nothing.
 */
create or replace function public.pending_turn_warnings()
returns table (
  draft_id      uuid,
  user_id       uuid,
  email         text,
  display_name  text,
  division_name text,
  league_name   text,
  gameweek      integer,
  expires_at    timestamptz,
  push_targets  jsonb
)
language sql security definer set search_path = public as $$
  select
    d.id,
    public.draft_user_at_turn(d.pick_order, d.current_turn) as user_id,
    p.email,
    p.display_name,
    dv.name,
    l.name,
    g.number,
    d.turn_expires_at,
    coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'id', s.id,
                  'endpoint', s.endpoint,
                  'p256dh', s.p256dh,
                  'auth', s.auth
                ) order by s.created_at)
         from public.push_subscriptions s
        where s.user_id = p.id),
      '[]'::jsonb
    ) as push_targets
  from public.drafts d
  join public.divisions dv on dv.id = d.division_id
  join public.leagues   l  on l.id  = dv.league_id
  join public.gameweeks g  on g.id  = d.gameweek_id
  join public.profiles  p
    on p.id = public.draft_user_at_turn(d.pick_order, d.current_turn)
  where d.status = 'active'
    and d.turn_started_at is not null
    and d.turn_expires_at is not null
    and d.turn_expires_at > now()
    and d.turn_expires_at <= now() + interval '3 hours'
    -- A turn shorter than the warning doesn't get one: the email saying it
    -- was your turn arrived inside the same three hours and already said
    -- when it ends. Two messages a few minutes apart is how people learn to
    -- ignore both.
    and d.turn_expires_at - d.turn_started_at > interval '3 hours'
    and (d.turn_warned_at is null or d.turn_warned_at < d.turn_started_at)
    and g.draft_closes_at > now()
    and p.email is not null
    and (
      p.notify_turn
      or exists (select 1 from public.push_subscriptions s where s.user_id = p.id)
    );
$$;

revoke all on function public.pending_turn_warnings()
  from public, anon, authenticated;

create or replace function public.mark_turn_warned(p_draft_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.drafts set turn_warned_at = now() where id = p_draft_id;
$$;

revoke all on function public.mark_turn_warned(uuid)
  from public, anon, authenticated;
