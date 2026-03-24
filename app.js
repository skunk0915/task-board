'use strict';

/* ============================================================
   定数・設定
   ============================================================ */
const API = 'api.php';

// 進捗バーの色 (0-100)
function progressColor(pct) {
  if (pct === 100) return '#10b981'; // 完了: グリーン
  if (pct >= 60)  return '#3b82f6'; // 進行: ブルー
  if (pct >= 20)  return '#f59e0b'; // 序盤: アンバー
  if (pct > 0)    return '#94a3b8'; // 序盤: スレートグレー
  return '#e5e8ef';                  // 0%: 非表示（背景色と同色）
}

// ローカルストレージキー
const LS = {
  TASK_ORDER:   'tb_task_order',    // { [projectId]: [taskId, ...] }
  SORT_MODE:    'tb_sort_mode',     // { [projectId]: 'manual'|'date'|'status' }
  PROJECT_ORDER:'tb_project_order', // [projectId, ...]
};

/* ============================================================
   状態
   ============================================================ */
let projects   = [];      // サーバーから取得したデータ
let sortables  = {};      // SortableJS インスタンス

/* ============================================================
   ローカルストレージ ヘルパー
   ============================================================ */
const ls = {
  obj: (k)   => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } },
  arr: (k)   => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } },
  set: (k,v) => localStorage.setItem(k, JSON.stringify(v)),
};

/* ============================================================
   API ヘルパー
   ============================================================ */
async function api(data) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

