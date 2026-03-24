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

        $taskMap = [];
        foreach ($tasks as $t) {
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
        $name  = trim($input['name']);
        $color = preg_match($validColors, $input['color'] ?? '') ? $input['color'] : '#4A90D9';
        $pos   = (int)$pdo->query("SELECT COALESCE(MAX(position),0)+1 FROM projects")->fetchColumn();
        $stmt  = $pdo->prepare("INSERT INTO projects (name,color,position) VALUES (?,?,?)");
        $stmt->execute([$name, $color, $pos]);
        echo json_encode(['id' => (int)$pdo->lastInsertId()]);
        break;

    case 'update_project':
        if ($err = requireFields($input, ['id','name'])) { badReq($err); break; }
        $id    = (int)$input['id'];
        $name  = trim($input['name']);
        $color = preg_match($validColors, $input['color'] ?? '') ? $input['color'] : '#4A90D9';
        $pdo->prepare("UPDATE projects SET name=?,color=? WHERE id=?")->execute([$name, $color, $id]);
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
        $pid    = (int)$input['project_id'];
        $name   = trim($input['name']);
        $desc   = trim($input['description'] ?? '');
        $start    = validDate($input['start_date'] ?? '');
        $end      = validDate($input['end_date'] ?? '');
        $progress = max(0, min(100, (int)($input['progress'] ?? 0)));
        $maxStmt  = $pdo->prepare("SELECT COALESCE(MAX(position),0)+1 FROM tasks WHERE project_id=?");
        $maxStmt->execute([$pid]);
        $pos = (int)$maxStmt->fetchColumn();
        $pdo->prepare("INSERT INTO tasks (project_id,name,description,start_date,end_date,progress,position) VALUES (?,?,?,?,?,?,?)")
            ->execute([$pid, $name, $desc, $start, $end, $progress, $pos]);
        echo json_encode(['id' => (int)$pdo->lastInsertId()]);
        break;

    case 'update_task':
        if ($err = requireFields($input, ['id','name'])) { badReq($err); break; }
        $id     = (int)$input['id'];
        $name   = trim($input['name']);
        $desc   = trim($input['description'] ?? '');
        $start    = validDate($input['start_date'] ?? '');
        $end      = validDate($input['end_date'] ?? '');
        $progress = max(0, min(100, (int)($input['progress'] ?? 0)));
        $pdo->prepare("UPDATE tasks SET name=?,description=?,start_date=?,end_date=?,progress=? WHERE id=?")
            ->execute([$name, $desc, $start, $end, $progress, $id]);
        echo json_encode(['ok' => true]);
        break;

    case 'delete_task':
        $id = (int)($input['id'] ?? 0);
        if (!$id) { badReq('id required'); break; }
        $pdo->prepare("DELETE FROM tasks WHERE id=?")->execute([$id]);
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
