-- Run read-only as the project owner. Aggregate operational metrics, no user content.
select now() measured_at,pg_database_size(current_database()) database_bytes,
 (select sum(pg_total_relation_size(c.oid)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r') app_table_bytes,
 (select count(*) from storage.objects where bucket_id='photos') media_objects,
 (select coalesce(sum((metadata->>'size')::bigint),0) from storage.objects where bucket_id='photos') media_bytes;
select relname,n_live_tup estimated_rows,n_dead_tup dead_rows,seq_scan,idx_scan,last_analyze,last_autoanalyze
from pg_stat_user_tables where schemaname='public' and relname in ('visits','places','profiles','homes','wishlist');
select numbackends,xact_commit,xact_rollback,deadlocks,temp_bytes,blks_read,blks_hit
from pg_stat_database where datname=current_database();
-- Review these in the provider dashboard too: API 5xx / P95 latency, DB CPU,
-- disk growth, storage and egress against the project's actual configured quota.
