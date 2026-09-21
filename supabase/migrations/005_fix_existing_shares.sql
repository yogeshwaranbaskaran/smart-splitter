-- 005: one-off repair of selections.share
--
-- THE BUG: SplitView used to save `share: item.price` — the WHOLE line price —
-- on every picker's row. SplitView's own summary hid this because it divided by
-- the number of pickers at render time, but GroupView.getBalances() reads
-- `share` straight out of the row. So a 300 dish shared by 3 people was counted
-- as 300 owed by EACH of them: 900 of debt on a 300 item.
--
-- Fixed going forward in SplitView.recomputeShares(). This repairs old rows.
--
-- THE MATHS: every existing row has qty IS NULL, i.e. an implicit claim. With
-- all claims implicit, splitmath gives each claimer  quantity/N  units at
-- price/quantity each, which reduces to simply  price / N.  Same number the UI
-- was already showing, now actually stored.
--
-- RUN 004 FIRST (this references the qty column).
-- Backup taken: backups/selections-pre-share-fix.json
--
-- SAFETY: only rows with item_id IS NOT NULL are touched. That deliberately
-- leaves alone:
--   * manual/GPay splits  — item_id NULL and share IS the agreed amount
--   * "nothing here is mine" markers — item_id NULL, share 0


-- ---------- 1. look before you leap ----------
-- How many rows are wrong, and by how much.
with claim_counts as (
  select item_id, count(*)::numeric as n
  from selections
  where item_id is not null
  group by item_id
)
select
  count(*)                                                       as rows_to_change,
  round(sum(s.share), 2)                                         as current_total,
  round(sum(round(i.price / cc.n, 2)), 2)                        as corrected_total
from selections s
join items i         on i.id = s.item_id
join claim_counts cc on cc.item_id = s.item_id
where s.item_id is not null
  and s.qty is null
  and s.share is distinct from round(i.price / cc.n, 2);


-- ---------- 2. the repair ----------
begin;

with claim_counts as (
  select item_id, count(*)::numeric as n
  from selections
  where item_id is not null
  group by item_id
)
update selections s
set share = round(i.price / cc.n, 2)
from items i, claim_counts cc
where i.id       = s.item_id
  and cc.item_id = s.item_id
  and s.item_id is not null
  and s.qty is null;

commit;


-- ---------- 3. verify ----------
-- For every scan split, what people owe in total should now equal the value of
-- the items that somebody actually claimed. Any row here with a mismatch means
-- something is off — send it to me rather than pushing on.
select
  s.split_id,
  round(sum(s.share), 2)                      as sum_of_shares,
  round((
    select coalesce(sum(i2.price), 0)
    from items i2
    where i2.split_id = s.split_id
      and exists (select 1 from selections x where x.item_id = i2.id)
  ), 2)                                       as value_of_claimed_items
from selections s
where s.item_id is not null
group by s.split_id
having abs(round(sum(s.share), 2) - round((
    select coalesce(sum(i2.price), 0)
    from items i2
    where i2.split_id = s.split_id
      and exists (select 1 from selections x where x.item_id = i2.id)
  ), 2)) > 0.10
order by s.split_id;
-- Zero rows expected.
--
-- The 0.10 tolerance is for rounding, not sloppiness: an item split 3 ways
-- cannot divide exactly (200/3 = 66.67 x 3 = 200.01), and a split with several
-- such items accumulates a few paise. Dry-run against the backup showed 54 of
-- 57 splits reconciling exactly and 3 off by 0.04-0.06, all from 3-way divisions.
-- Anything larger than 0.10 is a real problem — stop and investigate.
