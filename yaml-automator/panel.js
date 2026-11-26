const yamlEditor = document.getElementById('yamlEditor');
const validationBar = document.getElementById('validationBar');
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const templateSelect = document.getElementById('templateSelect');
const downloadYamlBtn = document.getElementById('downloadYamlBtn');
const runBtn = document.getElementById('runBtn');
const stopBtn = document.getElementById('stopBtn');
const recBtn = document.getElementById('recBtn');
const loopCheck = document.getElementById('loopCheck');
const stepDelayInput = document.getElementById('stepDelay');
const progressBar = document.getElementById('progressBar');
const logArea = document.getElementById('logArea');
const clearLogsBtn = document.getElementById('clearLogsBtn');
const exportLogsBtn = document.getElementById('exportLogsBtn');
const scriptNameInput = document.getElementById('scriptNameInput');
const saveScriptBtn = document.getElementById('saveScriptBtn');
const savedList = document.getElementById('savedList');

let parsedActions = [], isRecording = false, recordedActions = [];
const logHistory = [];

const TEMPLATES = {
    search: `scenarios:\n  web_search_demo:\n    requests:\n      - label: Example Search Flow\n        actions:\n          - go: https://example.com\n          - assertTitle: Example Domain\n          - waitFor:\n              locators:\n                - CSS: h1\n              value: 5s\n          - assertText:\n              locators:\n                - CSS: h1\n              param: Example Domain\n          - screenshot: example-home\n`,
    scrape: `scenarios:\n  extract_demo:\n    requests:\n      - label: Extract & Capture\n        actions:\n          - go: https://example.com\n          - pauseFor: 1s\n          - extractText:\n              locators:\n                - CSS: h1\n              param: page_heading\n          - extractText:\n              locators:\n                - CSS: p\n              param: first_paragraph\n          - screenshot: extracted-page\n`
};

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
});

function log(msg, type = 'info') {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logHistory.push(line);
    const div = document.createElement('div');
    div.className = `log-entry log-${type}`;
    div.textContent = line;
    logArea.appendChild(div);
    logArea.scrollTop = logArea.scrollHeight;
}

function normalizeActions(rawActions) {
    return rawActions.map(item => {
        if (item && item.type) return item;
        const keys = Object.keys(item || {});
        if (keys.length === 1) {
            const type = keys[0], val = item[type];
            return (typeof val === 'object' && val !== null) ? { type, ...val } : { type, param: val };
        }
        return item;
    });
}

function validateYAML() {
    const text = yamlEditor.value.trim();
    if (!text) {
        parsedActions = [];
        validationBar.textContent = 'Paste YAML, upload a file, or click Record.';
        validationBar.className = 'validation-bar';
        runBtn.disabled = true;
        return;
    }
    try {
        const doc = jsyaml.load(text);
        let raw = [];
        if (doc && doc.scenarios) {
            const keys = Object.keys(doc.scenarios);
            if (keys.length > 0 && doc.scenarios[keys[0]].requests?.length > 0) raw = doc.scenarios[keys[0]].requests[0].actions || [];
        } else if (doc && Array.isArray(doc.actions)) raw = doc.actions;
        parsedActions = normalizeActions(raw);
        if (parsedActions.length === 0) {
            validationBar.textContent = 'Valid YAML, but no actions found.';
            validationBar.className = 'validation-bar invalid';
            runBtn.disabled = true;
        } else {
            validationBar.textContent = `Valid YAML • ${parsedActions.length} action(s) ready`;
            validationBar.className = 'validation-bar valid';
            runBtn.disabled = false;
        }
    } catch (err) {
        parsedActions = [];
        validationBar.textContent = `YAML Error: ${err.message.split('\n')[0]}`;
        validationBar.className = 'validation-bar invalid';
        runBtn.disabled = true;
    }
}

