const modeSelect = document.getElementById('modeSelect');
const downloadBtn = document.getElementById('downloadBtn');
const copyBtn = document.getElementById('copyBtn');
const pickerBtn = document.getElementById('pickerBtn');
const statusDiv = document.getElementById('status');
const statsDiv = document.getElementById('stats');
const statSize = document.getElementById('statSize');
const statInfo = document.getElementById('statInfo');
const previewArea = document.getElementById('preview');

function setStatus(msg, type = 'info') {
    statusDiv.textContent = msg;
    statusDiv.className = `status ${type}`;
}

function updateStats(content, label) {
    const bytes = new Blob([content]).size;
    const kb = (bytes / 1024).toFixed(1);
    statSize.textContent = `${kb} KB`;
    statInfo.textContent = label;
    statsDiv.style.display = 'flex';
    previewArea.value = content.slice(0, 1500) + (content.length > 1500 ? '\n... (truncated preview)' : '');
    previewArea.style.display = 'block';
}

async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('No active tab found.');
    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:'))) {
        throw new Error('Cannot extract from restricted browser pages.');
    }
    return tab;
}

async function runExtraction(mode) {
    const tab = await getActiveTab();

    if (mode === 'full-dom' || mode === 'clean-html') {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractFullDOM
        });
        let html = results?.[0]?.result;
        if (!html) throw new Error('Failed to extract DOM.');

        if (mode === 'clean-html') {
            html = DOMPurify.sanitize(html, {
                WHOLE_DOCUMENT: true,
                FORBID_TAGS: ['script', 'noscript', 'iframe', 'object', 'embed'],
                FORBID_ATTR: ['onerror', 'onload', 'onclick']
            });
            return { content: html, ext: 'html', mime: 'text/html', label: 'Sanitized HTML' };
        }
        return { content: html, ext: 'html', mime: 'text/html', label: 'Full DOM HTML' };
    }

    if (mode === 'markdown') {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['lib/Readability.js']
        });

        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractReadableArticle
        });
        const article = results?.[0]?.result;
        if (!article) throw new Error('Failed to extract readable content.');

        const cleanHtml = DOMPurify.sanitize(article.content);
        const turndownService = new TurndownService({
            headingStyle: 'atx',
            hr: '---',
            bulletListMarker: '-',
            codeBlockStyle: 'fenced'
        });
        const mdBody = turndownService.turndown(cleanHtml);

        const headerLines = [
            `# ${article.title || tab.title || 'Untitled Page'}`,
            '',
            `> **Source:** ${tab.url}`,
            article.byline ? `> **Author:** ${article.byline}` : null,
            article.siteName ? `> **Site:** ${article.siteName}` : null,
            `> **Extracted:** ${new Date().toISOString()}`,
            '',
            '---',
            ''
        ].filter(line => line !== null);

        const markdown = headerLines.join('\n') + mdBody;
        const words = markdown.trim().split(/\s+/).length;
        return { content: markdown, ext: 'md', mime: 'text/markdown', label: `${words} words (Markdown)` };
    }

    if (mode === 'json-meta') {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractPageMetadata
        });
        const meta = results?.[0]?.result;
        if (!meta) throw new Error('Failed to extract metadata.');
        const json = JSON.stringify(meta, null, 2);
        return {
            content: json,
            ext: 'json',
            mime: 'application/json',
            label: `${meta.links.length} links • ${meta.inputs.length} inputs`
        };
    }

    throw new Error('Unknown extraction mode.');
}

async function handleAction(actionType) {
    const mode = modeSelect.value;
    downloadBtn.disabled = true;
    copyBtn.disabled = true;
    setStatus('Extracting...', 'info');

    try {
        const tab = await getActiveTab();
        const { content, ext, mime, label } = await runExtraction(mode);
        updateStats(content, label);

        if (actionType === 'copy') {
            await navigator.clipboard.writeText(content);
            setStatus(`Copied ${label} to clipboard!`, 'success');
        } else {
            const blob = new Blob([content], { type: mime });
            const url = URL.createObjectURL(blob);

            let hostname = 'extracted';
            try {
                hostname = new URL(tab.url).hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
            } catch (e) {}

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `${hostname}-${mode}-${timestamp}.${ext}`;

            chrome.downloads.download({ url, filename, saveAs: true }, () => {
                if (chrome.runtime.lastError) {
                    setStatus('Error: ' + chrome.runtime.lastError.message, 'error');
                } else {
                    setStatus(`Saved ${filename}`, 'success');
                }
                setTimeout(() => URL.revokeObjectURL(url), 5000);
            });
        }
    } catch (error) {
        setStatus('Error: ' + error.message, 'error');
    } finally {
        downloadBtn.disabled = false;
        copyBtn.disabled = false;
    }
}

downloadBtn.addEventListener('click', () => handleAction('download'));
copyBtn.addEventListener('click', () => handleAction('copy'));

pickerBtn.addEventListener('click', async () => {
    setStatus('Click any element on the page (ESC to cancel)...', 'info');
    try {
        const tab = await getActiveTab();
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: injectElementPicker
        });
        window.close();
    } catch (error) {
        setStatus('Error: ' + error.message, 'error');
    }
});

