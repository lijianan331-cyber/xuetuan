-- 动图和 5 秒以内的短视频（用户 2026-10-28）：photos 桶除了 jpg 也收 gif / mp4 / webm / mov。
-- 单个文件仍然最多 5MB；视频在手机上先重录成 720p 再传。
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']
where id = 'photos';
