-- 2026-11-06 已随 20261106100000 一起执行。前端在没有这一列时不写 halal。
-- 清真标记（用户 2026-11-03）：每条记录可选 清真 / 无猪肉 / 非清真，空 = 没说。
-- 只加一列和它的更新权限；已有数据、归属和可见性策略都不动。
alter table public.visits add column if not exists halal text
  check (halal is null or halal in ('halal','porkfree','nonhalal'));
grant update (halal) on public.visits to authenticated;
notify pgrst, 'reload schema';
