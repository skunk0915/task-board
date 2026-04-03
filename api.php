<?php
header('Content-Type: application/json; charset=utf-8');

// 未捕捉例外を JSON で返す
set_exception_handler(function (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
});

require_once __DIR__ . '/config.php';

// DB接続
try {
    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s', DB_HOST, DB_NAME, DB_CHARSET);
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'DB接続失敗: ' . $e->getMessage()]);
    exit;
}

// ── 自動マイグレーション ────────────────────────────────
(function() use ($pdo) {
    // projects: status
    $cols = $pdo->query("SHOW COLUMNS FROM projects")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('status', $cols)) {
        $pdo->exec("ALTER TABLE projects ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active'");
    }

    // tasks: estimated_hours / actual_hours / is_done
    $cols = $pdo->query("SHOW COLUMNS FROM tasks")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('estimated_hours', $cols)) {
        $pdo->exec("ALTER TABLE tasks ADD COLUMN estimated_hours DECIMAL(5,1) DEFAULT NULL");
    }
    if (!in_array('actual_hours', $cols)) {
        $pdo->exec("ALTER TABLE tasks ADD COLUMN actual_hours DECIMAL(5,1) DEFAULT 0");
    }
    if (!in_array('is_done', $cols)) {
        $pdo->exec("ALTER TABLE tasks ADD COLUMN is_done TINYINT(1) NOT NULL DEFAULT 0");
    }
    // daily_plans
    $pdo->exec("CREATE TABLE IF NOT EXISTS daily_plans (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        plan_date       DATE NOT NULL,
        available_hours DECIMAL(5,1) NOT NULL DEFAULT 8.0,
        UNIQUE KEY uk_date (plan_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    // daily_task_plans
    $pdo->exec("CREATE TABLE IF NOT EXISTS daily_task_plans (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        plan_date     DATE NOT NULL,
        task_id       INT NOT NULL,
        planned_hours DECIMAL(5,1) NOT NULL DEFAULT 1.0,
        sort_order    INT NOT NULL DEFAULT 0,
        UNIQUE KEY uk_date_task (plan_date, task_id),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    // task_daily_logs
    $pdo->exec("CREATE TABLE IF NOT EXISTS task_daily_logs (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        task_id      INT NOT NULL,
        log_date     DATE NOT NULL,
        hours_spent  DECIMAL(5,1) NOT NULL DEFAULT 0.0,
        progress_pct INT NOT NULL DEFAULT 0,
        UNIQUE KEY uk_task_date (task_id, log_date),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
})();

// 入力
$input  = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $_GET['action'] ?? ($input['action'] ?? '');

// バリデーションヘルパー
function requireFields(array $data, array $fields): ?string {
    foreach ($fields as $f) {
        if (!isset($data[$f]) || (is_string($data[$f]) && trim($data[$f]) === '')) {
            return "Missing field: $f";
        }
    }
    return null;
}

$validColors = '/^#[0-9A-Fa-f]{6}$/';

switch ($action) {

    // ── 全取得 ──────────────────────────────────────────
    case 'get_all':
        $projects = $pdo->query("SELECT * FROM projects ORDER BY position, id")->fetchAll();
        $tasks    = $pdo->query("SELECT * FROM tasks    ORDER BY position, id")->fetchAll();
        $logs     = $pdo->query("SELECT * FROM task_daily_logs ORDER BY log_date ASC, id ASC")->fetchAll();

        $logMap = [];
        foreach ($logs as $l) {
            $l['id']           = (int)$l['id'];
            $l['task_id']      = (int)$l['task_id'];
            $l['hours_spent']  = (float)$l['hours_spent'];
            $l['progress_pct'] = (int)$l['progress_pct'];
            $logMap[$l['task_id']][] = $l;
        }

        $taskMap = [];
        foreach ($tasks as $t) {
            $t['logs'] = $logMap[$t['id']] ?? [];
            $taskMap[$t['project_id']][] = $t;
        }
        foreach ($projects as &$p) {
            $p['tasks'] = $taskMap[$p['id']] ?? [];
        }
        echo json_encode(['projects' => $projects]);
        break;

    // ── プロジェクト CRUD ────────────────────────────────
    case 'create_project':
        if ($err = requireFields($input, ['name'])) { badReq($err); break; }
        $name   = trim($input['name']);
        $color  = preg_match($validColors, $input['color'] ?? '') ? $input['color'] : '#4A90D9';
        $status = $input['status'] ?? 'active';
        $pos    = (int)$pdo->query("SELECT COALESCE(MAX(position),0)+1 FROM projects")->fetchColumn();
        $stmt   = $pdo->prepare("INSERT INTO projects (name,color,position,status) VALUES (?,?,?,?)");
        $stmt->execute([$name, $color, $pos, $status]);
        echo json_encode(['id' => (int)$pdo->lastInsertId()]);
        break;

    case 'update_project':
        if ($err = requireFields($input, ['id','name'])) { badReq($err); break; }
        $id     = (int)$input['id'];
        $name   = trim($input['name']);
        $color  = preg_match($validColors, $input['color'] ?? '') ? $input['color'] : '#4A90D9';
        $status = $input['status'] ?? 'active';
        $pdo->prepare("UPDATE projects SET name=?,color=?,status=? WHERE id=?")->execute([$name, $color, $status, $id]);
        echo json_encode(['ok' => true]);
        break;

    case 'delete_project':
        $id = (int)($input['id'] ?? 0);
        if (!$id) { badReq('id required'); break; }
        $pdo->prepare("DELETE FROM projects WHERE id=?")->execute([$id]);
        echo json_encode(['ok' => true]);
        break;

    case 'update_project_order':
        $order = $input['order'] ?? [];
        if (!is_array($order)) { badReq('order must be array'); break; }
        $stmt = $pdo->prepare("UPDATE projects SET position=? WHERE id=?");
        foreach ($order as $pos => $pid) {
            $stmt->execute([$pos, (int)$pid]);
        }
        echo json_encode(['ok' => true]);
        break;

    // ── タスク CRUD ──────────────────────────────────────
    case 'create_task':
        if ($err = requireFields($input, ['project_id','name'])) { badReq($err); break; }
        $pid      = (int)$input['project_id'];
        $name     = trim($input['name']);
        $desc     = trim($input['description'] ?? '');
        $start    = validDate($input['start_date'] ?? '');
        $end      = validDate($input['end_date'] ?? '');
        $progress = max(0, min(100, (int)($input['progress'] ?? 0)));
        $estH     = (isset($input['estimated_hours']) && $input['estimated_hours'] !== '')
                    ? max(0, (float)$input['estimated_hours']) : null;
        $actH     = max(0, (float)($input['actual_hours'] ?? 0));
        $maxStmt  = $pdo->prepare("SELECT COALESCE(MAX(position),0)+1 FROM tasks WHERE project_id=?");
        $maxStmt->execute([$pid]);
        $pos = (int)$maxStmt->fetchColumn();
        $pdo->prepare("INSERT INTO tasks (project_id,name,description,start_date,end_date,progress,position,estimated_hours,actual_hours) VALUES (?,?,?,?,?,?,?,?,?)")
            ->execute([$pid, $name, $desc, $start, $end, $progress, $pos, $estH, $actH]);
        echo json_encode(['id' => (int)$pdo->lastInsertId()]);
        break;

    case 'update_task':
        if ($err = requireFields($input, ['id','name'])) { badReq($err); break; }
        $id       = (int)$input['id'];
        $name     = trim($input['name']);
        $desc     = trim($input['description'] ?? '');
        $start    = validDate($input['start_date'] ?? '');
        $end      = validDate($input['end_date'] ?? '');
        $progress = max(0, min(100, (int)($input['progress'] ?? 0)));
        $estH     = (isset($input['estimated_hours']) && $input['estimated_hours'] !== '')
                    ? max(0, (float)$input['estimated_hours']) : null;
        $actH     = max(0, (float)($input['actual_hours'] ?? 0));
        $pdo->prepare("UPDATE tasks SET name=?,description=?,start_date=?,end_date=?,progress=?,estimated_hours=?,actual_hours=? WHERE id=?")
            ->execute([$name, $desc, $start, $end, $progress, $estH, $actH, $id]);
        echo json_encode(['ok' => true]);
        break;

    case 'toggle_task_done':
        $id     = (int)($input['id'] ?? 0);
        $isDone = isset($input['is_done']) ? ((int)$input['is_done'] ? 1 : 0) : 0;
        if (!$id) { badReq('id required'); break; }
        $pdo->prepare("UPDATE tasks SET is_done=? WHERE id=?")->execute([$isDone, $id]);
        echo json_encode(['ok' => true]);
        break;

    case 'delete_task':
        $id = (int)($input['id'] ?? 0);
        if (!$id) { badReq('id required'); break; }
        $pdo->prepare("DELETE FROM tasks WHERE id=?")->execute([$id]);
        echo json_encode(['ok' => true]);
        break;

    case 'save_daily_log':
        if ($err = requireFields($input, ['task_id', 'log_date'])) { badReq($err); break; }
        $tid   = (int)$input['task_id'];
        $date  = validDate($input['log_date']);
        $hours = max(0, (float)($input['hours_spent'] ?? 0));
        $pct   = max(0, min(100, (int)($input['progress_pct'] ?? 0)));
        if (!$date) { badReq('invalid date'); break; }

        $pdo->prepare("INSERT INTO task_daily_logs (task_id, log_date, hours_spent, progress_pct) VALUES (?,?,?,?)
                       ON DUPLICATE KEY UPDATE hours_spent=?, progress_pct=?")
            ->execute([$tid, $date, $hours, $pct, $hours, $pct]);
        
        // タスクの合計実績時間と進捗を更新
        $pdo->prepare("UPDATE tasks SET 
            actual_hours = (SELECT SUM(hours_spent) FROM task_daily_logs WHERE task_id=?),
            progress = ?
            WHERE id=?")
            ->execute([$tid, $pct, $tid]);
            
        echo json_encode(['ok' => true]);
        break;

    case 'update_task_order':
        $pid   = (int)($input['project_id'] ?? 0);
        $order = $input['order'] ?? [];
        if (!$pid || !is_array($order)) { badReq('invalid'); break; }
        $stmt = $pdo->prepare("UPDATE tasks SET position=? WHERE id=? AND project_id=?");
        foreach ($order as $pos => $tid) {
            $stmt->execute([$pos, (int)$tid, $pid]);
        }
        echo json_encode(['ok' => true]);
        break;

    // ── 今日の作業計画 ─────────────────────────────────────
    case 'get_daily_plan':
        $date = validDate($_GET['date'] ?? '');
        if (!$date) $date = date('Y-m-d');
        $stmt = $pdo->prepare("SELECT available_hours FROM daily_plans WHERE plan_date=?");
        $stmt->execute([$date]);
        $plan = $stmt->fetch();
        $available = $plan ? (float)$plan['available_hours'] : 8.0;
        $stmt = $pdo->prepare("
            SELECT dtp.task_id, dtp.planned_hours, dtp.sort_order,
                   t.name, t.progress, t.estimated_hours, t.actual_hours, t.project_id
            FROM daily_task_plans dtp
            JOIN tasks t ON t.id = dtp.task_id
            WHERE dtp.plan_date = ?
            ORDER BY dtp.sort_order, dtp.id
        ");
        $stmt->execute([$date]);
        $taskPlans = $stmt->fetchAll();
        foreach ($taskPlans as &$tp) {
            $tp['task_id']        = (int)$tp['task_id'];
            $tp['planned_hours']  = (float)$tp['planned_hours'];
            $tp['progress']       = (int)$tp['progress'];
            $tp['estimated_hours']= $tp['estimated_hours'] !== null ? (float)$tp['estimated_hours'] : null;
            $tp['actual_hours']   = (float)($tp['actual_hours'] ?? 0);
            $tp['project_id']     = (int)$tp['project_id'];
        }
        echo json_encode(['date' => $date, 'available_hours' => $available, 'task_plans' => $taskPlans]);
        break;

    case 'save_daily_available_hours':
        $date  = validDate($input['date'] ?? '');
        if (!$date) { badReq('invalid date'); break; }
        $hours = max(0.5, min(24, (float)($input['available_hours'] ?? 8)));
        $pdo->prepare("INSERT INTO daily_plans (plan_date,available_hours) VALUES (?,?) ON DUPLICATE KEY UPDATE available_hours=?")
            ->execute([$date, $hours, $hours]);
        echo json_encode(['ok' => true]);
        break;

    case 'add_task_to_daily_plan':
        $date   = validDate($input['date'] ?? '');
        $taskId = (int)($input['task_id'] ?? 0);
        $hours  = max(0.5, min(24, (float)($input['planned_hours'] ?? 1)));
        if (!$date || !$taskId) { badReq('invalid params'); break; }
        $stmt = $pdo->prepare("SELECT COALESCE(MAX(sort_order),0)+1 FROM daily_task_plans WHERE plan_date=?");
        $stmt->execute([$date]);
        $sortOrd = (int)$stmt->fetchColumn();
        $pdo->prepare("INSERT INTO daily_task_plans (plan_date,task_id,planned_hours,sort_order) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE planned_hours=?")
            ->execute([$date, $taskId, $hours, $sortOrd, $hours]);
        echo json_encode(['ok' => true]);
        break;

    case 'remove_task_from_daily_plan':
        $date   = validDate($input['date'] ?? '');
        $taskId = (int)($input['task_id'] ?? 0);
        if (!$date || !$taskId) { badReq('invalid params'); break; }
        $pdo->prepare("DELETE FROM daily_task_plans WHERE plan_date=? AND task_id=?")->execute([$date, $taskId]);
        echo json_encode(['ok' => true]);
        break;

    case 'update_daily_task_hours':
        $date   = validDate($input['date'] ?? '');
        $taskId = (int)($input['task_id'] ?? 0);
        $hours  = max(0.5, min(24, (float)($input['planned_hours'] ?? 1)));
        if (!$date || !$taskId) { badReq('invalid params'); break; }
        $pdo->prepare("UPDATE daily_task_plans SET planned_hours=? WHERE plan_date=? AND task_id=?")
            ->execute([$hours, $date, $taskId]);
        echo json_encode(['ok' => true]);
        break;

    case 'update_daily_plan_order':
        $date  = validDate($input['date'] ?? '');
        $order = $input['order'] ?? [];
        if (!$date || !is_array($order)) { badReq('invalid'); break; }
        $stmt = $pdo->prepare("UPDATE daily_task_plans SET sort_order=? WHERE plan_date=? AND task_id=?");
        foreach ($order as $pos => $tid) {
            $stmt->execute([$pos, $date, (int)$tid]);
        }
        echo json_encode(['ok' => true]);
        break;

    default:
        http_response_code(400);
        echo json_encode(['error' => 'Unknown action: ' . htmlspecialchars($action)]);
}

function badReq(string $msg): void {
    http_response_code(400);
    echo json_encode(['error' => $msg]);
}

function validDate(string $s): ?string {
    if (!$s) return null;
    return preg_match('/^\d{4}-\d{2}-\d{2}$/', $s) ? $s : null;
}
