-- 001: delete the legacy ungrouped splits
--
-- Context: 61 splits have group_id IS NULL. They are leftovers from before
-- groups existed (v1/v2). Last one created 2026-06; none in July or August.
-- Decision (2026-08-05): delete them.
--
-- BACKED UP FIRST to Projects/smart-splitter/backups/ungrouped-splits-backup.json
-- (61 splits, 344 items, 369 selections). Do not run this without that file.
--
-- Run the SELECTs first and check the numbers match the backup before deleting.

-- ---------- 1. verify what is about to go ----------
select
  (select count(*) from splits where group_id is null)                                     as splits_to_delete,
  (select count(*) from items where split_id in (select id from splits where group_id is null))      as items_to_delete,
  (select count(*) from selections where split_id in (select id from splits where group_id is null)) as selections_to_delete;
-- expect: 61 | 344 | 369


-- ---------- 2. delete, children first ----------
-- Wrapped in a transaction: if any statement fails, nothing is deleted.
-- Order matters — selections reference items/splits, items reference splits.
begin;

delete from selections
where split_id in (select id from splits where group_id is null);

delete from items
where split_id in (select id from splits where group_id is null);

delete from splits
where group_id is null;

commit;


-- ---------- 3. confirm ----------
select
  (select count(*) from splits where group_id is null) as ungrouped_splits_left,  -- expect 0
  (select count(*) from splits)                        as splits_total,           -- expect 21
  (select count(*) from items)                         as items_total,            -- expect 98
  (select count(*) from selections)                    as selections_total;       -- expect 192
