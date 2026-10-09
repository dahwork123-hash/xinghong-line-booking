-- LINE binds are written by the webhook, so a staff page holding an older copy of the
-- schedule must not overwrite them when it saves. The stored bind always wins here;
-- staff unbind through xinghong_unbind_director_by_id instead.

create or replace function public.xinghong_save_schedule(p_value json)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  incoming jsonb := coalesce(p_value::jsonb, '{}'::jsonb);
  stored jsonb;
  next_dirs jsonb := '[]'::jsonb;
  item jsonb;
  prev jsonb;
begin
  select value::jsonb into stored from public.xinghong_settings where key = 'schedule';

  if jsonb_typeof(incoming->'directors') = 'array' then
    for item in select value from jsonb_array_elements(incoming->'directors')
    loop
      prev := null;
      if stored is not null and jsonb_typeof(stored->'directors') = 'array' then
        select d into prev
        from jsonb_array_elements(stored->'directors') d
        where d->>'id' = item->>'id'
        limit 1;
      end if;
      if prev is not null then
        item := item || jsonb_build_object(
          'notifyLine', coalesce(prev->>'notifyLine', ''),
          'notifyLineName', coalesce(prev->>'notifyLineName', ''),
          'bindCode', coalesce(nullif(prev->>'bindCode', ''), item->>'bindCode', '')
        );
      end if;
      next_dirs := next_dirs || jsonb_build_array(item);
    end loop;
    incoming := jsonb_set(incoming, '{directors}', next_dirs);
  end if;

  insert into public.xinghong_settings(key, value)
  values ('schedule', incoming::text)
  on conflict (key) do update set value = excluded.value;

  return json_build_object(
    'ok', true,
    'directors', coalesce(incoming->'directors', '[]'::jsonb)
  );
end;
$$;

create or replace function public.xinghong_unbind_director_by_id(p_id text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  sched jsonb;
  next_dirs jsonb := '[]'::jsonb;
  item jsonb;
begin
  select value::jsonb into sched from public.xinghong_settings where key = 'schedule';
  if sched is null then
    return json_build_object('ok', false);
  end if;
  for item in select value from jsonb_array_elements(coalesce(sched->'directors', '[]'::jsonb))
  loop
    if item->>'id' = p_id then
      item := item || jsonb_build_object('notifyLine', '', 'notifyLineName', '');
    end if;
    next_dirs := next_dirs || jsonb_build_array(item);
  end loop;
  sched := jsonb_set(sched, '{directors}', next_dirs);
  update public.xinghong_settings set value = sched::text where key = 'schedule';
  return json_build_object('ok', true);
end;
$$;

grant execute on function public.xinghong_save_schedule(json) to anon, authenticated, service_role;
grant execute on function public.xinghong_unbind_director_by_id(text) to anon, authenticated, service_role;
