// ==========================================
// M7 TASK-DIRECTOR CORE ENGINE
// ==========================================

const SUPABASE_URL = 'https://atjfbkcsfwwvsbltnsyb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_zoP_xSnBqNGwxXmh-mWrog_L4TX3hXE';

// Helper: talk to Supabase REST API
async function supabase(method, path, body = null) {
    const options = {
        method,
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }
    };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, options);
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`SUPABASE ERROR // ${err}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : [];
}

// 1. IN-MEMORY STATE
const DB_TABLE      = window.location.hostname.includes('github.io') ? 'tasks'      : 'tasks_dev';
const SPACES_TABLE  = window.location.hostname.includes('github.io') ? 'spaces'     : 'spaces_dev';

let taskState      = [];
let spacesState    = [];
let activeSpaceId  = null;
let editingTaskId  = null;
let managingSpaceId = null;
let taskOrder      = {};
let dragPlaceholder = null;
let draggingId      = null;
let editDraft      = '';
let lastDroppedId  = null;

async function loadTasks() {
    taskState = await supabase('GET', `${DB_TABLE}?order=task_number.asc`);
}

async function loadSpaces() {
    spacesState = await supabase('GET', `${SPACES_TABLE}?order=created_at.asc`);
    if (spacesState.length > 0 && !activeSpaceId) {
        activeSpaceId = spacesState[0].id;
    }
}

// 2. RENDER BOTH VIEWS
function render() {
    const filteredTasks = activeSpaceId
        ? taskState.filter(t => t.space_id === activeSpaceId)
        : taskState;

    renderDesktop(filteredTasks);
    updateDesktopStats(filteredTasks);
    renderSpacesSwitcher();

    renderMobile(filteredTasks);
    renderMobileSpaces();
}

// ---- TASK ORDER (manual column positions, persisted to Supabase) ----
function syncTaskOrder() {
    ['backlog', 'in-progress', 'done'].forEach(status => {
        const inStatus = taskState.filter(t => t.status === status);
        inStatus.sort((a, b) => {
            const pa = a.position ?? Infinity;
            const pb = b.position ?? Infinity;
            if (pa !== pb) return pa - pb;
            return (a.task_number ?? 0) - (b.task_number ?? 0);
        });
        taskOrder[status] = inStatus.map(t => t.id);
    });
}

function persistColumnOrder(status) {
    const ids = taskOrder[status] || [];
    ids.forEach((id, index) => {
        const task = taskState.find(t => t.id === id);
        if (task) task.position = index;
        supabase('PATCH', `${DB_TABLE}?id=eq.${encodeURIComponent(id)}`, { position: index });
    });
}

async function migrateLocalStorageOrder() {
    const allNull = taskState.every(t => t.position == null);
    if (!allNull) return;
    const stored = localStorage.getItem('td_task_order');
    if (!stored) return;
    try {
        const localOrder = JSON.parse(stored);
        for (const [status, ids] of Object.entries(localOrder)) {
            if (!Array.isArray(ids)) continue;
            for (let i = 0; i < ids.length; i++) {
                const task = taskState.find(t => t.id === ids[i]);
                if (task) {
                    task.position = i;
                    await supabase('PATCH', `${DB_TABLE}?id=eq.${encodeURIComponent(ids[i])}`, { position: i });
                }
            }
        }
        localStorage.removeItem('td_task_order');
    } catch (e) { console.warn('Position migration failed', e); }
}

function orderedForRender(tasks, status) {
    const order = taskOrder[status] || [];
    const inStatus = tasks.filter(t => t.status === status);
    const ordered = order.map(id => inStatus.find(t => t.id === id)).filter(Boolean);
    const rest = inStatus.filter(t => !order.includes(t.id));
    return [...ordered, ...rest];
}

// ---- DESKTOP ----
function renderDesktop(tasks) {
    const backlogCol = document.getElementById('backlog-container');
    const inprogressCol = document.getElementById('inprogress-container');
    const doneCol = document.getElementById('done-container');
    if (!backlogCol) return;

    backlogCol.innerHTML = '';
    inprogressCol.innerHTML = '';
    doneCol.innerHTML = '';

    const orderedTasks = [
        ...orderedForRender(tasks, 'backlog'),
        ...orderedForRender(tasks, 'in-progress'),
        ...orderedForRender(tasks, 'done'),
    ];
    orderedTasks.forEach(task => {
        const isEditing = editingTaskId === task.id;
        const moveLabel = task.status === 'done' ? 'Reset' : 'Move';

        let cardInner;
        if (isEditing) {
            cardInner = `
                <div class="p-3 flex flex-col h-full justify-between">
                    <div class="flex justify-between text-[9px] text-gray-500">
                        <span>#${task.task_number}</span>
                    </div>
                    <div class="flex items-center">
                        <input id="edit-input-${task.id}"
                            class="w-full bg-transparent border border-m7-neon text-m7-neon px-2 py-0.5 text-[11px] font-mono outline-none uppercase focus:ring-0 leading-tight h-[22px]"
                            value="${task.description}"
                            oninput="editDraft = this.value"
                            onchange="editDraft = this.value"
                            onblur="editDraft = this.value"
                            onkeydown="if(event.key==='Enter'){event.preventDefault();saveInlineEdit('${task.id}');}else if(event.key==='Escape')cancelInlineEdit()">
                    </div>
                    <div class="flex items-center gap-1.5 h-7">
                        <button draggable="false" class="flex-1 bg-m7-neon text-black font-bold text-[9px] h-full uppercase hover:bg-m7-neon/90"
                                onclick="saveInlineEdit('${task.id}')">Save</button>
                        <button draggable="false" class="flex-1 border border-m7-gray text-gray-500 text-[9px] h-full uppercase hover:bg-m7-gray"
                                onclick="cancelInlineEdit()">Cancel</button>
                    </div>
                </div>`;
        } else {
            cardInner = `
                <div class="p-3 flex flex-col h-full justify-between">
                    <div class="flex justify-between text-[9px] text-gray-500">
                        <span>#${task.task_number}</span>
                    </div>
                    <div class="flex items-center">
                        <p class="text-[11px] font-bold tracking-tight leading-snug uppercase truncate w-full" title="${task.description}">${task.description}</p>
                    </div>
                    <div class="flex items-center gap-1.5 h-7">
                        <button draggable="false" class="flex-1 bg-m7-gray text-[9px] h-full uppercase hover:bg-gray-700 transition-colors"
                                onclick="moveTask('${task.id}', '${task.status}')">${moveLabel}</button>
                        <button draggable="false" class="w-7 h-7 flex items-center justify-center bg-m7-dark-gray hover:bg-m7-gray transition-colors border border-m7-border text-gray-500 hover:text-m7-neon"
                                onclick="enterInlineEdit('${task.id}')" title="Edit Task">
                            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
                            </svg>
                        </button>
                        <button draggable="false" class="w-7 h-7 flex items-center justify-center bg-m7-dark-gray hover:bg-red-900/20 transition-colors border border-red-500/30"
                                onclick="deleteTask('${task.id}')">
                            <svg class="h-3.5 w-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
                            </svg>
                        </button>
                    </div>
                </div>`;
        }

        const dropClass = task.id === lastDroppedId ? 'card-just-dropped' : '';

        const cardHTML = `
            <div class="task-card border-m7 bg-m7-dark-gray hover:border-gray-500 transition-colors ${isEditing ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'} ${dropClass}"
                 data-id="${task.id}"
                 draggable="${!isEditing}"
                 ondragstart="handleDragStart(event, '${task.id}')"
                 ondragend="handleDragEnd(event)"
                 ondragover="handleDragOver(event)">
                ${cardInner}
            </div>`;

        if (task.status === 'backlog') backlogCol.innerHTML += cardHTML;
        else if (task.status === 'in-progress') inprogressCol.innerHTML += cardHTML;
        else if (task.status === 'done') doneCol.innerHTML += cardHTML;
    });
}

// ---- MOBILE ----
const ARROW_ICON = `<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
const TRASH_ICON = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>`;
const EDIT_ICON = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" viewBox="0 0 24 24"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>`;

