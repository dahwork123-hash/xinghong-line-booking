-- Move existing interviews when staff change a weekly slot, and queue one
-- LINE notice per booking/time. The channel token stays in the edge function.

alter table public.xinghong_bookings
  add column if not exists candidate_notice_key text,
  add column if not exists candidate_notice_sent_key text,
  add column if not exists candidate_notice_sent_at timestamptz,
  add column if not exists candidate_notice_claimed_at timestamptz;

create or replace function public.xinghong_reschedule_bookings(
  p_ids uuid[],
  p_start text,
  p_end text,
  p_director_id text,
  p_director_label text,
  p_capacity integer
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  cap integer;
  rec record;
  others integer;
  moving integer;
  n integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return json_build_object('ok', true, 'moved', 0);
  end if;
  if p_end <= p_start then
    raise exception 'INVALID_TIME';
  end if;
  cap := greatest(1, least(coalesce(p_capacity, 5), 99));

  for rec in
    select
      b.interview_date,
      coalesce(nullif(c.interview_city, ''), c.apply_city) as city,
      count(*)::integer as moving
    from public.xinghong_bookings b
    join public.xinghong_candidates c on c.id = b.candidate_id
    where b.id = any(p_ids)
      and b.status = 'confirmed'
      and b.interview_date >= (timezone('Asia/Taipei', now()))::date
    group by b.interview_date, coalesce(nullif(c.interview_city, ''), c.apply_city)
  loop
    if rec.interview_date is null then
      continue;
    end if;
    if p_start is not null then
      select count(*) into others
      from public.xinghong_bookings b
      join public.xinghong_candidates c on c.id = b.candidate_id
      where b.status = 'confirmed'
        and b.interview_date = rec.interview_date
        and b.start_time = p_start
        and not (b.id = any(p_ids))
        and coalesce(nullif(c.interview_city, ''), c.apply_city) = rec.city;
      moving := rec.moving;
      if coalesce(others, 0) + moving > cap then
        raise exception 'SLOT_FULL';
      end if;
    end if;
  end loop;

  update public.xinghong_bookings
  set start_time = p_start,
      end_time = p_end,
      director_id = coalesce(p_director_id, ''),
      director_label = coalesce(p_director_label, ''),
      updated_at = now()
  where id = any(p_ids)
    and status = 'confirmed'
    and interview_date >= (timezone('Asia/Taipei', now()))::date;
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'moved', n);
end;
$$;

create or replace function public.xinghong_queue_candidate_notice(p_booking_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  rec record;
  next_key text;
begin
  select
    b.id,
    b.interview_date,
    b.start_time,
    b.end_time,
    b.director_id,
    b.director_label,
    b.candidate_notice_key,
    b.candidate_notice_sent_key,
    b.candidate_notice_sent_at,
    nullif(btrim(c.line_user_id), '') as line_user_id
  into rec
  from public.xinghong_bookings b
  join public.xinghong_candidates c on c.id = b.candidate_id
  where b.id = p_booking_id
    and b.status = 'confirmed';
  if rec.id is null then
    raise exception 'NOT_FOUND';
  end if;
  if rec.line_user_id is null then
    return json_build_object('ok', false, 'status', 'no_line');
  end if;
  next_key := rec.interview_date::text
    || '|' || rec.start_time
    || '|' || coalesce(rec.end_time, '')
    || '|' || coalesce(rec.director_id, '')
    || '|' || coalesce(rec.director_label, '');
  if rec.candidate_notice_sent_key = next_key and rec.candidate_notice_sent_at is not null then
    return json_build_object('ok', true, 'status', 'already_sent', 'key', next_key);
  end if;
  if rec.candidate_notice_key = next_key and rec.candidate_notice_sent_at is null then
    return json_build_object('ok', true, 'status', 'pending', 'key', next_key);
  end if;
  update public.xinghong_bookings
  set candidate_notice_key = next_key,
      candidate_notice_sent_at = null,
      candidate_notice_claimed_at = null,
      updated_at = now()
  where id = rec.id;
  return json_build_object('ok', true, 'status', 'queued', 'key', next_key);
end;
$$;

create or replace function public.xinghong_claim_candidate_notices()
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return coalesce((
    with claimed as (
      update public.xinghong_bookings b
      set candidate_notice_claimed_at = now()
      from public.xinghong_candidates c
      where c.id = b.candidate_id
        and b.status = 'confirmed'
        and b.candidate_notice_key is not null
        and b.candidate_notice_sent_at is null
        and nullif(btrim(c.line_user_id), '') is not null
        and b.interview_date >= (timezone('Asia/Taipei', now()))::date
        and (
          b.candidate_notice_claimed_at is null
          or b.candidate_notice_claimed_at < now() - interval '3 minutes'
        )
      returning
        b.id,
        b.candidate_id,
        b.interview_date,
        b.start_time,
        b.end_time,
        b.director_id,
        b.director_label,
        b.candidate_notice_key,
        c.line_user_id,
        c.name,
        c.apply_city,
        c.interview_city
    )
    select json_agg(json_build_object(
      'id', id,
      'candidate_id', candidate_id,
      'interview_date', interview_date,
      'start_time', start_time,
      'end_time', end_time,
      'director_id', director_id,
      'director_label', director_label,
      'line_user_id', line_user_id,
      'name', name,
      'apply_city', apply_city,
      'interview_city', interview_city,
      'notice_key', candidate_notice_key
    ) order by interview_date, start_time, name)
    from claimed
  ), '[]'::json);
end;
$$;

create or replace function public.xinghong_mark_candidate_notice(p_booking_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.xinghong_bookings
  set candidate_notice_sent_at = now(),
      candidate_notice_sent_key = candidate_notice_key,
      candidate_notice_claimed_at = null
  where id = p_booking_id
    and candidate_notice_key is not null;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.xinghong_release_candidate_notice(p_booking_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.xinghong_bookings
  set candidate_notice_claimed_at = null
  where id = p_booking_id
    and candidate_notice_sent_at is null;
  return json_build_object('ok', true);
end;
$$;

grant execute on function public.xinghong_reschedule_bookings(uuid[], text, text, text, text, integer) to anon, authenticated, service_role;
grant execute on function public.xinghong_queue_candidate_notice(uuid) to anon, authenticated, service_role;

revoke all on function public.xinghong_claim_candidate_notices() from public, anon, authenticated;
revoke all on function public.xinghong_mark_candidate_notice(uuid) from public, anon, authenticated;
revoke all on function public.xinghong_release_candidate_notice(uuid) from public, anon, authenticated;
grant execute on function public.xinghong_claim_candidate_notices() to service_role;
grant execute on function public.xinghong_mark_candidate_notice(uuid) to service_role;
grant execute on function public.xinghong_release_candidate_notice(uuid) to service_role;
