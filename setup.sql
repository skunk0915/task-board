-- タスクボード DB セットアップ
-- さくらレンサバの phpMyAdmin 等で実行してください

CREATE TABLE IF NOT EXISTS projects (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  name      VARCHAR(255) NOT NULL,
  color     VARCHAR(7)   NOT NULL DEFAULT '#4A90D9',
  position  INT          NOT NULL DEFAULT 0,
  created_at TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tasks (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  project_id  INT          NOT NULL,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  start_date  DATE,
  end_date    DATE,
  progress    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  position    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_tasks_project ON tasks(project_id);