function renderMobile(tasks) {
    const backlogEl = document.getElementById('mob-backlog');
    const inprogressEl = document.getElementById('mob-inprogress');
    const doneEl = document.getElementById('mob-done');
    if (!backlogEl) return;

    backlogEl.innerHTML = '';
    inprogressEl.innerHTML = '';
    doneEl.innerHTML = '';

    const empty = `<div style="font-size: 10px; color: #2a2a2a; letter-spacing: 0.1em; padding: 10px 2px;">// NO PROTOCOLS</div>`;

    const backlog = orderedForRender(tasks, 'backlog');
    const inprogress = orderedForRender(tasks, 'in-progress');
    const done = orderedForRender(tasks, 'done');

    if (backlog.length === 0) backlogEl.innerHTML = empty;
    if (inprogress.length === 0) inprogressEl.innerHTML = empty;
    if (done.length === 0) doneEl.innerHTML = empty;

    [...backlog, ...inprogress, ...done].forEach(task => {
        const isEditing = editingTaskId === task.id;
        const num = String(task.task_number).padStart(3, '0');
        let card;

        if (isEditing) {
            card = `
                <div style="border: 1px solid #222; background: #141414; padding: 14px;">
                    <div style="font-size: 10px; color: #6b7280; margin-bottom: 12px;">#${num}</div>
                    <div style="margin-bottom: 14px;">
                        <input id="mob-edit-input-${task.id}"
                            style="width: 100%; background: transparent; border: 1px solid #00ff7f; color: #00ff7f; font-family: inherit; font-size: 13px; font-weight: 700; padding: 6px 8px; text-transform: uppercase; outline: none; line-height: 1.45;"
                            value="${task.description}"
                            oninput="editDraft = this.value"
                            onchange="editDraft = this.value"
                            onblur="editDraft = this.value"
                            onkeydown="if(event.key==='Enter'){event.preventDefault();saveInlineEdit('${task.id}');}else if(event.key==='Escape')cancelInlineEdit()">
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="mob-btn-move" style="background: #00ff7f; color: #000;" ontouchend="event.preventDefault(); if(isTap(event)) saveInlineEdit('${task.id}')">SAVE</button>
                        <button class="mob-btn-del" style="border-color: #4b5563; color: #4b5563;" ontouchend="event.preventDefault(); if(isTap(event)) cancelInlineEdit()">
                            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                    </div>
                </div>`;
        } else {
            const isDone = task.status === 'done';
            const moveLabel = isDone ? 'RESET' : 'MOVE';
            const moveClass = isDone ? 'mob-btn-move is-reset' : 'mob-btn-move';
            const moveArrow = isDone ? '' : ARROW_ICON;

            card = `
                <div class="mob-card" data-id="${task.id}" style="border: 1px solid #222; background: #141414; padding: 14px; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;"
                     ontouchstart="mobileDragTouchStart(event, '${task.id}')"
                     ontouchmove="mobileDragTouchMove(event)"
                     ontouchend="mobileDragTouchEnd(event)">
                    <div style="font-size: 10px; color: #6b7280; margin-bottom: 12px;">#${num}</div>
                    <div style="font-size: 13px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.45; color: #e5e7eb; margin-bottom: 14px;">${task.description}</div>
                    <div style="display: flex; gap: 8px;">
                        <button class="${moveClass}" ontouchend="event.stopPropagation(); event.preventDefault(); if(isTap(event)) moveTask('${task.id}', '${task.status}')">${moveLabel} ${moveArrow}</button>
                        <button class="mob-btn-edit" ontouchend="event.stopPropagation(); event.preventDefault(); if(isTap(event)) enterInlineEdit('${task.id}')">${EDIT_ICON}</button>
                        <button class="mob-btn-del" ontouchend="event.stopPropagation(); event.preventDefault(); if(isTap(event)) deleteTask('${task.id}')">${TRASH_ICON}</button>
                    </div>
                </div>`;
        }

        if (task.status === 'backlog') backlogEl.innerHTML += card;
        else if (task.status === 'in-progress') inprogressEl.innerHTML += card;
        else if (task.status === 'done') doneEl.innerHTML += card;

        if (isEditing) {
            setTimeout(() => {
                const el = document.getElementById(`mob-edit-input-${task.id}`);
                if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
            }, 10);
        }
    });

    updateMobileStats(tasks);
}

