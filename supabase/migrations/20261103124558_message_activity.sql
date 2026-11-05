-- Unified activity reminders. Existing posts, comments, photos and visibility stay unchanged.
begin;
create table xuetuan_guard.message_activity(
 seq bigint generated always as identity primary key,
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 sender_id uuid not null references public.profiles(id) on delete cascade,
 event_type text not null check(event_type in('like','comment','reply')),
 visit_id uuid not null references public.visits(id) on delete cascade,
 comment_id uuid references xuetuan_guard.post_comments(id) on delete cascade,
 created_at timestamptz default now(),is_read boolean not null default false,
 check(recipient_id<>sender_id),check((event_type='like')=(comment_id is null)));
create unique index message_activity_like on xuetuan_guard.message_activity(recipient_id,sender_id,visit_id) where event_type='like';
create unique index message_activity_comment on xuetuan_guard.message_activity(recipient_id,comment_id) where comment_id is not null;
create index message_activity_page on xuetuan_guard.message_activity(recipient_id,seq desc);
create index message_activity_unread on xuetuan_guard.message_activity(recipient_id,seq desc) where not is_read;
create index message_activity_sender on xuetuan_guard.message_activity(sender_id);
create index message_activity_visit on xuetuan_guard.message_activity(visit_id);
create index message_activity_target on xuetuan_guard.message_activity(comment_id);
alter table xuetuan_guard.message_activity enable row level security;
revoke all on xuetuan_guard.message_activity from public,anon,authenticated;

create function xuetuan_guard.activity_capture() returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid;parent_owner uuid;
begin
 if tg_table_name='post_likes' then
  if tg_op='DELETE' then
   delete from xuetuan_guard.message_activity where event_type='like' and sender_id=old.user_id and visit_id=old.visit_id;return old;
  end if;
  select user_id into owner_id from public.visits where id=new.visit_id and visibility='public';
  if owner_id is not null and owner_id<>new.user_id then
   insert into xuetuan_guard.message_activity(recipient_id,sender_id,event_type,visit_id) values(owner_id,new.user_id,'like',new.visit_id) on conflict do nothing;
  end if;
 else
  select user_id into owner_id from public.visits where id=new.visit_id and visibility='public';
  if owner_id is null or new.deleted then return new;end if;
  select user_id into parent_owner from xuetuan_guard.post_comments where id=new.parent_id;
  insert into xuetuan_guard.message_activity(recipient_id,sender_id,event_type,visit_id,comment_id,created_at)
   select recipient,new.user_id,case when recipient=parent_owner then 'reply' else 'comment' end,new.visit_id,new.id,new.created_at
   from(select owner_id recipient union select parent_owner) people where recipient is not null and recipient<>new.user_id on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function xuetuan_guard.activity_capture() from public,anon,authenticated;
create trigger message_activity_likes after insert or delete on xuetuan_guard.post_likes for each row execute function xuetuan_guard.activity_capture();
create trigger message_activity_comments after insert on xuetuan_guard.post_comments for each row execute function xuetuan_guard.activity_capture();

-- Historical records are readable but already read. Like times were not recorded, so never invent one.
insert into xuetuan_guard.message_activity(recipient_id,sender_id,event_type,visit_id,created_at,is_read)
 select v.user_id,l.user_id,'like',v.id,null,true from xuetuan_guard.post_likes l join public.visits v on v.id=l.visit_id
 where v.visibility='public' and v.user_id<>l.user_id on conflict do nothing;
insert into xuetuan_guard.message_activity(recipient_id,sender_id,event_type,visit_id,comment_id,created_at,is_read)
 select people.recipient,c.user_id,case when people.recipient=parent.user_id then 'reply' else 'comment' end,c.visit_id,c.id,c.created_at,true
 from xuetuan_guard.post_comments c join public.visits v on v.id=c.visit_id
 left join xuetuan_guard.post_comments parent on parent.id=c.parent_id
 cross join lateral(select v.user_id recipient union select parent.user_id) people
 where v.visibility='public' and not c.deleted and people.recipient is not null and people.recipient<>c.user_id on conflict do nothing;

create function xuetuan_guard.activity_user() returns uuid language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid();begin
 if viewer is null or not exists(select 1 from auth.users where id=viewer) then raise exception using errcode='42501',message='Login required';end if;
 return viewer;
end $$;
revoke all on function xuetuan_guard.activity_user() from public,anon,authenticated;

