-- 收藏一直存不上（2026-11-02）：插入检查里查 places，places 的读取规则又查 wishlist，数据库报“规则无限递归”。
-- place_id 已有外键保证地点存在，这里只查是不是自己。
alter policy "wishlist: insert own" on public.wishlist with check (user_id = (select auth.uid()));
