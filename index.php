<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>タスクボード</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>

<header class="app-header">
  <div class="header-left">
    <span class="header-icon">📋</span>
    <h1 class="app-title">タスクボード</h1>
  </div>
  <button class="btn btn-primary" id="addProjectBtn">＋ プロジェクト追加</button>
</header>

<main class="board" id="board">
  <div class="board-loading" id="boardLoading">
    <div class="spinner"></div>
    <span>読み込み中...</span>
  </div>
</main>

<!-- ====== プロジェクトモーダル ====== -->
<div class="modal-overlay" id="projectModal">
  <div class="modal">
    <div class="modal-header">
      <h2 id="projectModalTitle">プロジェクト追加</h2>
      <button class="modal-close" id="closeProjectModal">✕</button>
    </div>
    <div class="modal-body">
      <input type="hidden" id="projectId">
      <div class="form-group">
        <label for="projectName">プロジェクト名 <span class="required">*</span></label>
        <input type="text" id="projectName" placeholder="例: Webサイトリニューアル" maxlength="100">
      </div>
      <div class="form-group">
        <label>カラー</label>
        <div class="color-picker" id="colorPicker">
          <div class="color-opt" data-color="#4A90D9" style="background:#4A90D9" title="ブルー"></div>
          <div class="color-opt" data-color="#E74C3C" style="background:#E74C3C" title="レッド"></div>
          <div class="color-opt" data-color="#2ECC71" style="background:#2ECC71" title="グリーン"></div>
          <div class="color-opt" data-color="#9B59B6" style="background:#9B59B6" title="パープル"></div>
          <div class="color-opt" data-color="#F39C12" style="background:#F39C12" title="オレンジ"></div>
          <div class="color-opt" data-color="#1ABC9C" style="background:#1ABC9C" title="ティール"></div>
          <div class="color-opt" data-color="#E91E63" style="background:#E91E63" title="ピンク"></div>
          <div class="color-opt" data-color="#607D8B" style="background:#607D8B" title="グレー"></div>
        </div>
        <input type="hidden" id="projectColor" value="#4A90D9">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="cancelProjectModal">キャンセル</button>
      <button class="btn btn-primary" id="saveProject">保存</button>
    </div>
  </div>
</div>

<!-- ====== タスクモーダル ====== -->
<div class="modal-overlay" id="taskModal">
  <div class="modal modal-wide">
    <div class="modal-header">
      <h2 id="taskModalTitle">タスク追加</h2>
      <button class="modal-close" id="closeTaskModal">✕</button>
    </div>
    <div class="modal-body">
      <input type="hidden" id="taskId">
      <input type="hidden" id="taskProjectId">
      <div class="form-group">
        <label for="taskName">タスク名 <span class="required">*</span></label>
        <input type="text" id="taskName" placeholder="例: デザイン案作成" maxlength="200">
      </div>
      <div class="form-group">
        <label for="taskDescription">詳細</label>
        <textarea id="taskDescription" rows="4" placeholder="タスクの詳細を入力..."></textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="taskStartDate">開始日</label>
          <input type="date" id="taskStartDate">
        </div>
        <div class="form-group">
          <label for="taskEndDate">終了日</label>
          <input type="date" id="taskEndDate">
        </div>
      </div>
      <div class="form-group">
        <label for="taskProgress">進捗 <span id="taskProgressLabel">0</span>%</label>
        <input type="range" id="taskProgress" min="0" max="100" step="5" value="0">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-danger" id="deleteTaskBtn" style="display:none;margin-right:auto">🗑 削除</button>
      <button class="btn btn-secondary" id="cancelTaskModal">キャンセル</button>
      <button class="btn btn-primary" id="saveTaskBtn">保存</button>
    </div>
  </div>
</div>

<!-- ====== 削除確認モーダル ====== -->
<div class="modal-overlay" id="confirmModal">
  <div class="modal modal-sm">
    <div class="modal-header">
      <h2 id="confirmTitle">確認</h2>
    </div>
    <div class="modal-body">
      <p id="confirmMessage"></p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="confirmCancel">キャンセル</button>
      <button class="btn btn-danger" id="confirmOk">削除</button>
    </div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js"></script>
<script src="app.js"></script>
</body>
</html>
