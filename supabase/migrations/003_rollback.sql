-- ROLLBACK for 002.
--
-- Run this if locking down the policies breaks the app for you or your friends.
-- It restores the previous permissive state: RLS on, but every rule allows
-- everything. That re-opens the email leak, so treat it as a temporary undo
-- while you debug, not a resting place.

do $$
declare r record;
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('groups', 'group_members', 'settlements')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "groups_open"        on public.groups        for all using (true) with check (true);
create policy "group_members_open" on public.group_members for all using (true) with check (true);
create policy "settlements_open"   on public.settlements   for all using (true) with check (true);

-- The helper functions are harmless to leave in place; drop them only if you
-- want a completely clean slate:
-- drop function if exists public.is_group_member(uuid);
-- drop function if exists public.has_group_link(uuid);
-- drop function if exists public.group_preview(uuid);
