-- User requested original 10-second videos up to 30 MiB.
-- Change only the existing bucket size; keep privacy, MIME types and RLS intact.
update storage.buckets
set file_size_limit = 31457280
where id = 'photos';
