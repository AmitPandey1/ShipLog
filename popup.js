/* ===================== STORAGE HELPERS ===================== */
// Wraps chrome.storage.local in a simple promise-based API
const Store = {
  get(key) {
    return new Promise(resolve => {
      chrome.storage.local.get(key, result => resolve(result[key] ?? null));
    });
  },
  set(key, value) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  },
  getAll() {
    return new Promise(resolve => {
      chrome.storage.local.get(null, result => resolve(result));
    });
  }
};

/* ===================== TAB 1: Daily Plan ===================== */
(function () {
  const STORE_PREFIX = 'shiplog';
  let state = { date: todayStr(), data: null, prevData: null, loading: true, error: null };

  function todayStr() { return fmtDate(new Date()); }
  function fmtDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function shiftDate(dateStr, delta) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + delta); return fmtDate(dt);
  }
  function prettyDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function relativeLabel(dateStr) {
    const t = todayStr();
    if (dateStr === t) return 'TODAY';
    if (dateStr === shiftDate(t, -1)) return 'YESTERDAY';
    if (dateStr === shiftDate(t, 1)) return 'TOMORROW';
    return '';
  }
  function uid() { return Math.random().toString(36).slice(2, 9); }
  function emptyDay() { return { dailyPlan: [], newPriority: [], mrPending: [], interruptions: [], closed: false, carriedAck: null }; }
  function normalize(data) {
    if (!data) return emptyDay();
    if (!data.dailyPlan && data.mustShip) data.dailyPlan = data.mustShip;
    if (!data.dailyPlan) data.dailyPlan = [];
    if (!data.newPriority) data.newPriority = [];
    if (!data.mrPending) data.mrPending = [];
    if (!data.interruptions) data.interruptions = [];
    if (typeof data.closed !== 'boolean') data.closed = false;
    if (data.carriedAck === undefined) data.carriedAck = null;
    return data;
  }

  async function loadDate(dateStr) {
    try {
      const val = await Store.get(`${STORE_PREFIX}:${dateStr}`);
      return val ? (typeof val === 'string' ? JSON.parse(val) : val) : null;
    } catch (e) { return null; }
  }
  async function saveCurrentDay() {
    try {
      await Store.set(`${STORE_PREFIX}:${state.date}`, state.data);
      state.error = null;
    } catch (e) { state.error = 'Could not save — check extension permissions.'; }
  }

  async function loadAll(dateStr) {
    state.date = dateStr;
    state.data = normalize(await loadDate(dateStr));
    state.prevData = normalize(await loadDate(shiftDate(dateStr, -1)));
  }
  async function init() { await loadAll(state.date); state.loading = false; render(); }
  async function goToDate(newDate) { state.loading = true; render(); await loadAll(newDate); state.loading = false; render(); }

  async function addItem(section, text, effort) {
    if (!text.trim()) return;
    state.data[section].push({ id: uid(), text: text.trim(), effort: effort || 'M', done: false, carried: false, description: '', mrLink: '', utResult: '' });
    await saveCurrentDay(); render();
  }
  async function toggleItem(section, id) {
    const item = state.data[section].find(i => i.id === id);
    if (!item) return;
    const wasDone = item.done;
    item.done = !item.done;
    await saveCurrentDay(); render();
    if (!wasDone && item.done && (section === 'dailyPlan' || section === 'newPriority')) {
      openDescModal(section, id, true);
    }
  }
  async function deleteItem(section, id) {
    state.data[section] = state.data[section].filter(i => i.id !== id);
    await saveCurrentDay(); render();
  }
  let currentEditId = null, currentEditSection = null;
  function openDescModal(section, id, isCompletion = false) {
    currentEditSection = section; currentEditId = id;
    const item = state.data[section].find(i => i.id === id);
    document.getElementById('descModalTitle').textContent = isCompletion ? 'TASK COMPLETED! 🎉' : 'TASK DETAILS';
    document.getElementById('descMrInput').value = item.mrLink || '';
    document.getElementById('descUtInput').value = item.utResult || '';
    document.getElementById('descInput').value = item.description || '';
    document.getElementById('descModal').classList.remove('hidden');
    if (isCompletion) document.getElementById('descMrInput').focus();
    else document.getElementById('descInput').focus();
  }
  function closeDescModal() { document.getElementById('descModal').classList.add('hidden'); }
  async function saveDesc() {
    if (!currentEditId) return;
    const item = state.data[currentEditSection].find(i => i.id === currentEditId);
    if (item) { 
      item.mrLink = document.getElementById('descMrInput').value.trim();
      item.utResult = document.getElementById('descUtInput').value.trim();
      item.description = document.getElementById('descInput').value.trim(); 
    }
    closeDescModal(); await saveCurrentDay(); render();
  }
  async function addInterruption(text) {
    if (!text.trim()) return;
    state.data.interruptions.push({ id: uid(), text: text.trim(), status: 'pending' });
    await saveCurrentDay(); render();
  }
  async function setInterruptionStatus(id, status) {
    const item = state.data.interruptions.find(i => i.id === id);
    if (item) item.status = status;
    await saveCurrentDay(); render();
  }
  async function deleteInterruption(id) {
    state.data.interruptions = state.data.interruptions.filter(i => i.id !== id);
    await saveCurrentDay(); render();
  }
  async function carryOverYes() {
    const prevDate = shiftDate(state.date, -1);
    const unfinished = (state.prevData.dailyPlan || []).filter(i => !i.done);
    unfinished.forEach(i => { state.data.dailyPlan.push({ id: uid(), text: i.text, effort: i.effort || 'M', done: false, carried: true, description: i.description || '', mrLink: i.mrLink || '', utResult: i.utResult || '' }); });
    state.data.carriedAck = prevDate;
    await saveCurrentDay(); render();
  }
  async function carryOverNo() {
    state.data.carriedAck = shiftDate(state.date, -1);
    await saveCurrentDay(); render();
  }
  async function toggleClose() { state.data.closed = !state.data.closed; await saveCurrentDay(); render(); }

  function buildSummaryText() {
    const d = state.data;
    const planTotal = d.dailyPlan.length, planDone = d.dailyPlan.filter(i => i.done).length;
    const npTotal = d.newPriority.length, npDone = d.newPriority.filter(i => i.done).length;
    const mrTotal = d.mrPending.length, mrDone = d.mrPending.filter(i => i.done).length;
    const totalAll = planTotal + npTotal, totalDone = planDone + npDone;
    const statusIcon = { pending: '•', done: '✅', deferred: '↪️', dropped: '✕' };
    const rule = '─'.repeat(29);
    const lines = [];
    lines.push(`📅 ${prettyDate(state.date)}`);
    lines.push(`   ${d.closed ? 'Day closed' : 'Day in progress'}`);
    lines.push(rule);
    lines.push(`📋 Daily Plan [${planDone}/${planTotal}]`);
    d.dailyPlan.forEach(i => lines.push(`  ${i.done ? '✅' : '⬜'} ${i.text}${i.carried ? ' (carried)' : ''}`));
    if (planTotal === 0) lines.push('  (none)');
    lines.push(rule);
    lines.push(`🆕 New Priority [${npDone}/${npTotal}]`);
    d.newPriority.forEach(i => lines.push(`  ${i.done ? '✅' : '⬜'} ${i.text}`));
    if (npTotal === 0) lines.push('  (none)');
    lines.push(rule);
    lines.push(`🔀 Pending MRs [${mrDone}/${mrTotal}]`);
    d.mrPending.forEach(i => lines.push(`  ${i.done ? '✅' : '⬜'} ${i.text}`));
    if (mrTotal === 0) lines.push('  (none)');
    lines.push(rule);
    lines.push(`⚡ Interruptions [${d.interruptions.length}]`);
    d.interruptions.forEach(i => lines.push(`  ${statusIcon[i.status] || '•'} ${i.text}`));
    if (d.interruptions.length === 0) lines.push('  (none)');
    lines.push(rule);
    const barWidth = 12;
    const filled = totalAll ? Math.round((totalDone / totalAll) * barWidth) : 0;
    const pct = totalAll ? Math.round((totalDone / totalAll) * 100) : 0;
    lines.push(`${'█'.repeat(filled)}${'░'.repeat(barWidth - filled)}  ${totalDone}/${totalAll} shipped (${pct}%)`);
    return lines.join('\n');
  }

  function openShareModal() {
    document.getElementById('shareText').textContent = buildSummaryText();
    document.getElementById('shareModal').classList.remove('hidden');
    document.getElementById('copyFeedback').textContent = '';
  }
  function closeShareModal() { document.getElementById('shareModal').classList.add('hidden'); }

  function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function renderBar(done, total) {
    const width = 14;
    if (total === 0) return '░'.repeat(width).split('').map(c => `<span class="empty">${c}</span>`).join('');
    const filled = Math.round((done / total) * width);
    return '█'.repeat(filled) + `<span class="empty">${'░'.repeat(width - filled)}</span>`;
  }
  function renderItems(section, items, cls) {
    return items.map(i => `
      <div class="item-row">
        <button class="chk ${cls} ${i.done ? 'done' : ''}" data-action="toggle" data-section="${section}" data-id="${i.id}"></button>
        <div class="item-content">
          <div class="item-text ${i.done ? 'done' : ''} ${i.carried ? 'carried' : ''}">
            ${escapeHtml(i.text)}${i.carried ? ' <span style="font-size:8px;">(carried)</span>' : ''}
            ${i.mrLink ? `<a href="${escapeHtml(i.mrLink)}" target="_blank" class="mr-badge">MR ⤴</a>` : ''}
          </div>
          ${i.description ? `<div class="item-desc ${i.done ? 'done' : ''}">${escapeHtml(i.description)}</div>` : ''}
          ${i.utResult ? `<div class="item-desc" style="color:var(--text-dim);">🧪 <strong>UT:</strong> ${escapeHtml(i.utResult)}</div>` : ''}
        </div>
        ${i.effort ? `<div class="tag tag-${i.effort}">${i.effort}</div>` : ''}
        <button class="edit-btn" data-action="openDesc" data-section="${section}" data-id="${i.id}">📝</button>
        <button class="del-btn" data-action="delete" data-section="${section}" data-id="${i.id}">✕</button>
      </div>`).join('');
  }

  function render() {
    const app = document.getElementById('planApp');
    if (state.loading) { app.innerHTML = `<div class="loading">loading daily plan…</div>`; return; }
    const d = state.data;
    const planTotal = d.dailyPlan.length, planDone = d.dailyPlan.filter(i => i.done).length;
    const npTotal = d.newPriority.length, npDone = d.newPriority.filter(i => i.done).length;
    const mrTotal = d.mrPending.length, mrDone = d.mrPending.filter(i => i.done).length;
    const totalAll = planTotal + npTotal + mrTotal, totalDone = planDone + npDone + mrDone;
    const pct = totalAll ? Math.round((totalDone / totalAll) * 100) : 0;
    const doneInt = d.interruptions.filter(i => i.status === 'done').length;
    const deferredInt = d.interruptions.filter(i => i.status === 'deferred').length;
    const droppedInt = d.interruptions.filter(i => i.status === 'dropped').length;
    const rel = relativeLabel(state.date);
    const showCarryBanner = (state.prevData.dailyPlan || []).some(i => !i.done) && d.carriedAck !== shiftDate(state.date, -1);
    const carryCount = showCarryBanner ? state.prevData.dailyPlan.filter(i => !i.done).length : 0;

    app.innerHTML = `
      <div class="log-header">
        <div class="log-title">SHIP.LOG<span class="cursor"></span></div>
        <div class="log-sub">daily plan</div>
      </div>
      <div class="date-row">
        <button class="date-nav-btn" id="prevBtn">‹ prev</button>
        <div class="date-label"><div>${prettyDate(state.date)}</div>${rel ? `<div class="rel">${rel}</div>` : ''}</div>
        <button class="date-nav-btn" id="nextBtn">next ›</button>
      </div>
      ${state.error ? `<div class="err">${state.error}</div>` : ''}
      ${showCarryBanner ? `
        <div class="carry-banner">
          ↪ ${carryCount} unfinished item${carryCount > 1 ? 's' : ''} from ${prettyDate(shiftDate(state.date, -1))}. Carry into today?
          <div class="b-actions">
            <button class="b-btn yes" id="carryYes">Carry over</button>
            <button class="b-btn no" id="carryNo">Dismiss</button>
          </div>
        </div>` : ''}
      <div class="section ${d.closed ? 'disabled-overlay' : ''}">
        <div class="section-head"><span>📋 DAILY PLAN</span><span class="count-badge">${planDone}/${planTotal} done</span></div>
        <div class="section-body">
          ${planTotal === 0 ? `<div class="empty-hint">No plan yet — add what you're working on today.</div>` : ''}
          ${renderItems('dailyPlan', d.dailyPlan, 'daily')}
          <div class="add-row">
            <input class="add-input" id="dailyInput" placeholder="Add to today's plan…" maxlength="140">
            <select class="add-select" id="dailyEffort"><option value="S">S</option><option value="M" selected>M</option><option value="L">L</option></select>
            <button class="add-btn" id="dailyAddBtn">+</button>
          </div>
        </div>
      </div>
      <div class="section ${d.closed ? 'disabled-overlay' : ''}">
        <div class="section-head"><span>🆕 NEW PRIORITY</span><span class="count-badge">${npDone}/${npTotal} done</span></div>
        <div class="section-body">
          ${npTotal === 0 ? `<div class="empty-hint">Nothing new yet — log priorities that come up mid-day.</div>` : ''}
          ${renderItems('newPriority', d.newPriority, 'priority')}
          <div class="add-row">
            <input class="add-input" id="npInput" placeholder="A new priority just came up…" maxlength="140">
            <select class="add-select" id="npEffort"><option value="S">S</option><option value="M" selected>M</option><option value="L">L</option></select>
            <button class="add-btn priority" id="npAddBtn">+</button>
          </div>
        </div>
      </div>
      <div class="section ${d.closed ? 'disabled-overlay' : ''}">
        <div class="section-head"><span>🔀 PENDING MRs</span><span class="count-badge">${mrDone}/${mrTotal} done</span></div>
        <div class="section-body">
          ${mrTotal === 0 ? `<div class="empty-hint">No pending MRs.</div>` : ''}
          ${renderItems('mrPending', d.mrPending, 'priority')}
          <div class="add-row">
            <input class="add-input" id="mrInput" placeholder="Add a pending MR link or title…" maxlength="140">
            <button class="add-btn" style="background:var(--cyan);border-color:var(--cyan);color:#08090a;" id="mrAddBtn">+</button>
          </div>
        </div>
      </div>
      <div class="section ${d.closed ? 'disabled-overlay' : ''}">
        <div class="section-head"><span>⚡ INTERRUPTIONS</span><span class="count-badge">${d.interruptions.length}</span></div>
        <div class="section-body">
          ${d.interruptions.length === 0 ? `<div class="empty-hint">Unplanned work lands here — log it so it doesn't vanish.</div>` : ''}
          ${d.interruptions.map(i => `
            <div class="item-row">
              <div class="item-text" style="flex:1">${escapeHtml(i.text)}</div>
              <select class="status-sel" data-action="setStatus" data-id="${i.id}">
                <option value="pending" ${i.status === 'pending' ? 'selected' : ''}>pending</option>
                <option value="done" ${i.status === 'done' ? 'selected' : ''}>done</option>
                <option value="deferred" ${i.status === 'deferred' ? 'selected' : ''}>deferred</option>
                <option value="dropped" ${i.status === 'dropped' ? 'selected' : ''}>dropped</option>
              </select>
              <button class="del-btn" data-action="deleteInt" data-id="${i.id}">✕</button>
            </div>`).join('')}
          <div class="add-row">
            <input class="add-input" id="intInput" placeholder="Log an interruption…" maxlength="140">
            <button class="add-btn" id="intAddBtn">+</button>
          </div>
        </div>
      </div>
      <div class="section">
        <div class="section-head"><span>📝 SUMMARY</span></div>
        <div class="section-body">
          <div class="progress-wrap">
            <div class="bar">${renderBar(totalDone, totalAll)}</div>
            <div class="progress-label">${totalAll > 0 ? `${totalDone} of ${totalAll} shipped (${pct}%)` : 'nothing planned yet'}</div>
          </div>
          <div class="summary-breakdown">
            <div>📋 Daily Plan — ${planDone}/${planTotal}</div>
            <div>🆕 New Priority — ${npDone}/${npTotal}</div>
            <div>🔀 Pending MRs — ${mrDone}/${mrTotal}</div>
            <div>⚡ Interruptions — ${d.interruptions.length} total (${doneInt} resolved · ${deferredInt} deferred · ${droppedInt} dropped)</div>
          </div>
          <div class="summary-actions">
            <button class="close-btn ${d.closed ? 'closed' : 'open'}" id="closeBtn">${d.closed ? '✓ DAY CLOSED — REOPEN' : 'CLOSE DAY'}</button>
            <button class="share-btn" id="shareBtn">⤴ SHARE</button>
          </div>
          ${d.closed && totalAll > 0 ? `<div class="stamp ${totalDone === totalAll ? 'full' : 'partial'}"><span>${totalDone === totalAll ? 'SHIPPED' : 'PARTIAL'}</span></div>` : ''}
        </div>
      </div>
    `;
    attachHandlers();
  }

  function attachHandlers() {
    const $ = id => document.getElementById(id);
    $('prevBtn').onclick = () => goToDate(shiftDate(state.date, -1));
    $('nextBtn').onclick = () => goToDate(shiftDate(state.date, 1));
    if ($('carryYes')) $('carryYes').onclick = carryOverYes;
    if ($('carryNo')) $('carryNo').onclick = carryOverNo;

    if (!state.data.closed) {
      $('dailyAddBtn').onclick = () => { addItem('dailyPlan', $('dailyInput').value, $('dailyEffort').value); $('dailyInput').value = ''; };
      $('dailyInput').onkeydown = (e) => { if (e.key === 'Enter') $('dailyAddBtn').click(); };
      $('npAddBtn').onclick = () => { addItem('newPriority', $('npInput').value, $('npEffort').value); $('npInput').value = ''; };
      $('npInput').onkeydown = (e) => { if (e.key === 'Enter') $('npAddBtn').click(); };
      $('mrAddBtn').onclick = () => { addItem('mrPending', $('mrInput').value, null); $('mrInput').value = ''; };
      $('mrInput').onkeydown = (e) => { if (e.key === 'Enter') $('mrAddBtn').click(); };
      $('intAddBtn').onclick = () => { addInterruption($('intInput').value); $('intInput').value = ''; };
      $('intInput').onkeydown = (e) => { if (e.key === 'Enter') $('intAddBtn').click(); };
    }
    $('closeBtn').onclick = toggleClose;
    $('shareBtn').onclick = openShareModal;

    document.querySelectorAll('[data-action="toggle"]').forEach(el => { el.onclick = () => toggleItem(el.dataset.section, el.dataset.id); });
    document.querySelectorAll('[data-action="delete"]').forEach(el => { el.onclick = () => deleteItem(el.dataset.section, el.dataset.id); });
    document.querySelectorAll('[data-action="openDesc"]').forEach(el => { el.onclick = () => openDescModal(el.dataset.section, el.dataset.id); });
    document.querySelectorAll('[data-action="setStatus"]').forEach(el => { el.onchange = () => setInterruptionStatus(el.dataset.id, el.value); });
    document.querySelectorAll('[data-action="deleteInt"]').forEach(el => { el.onclick = () => deleteInterruption(el.dataset.id); });
  }

  document.getElementById('descModalClose').onclick = closeDescModal;
  document.getElementById('descSaveBtn').onclick = saveDesc;

  document.getElementById('modalClose').onclick = closeShareModal;
  document.getElementById('copyBtn').onclick = async () => {
    const text = document.getElementById('shareText').textContent;
    const fb = document.getElementById('copyFeedback');
    try {
      await navigator.clipboard.writeText(text);
      fb.textContent = 'Copied ✓';
    } catch (e) {
      fb.textContent = 'Copy failed — select the text manually.';
    }
  };

  window.__planGoTo = goToDate;
  init();
})();

/* ===================== TAB 2: Task Flow ===================== */
(function () {
  const phases = [
    {
      title: "Scope before opening the IDE", items: [
        ["Write the requirement in your own words, not the ticket's", ""],
        ["List every app/module that consumes this change", "For SDK work — who breaks if this shifts?"],
        ["List edge cases and integration points up front", "This is your 360° view, written down"],
        ["Identify what 'done' looks like before starting", ""]
      ]
    },
    {
      title: "Lock the design phase", items: [
        ["Close unrelated tabs, phone on DND", ""],
        ["Any stray thought goes in the Parking Lot, not a new tab", ""],
        ["Don't start coding until the scope feels complete", "Rushing this is where the gaps start"]
      ]
    },
    {
      title: "Build from the checklist, not memory", items: [
        ["Work directly off the scope list, checking items as you go", ""],
        ["New discovery mid-build? Add it to the list immediately", "Don't rely on remembering it later"]
      ]
    },
    {
      title: "Close the loop", items: [
        ["Re-read your own scope doc before marking done", ""],
        ["Confirm every listed item was actually addressed", "This is where missed edge cases get caught"]
      ]
    },
    {
      title: "Weekly competitive review (batched, not live)", items: [
        ["Go through the Parking Lot — Friday, fixed slot", ""],
        ["Decide: relevant to backlog, or discard", ""],
        ["Never compare platforms mid-task — only here", ""]
      ]
    }
  ];

  const container = document.getElementById('phases');

  phases.forEach((phase, pIdx) => {
    const el = document.createElement('div');
    el.className = 'tf-phase';
    el.innerHTML = `
      <div class="tf-phase-head">
        <div class="tf-phase-num">${pIdx + 1}</div>
        <div class="tf-phase-title">${phase.title}</div>
        <div class="tf-phase-progress" data-progress></div>
        <div class="tf-chev">▶</div>
      </div>
      <div class="tf-phase-body">
        ${phase.items.map((item, iIdx) => `
          <div class="tf-item" data-item>
            <input type="checkbox" id="p${pIdx}-i${iIdx}">
            <label for="p${pIdx}-i${iIdx}">${item[0]}${item[1] ? `<span class="tf-item-note">${item[1]}</span>` : ''}</label>
          </div>`).join('')}
      </div>`;
    container.appendChild(el);

    el.querySelector('.tf-phase-head').addEventListener('click', () => el.classList.toggle('open'));

    const checkboxes = el.querySelectorAll('input[type="checkbox"]');
    const progressEl = el.querySelector('[data-progress]');
    function updateProgress() {
      const total = checkboxes.length;
      const done = [...checkboxes].filter(c => c.checked).length;
      progressEl.textContent = `${done}/${total}`;
      el.classList.toggle('complete', done === total);
      checkboxes.forEach(c => c.closest('.tf-item').classList.toggle('checked', c.checked));
    }
    checkboxes.forEach(c => c.addEventListener('change', updateProgress));
    updateProgress();
  });

  container.querySelector('.tf-phase').classList.add('open');

  const parkingInput = document.getElementById('parking-input');
  const parkingAdd = document.getElementById('parking-add');
  const parkingList = document.getElementById('parking-list');

  function renderEmpty() {
    if (parkingList.children.length === 0) {
      const li = document.createElement('div');
      li.className = 'tf-parking-empty';
      li.textContent = 'Nothing parked. Good — stay focused.';
      li.id = 'empty-state';
      parkingList.appendChild(li);
    }
  }
  function addParkingItem(text) {
    const existingEmpty = document.getElementById('empty-state');
    if (existingEmpty) existingEmpty.remove();
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = text;
    const x = document.createElement('span');
    x.className = 'x'; x.textContent = '✕';
    x.addEventListener('click', () => { li.remove(); renderEmpty(); });
    li.appendChild(span); li.appendChild(x);
    parkingList.appendChild(li);
  }
  function handleAdd() {
    const val = parkingInput.value.trim();
    if (!val) return;
    addParkingItem(val);
    parkingInput.value = '';
    parkingInput.focus();
  }
  parkingAdd.addEventListener('click', handleAdd);
  parkingInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAdd(); });
  renderEmpty();
})();

/* ===================== TAB 3: Month view ===================== */
(function () {
  const STORE_PREFIX = 'shiplog';
  const today = new Date();
  let view = { year: today.getFullYear(), month: today.getMonth() };

  function pad(n) { return String(n).padStart(2, '0'); }
  function dateKey(y, m, d) { return `${y}-${pad(m + 1)}-${pad(d)}`; }
  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
  function firstWeekday(y, m) { return new Date(y, m, 1).getDay(); }
  function monthLabel(y, m) { return new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); }
  function todayKey() { return dateKey(today.getFullYear(), today.getMonth(), today.getDate()); }

  async function fetchMonthData() {
    const { year, month } = view;
    const total = daysInMonth(year, month);
    const allData = await Store.getAll();
    const dataByDate = {};
    for (let d = 1; d <= total; d++) {
      const key = dateKey(year, month, d);
      const stored = allData[`${STORE_PREFIX}:${key}`];
      if (stored) {
        try {
          const data = typeof stored === 'string' ? JSON.parse(stored) : stored;
          const planTotal = (data.dailyPlan || []).length, planDone = (data.dailyPlan || []).filter(i => i.done).length;
          const npTotal = (data.newPriority || []).length, npDone = (data.newPriority || []).filter(i => i.done).length;
          const total2 = planTotal + npTotal, done2 = planDone + npDone;
          dataByDate[key] = { total: total2, done: done2, closed: !!data.closed };
        } catch (e) { /* skip */ }
      }
    }
    return dataByDate;
  }

  function renderGrid(dataByDate, weekendType) {
    const { year, month } = view;
    document.getElementById('monthLabel').textContent = monthLabel(year, month);
    const total = daysInMonth(year, month);
    const offset = firstWeekday(year, month);
    const tk = todayKey();

    let loggedDays = 0, sumPct = 0, shippedDays = 0;
    Object.values(dataByDate).forEach(v => {
      if (v.total > 0) { loggedDays++; sumPct += (v.done / v.total); if (v.closed && v.done === v.total) shippedDays++; }
    });
    const avgPct = loggedDays ? Math.round((sumPct / loggedDays) * 100) : 0;
    document.getElementById('monthSummary').textContent = loggedDays
      ? `${loggedDays} day${loggedDays > 1 ? 's' : ''} logged · avg ${avgPct}% shipped · ${shippedDays} fully shipped`
      : 'No days logged yet this month';

    const weekdayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    let html = `<div class="cal-grid">`;
    weekdayNames.forEach(w => html += `<div class="cal-weekday">${w}</div>`);
    for (let i = 0; i < offset; i++) html += `<div class="cal-cell empty-slot"></div>`;
    for (let d = 1; d <= total; d++) {
      const key = dateKey(year, month, d);
      const info = dataByDate[key];
      let cls = 'cal-cell';
      let pctLabel = '';
      
      const dayOfWeek = new Date(year, month, d).getDay();
      const isWeekend = weekendType === 'fri-sat' ? (dayOfWeek === 5 || dayOfWeek === 6) : 
                        weekendType === 'sun' ? (dayOfWeek === 0) : 
                        (dayOfWeek === 0 || dayOfWeek === 6);
      if (isWeekend) cls += ' is-weekend';

      if (info && info.total > 0) {
        cls += ' has-data';
        const pct = Math.round((info.done / info.total) * 100);
        pctLabel = `${pct}%`;
        
        if (pct === 100) cls += ' pct-100';
        else if (pct >= 80) cls += ' pct-80';
        else if (pct >= 60) cls += ' pct-60';
        else if (pct >= 40) cls += ' pct-40';
        else if (pct > 0) cls += ' pct-20';
      }
      if (key === tk) cls += ' is-today';
      html += `<div class="${cls}" data-date="${key}"><div class="day-num">${d}</div>${pctLabel ? `<div class="day-pct">${pctLabel}</div>` : ''}</div>`;
    }
    html += `</div>`;
    document.getElementById('monthGridWrap').innerHTML = html;

    document.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
      cell.addEventListener('click', () => jumpToDay(cell.dataset.date));
    });
  }

  function jumpToDay(dateStr) {
    if (window.__planGoTo) window.__planGoTo(dateStr);
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.tab-btn[data-tab="plan"]').classList.add('active');
    document.getElementById('scroll-plan').classList.remove('hidden');
    document.getElementById('scroll-flow').classList.add('hidden');
    document.getElementById('scroll-month').classList.add('hidden');
  }

  async function refresh() {
    document.getElementById('monthGridWrap').innerHTML = `<div class="month-loading">loading month…</div>`;
    const data = await fetchMonthData();
    const weekendType = await Store.get('weekendType') || 'sat-sun';
    document.getElementById('weekendSelect').value = weekendType;
    renderGrid(data, weekendType);
  }

  document.getElementById('weekendSelect').onchange = (e) => {
    Store.set('weekendType', e.target.value).then(refresh);
  };

  document.getElementById('monthPrevBtn').onclick = () => {
    view.month -= 1;
    if (view.month < 0) { view.month = 11; view.year -= 1; }
    refresh();
  };
  document.getElementById('monthNextBtn').onclick = () => {
    view.month += 1;
    if (view.month > 11) { view.month = 0; view.year += 1; }
    refresh();
  };

  window.__monthRefresh = refresh;
  document.getElementById('monthLabel').textContent = monthLabel(view.year, view.month);
})();

/* ===================== TAB SWITCHING ===================== */
(function () {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const scrollPanels = {
    plan: document.getElementById('scroll-plan'),
    flow: document.getElementById('scroll-flow'),
    month: document.getElementById('scroll-month')
  };
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      Object.keys(scrollPanels).forEach(k => scrollPanels[k].classList.toggle('hidden', k !== btn.dataset.tab));
      if (btn.dataset.tab === 'month' && window.__monthRefresh) window.__monthRefresh();
    });
  });
})();

/* ===================== THEME TOGGLE ===================== */
(function() {
  Store.get('theme').then(theme => {
    if (theme === 'light') document.body.classList.add('theme-light');
  });

  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.addEventListener('click', () => {
      const isLight = document.body.classList.toggle('theme-light');
      Store.set('theme', isLight ? 'light' : 'dark');
    });
  }
})();
