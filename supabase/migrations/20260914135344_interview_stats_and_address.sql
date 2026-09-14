create index if not exists xinghong_bookings_status_date_idx
  on public.xinghong_bookings (status, interview_date);

create or replace function public.xinghong_interview_stats(p_from date, p_to date)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d0 date;
  d1 date;
  tmp date;
begin
  d0 := coalesce(p_from, (timezone('Asia/Taipei', now()))::date - 29);
  d1 := coalesce(p_to, (timezone('Asia/Taipei', now()))::date);
  if d1 < d0 then
    tmp := d0;
    d0 := d1;
    d1 := tmp;
  end if;
  if d1 > d0 + 365 then
    d1 := d0 + 365;
  end if;

  return json_build_object(
    'from', d0,
    'to', d1,
    'people', (
      select count(distinct b.candidate_id)
      from public.xinghong_bookings b
      where b.status = 'confirmed'
        and b.interview_date >= d0
        and b.interview_date <= d1
    ),
    'sessions', (
      select count(*)
      from public.xinghong_bookings b
      where b.status = 'confirmed'
        and b.interview_date >= d0
        and b.interview_date <= d1
    ),
    'days', coalesce((
      select json_agg(json_build_object(
        'date', gs.ts::date,
        'people', coalesce(x.people, 0),
        'sessions', coalesce(x.sessions, 0)
      ) order by gs.ts)
      from generate_series(d0::timestamp, d1::timestamp, interval '1 day') as gs(ts)
      left join (
        select
          b.interview_date,
          count(distinct b.candidate_id)::int as people,
          count(*)::int as sessions
        from public.xinghong_bookings b
        where b.status = 'confirmed'
          and b.interview_date >= d0
          and b.interview_date <= d1
        group by b.interview_date
      ) x on x.interview_date = gs.ts::date
    ), '[]'::json),
    'cities', coalesce((
      select json_agg(json_build_object(
        'city', y.city,
        'people', y.people,
        'sessions', y.sessions
      ) order by y.sessions desc, y.city)
      from (
        select
          coalesce(nullif(btrim(c.apply_city), ''), '未填') as city,
          count(distinct b.candidate_id)::int as people,
          count(*)::int as sessions
        from public.xinghong_bookings b
        join public.xinghong_candidates c on c.id = b.candidate_id
        where b.status = 'confirmed'
          and b.interview_date >= d0
          and b.interview_date <= d1
        group by 1
      ) y
    ), '[]'::json)
  );
end;
$$;

grant execute on function public.xinghong_interview_stats(date, date) to anon, authenticated, service_role;
