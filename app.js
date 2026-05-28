// ==========================================
// M7 TASK-DIRECTOR CORE ENGINE (UNIFIED)
// ==========================================

// 1. SYSTEM DATA STATE (Source of Truth)
let taskState = [
    { id: "#089-B", description: "INTEGRITY CHECK // SECTOR_B", status: "backlog" },
    { id: "#092-A", description: "DATA RECONSTRUCTION: PHASE_1", status: "backlog" },
    { id: "#114-X", description: "NETWORK SYNCING...", status: "in-progress" },
    { id: "#044-F", description: "ENCRYPTION WRAP-UP", status: "done" }
];

// 2. THE SINGLE RENDERING SYSTEM
function renderBoard() {
    const backlogCol = document.getElementById('backlog-container');
    const inprogressCol = document.getElementById('inprogress-container');
    const doneCol = document.getElementById('done-container');

    // Safety Gate
    if (!backlogCol || !inprogressCol || !doneCol) {
        console.warn("M7 SYSTEM DELAY // DOM containers not ready yet.");
        return;
    }

    // Clear previous elements
    backlogCol.innerHTML = '';
    inprogressCol.innerHTML = '';
    doneCol.innerHTML = '';

    // Build tasks dynamically
    taskState.forEach(task => {
        let cardHTML = `
            <div class="border-m7 p-4 bg-m7-dark-gray hover:border-gray-500 transition-colors cursor-grab active:cursor-grabbing" 
                 draggable="true" 
                 ondragstart="handleDragStart(event, '${task.id}')">
                
                <div class="flex justify-between text-[10px] text-gray-500 mb-3">
                    <span>${task.id}</span>
                </div>
                <p class="text-xs font-bold mb-4 tracking-tighter">${task.description}</p>
                <div class="flex gap-2">
                    <button class="flex-1 bg-m7-gray text-[10px] py-2 uppercase hover:bg-gray-700" onclick="moveTask('${task.id}')">Move</button>
                    <button class="p-2 bg-m7-dark-gray hover:bg-red-900/20 transition-colors border border-red-500" onclick="deleteTask('${task.id}')">
                        <svg class="h-4 w-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
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

// 3. CORE INTERACTION ACTIONS
function moveTask(taskId) {
    let task = taskState.find(t => t.id === taskId);
    if (task) {
        if (task.status === 'backlog') task.status = 'in-progress';
        else if (task.status === 'in-progress') task.status = 'done';
        else if (task.status === 'done') task.status = 'backlog';
        renderBoard();
    }
}

function deleteTask(taskId) {
    taskState = taskState.filter(t => t.id !== taskId);
    renderBoard();
}

function createNewTask() {
    const inputElement = document.getElementById('task-input');
    const taskText = inputElement.value.trim();

    if (taskText === "") {
        alert("CRITICAL WARNING // INPUT SEQUENCE EMPTY.");
        return;
    }

    const randomNumber = Math.floor(100 + Math.random() * 900);
    const characters = 'ABCXYZ';
    const randomLetter = characters.charAt(Math.floor(Math.random() * characters.length));
    const generatedId = `#${randomNumber}-${randomLetter}`;

    const newTask = {
        id: generatedId,
        description: taskText.toUpperCase(),
        status: 'backlog'
    };

    taskState.push(newTask);
    inputElement.value = '';
    renderBoard();
}

// 4. DRAG AND DROP HANDLERS
function handleDragStart(event, taskId) {
    event.dataTransfer.setData('text/plain', taskId);
}

// This function must accept the event parameter so it can run preventDefault()
function handleDragOver(event) {
    event.preventDefault();
}

function handleDrop(event, targetStatus) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/plain');
    let task = taskState.find(t => t.id === taskId);
    
    if (task) {
        task.status = targetStatus;
        renderBoard();
    }
}

// 5. ULTIMATE SAFE INITIALIZATION PROTOCOL
window.onload = () => {
    console.log("M7 SECURE LOGS // ALL SYSTEMS INITIALIZED.");
    renderBoard();
};