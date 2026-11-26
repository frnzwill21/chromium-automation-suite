# Chromium Automation & Extraction Suite

A powerful pair of **Manifest V3 Chromium extensions** designed for web scraping, AI/LLM content extraction, and BlazeMeter/Taurus YAML UI automation — enhanced with top open-source libraries.

## Extensions Included

### 1. HTML & Content Extractor Pro (`html-extractor/`)
Capture web pages in multiple formats with one click:
- **Full DOM HTML**: Serializes the complete live DOM including **Shadow DOM**, same-origin **iframes**, and live `<input>` / `<textarea>` / `<select>` states.
- **Sanitized Clean HTML**: Powered by **[DOMPurify](https://github.com/cure53/DOMPurify)** (v3.2.7) to strip unsafe scripts, trackers, and inline event handlers.
- **Article Markdown (AI-Ready)**: Powered by **[Mozilla Readability](https://github.com/mozilla/readability)** (v0.6.0) + **[Turndown](https://github.com/mixmark-io/turndown)** (v7.2.0) to extract clean main article content with metadata frontmatter and convert it to GitHub-style Markdown.
- **Page Metadata & Structure (JSON)**: Extracts `<meta>` tags, headings outline, form inputs/buttons, and links as structured JSON.
- **Interactive Element Picker**: Hover and click any element on a page to copy its optimal **CSS Selector**, **XPath**, and ready-to-paste **YAML Automator locator snippet**.
- **One-Click Copy or Download** with live size/word stats and preview.

### 2. YAML Automator Studio (`yaml-automator/`)
A full Side Panel browser automation studio powered by **[js-yaml](https://github.com/nodeca/js-yaml)**:
- **Live YAML Editor & Validator**: Upload `.yaml`/`.yml` files, edit directly in the Side Panel, load built-in templates, or export your scripts.
- **Interactive Action Recorder**: Click **Record**, interact with any webpage (clicks, typing, dropdown selects), and automatically generate valid Taurus/BlazeMeter YAML.
- **Expanded Action Engine** (with **Shadow DOM piercing**):
  - Navigation & Window: `go`, `resizeWindow`, `scrollTo`, `pauseFor` / `sleep`
  - Interactions: `click`, `type` / `keys`, `selectByValue`, `selectByLabel`, `hover`, `pressKey`
  - Synchronization & Assertions: `waitFor`, `assertText`, `assertTitle`, `assertVisible`
  - Data & Media: `extractText`, `screenshot` (auto-downloads PNG)
- **Execution Controls**: Run, Stop, Loop Mode, configurable step delay, live progress bar, and exportable execution logs.
- **Saved Workflows**: Save, load, and manage multiple YAML scripts locally via `chrome.storage.local`.

## Installation (Chrome / Edge / Brave)

1. Clone this repository:
   ```bash
   git clone https://github.com/frnzwill21/chromium-automation-suite.git
   ```
2. Open `chrome://extensions/` in your Chromium browser.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select:
   - `html-extractor/` for **HTML & Content Extractor Pro**
   - `yaml-automator/` for **YAML Automator Studio**

## Example Workflow

See [`examples/sample-workflow.yaml`](examples/sample-workflow.yaml) for a ready-to-run Taurus YAML workflow.

## Open-Source Libraries Integrated

| Library | Purpose | License |
| :--- | :--- | :--- |
| [@mozilla/readability](https://github.com/mozilla/readability) | Main article & metadata extraction | Apache-2.0 |
| [Turndown](https://github.com/mixmark-io/turndown) | HTML to Markdown conversion | MIT |
| [DOMPurify](https://github.com/cure53/DOMPurify) | XSS-safe HTML sanitization | Apache-2.0 / MPL-2.0 |
| [js-yaml](https://github.com/nodeca/js-yaml) | YAML 1.2 parser & serializer | MIT |