create function xuetuan_guard.activity_rows() returns table(seq bigint,event_type text,visit_id uuid,comment_id uuid,created_at timestamptz,is_read boolean,title text,body text,name text)
language sql stable security invoker set search_path='' as $$
 select a.seq,a.event_type,a.visit_id,a.comment_id,a.created_at,a.is_read,
  coalesce(nullif(v.title,''),nullif(left(v.text,80),''),p.name),c.body,case when a.event_type='like' then null else author.name end
 from xuetuan_guard.message_activity a join public.visits v on v.id=a.visit_id and v.visibility='public'
 join public.places p on p.id=v.place_id
 left join xuetuan_guard.post_comments c on c.id=a.comment_id
 left join public.profiles author on author.id=a.sender_id
 where a.recipient_id=auth.uid() and (a.event_type='like' or (c.id is not null and not c.deleted))
$$;
revoke all on function xuetuan_guard.activity_rows() from public,anon,authenticated;

create function xuetuan_guard.activity_inbox(kind text,before_seq bigint) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=xuetuan_guard.activity_user();items jsonb;unread_likes bigint;unread_comments bigint;watermark bigint;n integer;
begin
 if kind is null or kind not in('summary','likes','comments') then raise exception 'Invalid activity kind';end if;
 select count(distinct visit_id) filter(where event_type='like' and not is_read),
  count(*) filter(where event_type<>'like' and not is_read),coalesce(max(seq),0)
 into unread_likes,unread_comments,watermark from xuetuan_guard.activity_rows();
 if kind='summary' then return jsonb_build_object('likes',unread_likes,'comments',unread_comments,'watermark',watermark);end if;
 with grouped as(
  select max(a.seq) seq,'like'::text event_type,a.visit_id,null::uuid comment_id,max(a.created_at) created_at,bool_and(a.is_read) is_read,a.title,null::text body,null::text name,count(*) total
   from xuetuan_guard.activity_rows() a where kind='likes' and a.event_type='like' group by a.visit_id,a.title
  union all
  select a.seq,a.event_type,a.visit_id,a.comment_id,a.created_at,a.is_read,a.title,a.body,a.name,1::bigint total
   from xuetuan_guard.activity_rows() a where kind='comments' and a.event_type<>'like'
 ),page as(select * from grouped where before_seq is null or seq<before_seq order by seq desc limit 31),numbered as(select *,row_number() over(order by seq desc) rn from page)
 select coalesce(jsonb_agg(to_jsonb(numbered)-'rn' order by seq desc) filter(where rn<=30),'[]'::jsonb),count(*) into items,n from numbered;
 return jsonb_build_object('rows',items,'has_more',n>30,'likes',unread_likes,'comments',unread_comments,'watermark',watermark);
end $$;
create function xuetuan_guard.activity_seen(kind text,through_seq bigint,target_visit uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare viewer uuid:=xuetuan_guard.activity_user();begin
 if kind is null or kind not in('likes','comments') or through_seq is null or through_seq<0 then raise exception 'Invalid read position';end if;
 update xuetuan_guard.message_activity a set is_read=true
  where a.recipient_id=viewer and a.seq<=through_seq and not a.is_read
   and ((kind='likes' and a.event_type='like') or (kind='comments' and a.event_type<>'like'))
   and (target_visit is null or (a.visit_id=target_visit and (kind='likes' or a.seq=through_seq)))
   and exists(select 1 from xuetuan_guard.activity_rows() shown where shown.seq=a.seq);
 return jsonb_build_object('ok',true,'available',target_visit is null or exists(select 1 from xuetuan_guard.activity_rows() shown where shown.visit_id=target_visit and shown.seq=through_seq));
end $$;
revoke all on function xuetuan_guard.activity_inbox(text,bigint),xuetuan_guard.activity_seen(text,bigint,uuid) from public,anon,authenticated;
grant execute on function xuetuan_guard.activity_inbox(text,bigint),xuetuan_guard.activity_seen(text,bigint,uuid) to authenticated;
create function public.xuetuan_activity_inbox(kind text default 'summary',before_seq bigint default null) returns jsonb language sql security invoker set search_path='' as $$select xuetuan_guard.activity_inbox(kind,before_seq)$$;
create function public.xuetuan_activity_seen(kind text,through_seq bigint,visit_id uuid default null) returns jsonb language sql security invoker set search_path='' as $$select xuetuan_guard.activity_seen(kind,through_seq,visit_id)$$;
revoke all on function public.xuetuan_activity_inbox(text,bigint),public.xuetuan_activity_seen(text,bigint,uuid) from public,anon,authenticated;
grant execute on function public.xuetuan_activity_inbox(text,bigint),public.xuetuan_activity_seen(text,bigint,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
