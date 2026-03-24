-- status カラム → progress カラムへの移行
-- phpMyAdmin 等で実行してください（既存DBがある場合のみ）

ALTER TABLE tasks
  DROP COLUMN status,
  ADD COLUMN progress TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER end_date;
