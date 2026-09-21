-- Bind director LINE accounts, collect applicant name/phone/job, and notify
-- that director on book / day-before / two-hours-before.

alter table public.xinghong_candidates
  add column if not exists line_name_picked boolean not null default false,
  add column if not exists line_job_picked boolean not null default false,
  add column if not exists line_profile_ok boolean not null default false,
  add column if not exists line_pending jsonb;

alter table public.xinghong_bookings
  add column if not exists director_booked_notified_at timestamptz,
  add column if not exists director_day_notified_at timestamptz,
  add column if not exists director_2h_notified_at timestamptz;

update public.xinghong_candidates
set
  line_name_picked = true,
  line_job_picked = true,
  line_profile_ok = true
where char_length(btrim(name)) >= 2
  and name <> 'LINE面試者'
  and phone ~ '^09[0-9]{8}$'
  and job = any (array['社宅顧問'::text, '儲備主管'::text, '行政職'::text]);

drop function if exists public.xinghong_touch_line(text, text, text, text, text);

create or replace function public.xinghong_touch_line(
  p_line_user_id text,
  p_line_name text,
  p_job text default null,
  p_apply_city text default null,
  p_phone text default null,
  p_name text default null,
  p_job_picked boolean default null,
  p_pending json default null,
  p_clear_pending boolean default false
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
      line_name_picked, line_job_picked, line_pending
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
      case when p_clear_pending then null else p_pending::jsonb end
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

create or replace function public.xinghong_save_candidate(
  p_id uuid,
  p_name text,
  p_phone text,
  p_job text,
  p_apply_city text,
  p_source text,
  p_notes text,
  p_line_user_id text default null,
  p_line_name text default ''
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  rid uuid;
  line_id text;
  filled boolean;
begin
  line_id := nullif(btrim(coalesce(p_line_user_id, '')), '');
  filled := char_length(btrim(p_name)) >= 2
    and coalesce(trim(p_phone), '') ~ '^09[0-9]{8}$'
    and p_job = any (array['社宅顧問'::text, '儲備主管'::text, '行政職'::text]);
  if p_id is null then
    insert into public.xinghong_candidates(
      name, phone, job, apply_city, source, notes, line_user_id, line_name,
      line_name_picked, line_job_picked, line_profile_ok
    )
    values (
      trim(p_name),
      coalesce(trim(p_phone), ''),
      p_job,
      p_apply_city,
      p_source,
      coalesce(p_notes, ''),
      line_id,
      coalesce(trim(p_line_name), ''),
      true,
      true,
      filled
    )
    returning id into rid;
  else
    update public.xinghong_candidates
    set name = trim(p_name),
        phone = coalesce(trim(p_phone), ''),
        job = p_job,
        apply_city = p_apply_city,
        source = p_source,
        notes = coalesce(p_notes, ''),
        line_user_id = line_id,
        line_name = coalesce(trim(p_line_name), ''),
        line_name_picked = true,
        line_job_picked = true,
        line_profile_ok = filled,
        updated_at = now()
    where id = p_id
    returning id into rid;
    if rid is null then
      raise exception 'NOT_FOUND';
    end if;
  end if;
  return json_build_object('id', rid);
end;
$$;

create or replace function public.xinghong_bind_director(
  p_code text,
  p_line_user_id text,
  p_line_name text
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  sched jsonb;
  dirs jsonb;
  next_dirs jsonb := '[]'::jsonb;
  item jsonb;
  matched boolean := false;
  label text := '';
begin
  if nullif(btrim(coalesce(p_line_user_id, '')), '') is null then
    raise exception 'MISSING_LINE_USER';
  end if;
  if coalesce(p_code, '') !~ '^\d{6}$' then
    raise exception 'BAD_CODE';
  end if;
  select value::jsonb into sched from public.xinghong_settings where key = 'schedule';
  if sched is null then
    raise exception 'NO_SCHEDULE';
  end if;
  dirs := coalesce(sched->'directors', '[]'::jsonb);
  for item in select value from jsonb_array_elements(dirs)
  loop
    if item->>'notifyLine' = btrim(p_line_user_id) then
      item := item || jsonb_build_object('notifyLine', '', 'notifyLineName', '');
    end if;
    if item->>'bindCode' = p_code then
      item := item || jsonb_build_object(
        'notifyLine', btrim(p_line_user_id),
        'notifyLineName', coalesce(nullif(btrim(p_line_name), ''), '')
      );
      matched := true;
      label := concat_ws(' ', nullif(item->>'unit', ''), item->>'name');
    end if;
    next_dirs := next_dirs || jsonb_build_array(item);
  end loop;
  if not matched then
    raise exception 'CODE_NOT_FOUND';
  end if;
  sched := jsonb_set(sched, '{directors}', next_dirs);
  update public.xinghong_settings set value = sched::text where key = 'schedule';
  return json_build_object('ok', true, 'label', label);
end;
$$;

create or replace function public.xinghong_unbind_director(p_line_user_id text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  sched jsonb;
  dirs jsonb;
  next_dirs jsonb := '[]'::jsonb;
  item jsonb;
  n integer := 0;
begin
  if nullif(btrim(coalesce(p_line_user_id, '')), '') is null then
    raise exception 'MISSING_LINE_USER';
  end if;
  select value::jsonb into sched from public.xinghong_settings where key = 'schedule';
  if sched is null then
    return json_build_object('ok', true, 'cleared', 0);
  end if;
  dirs := coalesce(sched->'directors', '[]'::jsonb);
  for item in select value from jsonb_array_elements(dirs)
  loop
    if item->>'notifyLine' = btrim(p_line_user_id) then
      item := item || jsonb_build_object('notifyLine', '', 'notifyLineName', '');
      n := n + 1;
    end if;
    next_dirs := next_dirs || jsonb_build_array(item);
  end loop;
  sched := jsonb_set(sched, '{directors}', next_dirs);
  update public.xinghong_settings set value = sched::text where key = 'schedule';
  return json_build_object('ok', true, 'cleared', n);
end;
$$;

create or replace function public.xinghong_due_director_notices()
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  sched jsonb;
  today date := (timezone('Asia/Taipei', now()))::date;
  tomorrow date := today + 1;
begin
  select value::jsonb into sched from public.xinghong_settings where key = 'schedule';
  return coalesce((
    select json_agg(row_to_json(x) order by x.kind, x.start_time, x.name)
    from (
      with dirs as (
        select
          d->>'id' as id,
          nullif(d->>'notifyLine', '') as notify_line,
          concat_ws(' ', nullif(d->>'unit', ''), d->>'name') as label
        from jsonb_array_elements(coalesce(sched->'directors', '[]'::jsonb)) d
        where nullif(d->>'notifyLine', '') is not null
      ),
      base as (
        select
          b.id,
          b.candidate_id,
          b.interview_date,
          b.start_time,
          b.end_time,
          b.director_id,
          b.director_label,
          b.director_booked_notified_at,
          b.director_day_notified_at,
          b.director_2h_notified_at,
          b.created_at,
          c.name,
          c.phone,
          c.job,
          c.apply_city,
          c.line_name,
          d.notify_line,
          coalesce(nullif(b.director_label, ''), d.label) as notice_label,
          ((b.interview_date::text || ' ' || b.start_time)::timestamp at time zone 'Asia/Taipei') as starts_at
        from public.xinghong_bookings b
        join public.xinghong_candidates c on c.id = b.candidate_id
        join dirs d on d.id = b.director_id
        where b.status = 'confirmed'
      )
      select id, candidate_id, interview_date, start_time, end_time, director_id, notice_label as director_label,
             name, phone, job, apply_city, line_name, notify_line, 'booked'::text as kind
      from base
      where director_booked_notified_at is null
        and starts_at > now()
      union all
      select id, candidate_id, interview_date, start_time, end_time, director_id, notice_label,
             name, phone, job, apply_city, line_name, notify_line, 'day'
      from base
      where interview_date = tomorrow
        and director_day_notified_at is null
      union all
      select id, candidate_id, interview_date, start_time, end_time, director_id, notice_label,
             name, phone, job, apply_city, line_name, notify_line, 'twoh'
      from base
      where director_2h_notified_at is null
        and now() >= starts_at - interval '2 hours'
        and now() < starts_at
        and created_at < starts_at - interval '90 minutes'
    ) x
  ), '[]'::json);
end;
$$;

create or replace function public.xinghong_mark_director_notice(p_booking_id uuid, p_kind text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_kind = 'booked' then
    update public.xinghong_bookings
    set director_booked_notified_at = now(), updated_at = now()
    where id = p_booking_id and status = 'confirmed';
  elsif p_kind = 'day' then
    update public.xinghong_bookings
    set director_day_notified_at = now(), updated_at = now()
    where id = p_booking_id and status = 'confirmed';
  elsif p_kind = 'twoh' then
    update public.xinghong_bookings
    set director_2h_notified_at = now(), updated_at = now()
    where id = p_booking_id and status = 'confirmed';
  else
    raise exception 'BAD_KIND';
  end if;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  return json_build_object('ok', true);
end;
$$;

grant execute on function public.xinghong_touch_line(text, text, text, text, text, text, boolean, json, boolean) to anon, authenticated, service_role;
grant execute on function public.xinghong_save_candidate(uuid, text, text, text, text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.xinghong_bind_director(text, text, text) to anon, authenticated, service_role;
grant execute on function public.xinghong_unbind_director(text) to anon, authenticated, service_role;
grant execute on function public.xinghong_due_director_notices() to anon, authenticated, service_role;
grant execute on function public.xinghong_mark_director_notice(uuid, text) to anon, authenticated, service_role;