function updateMobileStats(tasks) {
    const counts = [
        tasks.filter(t => t.status === 'backlog').length,
        tasks.filter(t => t.status === 'in-progress').length,
        tasks.filter(t => t.status === 'done').length,
    ];
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    const distColors = ['#22d3ee', '#00ff7f', '#6b7280'];

    for (let i = 0; i < 3; i++) {
        const el = document.getElementById(`mob-count-${i}`);
        if (el) el.textContent = String(counts[i]).padStart(2, '0');
        const wm = document.getElementById(`mob-wm-${i}`);
        if (wm) wm.textContent = counts[i];
    }
    const mobDist = document.getElementById('mob-dist');
    if (mobDist) {
        mobDist.innerHTML = distColors.map((color, i) => {
            const grow = Math.max(counts[i] / total, 0.035);
            const opacity = i === 2 ? '0.55' : '1';
            return `<div style="flex: ${grow}; background: ${color}; opacity: ${opacity};"></div>`;
        }).join('');
    }
}

function updateDesktopStats(tasks) {
    const counts = [
        tasks.filter(t => t.status === 'backlog').length,
        tasks.filter(t => t.status === 'in-progress').length,
        tasks.filter(t => t.status === 'done').length,
    ];
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    const distColors = ['#22d3ee', '#00ff7f', '#6b7280'];

    for (let i = 0; i < 3; i++) {
        const el = document.getElementById(`desk-count-${i}`);
        if (el) el.textContent = String(counts[i]).padStart(2, '0');
    }
    const deskDist = document.getElementById('desk-dist');
    if (deskDist) {
        deskDist.innerHTML = distColors.map((color, i) => {
            const grow = Math.max(counts[i] / total, 0.035);
            const opacity = i === 2 ? '0.4' : '1';
            return `<div class="dist-segment" style="flex: ${grow}; background: ${color}; opacity: ${opacity};"></div>`;
        }).join('');
    }
}

// 3. CORE ACTIONS

function enterInlineEdit(taskId) {
    const task = taskState.find(t => t.id === taskId);
    editingTaskId = taskId;
    editDraft = task ? task.description : '';
    render();
    setTimeout(() => {
        const el = document.getElementById(`edit-input-${taskId}`) || document.getElementById(`mob-edit-input-${taskId}`);
        if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }, 10);
}

function cancelInlineEdit() {
    editingTaskId = null;
    render();
}

async function saveInlineEdit(taskId) {
    const task = taskState.find(t => t.id === taskId);
    if (!task) return;
    const newDesc = editDraft.trim();
    if (newDesc === '') { cancelInlineEdit(); return; }
    task.description = newDesc.toUpperCase();
    editingTaskId = null;
    editDraft = '';
    render();
    supabase('PATCH', `${DB_TABLE}?id=eq.${encodeURIComponent(taskId)}`, { description: task.description });
}

async function moveTask(taskId, currentStatus) {
    const next = { backlog: 'in-progress', 'in-progress': 'done', done: 'backlog' };
    const newStatus = next[currentStatus];
    const task = taskState.find(t => t.id === taskId);
    if (task) {
        task.status = newStatus;
        taskOrder[currentStatus] = (taskOrder[currentStatus] || []).filter(id => id !== taskId);
        taskOrder[newStatus] = taskOrder[newStatus] || [];
        taskOrder[newStatus].push(taskId);
        persistColumnOrder(currentStatus);
        persistColumnOrder(newStatus);
        render();
    }
    supabase('PATCH', `${DB_TABLE}?id=eq.${encodeURIComponent(taskId)}`, { status: newStatus });
}

async function deleteTask(taskId) {
    taskState = taskState.filter(t => t.id !== taskId);
    ['backlog', 'in-progress', 'done'].forEach(s => {
        taskOrder[s] = (taskOrder[s] || []).filter(id => id !== taskId);
    });
    render();
    supabase('DELETE', `${DB_TABLE}?id=eq.${encodeURIComponent(taskId)}`);
}

async function createNewTask() {
    const inputElement = document.getElementById('task-input');
    const taskText = inputElement.value.trim();
    if (taskText === '') return;
    const generatedId = crypto.randomUUID();
    const tempTask = { id: generatedId, description: taskText.toUpperCase(), status: 'backlog', task_number: '...', space_id: activeSpaceId, position: null };
    taskState.push(tempTask);
    taskOrder.backlog = taskOrder.backlog || [];
    taskOrder.backlog.unshift(generatedId);
    render();
    inputElement.value = '';
    document.getElementById('create-btn').disabled = true;
    const created = await supabase('POST', DB_TABLE, { id: generatedId, description: tempTask.description, status: 'backlog', space_id: activeSpaceId });
    if (created[0]) { tempTask.task_number = created[0].task_number; persistColumnOrder('backlog'); render(); }
}

