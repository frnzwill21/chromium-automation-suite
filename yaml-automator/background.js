chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

let isAborted = false;
let isRunning = false;

function sendLog(msg, level = 'info') { chrome.runtime.sendMessage({ type: 'LOG', msg, level }).catch(() => {}); }
function sendProgress(current, total, cycle) { chrome.runtime.sendMessage({ type: 'PROGRESS', current, total, cycle }).catch(() => {}); }
function sendExtracted(key, value) { chrome.runtime.sendMessage({ type: 'EXTRACTED_DATA', key, value }).catch(() => {}); }

chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'RUN_AUTOMATION') {
        if (isRunning) { sendLog('Automation is already running.', 'error'); return; }
        isAborted = false;
        runAutomation(message.actions, message.loop, message.stepDelay || 300);
    } else if (message.type === 'STOP_AUTOMATION') {
        isAborted = true; sendLog('Stop requested by user...', 'info');
    } else if (message.type === 'START_RECORDING') {
        startRecording();
    } else if (message.type === 'STOP_RECORDING') {
        stopRecording();
    } else if (message.type === 'RECORDED_EVENT') {
        chrome.runtime.sendMessage(message).catch(() => {});
    }
});

async function startRecording() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) { sendLog('No active tab to record.', 'error'); return; }
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: injectRecorder });
        sendLog(`Recording started on ${tab.url}`, 'success');
    } catch (err) { sendLog(`Failed to start recorder: ${err.message}`, 'error'); }
}

async function stopRecording() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => { if (window.__yamlAutomatorStopRecorder) window.__yamlAutomatorStopRecorder(); }
            });
        }
        sendLog('Recording stopped.', 'info');
    } catch (err) { sendLog(`Recorder cleanup note: ${err.message}`, 'info'); }
}

