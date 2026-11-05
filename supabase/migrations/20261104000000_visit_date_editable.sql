-- 编辑记录时能改日期（用户 2026-11-04：以前传的照片读不到拍摄时间，到访日期是上传那天）
grant update (created_at) on public.visits to authenticated;
