-- Staff pages loaded before directors had a branch office send directors without
-- branchId; keep the stored one instead of wiping it on their next save.

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
        if not (item ? 'branchId') and prev ? 'branchId' then
          item := item || jsonb_build_object('branchId', prev->'branchId');
        end if;
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
