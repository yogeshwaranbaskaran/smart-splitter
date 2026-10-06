-- 006: let the split creator pick items on behalf of other members,
--      and let those members push back.
--
-- WHY: waiting for five people to each tap their items is the slowest part of
-- a split, and one person who never opens the link stalls it for everyone. The
-- creator usually knows who ate what, so let them assign it and have the others
-- correct it if it is wrong. Assignment can never strand a split, because it is
-- complete the moment the creator finishes.
--
-- assigned_by  NULL  = this person picked it themselves (every existing row).
--              text  = username of the creator who picked it FOR them.
-- disputed     the assigned person says this is wrong. It is shown to the whole
--              group but DELIBERATELY DOES NOT BLOCK FINALIZE: a dispute that
--              blocks is just stranding with a nicer name. The creator decides.
-- dispute_note optional "I didn't have the eggs" from the disputer.
--
-- Backwards compatible: existing rows get assigned_by NULL and disputed false,
-- which is exactly today's behaviour.

alter table public.selections
  add column if not exists assigned_by  text,
  add column if not exists disputed     boolean not null default false,
  add column if not exists dispute_note text;

comment on column public.selections.assigned_by is
  'Username of the creator who picked this for someone else. NULL = self-picked.';
comment on column public.selections.disputed is
  'The assigned person disagrees. Shown to everyone; does not block finalize.';

-- Finding "what is assigned to me" and "what is disputed on this split" are both
-- per-split lookups the summary does on every load.
create index if not exists selections_split_disputed_idx
  on public.selections (split_id) where disputed;