async function createNewTaskMobile() {
    const inputEl = document.getElementById('mob-task-input');
    const taskText = inputEl.value.trim();
    if (taskText === '') return;
    const generatedId = crypto.randomUUID();
    const tempTask = { id: generatedId, description: taskText.toUpperCase(), status: 'backlog', task_number: '...', space_id: activeSpaceId, position: null };
    taskState.unshift(tempTask);
    taskOrder.backlog = taskOrder.backlog || [];
    taskOrder.backlog.unshift(generatedId);
    render();
    inputEl.value = '';
    document.getElementById('mobile-create-btn').disabled = true;
    closeSheet();
    scrollToColumn(0);
    const created = await supabase('POST', DB_TABLE, { id: generatedId, description: tempTask.description, status: 'backlog', space_id: activeSpaceId });
    if (created[0]) { tempTask.task_number = created[0].task_number; persistColumnOrder('backlog'); render(); }
}

// 4. DESKTOP DRAG AND DROP
function handleDragStart(event, taskId) {
    draggingId = taskId;
    event.dataTransfer.setData('text/plain', taskId);

    dragPlaceholder = document.createElement('div');
    dragPlaceholder.className = 'drag-placeholder';

    // setTimeout so the browser captures the drag image before we hide the card
    setTimeout(() => {
        const card = document.querySelector(`.task-card[data-id="${taskId}"]`);
        if (card && card.parentNode) {
            card.parentNode.insertBefore(dragPlaceholder, card);
            card.style.display = 'none';
        }
    }, 0);
}

function handleDragEnd(event) {
    const card = document.querySelector(`.task-card[data-id="${draggingId}"]`);
    if (card) card.style.display = '';
    if (dragPlaceholder && dragPlaceholder.parentNode) dragPlaceholder.parentNode.removeChild(dragPlaceholder);
    dragPlaceholder = null;
    draggingId = null;
}

function handleDragOver(event) {
    event.preventDefault();
    if (!dragPlaceholder || !draggingId) return;

    const container = event.target.closest('[data-status]');
    if (!container) return;

    const collectCards = (col) => col
        ? [...col.querySelectorAll('.task-card')].filter(c => c.dataset.id !== draggingId)
        : [];

    const oldContainer = dragPlaceholder.parentNode;
    const allCards = [...new Set([...collectCards(oldContainer), ...collectCards(container)])];

    // Settle any in-progress animations before measuring — prevents oscillation
    // caused by reading mid-animation getBoundingClientRect values.
    allCards.forEach(c => { c.style.transition = 'none'; c.style.transform = ''; });

    // Find insertion point by scanning card positions (not event.target), so
    // off-screen cards pushed down by the placeholder are still considered.
    let ref = null;
    for (const card of collectCards(container)) {
        const rect = card.getBoundingClientRect();
        if (event.clientY < rect.top + rect.height / 2) { ref = card; break; }
    }

    // Skip if placeholder is already in the right spot
    if (dragPlaceholder.parentNode === container && dragPlaceholder.nextSibling === ref) return;

    // FLIP — snapshot layout positions after settling transforms
    const snapshots = new Map(allCards.map(c => [c, c.getBoundingClientRect().top]));

    container.insertBefore(dragPlaceholder, ref);

    allCards.forEach(c => {
        const delta = (snapshots.get(c) || 0) - c.getBoundingClientRect().top;
        if (Math.abs(delta) < 0.5) return;
        c.style.transform = `translateY(${delta}px)`;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            c.style.transition = 'transform 0.15s ease-out';
            c.style.transform = '';
        }));
    });
}

function handleDrop(event, targetStatus) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/plain');
    if (!taskId) return;

    const task = taskState.find(t => t.id === taskId);
    if (!task) return;

    const oldStatus = task.status;
    let newStatus = targetStatus;
    let newOrder = null;

    // Read insertion position from placeholder's current DOM location
    if (dragPlaceholder && dragPlaceholder.parentNode) {
        const container = dragPlaceholder.parentNode;
        newStatus = container.dataset.status || targetStatus;
        newOrder = [];
        for (const child of container.children) {
            if (child.classList.contains('drag-placeholder')) newOrder.push(taskId);
            else if (child.dataset.id && child.dataset.id !== taskId) newOrder.push(child.dataset.id);
        }
        if (!newOrder.includes(taskId)) newOrder.push(taskId);
    }

    // Update task status
    if (task.status !== newStatus) {
        task.status = newStatus;
        supabase('PATCH', `${DB_TABLE}?id=eq.${encodeURIComponent(taskId)}`, { status: newStatus });
    }

    // Remove from old column order when changing columns
    if (oldStatus !== newStatus) {
        taskOrder[oldStatus] = (taskOrder[oldStatus] || []).filter(id => id !== taskId);
    }

    // Merge current-space new order with other spaces' tasks (which aren't visible
    // in the DOM but must stay in taskOrder so persistColumnOrder doesn't lose them)
    if (newOrder) {
        const otherSpaceIds = (taskOrder[newStatus] || []).filter(id => {
            const t = taskState.find(task => task.id === id);
            return t && t.space_id !== activeSpaceId;
        });
        taskOrder[newStatus] = [...newOrder, ...otherSpaceIds];
    }
    persistColumnOrder(newStatus);
    if (oldStatus !== newStatus) persistColumnOrder(oldStatus);

    lastDroppedId = taskId;
    const dropY = event.clientY;
    render();

    const cardEl = document.querySelector(`.task-card[data-id="${taskId}"]`);
    if (cardEl && dropY != null) {
        const finalTop = cardEl.getBoundingClientRect().top;
        const offset = dropY - finalTop;
        if (Math.abs(offset) > 4) {
            cardEl.style.transition = 'none';
            cardEl.style.transform = `translateY(${offset}px)`;
            requestAnimationFrame(() => requestAnimationFrame(() => {
                cardEl.style.transition = 'transform 0.25s ease-out';
                cardEl.style.transform = 'translateY(0)';
            }));
        }
    }

    setTimeout(() => { lastDroppedId = null; }, 300);
}

