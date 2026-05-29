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

// 1. IN-MEMORY STATE (keeps UI instant)
let taskState = [];

async function loadTasks() {
    taskState = await supabase('GET', 'tasks?order=task_number.asc');
}

// 2. RENDERING
function renderBoard(tasks) {
    const backlogCol = document.getElementById('backlog-container');
    const inprogressCol = document.getElementById('inprogress-container');
    const doneCol = document.getElementById('done-container');

    backlogCol.innerHTML = '';
    inprogressCol.innerHTML = '';
    doneCol.innerHTML = '';

    tasks.forEach(task => {
        const moveButton = task.status !== 'done'
            ? `<button draggable="false" class="flex-1 bg-m7-gray text-[10px] py-2 uppercase hover:bg-gray-700" onclick="moveTask('${task.id}', '${task.status}')">Move</button>`
            : '';

        const cardHTML = `
            <div class="task-card border-m7 p-4 bg-m7-dark-gray hover:border-gray-500 transition-colors cursor-grab active:cursor-grabbing"
                 draggable="true"
                 ondragstart="handleDragStart(event, '${task.id}')"
                 ondragend="handleDragEnd(event)"
                 ondragover="handleDragOver(event)"
                 ondrop="handleCardDrop(event)">
                <div class="flex justify-between text-[10px] text-gray-500 mb-3">
                    <span>#${task.task_number}</span>
                </div>
                <p class="text-xs font-bold mb-4 tracking-tighter">${task.description}</p>
                <div class="flex gap-2">
                    ${moveButton}
                    <button draggable="false" class="p-2 bg-m7-dark-gray hover:bg-red-900/20 transition-colors border border-red-500" onclick="deleteTask('${task.id}')">
                        <svg class="h-4 w-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;

        if (task.status === 'backlog') backlogCol.innerHTML += cardHTML;
        else if (task.status === 'in-progress') inprogressCol.innerHTML += cardHTML;
        else if (task.status === 'done') doneCol.innerHTML += cardHTML;
    });
}

async function refreshBoard() {
    await loadTasks();
    renderBoard(taskState);
}

// 3. CORE ACTIONS
async function moveTask(taskId, currentStatus) {
    const next = { backlog: 'in-progress', 'in-progress': 'done', done: 'backlog' };
    const newStatus = next[currentStatus];
    const task = taskState.find(t => t.id === taskId);
    if (task) { task.status = newStatus; renderBoard(taskState); }
    supabase('PATCH', `tasks?id=eq.${encodeURIComponent(taskId)}`, { status: newStatus });
}

async function deleteTask(taskId) {
    taskState = taskState.filter(t => t.id !== taskId);
    renderBoard(taskState);
    supabase('DELETE', `tasks?id=eq.${encodeURIComponent(taskId)}`);
}

async function createNewTask() {
    const inputElement = document.getElementById('task-input');
    const taskText = inputElement.value.trim();
    if (taskText === '') return;

    const generatedId = crypto.randomUUID();
    const tempTask = { id: generatedId, description: taskText.toUpperCase(), status: 'backlog', task_number: '...' };
    taskState.push(tempTask);
    renderBoard(taskState);
    inputElement.value = '';
    document.getElementById('create-btn').disabled = true;

    const created = await supabase('POST', 'tasks', {
        id: generatedId,
        description: tempTask.description,
        status: 'backlog'
    });
    if (created[0]) { tempTask.task_number = created[0].task_number; renderBoard(taskState); }
}

// 4. DRAG AND DROP
function handleDragStart(event, taskId) {
    event.dataTransfer.setData('text/plain', taskId);
    setTimeout(() => { event.target.style.opacity = '0'; }, 0);
}

function handleDragEnd(event) {
    event.target.style.opacity = '1';
}

function handleDragOver(event) {
    event.preventDefault();
}

function applyDrop(taskId, targetStatus) {
    const task = taskState.find(t => t.id === taskId);
    if (task) { task.status = targetStatus; renderBoard(taskState); }
    supabase('PATCH', `tasks?id=eq.${encodeURIComponent(taskId)}`, { status: targetStatus });
}

function handleDrop(event, targetStatus) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/plain');
    if (taskId) applyDrop(taskId, targetStatus);
}

function handleCardDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    const taskId = event.dataTransfer.getData('text/plain');
    if (!taskId) return;
    const container = event.currentTarget.closest('[data-status]');
    if (container) applyDrop(taskId, container.dataset.status);
}

// 5. INIT
window.onload = async () => {
    await refreshBoard();
};
