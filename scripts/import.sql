-- 把 poi-data 分支的地点文件导入 poi 表（在 Supabase 的 SQL Editor 里整段运行）
-- 已经有的 id 会跳过，重复运行也没关系。导完会删掉临时开的 http 扩展。
create extension if not exists http with schema extensions;
select extensions.http_set_curlopt('CURLOPT_TIMEOUT', '120');

insert into public.poi (id, name, alt_name, mode, cat, lat, lng, locality, confidence)
select c[1], c[2], c[3], c[4], c[5], c[6]::float8, c[7]::float8, c[8], c[9]::real
from unnest(array['sg-000', 'jp-000', 'jp-001', 'jp-002', 'jp-003', 'th-000', 'th-001']) as f(name),
  lateral extensions.http_get('https://raw.githubusercontent.com/lijianan331-cyber/xuetuan/poi-data/data/' || f.name || '.tsv') as r,
  lateral regexp_split_to_table(r.content, E'\n') as line,
  lateral (select string_to_array(line, E'\t') as c) as x
where r.status = 200 and line <> '' and array_length(c, 1) = 9
on conflict (id) do nothing;

drop extension http;
analyze public.poi;

-- 核对：马来西亚 266,098 + 这次 273,307，一共应该是 539,405
select count(*) as total,
       count(*) filter (where lat > 7.5 and lng < 101) as thailand,
       count(*) filter (where lng > 129) as japan
from public.poi;