async function apiGet(action) {
  const res = await fetch(`${API}?action=${action}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

/* ============================================================
   データ読み込み
   ============================================================ */
async function loadProjects() {
  const data = await apiGet('get_all');
  const raw  = data.projects || [];

  // プロジェクト順序を LS で上書き
  const pOrder = ls.arr(LS.PROJECT_ORDER);
  if (pOrder.length) {
    const map = Object.fromEntries(raw.map(p => [String(p.id), p]));
    const ordered = pOrder.map(id => map[String(id)]).filter(Boolean);
    raw.forEach(p => { if (!pOrder.includes(String(p.id))) ordered.push(p); });
    projects = ordered;
  } else {
    projects = raw;
  }

  render();
}

/* ============================================================
   タスク順序の取得
   ============================================================ */
function getOrderedTasks(projectId, tasks) {
  const modes   = ls.obj(LS.SORT_MODE);
  const mode    = modes[String(projectId)] || 'manual';

  if (mode === 'date') {
    return [...tasks].sort((a, b) => {
      if (!a.start_date && !b.start_date) return 0;
      if (!a.start_date) return 1;
      if (!b.start_date) return -1;
      return a.start_date.localeCompare(b.start_date);
    });
  }

  if (mode === 'status') {
    return [...tasks].sort((a, b) => (a.progress ?? 0) - (b.progress ?? 0));
  }

  // manual: LS の順序を適用
  const orders  = ls.obj(LS.TASK_ORDER);
  const order   = (orders[String(projectId)] || []).map(String);
  const taskMap = Object.fromEntries(tasks.map(t => [String(t.id), t]));
  const seen    = new Set();
  const result  = [];

  order.forEach(id => {
    if (taskMap[id]) { result.push(taskMap[id]); seen.add(id); }
  });
  tasks.forEach(t => { if (!seen.has(String(t.id))) result.push(t); });

  return result;
}

/* ============================================================
   ユーティリティ
   ============================================================ */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${y}/${m}/${day}`;
}

/* ============================================================
   レンダリング
   ============================================================ */
function render() {
  // 既存 Sortable を破棄
  Object.values(sortables).forEach(s => { try { s.destroy(); } catch {} });
  sortables = {};

  const board = document.getElementById('board');
  board.innerHTML = '';

  const modes = ls.obj(LS.SORT_MODE);

  projects.forEach(project => {
    const pid       = project.id;
    const mode      = modes[String(pid)] || 'manual';
    const tasks     = getOrderedTasks(pid, project.tasks || []);
    const colEl     = buildProjectCol(project, tasks, mode);
    board.appendChild(colEl);

    // タスクの SortableJS (手動のみ)
    if (mode === 'manual') {
      const listEl = colEl.querySelector('.task-list');
      sortables[`t${pid}`] = new Sortable(listEl, {
        animation:   150,
        ghostClass:  'sortable-ghost',
        dragClass:   'sortable-drag',
        handle:      '.task-drag-handle',
        filter:      '.task-empty',
        onEnd() {
          const ids   = [...listEl.querySelectorAll('.task-card')].map(el => el.dataset.tid);
          const store = ls.obj(LS.TASK_ORDER);
          store[String(pid)] = ids;
          ls.set(LS.TASK_ORDER, store);
          api({ action: 'update_task_order', project_id: pid, order: ids }).catch(() => {});
        },
      });
    }
  });

  // プロジェクトの SortableJS
  sortables['board'] = new Sortable(board, {
    animation:  200,
    ghostClass: 'sortable-ghost',
    handle:     '.proj-drag-handle',
    onEnd() {
      const ids = [...board.querySelectorAll('.project-col')].map(el => el.dataset.pid);
      ls.set(LS.PROJECT_ORDER, ids);
      api({ action: 'update_project_order', order: ids }).catch(() => {});
    },
  });
}

function buildProjectCol(project, tasks, mode) {
  const pid = project.id;
  const col = document.createElement('div');
  col.className   = 'project-col';
  col.dataset.pid = pid;

  col.innerHTML = `
    <div class="project-header" style="border-top-color:${esc(project.color)}">
      <div class="project-header-top">
        <div class="project-title-row">
          <span class="proj-drag-handle" title="ドラッグして移動">⠿</span>
          <span class="project-name" title="${esc(project.name)}">${esc(project.name)}</span>
          <span class="task-count-badge">${tasks.length}</span>
        </div>
        <div class="project-actions">
          <button class="icon-btn edit-proj-btn"  data-pid="${pid}" title="編集">✏️</button>
          <button class="icon-btn del-proj-btn"   data-pid="${pid}" title="削除">🗑️</button>
        </div>
      </div>
      <div class="sort-controls">
        <button class="sort-btn ${mode==='manual' ?'active':''}" data-pid="${pid}" data-mode="manual">手動</button>
        <button class="sort-btn ${mode==='date'   ?'active':''}" data-pid="${pid}" data-mode="date">開始日</button>
        <button class="sort-btn ${mode==='status' ?'active':''}" data-pid="${pid}" data-mode="status">進捗</button>
      </div>
    </div>

    <div class="task-list" id="tl-${pid}">
      ${tasks.length === 0
        ? '<div class="task-empty">タスクなし</div>'
        : tasks.map(buildTaskCard).join('')}
    </div>

    <button class="add-task-btn add-task-btn-js" data-pid="${pid}">＋ タスク追加</button>
  `;

  // イベント委譲（列内）
  col.querySelector('.edit-proj-btn').addEventListener('click', () => openEditProject(pid));
  col.querySelector('.del-proj-btn').addEventListener('click', () => confirmDeleteProject(pid));
  col.querySelectorAll('.sort-btn').forEach(btn =>
    btn.addEventListener('click', () => setSortMode(pid, btn.dataset.mode))
  );
  col.querySelector('.add-task-btn-js').addEventListener('click', () => openAddTask(pid));
  col.querySelectorAll('.task-card').forEach(card =>
    card.addEventListener('click', () => openEditTask(Number(card.dataset.tid)))
  );

  return col;
}

function buildTaskCard(task) {
  const pct   = task.progress ?? 0;
  const color = progressColor(pct);
  return `
    <div class="task-card" data-tid="${task.id}">
      <span class="task-drag-handle" title="ドラッグして並べ替え">⠿</span>
      <div class="task-card-body">
        <div class="task-name">${esc(task.name)}</div>
        <div class="task-meta">
          <span class="task-date">${task.start_date ? '📅 ' + fmtDate(task.start_date) : ''}</span>
          <div class="progress-wrap">
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" style="width:${pct}%;background:${color}"></div>
            </div>
            <span class="progress-pct">${pct}%</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* ============================================================
   ソートモード切替
   ============================================================ */
function setSortMode(projectId, mode) {
  const modes = ls.obj(LS.SORT_MODE);
  modes[String(projectId)] = mode;
  ls.set(LS.SORT_MODE, modes);
  render();
}

/* ============================================================
   プロジェクト モーダル
   ============================================================ */
let selectedColor = '#4A90D9';

function openAddProject() {
  selectedColor = '#4A90D9';
  document.getElementById('projectId').value    = '';
  document.getElementById('projectName').value  = '';
  document.getElementById('projectColor').value = selectedColor;
  document.getElementById('projectModalTitle').textContent = 'プロジェクト追加';
  syncColorPicker(selectedColor);
  openModal('projectModal');
  document.getElementById('projectName').focus();
}

function openEditProject(pid) {
  const p = projects.find(x => x.id == pid);
  if (!p) return;
  selectedColor = p.color || '#4A90D9';
  document.getElementById('projectId').value    = p.id;
  document.getElementById('projectName').value  = p.name;
  document.getElementById('projectColor').value = selectedColor;
  document.getElementById('projectModalTitle').textContent = 'プロジェクト編集';
  syncColorPicker(selectedColor);
  openModal('projectModal');
  document.getElementById('projectName').focus();
}

async function saveProject() {
  const id    = document.getElementById('projectId').value;
  const name  = document.getElementById('projectName').value.trim();
  const color = document.getElementById('projectColor').value;
  if (!name) { alert('プロジェクト名を入力してください'); return; }
  try {
    if (id) {
      await api({ action: 'update_project', id, name, color });
    } else {
      await api({ action: 'create_project', name, color });
    }
    closeModal('projectModal');
    await loadProjects();
  } catch (e) {
    alert('保存失敗: ' + e.message);
  }
}

async function confirmDeleteProject(pid) {
  const p = projects.find(x => x.id == pid);
  if (!p) return;
  const ok = await confirm2(`プロジェクト「${p.name}」を削除しますか？\nタスクもすべて削除されます。`);
  if (!ok) return;
  try {
    await api({ action: 'delete_project', id: pid });
    // LS のクリーンアップ
    const to = ls.obj(LS.TASK_ORDER); delete to[String(pid)]; ls.set(LS.TASK_ORDER, to);
    const sm = ls.obj(LS.SORT_MODE);  delete sm[String(pid)]; ls.set(LS.SORT_MODE, sm);
    ls.set(LS.PROJECT_ORDER, ls.arr(LS.PROJECT_ORDER).filter(id => String(id) !== String(pid)));
    await loadProjects();
  } catch (e) {
    alert('削除失敗: ' + e.message);
  }
}

function syncColorPicker(color) {
  document.querySelectorAll('.color-opt').forEach(el =>
    el.classList.toggle('selected', el.dataset.color === color)
  );
}

/* ============================================================
   タスク モーダル
   ============================================================ */
function openAddTask(pid) {
  document.getElementById('taskId').value          = '';
  document.getElementById('taskProjectId').value   = pid;
  document.getElementById('taskName').value        = '';
  document.getElementById('taskDescription').value = '';
  document.getElementById('taskStartDate').value   = '';
  document.getElementById('taskEndDate').value     = '';
  setProgressSlider(0);
  document.getElementById('taskModalTitle').textContent = 'タスク追加';
  document.getElementById('deleteTaskBtn').style.display = 'none';
  openModal('taskModal');
  document.getElementById('taskName').focus();
}

function openEditTask(tid) {
  let task = null;
  for (const p of projects) {
    task = (p.tasks || []).find(t => t.id == tid);
    if (task) break;
  }
  if (!task) return;

  document.getElementById('taskId').value          = task.id;
  document.getElementById('taskProjectId').value   = task.project_id;
  document.getElementById('taskName').value        = task.name;
  document.getElementById('taskDescription').value = task.description || '';
  document.getElementById('taskStartDate').value   = task.start_date  || '';
  document.getElementById('taskEndDate').value     = task.end_date    || '';
  setProgressSlider(task.progress ?? 0);
  document.getElementById('taskModalTitle').textContent = 'タスク編集';
  document.getElementById('deleteTaskBtn').style.display = '';
  openModal('taskModal');
  document.getElementById('taskName').focus();
}

async function saveTask() {
  const id          = document.getElementById('taskId').value;
  const projectId   = document.getElementById('taskProjectId').value;
  const name        = document.getElementById('taskName').value.trim();
  const description = document.getElementById('taskDescription').value.trim();
  const start_date  = document.getElementById('taskStartDate').value;
  const end_date    = document.getElementById('taskEndDate').value;
  const progress    = Number(document.getElementById('taskProgress').value);

  if (!name) { alert('タスク名を入力してください'); return; }
  try {
    if (id) {
      await api({ action: 'update_task', id, name, description, start_date, end_date, progress });
    } else {
      await api({ action: 'create_task', project_id: projectId, name, description, start_date, end_date, progress });
    }
    closeModal('taskModal');
    await loadProjects();
  } catch (e) {
    alert('保存失敗: ' + e.message);
  }
}

async function deleteTask() {
  const id   = document.getElementById('taskId').value;
  const name = document.getElementById('taskName').value;
  const ok   = await confirm2(`タスク「${name}」を削除しますか？`);
  if (!ok) return;
  try {
    await api({ action: 'delete_task', id });
    closeModal('taskModal');
    await loadProjects();
  } catch (e) {
    alert('削除失敗: ' + e.message);
  }
}

/* ============================================================
   進捗スライダー ヘルパー
   ============================================================ */
function setProgressSlider(val) {
  const slider = document.getElementById('taskProgress');
  const label  = document.getElementById('taskProgressLabel');
  slider.value = val;
  label.textContent = val;
}

/* ============================================================
   確認ダイアログ（カスタム）
   ============================================================ */
function confirm2(message) {
  return new Promise(resolve => {
    document.getElementById('confirmMessage').textContent = message;
    openModal('confirmModal');
    const ok  = document.getElementById('confirmOk');
    const ng  = document.getElementById('confirmCancel');
    function cleanup(val) {
      closeModal('confirmModal');
      ok.removeEventListener('click', onOk);
      ng.removeEventListener('click', onNg);
      resolve(val);
    }
    const onOk = () => cleanup(true);
    const onNg = () => cleanup(false);
    ok.addEventListener('click', onOk);
    ng.addEventListener('click', onNg);
  });
}

/* ============================================================
   モーダル 開閉
   ============================================================ */
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

/* ============================================================
   初期化
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {

  // ヘッダー
  document.getElementById('addProjectBtn').addEventListener('click', openAddProject);

  // プロジェクトモーダル
  document.getElementById('closeProjectModal').addEventListener('click',  () => closeModal('projectModal'));
  document.getElementById('cancelProjectModal').addEventListener('click', () => closeModal('projectModal'));
  document.getElementById('saveProject').addEventListener('click', saveProject);
  document.getElementById('projectName').addEventListener('keydown', e => { if (e.key === 'Enter') saveProject(); });

  // カラーピッカー
  document.getElementById('colorPicker').addEventListener('click', e => {
    const opt = e.target.closest('.color-opt');
    if (!opt) return;
    selectedColor = opt.dataset.color;
    document.getElementById('projectColor').value = selectedColor;
    syncColorPicker(selectedColor);
  });

  // 進捗スライダー
  document.getElementById('taskProgress').addEventListener('input', e => {
    document.getElementById('taskProgressLabel').textContent = e.target.value;
  });

  // タスクモーダル
  document.getElementById('closeTaskModal').addEventListener('click',  () => closeModal('taskModal'));
  document.getElementById('cancelTaskModal').addEventListener('click', () => closeModal('taskModal'));
  document.getElementById('saveTaskBtn').addEventListener('click', saveTask);
  document.getElementById('deleteTaskBtn').addEventListener('click', deleteTask);
  document.getElementById('taskName').addEventListener('keydown', e => { if (e.key === 'Enter') saveTask(); });

  // オーバーレイクリックで閉じる
  ['projectModal', 'taskModal', 'confirmModal'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => {
      if (e.target === e.currentTarget) closeModal(id);
    });
  });

  // 初回ロード
  loadProjects().catch(err => {
    const board = document.getElementById('board');
    board.innerHTML = `<div style="color:#ef4444;padding:40px;">
      読み込みエラー: ${esc(err.message)}<br>
      <small>config.php のDB設定を確認してください。</small>
    </div>`;
  });
});
