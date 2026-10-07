-- LINE and staff only offer 社宅顧問 and 儲備主管.

alter table public.xinghong_candidates
  drop constraint if exists xinghong_candidates_job_check;

alter table public.xinghong_candidates
  add constraint xinghong_candidates_job_check
  check (job = any (array['社宅顧問'::text, '儲備主管'::text]));

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
    and p_job = any (array['社宅顧問'::text, '儲備主管'::text]);
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
