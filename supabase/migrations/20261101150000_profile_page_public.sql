-- 个人主页开关：默认关，用户在“我的”里打开后别人才能点进他的主页
-- （主页上只显示他已分享到大地图的记录）。
alter table public.profiles add column if not exists page_public boolean not null default false;
grant update (page_public) on public.profiles to authenticated;
