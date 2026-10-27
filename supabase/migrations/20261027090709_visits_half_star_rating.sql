-- 评分可以打半颗星：0、0.5、1 … 5（原来是 0–5 的整数）
alter table public.visits alter column rating type numeric(2,1);
alter table public.visits add constraint visits_rating_half check (rating * 2 = trunc(rating * 2));
