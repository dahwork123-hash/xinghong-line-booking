-- Cancel removes the booking row instead of leaving a cancelled timeslot.
-- Reminders include apply_city so LINE can use that office's address.

create or replace function public.xinghong_cancel(p_booking_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  delete from public.xinghong_bookings
  where id = p_booking_id
    and status = 'confirmed';
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.xinghong_cancel_by_line(p_line_user_id text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer;
begin
  delete from public.xinghong_bookings b
  using public.xinghong_candidates c
  where c.id = b.candidate_id
    and c.line_user_id = btrim(p_line_user_id)
    and b.status = 'confirmed'
    and b.interview_date >= (timezone('Asia/Taipei', now()))::date;
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'cancelled', n);
end;
$$;

create or replace function public.xinghong_line_book(
  p_line_user_id text,
  p_line_name text,
  p_date date,
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
  cid uuid;
  cap integer;
  taken integer;
  bid uuid;
  display_name text;
begin
  if nullif(btrim(coalesce(p_line_user_id, '')), '') is null then
    raise exception 'MISSING_LINE_USER';
  end if;
  if p_end <= p_start then
    raise exception 'INVALID_TIME';
  end if;
  cap := greatest(1, least(coalesce(p_capacity, 5), 99));
  display_name := coalesce(nullif(btrim(p_line_name), ''), 'LINE面試者');

  select id into cid
  from public.xinghong_candidates
  where line_user_id = btrim(p_line_user_id)
  limit 1;

  if cid is null then
    insert into public.xinghong_candidates(name, phone, job, apply_city, source, notes, line_user_id, line_name)
    values (display_name, '', '社宅顧問', '台中', '其他', '', btrim(p_line_user_id), display_name)
    returning id into cid;
  else
    update public.xinghong_candidates
    set line_name = display_name,
        name = case when name in ('', 'LINE面試者') then display_name else name end,
        updated_at = now()
    where id = cid;
  end if;

  delete from public.xinghong_bookings
  where candidate_id = cid
    and status = 'confirmed'
    and interview_date >= (timezone('Asia/Taipei', now()))::date
    and not (interview_date = p_date and start_time = p_start);

  select id into bid
  from public.xinghong_bookings
  where candidate_id = cid
    and status = 'confirmed'
    and interview_date = p_date
    and start_time = p_start
  limit 1;

  if bid is not null then
    return json_build_object('id', bid, 'candidate_id', cid, 'changed', false);
  end if;

  select count(*) into taken
  from public.xinghong_bookings
  where status = 'confirmed'
    and interview_date = p_date
    and start_time = p_start;
  if taken >= cap then
    raise exception 'SLOT_FULL';
  end if;

  insert into public.xinghong_bookings(
    candidate_id, interview_date, start_time, end_time, director_id, director_label, status, booked_via
  ) values (
    cid, p_date, p_start, p_end, coalesce(p_director_id, ''), coalesce(p_director_label, ''), 'confirmed', 'line'
  ) returning id into bid;

  return json_build_object('id', bid, 'candidate_id', cid, 'changed', true);
end;
$$;

create or replace function public.xinghong_due_reminders()
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  tomorrow date := (timezone('Asia/Taipei', now()))::date + 1;
begin
  return coalesce((
    select json_agg(row_to_json(x) order by x.start_time, x.line_name)
    from (
      select
        b.id,
        b.candidate_id,
        b.interview_date,
        b.start_time,
        b.end_time,
        b.director_label,
        b.reminder_sent_at,
        c.name,
        c.line_name,
        c.line_user_id,
        c.phone,
        c.apply_city
      from public.xinghong_bookings b
      join public.xinghong_candidates c on c.id = b.candidate_id
      where b.status = 'confirmed'
        and b.interview_date = tomorrow
    ) x
  ), '[]'::json);
end;
$$;

delete from public.xinghong_bookings where status = 'cancelled';
