-- 地点所在国家的两位代码（人均显示哪种货币用，界面上不显示国家名）。2026-11-02
alter table public.places add column if not exists cc text check (cc is null or cc ~ '^[A-Z]{2}$');
