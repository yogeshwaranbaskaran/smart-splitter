-- 008: a real thread on a dispute, instead of one note and one reply.
--
-- 006 gave the member dispute_note and 007 gave the creator dispute_reply.
-- That is exactly one round trip: the moment the member wants to answer the
-- answer, there is nowhere to put it. Two text columns are not a conversation,
-- so the thread moves to its own table.
--
-- A thread is keyed by (split_id, about_user): "the discussion about what
-- Ravi was assigned". Anyone in the split can post to it, because the person
-- who actually ate the item is often neither the creator nor the disputer.
--
-- selections.disputed STAYS as the flag: it is what the summary highlights and
-- what only the disputer can clear. The messages are the discussion around it.
-- dispute_note / dispute_reply are left in place but no longer written to.
--
-- RLS is open here, matching every other table in this database. It gets
-- tightened with the rest in the RLS batch (002/003), not piecemeal.

create table if not exists public.split_messages (
  id         uuid primary key default gen_random_uuid(),
  split_id   uuid not null references public.splits(id) on delete cascade,
  about_user text not null,
  author     text not null,
  body       text not null,
  created_at timestamptz not null default now()
);

create index if not exists split_messages_thread_idx
  on public.split_messages (split_id, about_user, created_at);

alter table public.split_messages enable row level security;

drop policy if exists split_messages_open on public.split_messages;
create policy split_messages_open on public.split_messages
  for all using (true) with check (true);