// 5. MOBILE TOUCH DRAG AND DROP
let mobDragId = null;
let mobDragClone = null;
let mobDragPlaceholder = null;
let mobDragLongPressTimer = null;
let mobDragStartX = 0;
let mobDragStartY = 0;
let mobDragOffsetX = 0;
let mobDragOffsetY = 0;
let mobDragActive = false;
let mobDragColTimer = null;   // timer for auto-swipe between columns
let mobDragColCooldown = false; // true after a switch until finger returns to neutral

function _mobDragPreventScroll(e) { if (mobDragActive) e.preventDefault(); }
function mobDragLockScroll()   { document.addEventListener('touchmove', _mobDragPreventScroll, { passive: false }); }
function mobDragUnlockScroll() { document.removeEventListener('touchmove', _mobDragPreventScroll); }

function mobileDragTouchStart(event, taskId) {
    // Only respond to single-finger touch on the card itself (not buttons)
    if (event.target.closest('button')) return;
    const touch = event.touches[0];
    mobDragStartX = touch.clientX;
    mobDragStartY = touch.clientY;

    mobDragLongPressTimer = setTimeout(() => {
        const card = document.querySelector(`.mob-card[data-id="${taskId}"]`);
        if (!card) return;
        const rect = card.getBoundingClientRect();
        mobDragOffsetX = touch.clientX - rect.left;
        mobDragOffsetY = touch.clientY - rect.top;

        mobDragId = taskId;
        mobDragActive = true;
        _didScroll = true; // suppress tap
        mobDragLockScroll();

        // Create floating clone — set individual props to preserve card's background/border inline styles
        mobDragClone = card.cloneNode(true);
        mobDragClone.style.position    = 'fixed';
        mobDragClone.style.left        = rect.left + 'px';
        mobDragClone.style.top         = rect.top + 'px';
        mobDragClone.style.width       = rect.width + 'px';
        mobDragClone.style.opacity     = '0.9';
        mobDragClone.style.zIndex      = '9999';
        mobDragClone.style.pointerEvents = 'none';
        mobDragClone.style.boxShadow   = '0 8px 32px rgba(0,255,127,0.25)';
        mobDragClone.style.borderColor = '#00ff7f';
        mobDragClone.style.transition  = 'none';
        document.body.appendChild(mobDragClone);

        // Lock selection on the whole document for the duration of the drag
        document.body.style.userSelect       = 'none';
        document.body.style.webkitUserSelect = 'none';

        // Placeholder in original position
        mobDragPlaceholder = document.createElement('div');
        mobDragPlaceholder.className = 'drag-placeholder';
        card.parentNode.insertBefore(mobDragPlaceholder, card);
        card.style.display = 'none';

        if (navigator.vibrate) navigator.vibrate(40);
    }, 350);
}

function mobDragPlaceholderIntoColumn(colIndex, touchY) {
    const colIds = ['mob-backlog', 'mob-inprogress', 'mob-done'];
    const container = document.getElementById(colIds[colIndex]);
    if (!container) return;

    const cards = [...container.querySelectorAll('.mob-card')].filter(c => c.dataset.id !== mobDragId);
    let ref = null;
    // touchY may be stale after a column switch — default to appending at end
    if (touchY != null) {
        for (const c of cards) {
            const r = c.getBoundingClientRect();
            if (touchY < r.top + r.height / 2) { ref = c; break; }
        }
    }
    if (mobDragPlaceholder.parentNode === container && mobDragPlaceholder.nextSibling === ref) return;
    container.insertBefore(mobDragPlaceholder, ref);
}

function mobileDragTouchMove(event) {
    // Cancel long press if finger moved too far before timer fires
    if (mobDragLongPressTimer && !mobDragActive) {
        const touch = event.touches[0];
        if (Math.abs(touch.clientX - mobDragStartX) > 8 || Math.abs(touch.clientY - mobDragStartY) > 8) {
            clearTimeout(mobDragLongPressTimer);
            mobDragLongPressTimer = null;
        }
        return;
    }
    if (!mobDragActive || !mobDragClone) return;

    const touch = event.touches[0];
    const w = window.innerWidth;

    // Move clone to follow finger
    mobDragClone.style.left = (touch.clientX - mobDragOffsetX) + 'px';
    mobDragClone.style.top  = (touch.clientY - mobDragOffsetY) + 'px';

    // ---- Auto-swipe to adjacent column when finger crosses 50% of screen edge ----
    const inRightZone = touch.clientX > w * 0.5 && activeColumn < 2;
    const inLeftZone  = touch.clientX < w * 0.5 && activeColumn > 0;
    const inNeutral   = touch.clientX >= w * 0.25 && touch.clientX <= w * 0.75;

    // Clear cooldown once finger returns to the neutral middle band
    if (mobDragColCooldown && inNeutral) mobDragColCooldown = false;

    if (!mobDragColCooldown && (inRightZone || inLeftZone)) {
        if (!mobDragColTimer) {
            mobDragColTimer = setTimeout(() => {
                mobDragColTimer = null;
                mobDragColCooldown = true; // block re-trigger until finger resets
                const targetCol = inRightZone ? activeColumn + 1 : activeColumn - 1;
                activeColumn = targetCol;
                scrollToColumn(targetCol);
                // Move placeholder into the new column after scroll animates (~350ms)
                setTimeout(() => mobDragPlaceholderIntoColumn(targetCol, null), 380);
            }, 400);
        }
    } else {
        // Finger moved back into safe zone or cooldown active — cancel pending switch
        if (mobDragColTimer) { clearTimeout(mobDragColTimer); mobDragColTimer = null; }
    }

    // ---- Update placeholder position within the currently visible column ----
    mobDragClone.style.visibility = 'hidden';
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    mobDragClone.style.visibility = '';
    if (!el) return;

    const container = el.closest('[data-status]');
    if (!container) return;

    const cards = [...container.querySelectorAll('.mob-card')].filter(c => c.dataset.id !== mobDragId);
    let ref = null;
    for (const c of cards) {
        const r = c.getBoundingClientRect();
        if (touch.clientY < r.top + r.height / 2) { ref = c; break; }
    }

    if (mobDragPlaceholder.parentNode === container && mobDragPlaceholder.nextSibling === ref) return;
    container.insertBefore(mobDragPlaceholder, ref);
}

