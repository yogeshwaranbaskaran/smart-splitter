-- 003: the actual lockdown. THIS IS THE STEP THAT CAN BREAK THINGS.
--
-- Prerequisites, in order:
--   1. 002_helper_functions.sql has been run
--   2. JoinGroup.jsx (using rpc('group_preview')) is DEPLOYED to production
--
-- Rollback: 003_rollback.sql
-- ============================================================
-- 2. DROP THE OLD `using (true)` POLICIES
-- ============================================================
-- Done by loop because the old policy names were never written down.
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


-- ============================================================
-- 3. GROUPS
-- ============================================================
alter table public.groups enable row level security;

-- Read: members (or invitees) only, plus the creator.
-- The creator clause matters for more than ownership: Home.jsx does
-- `.insert(...).select()`, and Postgres applies the SELECT policy to the
-- RETURNING row. Without it, creating a group returns nothing and the very
-- next insert (adding yourself as a member) has no group id to use.
create policy "groups_select_linked" on public.groups
for select to authenticated
using (
  public.has_group_link(id)
  or created_by = (auth.jwt() ->> 'email')
);

create policy "groups_insert_authenticated" on public.groups
for insert to authenticated
with check (created_by = (auth.jwt() ->> 'email'));

-- Rename / change currency: any accepted member, matching current app behaviour.
create policy "groups_update_members" on public.groups
for update to authenticated
using      (public.is_group_member(id))
with check (public.is_group_member(id));

-- No DELETE policy on purpose: delete-group is not built yet, so nothing can
-- delete a group. Add one when that feature lands.


-- ============================================================
-- 4. GROUP_MEMBERS   <-- this is the table that was leaking emails
-- ============================================================
alter table public.group_members enable row level security;

-- Read: your own rows (so pending invites show on Home), plus everyone in a
-- group you actually belong to.
create policy "group_members_select" on public.group_members
for select to authenticated
using (
  user_id = auth.uid()
  or public.is_group_member(group_id)
);

-- Write: add YOURSELF (creating a group, or joining via share link — both are
-- intentional), or invite someone else to a group you are already in.
create policy "group_members_insert" on public.group_members
for insert to authenticated
with check (
  user_id = auth.uid()
  or public.is_group_member(group_id)
);

-- Accept / decline an invite: only ever your own row.
create policy "group_members_update_self" on public.group_members
for update to authenticated
using      (user_id = auth.uid())
with check (user_id = auth.uid());

-- Leave a group: only your own row. Nobody can remove anybody else.
create policy "group_members_delete_self" on public.group_members
for delete to authenticated
using (user_id = auth.uid());


-- ============================================================
-- 5. SETTLEMENTS
-- ============================================================
alter table public.settlements enable row level security;

-- Settle-up is entirely a group activity, so one rule covers every command.
create policy "settlements_members_all" on public.settlements
for all to authenticated
using      (public.is_group_member(group_id))
with check (public.is_group_member(group_id));


-- ============================================================
-- 6. VERIFY
-- ============================================================
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('groups', 'group_members', 'settlements')
order by tablename, cmd;
