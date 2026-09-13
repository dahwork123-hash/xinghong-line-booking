-- Combined LINE conversation: human pause, profile touch, cancel by LINE id.
alter table public.xinghong_candidates
  add column if not exists line_mode text not null default 'auto';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'xinghong_candidates_line_mode_check'
  ) then
    alter table public.xinghong_candidates
      add constraint xinghong_candidates_line_mode_check
      check (line_mode in ('auto', 'human'));
  end if;
end $$;

create unique index if not exists xinghong_candidates_line_user_id_uidx
  on public.xinghong_candidates (line_user_id)
  where line_user_id is not null and btrim(line_user_id) <> '';

create or replace function public.xinghong_touch_line(
  p_line_user_id text,
  p_line_name text,
  p_job text default null,
  p_apply_city text default null,
  p_phone text default null
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
    insert into public.xinghong_candidates(name, phone, job, apply_city, source, notes, line_user_id, line_name)
    values (
      display_name,
      coalesce(nullif(btrim(p_phone), ''), ''),
      coalesce(nullif(p_job, ''), '社宅顧問'),
      coalesce(nullif(p_apply_city, ''), '台中'),
      '其他',
      '',
      btrim(p_line_user_id),
      display_name
    )
    returning id into cid;
  else
    update public.xinghong_candidates
    set line_name = display_name,
        name = case when name in ('', 'LINE面試者') then display_name else name end,
        job = coalesce(nullif(p_job, ''), job),
        apply_city = coalesce(nullif(p_apply_city, ''), apply_city),
        phone = case
          when nullif(btrim(coalesce(p_phone, '')), '') is null then phone
          else btrim(p_phone)
        end,
        updated_at = now()
    where id = cid;
  end if;

  return json_build_object('id', cid);
end;
$$;

create or replace function public.xinghong_set_line_mode(
  p_line_user_id text,
  p_mode text,
  p_line_name text default ''
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  cid uuid;
begin
  if p_mode not in ('auto', 'human') then
    raise exception 'INVALID_MODE';
  end if;
  perform public.xinghong_touch_line(p_line_user_id, p_line_name, null, null, null);
  update public.xinghong_candidates
  set line_mode = p_mode, updated_at = now()
  where line_user_id = btrim(p_line_user_id)
  returning id into cid;
  return json_build_object('id', cid, 'line_mode', p_mode);
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
  update public.xinghong_bookings b
  set status = 'cancelled', updated_at = now()
  from public.xinghong_candidates c
  where c.id = b.candidate_id
    and c.line_user_id = btrim(p_line_user_id)
    and b.status = 'confirmed'
    and b.interview_date >= (timezone('Asia/Taipei', now()))::date;
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'cancelled', n);
end;
$$;

grant execute on function public.xinghong_touch_line(text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.xinghong_set_line_mode(text, text, text) to anon, authenticated, service_role;
grant execute on function public.xinghong_cancel_by_line(text) to anon, authenticated, service_role;