function mobileDragTouchEnd(event) {
    clearTimeout(mobDragLongPressTimer);
    mobDragLongPressTimer = null;

    if (!mobDragActive) return;
    mobDragActive = false;
    mobDragUnlockScroll();
    if (mobDragColTimer) { clearTimeout(mobDragColTimer); mobDragColTimer = null; }
    mobDragColCooldown = false;

    // Unlock text selection
    document.body.style.userSelect       = '';
    document.body.style.webkitUserSelect = '';

    // Restore original card display
    const card = document.querySelector(`.mob-card[data-id="${mobDragId}"]`);
    if (card) card.style.display = '';

    if (mobDragClone) { mobDragClone.remove(); mobDragClone = null; }

    // Commit drop
    if (mobDragPlaceholder && mobDragPlaceholder.parentNode) {
        const container = mobDragPlaceholder.parentNode;
        const newStatus = container.dataset.status;
        const task = taskState.find(t => t.id === mobDragId);

        if (task) {
            const oldStatus = task.status;

            // Build new column order from DOM
            const newOrder = [];
            for (const child of container.children) {
                if (child === mobDragPlaceholder) newOrder.push(mobDragId);
                else if (child.dataset.id && child.dataset.id !== mobDragId) newOrder.push(child.dataset.id);
            }
            if (!newOrder.includes(mobDragId)) newOrder.push(mobDragId);

            if (task.status !== newStatus) {
                task.status = newStatus;
                supabase('PATCH', `${DB_TABLE}?id=eq.${encodeURIComponent(mobDragId)}`, { status: newStatus });
            }

            if (oldStatus !== newStatus) {
                taskOrder[oldStatus] = (taskOrder[oldStatus] || []).filter(id => id !== mobDragId);
            }

            const otherSpaceIds = (taskOrder[newStatus] || []).filter(id => {
                const t = taskState.find(tk => tk.id === id);
                return t && t.space_id !== activeSpaceId;
            });
            taskOrder[newStatus] = [...newOrder, ...otherSpaceIds];
            persistColumnOrder(newStatus);
            if (oldStatus !== newStatus) persistColumnOrder(oldStatus);
        }

        mobDragPlaceholder.remove();
        mobDragPlaceholder = null;
    }

    mobDragId = null;
    render();
}

// 7. MOBILE SHEET
function openSheet() {
    document.getElementById('create-sheet-root').classList.add('is-open');
    setTimeout(() => document.getElementById('mob-task-input').focus(), 60);
}
function closeSheet() {
    document.getElementById('create-sheet-root').classList.remove('is-open');
    document.getElementById('mob-task-input').value = '';
    document.getElementById('mobile-create-btn').disabled = true;
}

// 6. MOBILE COLUMN SWITCHER
let activeColumn = 0;

function scrollToColumn(col) {
    const board = document.getElementById('mobile-board');
    if (!board) return;
    board.scrollTo({ left: col * board.offsetWidth, behavior: 'smooth' });
}

function updateActiveColumn() {
    const board = document.getElementById('mobile-board');
    if (!board) return;
    const col = Math.round(board.scrollLeft / board.offsetWidth);
    if (col === activeColumn) return;
    activeColumn = col;
    for (let i = 0; i < 3; i++) {
        const stat = document.getElementById(`mob-stat-${i}`);
        if (stat) stat.style.opacity = i === col ? '1' : '0.55';
    }
}

// 7. SPACES (DESKTOP)

function renderSpacesSwitcher() {
    const container = document.getElementById('desk-spaces-list');
    if (!container) return;

    if (spacesState.length === 0) {
        container.innerHTML = `<span class="text-gray-600 text-[10px] tracking-widest">NO SPACES — HIT + TO CREATE ONE</span>`;
        return;
    }

    container.innerHTML = spacesState.map((space, i) => {
        const isActive = space.id === activeSpaceId;
        const sep = i < spacesState.length - 1
            ? `<span class="w-px h-3 bg-m7-border flex-none"></span>`
            : '';

        if (isActive) {
            return `
                <div class="flex items-center gap-1.5 text-m7-neon flex-none">
                    <span class="w-1.5 h-1.5 rounded-full bg-m7-neon shadow-[0_0_8px_rgba(0,255,127,0.8)]"></span>
                    <span>${space.name}</span>
                    <button onclick="openManageSpaceModal('${space.id}')"
                        style="background:none;border:none;padding:0 2px;cursor:pointer;"
                        class="text-gray-600 hover:text-gray-400 transition-colors flex items-center">
                        <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"
                             stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                            <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
                        </svg>
                    </button>
                </div>${sep}`;
        }
        return `
            <div class="flex items-center gap-1.5 text-gray-600 hover:text-gray-400 cursor-pointer transition-colors flex-none"
                 onclick="switchSpace('${space.id}')">
                <span>${space.name}</span>
            </div>${sep}`;
    }).join('');
}

