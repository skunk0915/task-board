-- v3 マイグレーション: 所要時間・作業計画機能
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimated_hours DECIMAL(5,1) DEFAULT NULL COMMENT '所要予定時間(h)';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS actual_hours DECIMAL(5,1) DEFAULT 0 COMMENT '累積作業時間(h)';

CREATE TABLE IF NOT EXISTS daily_plans (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  plan_date     DATE NOT NULL,
  available_hours DECIMAL(5,1) NOT NULL DEFAULT 8.0,
  UNIQUE KEY uk_date (plan_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS daily_task_plans (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  plan_date     DATE NOT NULL,
  task_id       INT NOT NULL,
  planned_hours DECIMAL(5,1) NOT NULL DEFAULT 1.0,
  sort_order    INT NOT NULL DEFAULT 0,
  UNIQUE KEY uk_date_task (plan_date, task_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
