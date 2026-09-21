-- 002: helper functions only.
--
-- ADDITIVE AND SAFE. Creates functions; changes no policy and no data.
-- Run this FIRST, then deploy the JoinGroup.jsx change, THEN run 003.
-- Splitting it this way means the app keeps working at every step.
-- ============================================================
-- 1. HELPERS
-- ============================================================
-- A policy on group_members that queries group_members would recurse forever.
-- SECURITY DEFINER makes the function run as its owner, which skips RLS on the
-- inner query and breaks the loop. `set search_path` is required — without it a
-- caller could point `group_members` at their own table and hijack the check.

-- Accepted members only. Used for anything that changes data.
create or replace function public.is_group_member(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid
      and user_id  = auth.uid()
      and status   = 'accepted'
  );
$$;

-- Any link to the group, including a PENDING invite. Used only for reading the
-- group row, so an invitee can see the group's name before accepting.
create or replace function public.has_group_link(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid
      and user_id  = auth.uid()
  );
$$;

-- Share-link preview. JoinGroup.jsx must show "Join <name>?" to someone who is
-- NOT a member yet (and may not even be logged in). Rather than leaving the
-- whole groups table readable, this returns just id+name for ONE known uuid.
-- No filtering, no enumeration: you must already know the group's id.
create or replace function public.group_preview(gid uuid)
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select g.id, g.name from public.groups g where g.id = gid;
$$;

grant execute on function public.group_preview(uuid) to anon, authenticated;


