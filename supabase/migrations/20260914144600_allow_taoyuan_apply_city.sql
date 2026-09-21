-- Staff UI and LINE already offer 桃園; the check constraint still listed the older five cities only.
-- Saving 桃園 then failed, so confirm messages kept using 台中.

alter table public.xinghong_candidates
  drop constraint if exists xinghong_candidates_apply_city_check;

alter table public.xinghong_candidates
  add constraint xinghong_candidates_apply_city_check
  check (apply_city = any (array['新竹'::text, '桃園'::text, '台中'::text, '彰化'::text, '嘉義'::text, '南投'::text]));
