-- 007: let the creator answer a dispute.
--
-- A dispute was one-directional: the member said "this is wrong" and the only
-- reply was outside the app. Now the creator can answer in place.
--
-- WHO CLEARS IT: the person who raised it, by tapping "These are mine" or by
-- editing their own items. The creator deliberately CANNOT delete someone
-- else's objection. They already control the amounts (edit, finalize, reopen);
-- letting them also erase the complaint would make the record dishonest, and
-- the rule here is owner-decides-the-numbers, dissenters-keep-their-version.

alter table public.selections
  add column if not exists dispute_reply text;

comment on column public.selections.dispute_reply is
  'Creator''s answer to a dispute. Only the disputer can clear the dispute itself.';
