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
  HIDE_DONE:    'tb_hide_done',     // { [projectId]: true/false }
  PROJECT_COLLAPSED: 'tb_proj_collapsed', // { [pid]: true/false }
};

/* ============================================================
   状態
   ============================================================ */
let projects   = [];      // サーバーから取得したデータ
let sortables  = {};      // SortableJS インスタンス

// 今日の日付 (YYYY-MM-DD)
const TODAY = (() => {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
})();

let dailyPlan = { date: TODAY, available_hours: 8, task_plans: [] };
let dailySortable = null;
let dpCollapsed = false;

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
        onEnd(evt) {
          // 今日の計画エリアにドロップされたか座標で判定
          const zone = document.getElementById('dpDropZone');
          const dpBody = document.getElementById('dpBody');
          if (zone && dpBody && !dpBody.classList.contains('dp-collapsed')) {
            const r  = zone.getBoundingClientRect();
            const oe = evt.originalEvent || {};
            // clientX/Y が 0,0 の場合は changedTouches をフォールバック
            const cx = oe.clientX || 0;
            const cy = oe.clientY || 0;
            if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
              zone.classList.remove('dp-drag-over');
              addTaskToDailyPlan(parseInt(evt.item.dataset.tid));
              return;
            }
          }
          zone && zone.classList.remove('dp-drag-over');
          // 通常の並び替え
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
  const pid      = project.id;
  const hideDone = ls.obj(LS.HIDE_DONE)[String(pid)] || false;
  const collapsed = ls.obj(LS.PROJECT_COLLAPSED)[String(pid)] || false;
  const doneCnt  = tasks.filter(t => t.is_done).length;
  const visibleTasks = hideDone ? tasks.filter(t => !t.is_done) : tasks;

  const col = document.createElement('div');
  col.className   = 'project-col' + (collapsed ? ' collapsed' : '');
  col.dataset.pid = pid;

  const doneFilterBtn = doneCnt > 0
    ? `<button class="sort-btn done-filter-btn${hideDone ? ' active' : ''}" data-pid="${pid}">完了${doneCnt}件${hideDone ? '▶' : '▼'}</button>`
    : '';

  col.innerHTML = `
    <div class="project-header" style="border-top-color:${esc(project.color)}">
      <div class="project-header-top">
        <div class="project-title-row">
          <span class="proj-drag-handle" title="ドラッグして移動">⠿</span>
          <span class="project-name" title="${esc(project.name)}">${esc(project.name)}</span>
          <span class="task-count-badge">${visibleTasks.length}</span>
        </div>
        <div class="project-actions">
          <button class="icon-btn hide-done-btn${hideDone ? ' active' : ''}" data-pid="${pid}" title="${hideDone ? '完了タスクを表示' : '完了タスクを隠す'}">${hideDone ? '👁️‍🗨️' : '👁️'}</button>
          <button class="icon-btn toggle-proj-btn" data-pid="${pid}" title="${collapsed ? '展開' : '折りたたむ'}">${collapsed ? '▼' : '▲'}</button>
          <button class="icon-btn edit-proj-btn"  data-pid="${pid}" title="編集">✏️</button>
          <button class="icon-btn del-proj-btn"   data-pid="${pid}" title="削除">🗑️</button>
        </div>
      </div>
      <div class="sort-controls">
        <button class="sort-btn ${mode==='manual' ?'active':''}" data-pid="${pid}" data-mode="manual">手動</button>
        <button class="sort-btn ${mode==='date'   ?'active':''}" data-pid="${pid}" data-mode="date">開始日</button>
        <button class="sort-btn ${mode==='status' ?'active':''}" data-pid="${pid}" data-mode="status">進捗</button>
        ${doneFilterBtn}
      </div>
    </div>

    <div class="task-list" id="tl-${pid}">
      ${visibleTasks.length === 0
        ? '<div class="task-empty">タスクなし</div>'
        : visibleTasks.map(buildTaskCard).join('')}
    </div>

    <button class="add-task-btn add-task-btn-js" data-pid="${pid}">＋ タスク追加</button>
  `;

  // イベント委譲（列内）
  col.querySelector('.hide-done-btn').addEventListener('click', () => toggleHideDone(pid));
  col.querySelector('.toggle-proj-btn').addEventListener('click', () => toggleProjectCollapse(pid));
  col.querySelector('.edit-proj-btn').addEventListener('click', () => openEditProject(pid));
  col.querySelector('.del-proj-btn').addEventListener('click', () => confirmDeleteProject(pid));
  col.querySelectorAll('.sort-btn:not(.done-filter-btn)').forEach(btn =>
    btn.addEventListener('click', () => setSortMode(pid, btn.dataset.mode))
  );
  col.querySelector('.done-filter-btn')?.addEventListener('click', () => toggleHideDone(pid));
  col.querySelector('.add-task-btn-js').addEventListener('click', () => openAddTask(pid));
  col.querySelectorAll('.task-card').forEach(card =>
    card.addEventListener('click', () => openEditTask(Number(card.dataset.tid)))
  );
  col.querySelectorAll('.task-done-btn').forEach(btn =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTaskDone(Number(btn.dataset.tid));
    })
  );

  return col;
}

