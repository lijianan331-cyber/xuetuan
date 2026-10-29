-- Optional post title on the existing footprint/review entity.
alter table public.visits add column if not exists title text constraint visits_title_length check (char_length(title) <= 80);
notify pgrst, 'reload schema';