yamlEditor.addEventListener('input', validateYAML);
uploadBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { yamlEditor.value = ev.target.result; validateYAML(); log(`Loaded file: ${file.name}`, 'success'); };
    reader.readAsText(file);
});
templateSelect.addEventListener('change', () => {
    const key = templateSelect.value;
    if (key && TEMPLATES[key]) { yamlEditor.value = TEMPLATES[key]; validateYAML(); log(`Loaded template: ${key}`, 'info'); templateSelect.value = ''; }
});
downloadYamlBtn.addEventListener('click', () => {
    const text = yamlEditor.value; if (!text.trim()) return;
    const blob = new Blob([text], { type: 'text/yaml' }); const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: `workflow-${Date.now()}.yaml`, saveAs: true }, () => setTimeout(() => URL.revokeObjectURL(url), 5000));
});
runBtn.addEventListener('click', () => {
    if (parsedActions.length === 0) return;
    runBtn.disabled = true; stopBtn.disabled = false; progressBar.style.width = '0%';
    log(`Starting execution of ${parsedActions.length} actions...`, 'info');
    chrome.runtime.sendMessage({ type: 'RUN_AUTOMATION', actions: parsedActions, loop: loopCheck.checked, stepDelay: parseInt(stepDelayInput.value, 10) || 300 });
});
stopBtn.addEventListener('click', () => { chrome.runtime.sendMessage({ type: 'STOP_AUTOMATION' }); stopBtn.disabled = true; });
recBtn.addEventListener('click', () => {
    isRecording = !isRecording;
    if (isRecording) { recordedActions = []; recBtn.textContent = 'Stop Rec'; recBtn.classList.add('recording'); chrome.runtime.sendMessage({ type: 'START_RECORDING' }); }
    else { recBtn.textContent = 'Record'; recBtn.classList.remove('recording'); chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }); }
});

function renderSavedScripts() {
    chrome.storage.local.get({ savedWorkflows: {} }, ({ savedWorkflows }) => {
        savedList.innerHTML = '';
        const names = Object.keys(savedWorkflows);
        if (names.length === 0) { savedList.innerHTML = '<div style="font-size:12px;color:#64748b;text-align:center;margin-top:20px;">No saved workflows yet.</div>'; return; }
        names.forEach(name => {
            const row = document.createElement('div'); row.className = 'saved-item';
            const title = document.createElement('span'); title.textContent = name;
            const actions = document.createElement('div'); actions.style.display = 'flex'; actions.style.gap = '4px';
            const loadBtn = document.createElement('button'); loadBtn.className = 'btn btn-sec'; loadBtn.textContent = 'Load';
            loadBtn.onclick = () => { yamlEditor.value = savedWorkflows[name]; validateYAML(); document.querySelector('.tab-btn[data-tab="editor"]').click(); log(`Loaded saved workflow: ${name}`, 'info'); };
            const delBtn = document.createElement('button'); delBtn.className = 'btn btn-stop'; delBtn.textContent = 'Del';
            delBtn.onclick = () => { delete savedWorkflows[name]; chrome.storage.local.set({ savedWorkflows }, renderSavedScripts); };
            actions.appendChild(loadBtn); actions.appendChild(delBtn); row.appendChild(title); row.appendChild(actions); savedList.appendChild(row);
        });
    });
}

saveScriptBtn.addEventListener('click', () => {
    const name = scriptNameInput.value.trim(), yaml = yamlEditor.value.trim();
    if (!name || !yaml) return;
    chrome.storage.local.get({ savedWorkflows: {} }, ({ savedWorkflows }) => {
        savedWorkflows[name] = yaml;
        chrome.storage.local.set({ savedWorkflows }, () => { scriptNameInput.value = ''; renderSavedScripts(); log(`Saved workflow "${name}".`, 'success'); });
    });
});
clearLogsBtn.addEventListener('click', () => { logArea.innerHTML = ''; logHistory.length = 0; });
exportLogsBtn.addEventListener('click', () => {
    const blob = new Blob([logHistory.join('\n')], { type: 'text/plain' }); const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: `automator-logs-${Date.now()}.txt`, saveAs: true }, () => setTimeout(() => URL.revokeObjectURL(url), 5000));
});

chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'LOG') log(message.msg, message.level);
    else if (message.type === 'PROGRESS') progressBar.style.width = `${Math.round((message.current / message.total) * 100)}%`;
    else if (message.type === 'EXTRACTED_DATA') log(`DATA [${message.key}] => ${message.value}`, 'success');
    else if (message.type === 'RECORDED_EVENT' && isRecording) {
        recordedActions.push(message.action);
        yamlEditor.value = jsyaml.dump({ scenarios: { recorded_flow: { requests: [{ label: 'Recorded Session', actions: recordedActions }] } } }, { noRefs: true });
        validateYAML();
    } else if (message.type === 'FINISHED') { log('Automation completed.', 'success'); progressBar.style.width = '100%'; runBtn.disabled = false; stopBtn.disabled = true; }
    else if (message.type === 'ERROR') { log(`Execution failed: ${message.msg}`, 'error'); runBtn.disabled = false; stopBtn.disabled = true; }
});

renderSavedScripts();