async function runAutomation(actions, loopEnabled, stepDelay) {
    isRunning = true;
    try {
        let keepLooping = true, loopCount = 0;
        while (keepLooping && !isAborted) {
            loopCount++;
            sendLog(loopEnabled ? `--- Starting Cycle ${loopCount} ---` : `--- Starting Automation (${actions.length} steps) ---`, 'info');
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) { chrome.runtime.sendMessage({ type: 'ERROR', msg: 'No active tab found.' }).catch(() => {}); return; }
            const currentTabId = tab.id;
            let cycleSuccess = true;

            for (let i = 0; i < actions.length; i++) {
                if (isAborted) { sendLog('Automation stopped by user.', 'error'); keepLooping = false; break; }
                const action = actions[i];
                sendProgress(i + 1, actions.length, loopCount);
                sendLog(`[${i + 1}/${actions.length}] Executing [${action.type}]...`);
                try {
                    if (action.type === 'resizeWindow') {
                        const [width, height] = String(action.param).split(',').map(n => parseInt(n, 10));
                        const win = await chrome.windows.getCurrent();
                        await chrome.windows.update(win.id, { width, height });
                        sendLog(`Window resized to ${width}x${height}`);
                    } else if (action.type === 'go') {
                        if (loopEnabled && loopCount > 1) { sendLog(`Skipping navigation on cycle ${loopCount}.`); }
                        else { await chrome.tabs.update(currentTabId, { url: action.param }); sendLog(`Navigated to ${action.param}`); await waitTabLoaded(currentTabId); sendLog('Page loaded.'); }
                    } else if (action.type === 'pauseFor' || action.type === 'sleep') {
                        const raw = String(action.param || action.value || '1s');
                        const ms = raw.endsWith('ms') ? parseInt(raw, 10) : parseFloat(raw.replace('s', '')) * 1000;
                        await new Promise(r => setTimeout(r, ms));
                        sendLog(`Paused for ${ms}ms.`);
                    } else if (action.type === 'waitFor') {
                        const timeoutStr = String(action.value || action.param || '10s');
                        const timeoutMs = timeoutStr.endsWith('ms') ? parseInt(timeoutStr, 10) : parseFloat(timeoutStr.replace('s', '')) * 1000;
                        await chrome.scripting.executeScript({ target: { tabId: currentTabId }, func: injectWaitFor, args: [action.locators, timeoutMs] });
                        sendLog('Element appeared.');
                    } else if (action.type === 'click') {
                        await chrome.scripting.executeScript({ target: { tabId: currentTabId }, func: injectClick, args: [action.locators] });
                        sendLog('Click successful.');
                    } else if (action.type === 'type' || action.type === 'keys') {
                        await chrome.scripting.executeScript({ target: { tabId: currentTabId }, func: injectType, args: [action.locators, String(action.param ?? '')] });
                        sendLog(`Typed "${String(action.param ?? '').slice(0, 40)}".`);
                    } else if (action.type === 'selectByValue' || action.type === 'selectByLabel') {
                        await chrome.scripting.executeScript({ target: { tabId: currentTabId }, func: injectSelect, args: [action.locators, String(action.param ?? ''), action.type === 'selectByLabel'] });
                        sendLog(`Selected "${action.param}".`);
                    } else if (action.type === 'hover') {
                        await chrome.scripting.executeScript({ target: { tabId: currentTabId }, func: injectHover, args: [action.locators] });
                        sendLog('Hover dispatched.');
                    } else if (action.type === 'scrollTo') {
                        await chrome.scripting.executeScript({ target: { tabId: currentTabId }, func: injectScrollTo, args: [action.locators || null, action.param || null] });
                        sendLog('Scrolled.');
                    } else if (action.type === 'pressKey') {
                        await chrome.scripting.executeScript({ target: { tabId: currentTabId }, func: injectPressKey, args: [action.locators || null, String(action.param || 'Enter')] });
                        sendLog(`Pressed key "${action.param || 'Enter'}".`);
                    } else if (action.type === 'assertText') {
                        const res = await chrome.scripting.executeScript({ target: { tabId: currentTabId }, func: injectAssertText, args: [action.locators, String(action.param ?? '')] });
                        sendLog(`Assertion passed: "${res?.[0]?.result?.slice(0, 60)}"`, 'success');
                    } else if (action.type === 'assertTitle') {
                        const updatedTab = await chrome.tabs.get(currentTabId);
                        const expected = String(action.param ?? '');
                        if (!updatedTab.title || !updatedTab.title.includes(expected)) throw new Error(`Title "${updatedTab.title}" does not include "${expected}"`);
                        sendLog(`Title assertion passed: "${updatedTab.title}"`, 'success');
                    } else if (action.type === 'assertVisible') {
                        await chrome.scripting.executeScript({ target: { tabId: currentTabId }, func: injectAssertVisible, args: [action.locators] });
                        sendLog('Visibility assertion passed.', 'success');
                    } else if (action.type === 'extractText') {
                        const res = await chrome.scripting.executeScript({ target: { tabId: currentTabId }, func: injectExtractText, args: [action.locators] });
                        const text = res?.[0]?.result ?? '';
                        const key = action.param || `step_${i + 1}`;
                        sendExtracted(key, text);
                        sendLog(`Extracted [${key}]: "${text.slice(0, 80)}"`, 'success');
                    } else if (action.type === 'screenshot') {
                        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
                        const fname = (action.param ? `${action.param}` : `screenshot-${Date.now()}`).replace(/\.png$/i, '') + '.png';
                        await chrome.downloads.download({ url: dataUrl, filename: fname, saveAs: false });
                        sendLog(`Screenshot saved: ${fname}`, 'success');
                    } else {
                        sendLog(`Skipping unsupported action: ${action.type}`, 'info');
                    }
                    if (stepDelay > 0 && !isAborted) await new Promise(r => setTimeout(r, stepDelay));
                } catch (err) {
                    if (loopEnabled) { sendLog(`Cycle ${loopCount} stopped: ${err.message}. Assuming all items done!`, 'success'); keepLooping = false; cycleSuccess = false; break; }
                    sendLog(`Step [${action.type}] failed: ${err.message}`, 'error');
                    chrome.runtime.sendMessage({ type: 'ERROR', msg: `Step failed: ${err.message}` }).catch(() => {});
                    return;
                }
            }
            if (!loopEnabled || !cycleSuccess || isAborted) keepLooping = false;
            else await new Promise(r => setTimeout(r, 800));
        }
        chrome.runtime.sendMessage({ type: 'FINISHED' }).catch(() => {});
    } catch (err) {
        chrome.runtime.sendMessage({ type: 'ERROR', msg: err.message }).catch(() => {});
    } finally { isRunning = false; }
}

function waitTabLoaded(tabId) {
    return new Promise((resolve) => {
        const listener = (updatedTabId, info) => {
            if (updatedTabId === tabId && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(listener); resolve(); }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 15000);
    });
}

