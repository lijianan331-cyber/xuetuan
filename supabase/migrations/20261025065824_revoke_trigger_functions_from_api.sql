-- 这几个只给触发器用，不需要通过 API 调用
revoke execute on function public.drop_empty_place() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
