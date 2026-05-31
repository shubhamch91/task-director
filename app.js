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
const DB_TABLE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'tasks_dev'
    : 'tasks';
let taskState = [];
let editingTaskId = null;
let editDraft = '';
let lastDroppedId = null;

async function loadTasks() {
    taskState = await supabase('GET', `${DB_TABLE}?order=task_number.asc`);
}

// 2. RENDER BOTH VIEWS
function render() {
    renderDesktop(taskState);
    renderMobile(taskState);
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

    tasks.forEach(task => {
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
                 ondragover="handleDragOver(event)"
                 ondrop="handleCardDrop(event)">
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

    const backlog = tasks.filter(t => t.status === 'backlog');
    const inprogress = tasks.filter(t => t.status === 'in-progress');
    const done = tasks.filter(t => t.status === 'done');

    if (backlog.length === 0) backlogEl.innerHTML = empty;
    if (inprogress.length === 0) inprogressEl.innerHTML = empty;
    if (done.length === 0) doneEl.innerHTML = empty;

    tasks.forEach(task => {
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
                <div style="border: 1px solid #222; background: #141414; padding: 14px;">
                    <div style="font-size: 10px; color: #6b7280; margin-bottom: 12px;">#${num}</div>
                    <div style="font-size: 13px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.45; color: #e5e7eb; margin-bottom: 14px;">${task.description}</div>
                    <div style="display: flex; gap: 8px;">
                        <button class="${moveClass}" ontouchend="event.preventDefault(); if(isTap(event)) moveTask('${task.id}', '${task.status}')">${moveLabel} ${moveArrow}</button>
                        <button class="mob-btn-edit" ontouchend="event.preventDefault(); if(isTap(event)) enterInlineEdit('${task.id}')">${EDIT_ICON}</button>
                        <button class="mob-btn-del" ontouchend="event.preventDefault(); if(isTap(event)) deleteTask('${task.id}')">${TRASH_ICON}</button>
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

    // Mobile
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

    // Desktop
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
    if (task) { task.status = newStatus; render(); }
    supabase('PATCH', `${DB_TABLE}?id=eq.${encodeURIComponent(taskId)}`, { status: newStatus });
}

async function deleteTask(taskId) {
    taskState = taskState.filter(t => t.id !== taskId);
    render();
    supabase('DELETE', `${DB_TABLE}?id=eq.${encodeURIComponent(taskId)}`);
}

async function createNewTask() {
    const inputElement = document.getElementById('task-input');
    const taskText = inputElement.value.trim();
    if (taskText === '') return;
    const generatedId = crypto.randomUUID();
    const tempTask = { id: generatedId, description: taskText.toUpperCase(), status: 'backlog', task_number: '...' };
    taskState.push(tempTask);
    render();
    inputElement.value = '';
    document.getElementById('create-btn').disabled = true;
    const created = await supabase('POST', DB_TABLE, { id: generatedId, description: tempTask.description, status: 'backlog' });
    if (created[0]) { tempTask.task_number = created[0].task_number; render(); }
}

async function createNewTaskMobile() {
    const inputEl = document.getElementById('mob-task-input');
    const taskText = inputEl.value.trim();
    if (taskText === '') return;
    const generatedId = crypto.randomUUID();
    const tempTask = { id: generatedId, description: taskText.toUpperCase(), status: 'backlog', task_number: '...' };
    taskState.unshift(tempTask); // newest first on mobile
    render();
    inputEl.value = '';
    document.getElementById('mobile-create-btn').disabled = true;
    closeSheet();
    scrollToColumn(0); // jump to backlog
    const created = await supabase('POST', DB_TABLE, { id: generatedId, description: tempTask.description, status: 'backlog' });
    if (created[0]) { tempTask.task_number = created[0].task_number; render(); }
}

// 4. DESKTOP DRAG AND DROP
function handleDragStart(event, taskId) {
    event.dataTransfer.setData('text/plain', taskId);
    setTimeout(() => { event.target.style.opacity = '0'; }, 0);
}
function handleDragEnd(event) { event.target.style.opacity = '1'; }
function handleDragOver(event) { event.preventDefault(); }

function applyDrop(taskId, targetStatus, dropY) {
    const task = taskState.find(t => t.id === taskId);
    if (!task) return;
    task.status = targetStatus;
    lastDroppedId = taskId;
    render();

    // Animate from drop position to final position
    const cardEl = document.querySelector(`.task-card[data-id="${taskId}"]`);
    if (cardEl && dropY != null) {
        const finalTop = cardEl.getBoundingClientRect().top;
        const offset = dropY - finalTop;
        cardEl.style.transition = 'none';
        cardEl.style.transform = `translateY(${offset}px)`;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                cardEl.style.transition = 'transform 0.28s ease-out';
                cardEl.style.transform = 'translateY(0)';
            });
        });
    }

    setTimeout(() => { lastDroppedId = null; }, 300);
    supabase('PATCH', `${DB_TABLE}?id=eq.${encodeURIComponent(taskId)}`, { status: targetStatus });
}
function handleDrop(event, targetStatus) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/plain');
    if (taskId) applyDrop(taskId, targetStatus, event.clientY);
}
function handleCardDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    const taskId = event.dataTransfer.getData('text/plain');
    if (!taskId) return;
    const container = event.currentTarget.closest('[data-status]');
    if (container) applyDrop(taskId, container.dataset.status, event.clientY);
}

// 5. MOBILE SHEET
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

// 7. LIVE CLOCK
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

// 8. MOBILE TAP DETECTION
let _didScroll = false;
document.addEventListener('touchstart', () => { _didScroll = false; }, { passive: true });
document.addEventListener('touchmove', () => { _didScroll = true; }, { passive: true });

function isTap(event) {
    return !_didScroll;
}

// 9. INIT
window.onload = async () => {
    updateClock();
    setInterval(updateClock, 15000);

    const board = document.getElementById('mobile-board');
    if (board) board.addEventListener('scroll', updateActiveColumn, { passive: true });

    await loadTasks();
    render();
    updateActiveColumn();
};
