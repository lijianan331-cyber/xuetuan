-- The shared unauthenticated SQL role is read-only. Anonymous app accounts use authenticated.
-- Keep SELECT and all existing row ownership/visibility policies unchanged.
revoke all on public.visits from anon;
grant select on public.visits to anon;