function renderMobileSpaces() {
    const container = document.getElementById('mob-spaces-row');
    if (!container) return;

    if (spacesState.length === 0) {
        container.innerHTML = `<span style="font-size: 9px; color: #374151; letter-spacing: 0.2em; text-transform: uppercase; white-space: nowrap;">NO SPACES — HIT + TO CREATE</span>`;
        return;
    }

    container.innerHTML = spacesState.map((space, i) => {
        const isActive = space.id === activeSpaceId;
        const dot = isActive
            ? `<span style="width:6px; height:6px; border-radius:50%; background:#00ff7f; box-shadow:0 0 8px rgba(0,255,127,0.7); flex:none; display:inline-block;"></span>`
            : '';
        const sep = i < spacesState.length - 1
            ? `<span style="display:inline-block; width:1px; height:12px; background:#222222; flex:none; margin:0 12px;"></span>`
            : '';
        const pencil = isActive ? `<button
            ontouchend="event.preventDefault(); if(isTap(event)) openManageSpaceModal('${space.id}')"
            onclick="openManageSpaceModal('${space.id}')"
            style="background:none;border:none;padding:0 2px;cursor:pointer;color:#374151;display:flex;align-items:center;touch-action:manipulation;">
            <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
            </svg>
        </button>` : '';
        return `<button
            ontouchend="event.preventDefault(); if(isTap(event)) switchSpace('${space.id}')"
            onclick="switchSpace('${space.id}')"
            style="flex:none; display:flex; align-items:center; gap:5px; padding:2px 0; background:none; border:none; cursor:pointer; font-family:inherit; font-size:10px; font-weight:700; letter-spacing:0.2em; text-transform:uppercase; color:${isActive ? '#00ff7f' : '#4b5563'}; white-space:nowrap; touch-action:manipulation;"
        >${dot}${space.name}</button>${pencil}${sep}`;
    }).join('');
}

function switchSpace(spaceId) {
    activeSpaceId = spaceId;
    editingTaskId = null;
    render();
}

function openNewSpaceModal() {
    const modal = document.getElementById('new-space-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    setTimeout(() => {
        const input = document.getElementById('new-space-input');
        const btn = document.getElementById('new-space-confirm-btn');
        if (input) { input.value = ''; input.focus(); }
        if (btn) btn.disabled = true;
    }, 50);
}

function closeNewSpaceModal() {
    const modal = document.getElementById('new-space-modal');
    if (modal) modal.classList.add('hidden');
}

async function confirmNewSpace() {
    const input = document.getElementById('new-space-input');
    if (!input) return;
    const name = input.value.trim().toUpperCase();
    if (!name) return;
    closeNewSpaceModal();
    const created = await supabase('POST', SPACES_TABLE, { name });
    if (created[0]) {
        spacesState.push(created[0]);
        activeSpaceId = created[0].id;
        render();
    }
}

// 8b. MANAGE SPACE (rename / delete)

const isMobile = () => window.innerWidth < 1024;

function openManageSpaceModal(spaceId) {
    managingSpaceId = spaceId;
    const space = spacesState.find(s => s.id === spaceId);
    if (!space) return;
    const canDelete = spacesState.length > 1;

    if (isMobile()) {
        document.getElementById('mob-msp-title').textContent = 'MANAGE — ' + space.name;
        const deleteBtn = document.getElementById('mob-msp-delete-btn');
        const deleteHint = document.getElementById('mob-msp-delete-hint');
        if (canDelete) {
            deleteBtn.style.cssText = 'width:100%;min-height:50px;background:rgba(239,68,68,0.1);border:1px solid #ef4444;color:#ef4444;font-family:inherit;font-size:13px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;cursor:pointer;touch-action:manipulation;';
            deleteHint.style.display = 'none';
        } else {
            deleteBtn.style.cssText = 'width:100%;min-height:50px;background:transparent;border:1px solid #2a2a2a;color:#374151;font-family:inherit;font-size:13px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;cursor:not-allowed;opacity:0.4;touch-action:manipulation;';
            deleteHint.style.display = 'block';
        }
        document.getElementById('mob-msp-menu').style.display = 'block';
        document.getElementById('mob-msp-rename').style.display = 'none';
        const root = document.getElementById('manage-sheet-root');
        root.style.pointerEvents = 'auto';
        document.getElementById('manage-scrim').style.opacity = '1';
        document.getElementById('manage-sheet').style.transform = 'translateY(0)';
    } else {
        document.getElementById('msp-title').textContent = 'MANAGE — ' + space.name;
        const deleteBtn = document.getElementById('msp-delete-btn');
        const deleteHint = document.getElementById('msp-delete-hint');
        if (canDelete) {
            deleteBtn.className = 'w-full py-3 border border-red-500/50 text-red-500 text-sm font-bold tracking-widest uppercase hover:bg-red-900/20 transition-colors cursor-pointer';
            deleteHint.classList.add('hidden');
        } else {
            deleteBtn.className = 'w-full py-3 border border-m7-border text-gray-600 text-sm font-bold tracking-widest uppercase cursor-not-allowed opacity-40';
            deleteHint.classList.remove('hidden');
        }
        document.getElementById('msp-menu').classList.remove('hidden');
        document.getElementById('msp-rename').classList.add('hidden');
        document.getElementById('manage-space-modal').classList.remove('hidden');
    }
}

function closeManageSpaceModal() {
    if (isMobile()) {
        const root = document.getElementById('manage-sheet-root');
        root.style.pointerEvents = 'none';
        document.getElementById('manage-scrim').style.opacity = '0';
        document.getElementById('manage-sheet').style.transform = 'translateY(110%)';
    } else {
        document.getElementById('manage-space-modal').classList.add('hidden');
    }
    managingSpaceId = null;
}

