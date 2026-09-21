-- 004: per-selection quantity
--
-- Lets someone say "I had 1 of the 2 Cokes" instead of only "I had some Coke".
--
-- NULL means an IMPLICIT claim: "I had some of this, share it with the others
-- who also tapped it". That is exactly how every selection behaves today, so
-- every existing row keeps working unchanged — no backfill needed.
-- A number means an EXPLICIT claim for that many units (decimals allowed, e.g.
-- 0.5 for half a portion).
--
-- Independent of the RLS work in 002/003 — can run before or after.

alter table public.selections
  add column if not exists qty numeric;

comment on column public.selections.qty is
  'Units of the item claimed. NULL = share the remainder equally with other untagged claimers.';