function buildTaskCard(task) {
  const isDone = !!task.is_done;
  const pct    = task.progress ?? 0;
  const color  = isDone ? '#94a3b8' : progressColor(pct);
  const estH   = task.estimated_hours != null ? parseFloat(task.estimated_hours) : null;
  const actH   = parseFloat(task.actual_hours ?? 0);
  const timeInfo = (estH != null || actH > 0)
    ? `<div class="task-time-info">
        ${estH != null ? `<span class="task-est-h" title="所要予定時間">予${estH}h</span>` : ''}
        ${actH > 0    ? `<span class="task-act-h" title="累積作業時間">実${actH}h</span>` : ''}
       </div>`
    : '';
  return `
    <div class="task-card${isDone ? ' is-done' : ''}" data-tid="${task.id}">
      <span class="task-drag-handle" title="ドラッグして並べ替え / 今日の計画へ">⠿</span>
      <button class="task-done-btn${isDone ? ' done' : ''}" data-tid="${task.id}" title="${isDone ? '完了を解除' : '完了にする'}">✓</button>
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
        ${timeInfo}
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
   タスク完了フラグ切替
   ============================================================ */
async function toggleTaskDone(tid) {
  let task = null;
  for (const p of projects) {
    task = (p.tasks || []).find(t => t.id == tid);
    if (task) break;
  }
  if (!task) return;
  const newDone = task.is_done ? 0 : 1;
  try {
    await api({ action: 'toggle_task_done', id: tid, is_done: newDone });
    task.is_done = newDone;
    render();
  } catch (e) {
    console.warn('toggle done failed:', e);
  }
}

/* ============================================================
   プロジェクト単位の完了タスク 表示/非表示
   ============================================================ */
function toggleHideDone(pid) {
  const map = ls.obj(LS.HIDE_DONE);
  map[String(pid)] = !map[String(pid)];
  ls.set(LS.HIDE_DONE, map);
  render();
}

function toggleAllHideDone() {
  const map = ls.obj(LS.HIDE_DONE);
  // 現状を見て、1つでも表示されている（hideDone=false）ものがあれば全非表示、そうでければ全表示
  const someShown = projects.some(p => !map[String(p.id)]);
  projects.forEach(p => {
    map[String(p.id)] = someShown;
  });
  ls.set(LS.HIDE_DONE, map);
  render();
}

/* ============================================================
   プロジェクトの開閉
   ============================================================ */
function toggleProjectCollapse(pid) {
  const map = ls.obj(LS.PROJECT_COLLAPSED);
  map[String(pid)] = !map[String(pid)];
  ls.set(LS.PROJECT_COLLAPSED, map);
  render();
}

function toggleAllProjects() {
  const map = ls.obj(LS.PROJECT_COLLAPSED);
  // 現状を見て、1つでも開いているものがあれば全閉、そうでければ全開
  const someOpen = projects.some(p => !map[String(p.id)]);
  projects.forEach(p => {
    map[String(p.id)] = someOpen;
  });
  ls.set(LS.PROJECT_COLLAPSED, map);
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
  document.getElementById('taskId').value             = '';
  document.getElementById('taskProjectId').value      = pid;
  document.getElementById('taskName').value           = '';
  document.getElementById('taskDescription').value    = '';
  document.getElementById('taskStartDate').value      = TODAY;
  document.getElementById('taskEndDate').value        = '';
  document.getElementById('taskEstimatedHours').value = '';
  document.getElementById('taskActualHours').value    = '0';
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

  document.getElementById('taskId').value             = task.id;
  document.getElementById('taskProjectId').value      = task.project_id;
  document.getElementById('taskName').value           = task.name;
  document.getElementById('taskDescription').value    = task.description || '';
  document.getElementById('taskStartDate').value      = task.start_date  || '';
  document.getElementById('taskEndDate').value        = task.end_date    || '';
  document.getElementById('taskEstimatedHours').value = task.estimated_hours != null ? task.estimated_hours : '';
  document.getElementById('taskActualHours').value    = task.actual_hours ?? 0;
  setProgressSlider(task.progress ?? 0);
  document.getElementById('taskModalTitle').textContent = 'タスク編集';
  document.getElementById('deleteTaskBtn').style.display = '';
  openModal('taskModal');
  document.getElementById('taskName').focus();
}

async function saveTask() {
  const id             = document.getElementById('taskId').value;
  const projectId      = document.getElementById('taskProjectId').value;
  const name           = document.getElementById('taskName').value.trim();
  const description    = document.getElementById('taskDescription').value.trim();
  const start_date     = document.getElementById('taskStartDate').value;
  const end_date       = document.getElementById('taskEndDate').value;
  const progress       = Number(document.getElementById('taskProgress').value);
  const estVal         = document.getElementById('taskEstimatedHours').value;
  const estimated_hours = estVal !== '' ? parseFloat(estVal) : '';
  const actual_hours   = parseFloat(document.getElementById('taskActualHours').value) || 0;

  if (!name) { alert('タスク名を入力してください'); return; }
  try {
    if (id) {
      await api({ action: 'update_task', id, name, description, start_date, end_date, progress, estimated_hours, actual_hours });
    } else {
      await api({ action: 'create_task', project_id: projectId, name, description, start_date, end_date, progress, estimated_hours, actual_hours });
    }
    closeModal('taskModal');
    await loadProjects();
    await loadDailyPlan(); // 今日の計画バーも更新
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
    await loadDailyPlan();
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
   今日の作業計画
   ============================================================ */
async function loadDailyPlan() {
  try {
    const data = await apiGet(`get_daily_plan&date=${TODAY}`);
    dailyPlan.available_hours = parseFloat(data.available_hours) || 8;
    dailyPlan.task_plans = data.task_plans || [];
  } catch (e) {
    console.warn('daily plan load failed:', e);
  }
  renderDailyPlan();
}

function renderDailyPlan() {
  // 日付表示
  const [y, m, d] = TODAY.split('-');
  document.getElementById('dpDate').textContent = `${y}/${m}/${d}`;

  // 利用可能時間
  document.getElementById('availableHours').value = dailyPlan.available_hours;

  // タスクリスト
  const list = document.getElementById('dpTasksList');
  list.innerHTML = '';
  const hint = document.getElementById('dpDropHint');

  if (dailyPlan.task_plans.length === 0) {
    hint.style.display = 'flex';
  } else {
    hint.style.display = 'none';
    dailyPlan.task_plans.forEach(tp => list.appendChild(buildDpTaskItem(tp)));
  }

  renderDpBar();
  setupDailySortable();
}

function buildDpTaskItem(tp) {
  const project = projects.find(p => p.id == tp.project_id);
  const color   = project ? project.color : '#4A90D9';
  const projName = project ? project.name : '';
  const hours   = parseFloat(tp.planned_hours);

  const item = document.createElement('div');
  item.className   = 'dp-task-item';
  item.dataset.tid = tp.task_id;
  item.style.setProperty('--proj-color', color);
  item.innerHTML = `
    <span class="dp-task-info">
      <span class="dp-task-proj">${esc(projName)}</span>
      <span class="dp-task-name">${esc(tp.name)}</span>
    </span>
    <input type="number" class="dp-task-hours-inp" value="${hours}" min="0.5" max="24" step="0.5" title="今日の作業時間">
    <span class="dp-task-unit">h</span>
    <button class="dp-task-remove" title="削除">✕</button>
  `;

  item.querySelector('.dp-task-hours-inp').addEventListener('change', async (e) => {
    const h = Math.max(0.5, parseFloat(e.target.value) || 0.5);
    e.target.value = h;
    tp.planned_hours = h;
    try {
      await api({ action: 'update_daily_task_hours', date: TODAY, task_id: tp.task_id, planned_hours: h });
    } catch {}
    renderDpBar();
  });

  item.querySelector('.dp-task-remove').addEventListener('click', async () => {
    try {
      await api({ action: 'remove_task_from_daily_plan', date: TODAY, task_id: tp.task_id });
      await loadDailyPlan();
    } catch {}
  });

  return item;
}

function calcExpectedProgress(currentPct, estHours, todayHours) {
  if (!estHours || estHours <= 0) return currentPct;
  return Math.min(100, Math.round(currentPct + (todayHours / estHours) * 100));
}

function renderDpBar() {
  const area      = document.getElementById('dpBarArea');
  const available = dailyPlan.available_hours;
  const tasks     = dailyPlan.task_plans;

  if (tasks.length === 0) {
    area.innerHTML = '';
    return;
  }

  const totalPlanned = tasks.reduce((s, t) => s + parseFloat(t.planned_hours), 0);
  const scale        = Math.max(totalPlanned, available);
  const overTime     = totalPlanned > available;

  let segments = '';
  tasks.forEach(tp => {
    const project    = projects.find(p => p.id == tp.project_id);
    const color      = project ? project.color : '#4A90D9';
    const ph         = parseFloat(tp.planned_hours);
    const widthPct   = (ph / scale) * 100;
    const curPct     = parseInt(tp.progress) || 0;
    const estH       = tp.estimated_hours != null ? parseFloat(tp.estimated_hours) : null;
    const actH       = parseFloat(tp.actual_hours || 0);
    const newPct     = calcExpectedProgress(curPct, estH, ph);
    const hasEst     = estH != null && estH > 0;

    const progressChange = hasEst
      ? `<div class="dp-callout-progress">
           <span class="dp-callout-cur">${curPct}%</span>
           <span class="dp-callout-arrow">→</span>
           <span class="dp-callout-new">${newPct}%</span>
         </div>`
      : `<div class="dp-callout-progress dp-callout-no-est">進捗予測には所要予定時間を設定してください</div>`;

    const hoursRow = `<div class="dp-callout-hours">今日: ${ph}h${hasEst ? ` / 予定: ${estH}h` : ''}${actH > 0 ? ` / 累積: ${actH}h` : ''}</div>`;

    segments += `
      <div class="dp-bar-seg" style="width:${widthPct.toFixed(2)}%;background:${esc(color)}" data-tid="${tp.task_id}">
        <div class="dp-callout">
          <div class="dp-callout-name">${esc(tp.name)}</div>
          ${progressChange}
          ${hoursRow}
        </div>
      </div>`;
  });

  // 余り時間
  if (available > totalPlanned) {
    const remPct = ((available - totalPlanned) / scale) * 100;
    segments += `<div class="dp-bar-seg dp-bar-rem" style="width:${remPct.toFixed(2)}%">
      <div class="dp-callout dp-callout-rem">
        <div class="dp-callout-name">空き時間: ${(available - totalPlanned).toFixed(1)}h</div>
      </div>
    </div>`;
  }

  const overWarn = overTime
    ? `<span class="dp-over-warn">⚠️ 計画 ${totalPlanned.toFixed(1)}h が利用可能時間 ${available}h を超えています</span>`
    : `<span class="dp-time-summary">計画 ${totalPlanned.toFixed(1)}h / 利用可能 ${available}h（余り ${Math.max(0, available - totalPlanned).toFixed(1)}h）</span>`;

  area.innerHTML = `
    <div class="dp-bar-wrap">
      <div class="dp-bar">${segments}</div>
      <div class="dp-bar-footer">${overWarn}</div>
    </div>
  `;
}

function setupDailySortable() {
  if (dailySortable) { try { dailySortable.destroy(); } catch {} dailySortable = null; }

  const list = document.getElementById('dpTasksList');
  if (list.children.length === 0) return;

  dailySortable = new Sortable(list, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    onEnd() {
      const ids = [...list.querySelectorAll('.dp-task-item')].map(el => el.dataset.tid);
      dailyPlan.task_plans = ids.map(id =>
        dailyPlan.task_plans.find(tp => String(tp.task_id) === String(id))
      ).filter(Boolean);
      api({ action: 'update_daily_plan_order', date: TODAY, order: ids }).catch(() => {});
      renderDpBar();
    },
  });
}

function initDpDropZone() {
  // ドラッグ中のビジュアルフィードバックのみ
  // 実際のドロップ判定は SortableJS onEnd の座標チェックで行う
  const zone = document.getElementById('dpDropZone');
  zone.addEventListener('dragover', e => {
    e.preventDefault(); // ドロップ許可（カーソル変更）
    zone.classList.add('dp-drag-over');
  });
  zone.addEventListener('dragleave', e => {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove('dp-drag-over');
  });
  zone.addEventListener('dragend', () => zone.classList.remove('dp-drag-over'));
  document.addEventListener('dragend', () => zone.classList.remove('dp-drag-over'));
}

async function addTaskToDailyPlan(taskId) {
  if (dailyPlan.task_plans.some(tp => tp.task_id == taskId)) return; // 重複防止
  try {
    await api({ action: 'add_task_to_daily_plan', date: TODAY, task_id: taskId, planned_hours: 1.0 });
    await loadDailyPlan();
  } catch (e) {
    console.warn('add to daily plan failed:', e);
  }
}

/* ============================================================
   初期化
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {

  // ヘッダー
  document.getElementById('addProjectBtn').addEventListener('click', openAddProject);
  document.getElementById('toggleAllBtn').addEventListener('click', toggleAllProjects);
  document.getElementById('toggleAllDoneBtn').addEventListener('click', toggleAllHideDone);

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

  // 今日の作業計画: ドロップゾーン初期化
  initDpDropZone();

  // 今日の作業計画: 利用可能時間の変更
  document.getElementById('availableHours').addEventListener('change', async (e) => {
    const h = Math.max(0.5, Math.min(24, parseFloat(e.target.value) || 8));
    e.target.value = h;
    dailyPlan.available_hours = h;
    try {
      await api({ action: 'save_daily_available_hours', date: TODAY, available_hours: h });
    } catch {}
    renderDpBar();
  });

  // 今日の作業計画: 折りたたみ
  document.getElementById('dpToggleBtn').addEventListener('click', () => {
    dpCollapsed = !dpCollapsed;
    const body = document.getElementById('dpBody');
    const btn  = document.getElementById('dpToggleBtn');
    body.classList.toggle('dp-collapsed', dpCollapsed);
    btn.textContent = dpCollapsed ? '▼' : '▲';
    btn.title       = dpCollapsed ? '展開' : '折りたたむ';
  });

  // 初回ロード
  loadProjects()
    .then(() => loadDailyPlan())
    .catch(err => {
      const board = document.getElementById('board');
      board.innerHTML = `<div style="color:#ef4444;padding:40px;">
        読み込みエラー: ${esc(err.message)}<br>
        <small>config.php のDB設定を確認してください。</small>
      </div>`;
    });
});
