-- Store interview city/office separately from apply city, for 南投 routing and extra offices.

alter table public.xinghong_candidates
  add column if not exists interview_city text not null default '',
  add column if not exists interview_office_id text not null default '';

drop function if exists public.xinghong_touch_line(text, text, text, text, text, text, boolean, json, boolean);

create or replace function public.xinghong_touch_line(
  p_line_user_id text,
  p_line_name text,
  p_job text default null,
  p_apply_city text default null,
  p_phone text default null,
  p_name text default null,
  p_job_picked boolean default null,
  p_pending json default null,
  p_clear_pending boolean default false,
  p_interview_city text default null,
  p_interview_office_id text default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  cid uuid;
  display_name text;
begin
  if nullif(btrim(coalesce(p_line_user_id, '')), '') is null then
    raise exception 'MISSING_LINE_USER';
  end if;
  display_name := coalesce(nullif(btrim(p_line_name), ''), 'LINE面試者');

  select id into cid
  from public.xinghong_candidates
  where line_user_id = btrim(p_line_user_id)
  limit 1;

  if cid is null then
    insert into public.xinghong_candidates(
      name, phone, job, apply_city, source, notes, line_user_id, line_name,
      line_name_picked, line_job_picked, line_pending, interview_city, interview_office_id
    )
    values (
      coalesce(nullif(btrim(p_name), ''), display_name),
      coalesce(nullif(btrim(p_phone), ''), ''),
      coalesce(nullif(p_job, ''), '社宅顧問'),
      coalesce(nullif(p_apply_city, ''), '台中'),
      '其他',
      '',
      btrim(p_line_user_id),
      display_name,
      nullif(btrim(p_name), '') is not null,
      coalesce(p_job_picked, false),
      case when p_clear_pending then null else p_pending::jsonb end,
      coalesce(nullif(btrim(coalesce(p_interview_city, '')), ''), ''),
      coalesce(nullif(btrim(coalesce(p_interview_office_id, '')), ''), '')
    )
    returning id into cid;
  else
    update public.xinghong_candidates
    set line_name = display_name,
        name = case
          when nullif(btrim(p_name), '') is not null then btrim(p_name)
          when name in ('', 'LINE面試者') then display_name
          else name
        end,
        line_name_picked = case
          when nullif(btrim(p_name), '') is not null then true
          else line_name_picked
        end,
        job = coalesce(nullif(p_job, ''), job),
        line_job_picked = case
          when p_job_picked is true then true
          else line_job_picked
        end,
        apply_city = coalesce(nullif(p_apply_city, ''), apply_city),
        interview_city = case
          when p_interview_city is null then interview_city
          else btrim(p_interview_city)
        end,
        interview_office_id = case
          when p_interview_office_id is null then interview_office_id
          else btrim(p_interview_office_id)
        end,
        phone = case
          when nullif(btrim(coalesce(p_phone, '')), '') is null then phone
          else btrim(p_phone)
        end,
        line_pending = case
          when p_clear_pending then null
          when p_pending is not null then p_pending::jsonb
          else line_pending
        end,
        updated_at = now()
    where id = cid;
  end if;

  update public.xinghong_candidates
  set line_profile_ok = (
        line_name_picked
        and phone ~ '^09[0-9]{8}$'
        and line_job_picked
      )
  where id = cid;

  return json_build_object('id', cid);
end;
$$;

grant execute on function public.xinghong_touch_line(text, text, text, text, text, text, boolean, json, boolean, text, text) to anon, authenticated, service_role;

-- Seat counts follow where the applicant actually interviews (南投 applicants sit in 台中 or 彰化).
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

  select coalesce(nullif(interview_city, ''), apply_city) into city
  from public.xinghong_candidates where id = cid;
  select count(*) into taken
  from public.xinghong_bookings b
  join public.xinghong_candidates c on c.id = b.candidate_id
  where b.status = 'confirmed'
    and b.interview_date = p_date
    and b.start_time = p_start
    and coalesce(nullif(c.interview_city, ''), c.apply_city) = city;
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
