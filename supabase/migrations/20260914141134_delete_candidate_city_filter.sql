create or replace function public.xinghong_delete_candidate(p_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  delete from public.xinghong_candidates
  where id = p_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  return json_build_object('ok', true);
end;
$$;

grant execute on function public.xinghong_delete_candidate(uuid) to anon, authenticated, service_role;

create or replace function public.xinghong_assign(
  p_candidate_id uuid,
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
  taken integer;
  cap integer;
  bid uuid;
  city text;
begin
  if not exists (select 1 from public.xinghong_candidates where id = p_candidate_id) then
    raise exception 'NOT_FOUND';
  end if;
  cap := greatest(1, least(coalesce(p_capacity, 5), 99));
  if p_end <= p_start then
    raise exception 'INVALID_TIME';
  end if;
  if exists (
    select 1 from public.xinghong_bookings
    where candidate_id = p_candidate_id
      and status = 'confirmed'
      and interview_date >= (timezone('Asia/Taipei', now()))::date
  ) then
    raise exception 'ALREADY_BOOKED';
  end if;
  select apply_city into city from public.xinghong_candidates where id = p_candidate_id;
  select count(*) into taken
  from public.xinghong_bookings b
  join public.xinghong_candidates c on c.id = b.candidate_id
  where b.status = 'confirmed'
    and b.interview_date = p_date
    and b.start_time = p_start
    and c.apply_city = city;
  if taken >= cap then
    raise exception 'SLOT_FULL';
  end if;
  insert into public.xinghong_bookings(
    candidate_id, interview_date, start_time, end_time, director_id, director_label, status
  ) values (
    p_candidate_id, p_date, p_start, p_end, coalesce(p_director_id, ''), coalesce(p_director_label, ''), 'confirmed'
  ) returning id into bid;
  return json_build_object('id', bid);
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
  city text;
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

  select apply_city into city from public.xinghong_candidates where id = cid;
  select count(*) into taken
  from public.xinghong_bookings b
  join public.xinghong_candidates c on c.id = b.candidate_id
  where b.status = 'confirmed'
    and b.interview_date = p_date
    and b.start_time = p_start
    and c.apply_city = city;
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