function extractFullDOM() {
    function serializeDOM(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.nodeValue.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
            let str = `<${node.tagName.toLowerCase()}`;
            for (let attr of node.attributes) {
                if (attr.name === 'value' && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT')) continue;
                let val = attr.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
                str += ` ${attr.name}="${val}"`;
            }
            if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT') {
                if (node.type !== 'checkbox' && node.type !== 'radio') {
                    let val = (node.value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
                    str += ` value="${val}"`;
                } else if (node.checked) {
                    str += ` checked="checked"`;
                }
            }
            str += `>`;
            const voidElements = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'];
            if (voidElements.includes(node.tagName.toLowerCase())) return str;
            if (node.tagName === 'TEXTAREA') {
                str += node.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + `</textarea>`;
                return str;
            }
            if (node.shadowRoot) {
                str += `\n<!-- SHADOW ROOT START -->\n`;
                for (let child of node.shadowRoot.childNodes) str += serializeDOM(child);
                str += `\n<!-- SHADOW ROOT END -->\n`;
            }
            if (node.tagName === 'IFRAME') {
                try {
                    if (node.contentDocument) {
                        str += `\n<!-- IFRAME CONTENT START -->\n` + serializeDOM(node.contentDocument.documentElement) + `\n<!-- IFRAME CONTENT END -->\n`;
                    }
                } catch (e) {
                    str += `\n<!-- IFRAME CROSS-ORIGIN OR INACCESSIBLE -->\n`;
                }
            } else {
                for (let child of node.childNodes) str += serializeDOM(child);
            }
            str += `</${node.tagName.toLowerCase()}>`;
            return str;
        }
        if (node.nodeType === Node.COMMENT_NODE) return `<!--${node.nodeValue}-->`;
        if (node.nodeType === Node.DOCUMENT_NODE) {
            let str = '<!DOCTYPE html>\n';
            for (let child of node.childNodes) {
                if (child.nodeType !== Node.DOCUMENT_TYPE_NODE) str += serializeDOM(child);
            }
            return str;
        }
        return '';
    }
    return serializeDOM(document);
}

function extractReadableArticle() {
    try {
        const documentClone = document.cloneNode(true);
        const article = new Readability(documentClone).parse();
        if (article && article.content) {
            return { title: article.title, byline: article.byline, siteName: article.siteName, excerpt: article.excerpt, content: article.content };
        }
    } catch (e) {}
    return { title: document.title, byline: null, siteName: location.hostname, excerpt: null, content: document.body ? document.body.innerHTML : '' };
}

function extractPageMetadata() {
    const metaTags = {};
    document.querySelectorAll('meta[name], meta[property]').forEach(m => {
        const key = m.getAttribute('name') || m.getAttribute('property');
        if (key && m.content) metaTags[key] = m.content;
    });
    const headings = Array.from(document.querySelectorAll('h1, h2, h3')).slice(0, 50).map(h => ({ tag: h.tagName.toLowerCase(), text: h.innerText.trim().slice(0, 200) }));
    const inputs = Array.from(document.querySelectorAll('input, textarea, select, button')).slice(0, 100).map(el => ({
        tag: el.tagName.toLowerCase(), type: el.type || null, id: el.id || null, name: el.name || null, placeholder: el.placeholder || null, text: el.tagName === 'BUTTON' ? el.innerText.trim().slice(0, 80) : null
    }));
    const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 150).map(a => ({ text: a.innerText.trim().slice(0, 100), href: a.href }));
    return { url: location.href, title: document.title, extractedAt: new Date().toISOString(), meta: metaTags, headings, inputs, links };
}

function injectElementPicker() {
    if (window.__htmlExtractorPickerActive) return;
    window.__htmlExtractorPickerActive = true;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #10b981;background:rgba(16,185,129,0.15);transition:all 0.05s ease;';
    document.body.appendChild(overlay);
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#0f172a;color:#f8fafc;padding:10px 14px;border-radius:8px;font:12px/1.4 sans-serif;border:1px solid #10b981;box-shadow:0 4px 20px rgba(0,0,0,0.4);';
    toast.textContent = 'HTML Extractor Picker: Click any element to copy CSS & XPath (ESC to cancel)';
    document.body.appendChild(toast);

    function getCssSelector(el) {
        if (el.id) return `#${CSS.escape(el.id)}`;
        const path = [];
        while (el && el.nodeType === Node.ELEMENT_NODE) {
            let selector = el.nodeName.toLowerCase();
            if (el.id) { selector += `#${CSS.escape(el.id)}`; path.unshift(selector); break; }
            let sib = el, nth = 1;
            while ((sib = sib.previousElementSibling)) { if (sib.nodeName.toLowerCase() === selector) nth++; }
            if (nth !== 1) selector += `:nth-of-type(${nth})`;
            path.unshift(selector);
            el = el.parentNode;
        }
        return path.join(' > ');
    }
    function getXPath(el) {
        if (el.id) return `//*[@id="${el.id}"]`;
        const parts = [];
        while (el && el.nodeType === Node.ELEMENT_NODE) {
            let idx = 1, sib = el.previousSibling;
            while (sib) { if (sib.nodeType === Node.ELEMENT_NODE && sib.nodeName === el.nodeName) idx++; sib = sib.previousSibling; }
            parts.unshift(`${el.nodeName.toLowerCase()}[${idx}]`);
            el = el.parentNode;
        }
        return '/' + parts.join('/');
    }
    function cleanup() {
        window.__htmlExtractorPickerActive = false;
        overlay.remove();
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKey, true);
    }
    function onMove(e) {
        const rect = e.target.getBoundingClientRect();
        overlay.style.top = rect.top + 'px'; overlay.style.left = rect.left + 'px';
        overlay.style.width = rect.width + 'px'; overlay.style.height = rect.height + 'px';
    }
    function onClick(e) {
        e.preventDefault(); e.stopPropagation();
        const css = getCssSelector(e.target), xpath = getXPath(e.target);
        navigator.clipboard.writeText(`locators:\n  - CSS: "${css}"\n  - XPath: "${xpath}"`).catch(() => {});
        toast.textContent = `Copied! CSS: ${css}`;
        cleanup();
        setTimeout(() => toast.remove(), 3000);
    }
    function onKey(e) { if (e.key === 'Escape') { cleanup(); toast.remove(); } }
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
}
