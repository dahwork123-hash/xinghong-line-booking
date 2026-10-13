alter table public.xinghong_candidates
  add column if not exists human_requested_at timestamptz,
  add column if not exists human_message text not null default '',
  add column if not exists human_kind text not null default '';

update public.xinghong_candidates
set human_requested_at = updated_at,
    human_kind = 'question'
where line_mode = 'human'
  and human_requested_at is null;

create or replace function public.xinghong_request_human(
  p_line_user_id text,
  p_line_name text,
  p_message text,
  p_kind text
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  cid uuid;
begin
  perform public.xinghong_touch_line(p_line_user_id, p_line_name, null, null, null);
  update public.xinghong_candidates
  set human_requested_at = now(),
      human_message = left(coalesce(p_message, ''), 300),
      human_kind = case when p_kind in ('contact', 'question') then p_kind else 'question' end,
      updated_at = now()
  where line_user_id = btrim(p_line_user_id)
  returning id into cid;
  return json_build_object('id', cid);
end;
$$;

create or replace function public.xinghong_resolve_human(p_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.xinghong_candidates
  set human_requested_at = null,
      human_message = '',
      human_kind = '',
      line_mode = 'auto',
      updated_at = now()
  where id = p_id;
  return json_build_object('ok', found);
end;
$$;

revoke execute on function public.xinghong_request_human(text, text, text, text) from public, anon, authenticated;
grant execute on function public.xinghong_request_human(text, text, text, text) to service_role;
grant execute on function public.xinghong_resolve_human(uuid) to anon, authenticated, service_role;