function showManageMenuMode() {
    if (isMobile()) {
        document.getElementById('mob-msp-menu').style.display = 'block';
        document.getElementById('mob-msp-rename').style.display = 'none';
    } else {
        document.getElementById('msp-menu').classList.remove('hidden');
        document.getElementById('msp-rename').classList.add('hidden');
    }
}

function showManageRenameMode() {
    const space = spacesState.find(s => s.id === managingSpaceId);
    if (isMobile()) {
        const input = document.getElementById('mob-rename-space-input');
        const btn = document.getElementById('mob-msp-confirm-btn');
        if (input && space) { input.value = space.name; }
        if (btn) {
            const empty = !input || input.value.trim() === '';
            btn.disabled = empty;
            btn.style.opacity = empty ? '0.3' : '1';
            btn.style.cursor = empty ? 'not-allowed' : 'pointer';
        }
        document.getElementById('mob-msp-menu').style.display = 'none';
        document.getElementById('mob-msp-rename').style.display = 'block';
        setTimeout(() => {
            if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
        }, 50);
    } else {
        const input = document.getElementById('rename-space-input');
        const btn = document.getElementById('msp-confirm-btn');
        if (input && space) { input.value = space.name; }
        if (btn) btn.disabled = !input || input.value.trim() === '';
        document.getElementById('msp-menu').classList.add('hidden');
        document.getElementById('msp-rename').classList.remove('hidden');
        setTimeout(() => {
            if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
        }, 50);
    }
}

async function confirmRenameSpace() {
    const input = document.getElementById('rename-space-input');
    if (!input || !managingSpaceId) return;
    const name = input.value.trim().toUpperCase();
    if (!name) return;
    const space = spacesState.find(s => s.id === managingSpaceId);
    if (space) space.name = name;
    render();
    closeManageSpaceModal();
    supabase('PATCH', `${SPACES_TABLE}?id=eq.${encodeURIComponent(managingSpaceId)}`, { name });
}

async function confirmRenameSpaceMobile() {
    const input = document.getElementById('mob-rename-space-input');
    if (!input || !managingSpaceId) return;
    const name = input.value.trim().toUpperCase();
    if (!name) return;
    const space = spacesState.find(s => s.id === managingSpaceId);
    if (space) space.name = name;
    render();
    closeManageSpaceModal();
    supabase('PATCH', `${SPACES_TABLE}?id=eq.${encodeURIComponent(managingSpaceId)}`, { name });
}

async function confirmDeleteSpace() {
    if (!managingSpaceId || spacesState.length <= 1) return;
    const idToDelete = managingSpaceId;
    taskState = taskState.filter(t => t.space_id !== idToDelete);
    spacesState = spacesState.filter(s => s.id !== idToDelete);
    if (activeSpaceId === idToDelete)
        activeSpaceId = spacesState.length > 0 ? spacesState[0].id : null;
    render();
    closeManageSpaceModal();
    supabase('DELETE', `${SPACES_TABLE}?id=eq.${encodeURIComponent(idToDelete)}`);
    supabase('DELETE', `${DB_TABLE}?space_id=eq.${encodeURIComponent(idToDelete)}`);
}

// 9. LIVE CLOCK
function updateClock() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
    const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const timeStr = `${hh}:${mm}`;
    const dateStr = `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]}`;

    const mobTimeEl = document.getElementById('mob-time');
    const mobDateEl = document.getElementById('mob-date');
    if (mobTimeEl) mobTimeEl.textContent = timeStr;
    if (mobDateEl) mobDateEl.textContent = dateStr;

    const deskTimeEl = document.getElementById('desk-time');
    const deskDateEl = document.getElementById('desk-date');
    if (deskTimeEl) deskTimeEl.textContent = timeStr;
    if (deskDateEl) deskDateEl.textContent = dateStr;
}

// 10. MOBILE TAP DETECTION
let _didScroll = false;
document.addEventListener('touchstart', () => { _didScroll = false; }, { passive: true });
document.addEventListener('touchmove', () => { _didScroll = true; }, { passive: true });
// Clean up any interrupted mobile drag (e.g. incoming call, back gesture)
document.addEventListener('touchcancel', () => {
    clearTimeout(mobDragLongPressTimer);
    mobDragLongPressTimer = null;
    if (mobDragActive) {
        mobDragActive = false;
        mobDragUnlockScroll();
        if (mobDragColTimer) { clearTimeout(mobDragColTimer); mobDragColTimer = null; }
        mobDragColCooldown = false;
        document.body.style.userSelect       = '';
        document.body.style.webkitUserSelect = '';
        const card = document.querySelector(`.mob-card[data-id="${mobDragId}"]`);
        if (card) card.style.display = '';
        if (mobDragClone) { mobDragClone.remove(); mobDragClone = null; }
        if (mobDragPlaceholder) { mobDragPlaceholder.remove(); mobDragPlaceholder = null; }
        mobDragId = null;
        render();
    }
});

function isTap(event) {
    return !_didScroll;
}

// 11. INIT
window.onload = async () => {
    updateClock();
    setInterval(updateClock, 15000);

    const board = document.getElementById('mobile-board');
    if (board) board.addEventListener('scroll', updateActiveColumn, { passive: true });

    await Promise.all([loadSpaces(), loadTasks()]);
    await migrateLocalStorageOrder();
    syncTaskOrder();
    // Re-persist all column orders so any stale cross-space positions are corrected
    if (taskState.some(t => t.position != null)) {
        ['backlog', 'in-progress', 'done'].forEach(persistColumnOrder);
    }
    render();
    updateActiveColumn();
};
