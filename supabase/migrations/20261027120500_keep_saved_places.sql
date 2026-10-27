-- 删掉最后一条记录时，还有人想去就留着地点；没人记录、也没人想去了才删
create or replace function public.drop_empty_place() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.visits where place_id = old.place_id)
     and not exists (select 1 from public.wishlist where place_id = old.place_id) then
    delete from public.places where id = old.place_id;
  end if;
  return null;
end $$;

create trigger wishlist_drop_empty_place after delete on public.wishlist
  for each row execute function public.drop_empty_place();

-- 收藏了的地点自己一直看得见（哪怕记录都删了）
alter policy "places: read if any visible visit" on public.places using (
  created_by = (select auth.uid())
  or exists (select 1 from public.visits v where v.place_id = places.id)
  or exists (select 1 from public.wishlist w where w.place_id = places.id and w.user_id = (select auth.uid()))
);

-- 只能收藏看得见的地点（不然知道 id 就能借收藏看到只有私密记录的地点）
alter policy "wishlist: insert own" on public.wishlist with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.places p where p.id = wishlist.place_id)
);