async function injectWaitFor(locators, timeout) {
    function deepFind(locs) {
        function searchRoot(root, loc) {
            try {
                if (loc.CSS) { const el = root.querySelector(loc.CSS); if (el) return el; }
                if (loc.ID && root.getElementById) { const el = root.getElementById(loc.ID); if (el) return el; }
                if (loc.XPath && root === document) { const el = document.evaluate(loc.XPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; if (el) return el; }
                for (const node of root.querySelectorAll('*')) { if (node.shadowRoot) { const found = searchRoot(node.shadowRoot, loc); if (found) return found; } }
            } catch (e) {}
            return null;
        }
        for (const loc of locs || []) { const el = searchRoot(document, loc); if (el) return el; }
        return null;
    }
    return new Promise((resolve, reject) => {
        let elapsed = 0; const interval = 200;
        const check = setInterval(() => {
            const el = deepFind(locators);
            if (el) { clearInterval(check); const orig = el.style.outline; el.style.outline = '2px solid #f59e0b'; setTimeout(() => { el.style.outline = orig; }, 800); resolve(true); }
            else { elapsed += interval; if (elapsed >= timeout) { clearInterval(check); reject(new Error('Element not found within timeout')); } }
        }, interval);
    });
}

function injectClick(locators) {
    function searchRoot(root, loc) {
        try {
            if (loc.CSS) { const el = root.querySelector(loc.CSS); if (el) return el; }
            if (loc.ID && root.getElementById) { const el = root.getElementById(loc.ID); if (el) return el; }
            if (loc.XPath && root === document) { const el = document.evaluate(loc.XPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; if (el) return el; }
            for (const node of root.querySelectorAll('*')) { if (node.shadowRoot) { const found = searchRoot(node.shadowRoot, loc); if (found) return found; } }
        } catch (e) {}
        return null;
    }
    let el = null; for (const loc of locators || []) { el = searchRoot(document, loc); if (el) break; }
    if (!el) throw new Error('Element not found for click');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const orig = el.style.outline; el.style.outline = '2px solid #10b981'; setTimeout(() => { el.style.outline = orig; }, 800);
    el.click(); return true;
}

function injectType(locators, text) {
    function searchRoot(root, loc) {
        try {
            if (loc.CSS) { const el = root.querySelector(loc.CSS); if (el) return el; }
            if (loc.ID && root.getElementById) { const el = root.getElementById(loc.ID); if (el) return el; }
            if (loc.XPath && root === document) { const el = document.evaluate(loc.XPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; if (el) return el; }
            for (const node of root.querySelectorAll('*')) { if (node.shadowRoot) { const found = searchRoot(node.shadowRoot, loc); if (found) return found; } }
        } catch (e) {}
        return null;
    }
    let el = null; for (const loc of locators || []) { el = searchRoot(document, loc); if (el) break; }
    if (!el) throw new Error('Element not found for type');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const orig = el.style.outline; el.style.outline = '2px solid #3b82f6'; setTimeout(() => { el.style.outline = orig; }, 800);
    el.focus();
    const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) setter.call(el, text);
    else if (el.isContentEditable) el.innerText = text;
    else el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}

function injectSelect(locators, targetVal, byLabel) {
    let el = null;
    for (const loc of locators || []) {
        try {
            if (loc.CSS) el = document.querySelector(loc.CSS);
            else if (loc.ID) el = document.getElementById(loc.ID);
            else if (loc.XPath) el = document.evaluate(loc.XPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (el) break;
        } catch (e) {}
    }
    if (!el || el.tagName !== 'SELECT') throw new Error('Select element not found');
    if (byLabel) {
        const opt = Array.from(el.options).find(o => o.text.trim() === targetVal);
        if (!opt) throw new Error(`Option label "${targetVal}" not found`);
        el.value = opt.value;
    } else el.value = targetVal;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}

function injectHover(locators) {
    let el = null;
    for (const loc of locators || []) {
        try {
            if (loc.CSS) el = document.querySelector(loc.CSS);
            else if (loc.ID) el = document.getElementById(loc.ID);
            else if (loc.XPath) el = document.evaluate(loc.XPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (el) break;
        } catch (e) {}
    }
    if (!el) throw new Error('Element not found for hover');
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    return true;
}

function injectScrollTo(locators, param) {
    if (locators && locators.length > 0) {
        for (const loc of locators) {
            const el = loc.CSS ? document.querySelector(loc.CSS) : (loc.ID ? document.getElementById(loc.ID) : null);
            if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return true; }
        }
    }
    if (param === 'bottom') window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    else if (param === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
    else window.scrollBy({ top: parseInt(param, 10) || 400, behavior: 'smooth' });
    return true;
}

function injectPressKey(locators, key) {
    let target = document.activeElement || document.body;
    if (locators && locators.length > 0) {
        for (const loc of locators) {
            const el = loc.CSS ? document.querySelector(loc.CSS) : (loc.ID ? document.getElementById(loc.ID) : null);
            if (el) { target = el; target.focus(); break; }
        }
    }
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
    if (key === 'Enter' && target.form) target.form.requestSubmit ? target.form.requestSubmit() : target.form.submit();
    return true;
}

function injectAssertText(locators, expected) {
    let el = null;
    for (const loc of locators || []) {
        if (loc.CSS) el = document.querySelector(loc.CSS);
        else if (loc.ID) el = document.getElementById(loc.ID);
        else if (loc.XPath) el = document.evaluate(loc.XPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (el) break;
    }
    if (!el) throw new Error('Element not found for assertText');
    const actual = (el.innerText || el.textContent || '').trim();
    if (!actual.includes(expected)) throw new Error(`Expected text "${expected}" not found in "${actual.slice(0, 80)}"`);
    return actual;
}

function injectAssertVisible(locators) {
    let el = null;
    for (const loc of locators || []) {
        if (loc.CSS) el = document.querySelector(loc.CSS);
        else if (loc.ID) el = document.getElementById(loc.ID);
        else if (loc.XPath) el = document.evaluate(loc.XPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (el) break;
    }
    if (!el) throw new Error('Element not found for assertVisible');
    const rect = el.getBoundingClientRect(), style = window.getComputedStyle(el);
    if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden' || style.display === 'none') throw new Error('Element exists but is not visible');
    return true;
}

function injectExtractText(locators) {
    let el = null;
    for (const loc of locators || []) {
        if (loc.CSS) el = document.querySelector(loc.CSS);
        else if (loc.ID) el = document.getElementById(loc.ID);
        else if (loc.XPath) el = document.evaluate(loc.XPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (el) break;
    }
    if (!el) throw new Error('Element not found for extractText');
    return (el.innerText || el.value || el.textContent || '').trim();
}

function injectRecorder() {
    if (window.__yamlAutomatorRecording) return;
    window.__yamlAutomatorRecording = true;
    function getCss(el) {
        if (el.id) return `#${CSS.escape(el.id)}`;
        if (el.name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
        const path = []; let cur = el;
        while (cur && cur.nodeType === Node.ELEMENT_NODE && path.length < 4) {
            let sel = cur.nodeName.toLowerCase();
            if (cur.id) { path.unshift(`#${CSS.escape(cur.id)}`); break; }
            let sib = cur, nth = 1;
            while ((sib = sib.previousElementSibling)) { if (sib.nodeName.toLowerCase() === sel) nth++; }
            if (nth > 1) sel += `:nth-of-type(${nth})`;
            path.unshift(sel); cur = cur.parentNode;
        }
        return path.join(' > ');
    }
    function onClick(e) {
        const el = e.target;
        if (!el || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return;
        chrome.runtime.sendMessage({ type: 'RECORDED_EVENT', action: { type: 'click', locators: [{ CSS: getCss(el) }] } }).catch(() => {});
    }
    function onChange(e) {
        const el = e.target; if (!el) return;
        if (el.tagName === 'SELECT') chrome.runtime.sendMessage({ type: 'RECORDED_EVENT', action: { type: 'selectByValue', locators: [{ CSS: getCss(el) }], param: el.value } }).catch(() => {});
        else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') chrome.runtime.sendMessage({ type: 'RECORDED_EVENT', action: { type: 'type', locators: [{ CSS: getCss(el) }], param: el.value } }).catch(() => {});
    }
    document.addEventListener('click', onClick, true);
    document.addEventListener('change', onChange, true);
    window.__yamlAutomatorStopRecorder = () => {
        window.__yamlAutomatorRecording = false;
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('change', onChange, true);
    };
}
