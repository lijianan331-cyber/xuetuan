-- 新记录在界面上必须打分；但本地版 v1 的旧记录可能没分，上传时允许为空
alter table public.visits alter column rating drop not null;
