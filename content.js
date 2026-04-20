(() => {
  const ROOT_ID = 'cx-pdf-extractor-root';
  const BUTTON_ID = 'cx-pdf-extractor-button';
  const PANEL_ID = 'cx-pdf-extractor-panel';
  const STATUS_ID = 'cx-pdf-extractor-status';
  const LINK_ID = 'cx-pdf-extractor-link';
  const CLOSE_ID = 'cx-pdf-extractor-close';
  const MESSAGE_TYPE = 'cx-pdf-extractor-candidate';
  const REQUEST_TYPE = 'cx-pdf-extractor-request';
  const POSITION_STORAGE_KEY = 'cx-pdf-extractor-position';
  const DRAG_THRESHOLD = 6;

  let busy = false;
  const sharedCandidates = new Map();
  let dragState = null;
  let suppressNextClick = false;

  function collectLocalCandidateTexts() {
    const candidates = [];
    const seen = new Set();

    const add = value => {
      if (typeof value !== 'string' || !value) return;
      if (seen.has(value)) return;
      seen.add(value);
      candidates.push(value);
    };

    add(window.location.href);

    for (const iframe of document.querySelectorAll('iframe')) {
      add(iframe.src);
      try {
        const frameWindow = iframe.contentWindow;
        add(frameWindow?.location?.href);
      } catch {}
    }

    for (const element of document.querySelectorAll('[src],[href],[data],[data-src],[objectid]')) {
      for (const attr of ['src', 'href', 'data', 'data-src', 'objectid']) {
        add(element.getAttribute(attr));
      }
    }

    for (const script of document.scripts) {
      add(script.src);
      if (script.textContent && /objectid|file_[a-f0-9]{32}|ananas\/status/i.test(script.textContent)) {
        add(script.textContent.slice(0, 20000));
      }
    }

    return candidates;
  }

  function postCandidatesToTop() {
    if (window.top === window.self) return;
    const texts = collectLocalCandidateTexts();
    if (!texts.length) return;
    window.top.postMessage({
      type: MESSAGE_TYPE,
      sourceUrl: window.location.href,
      texts,
      timestamp: Date.now()
    }, '*');
  }

  function watchFrameChanges() {
    if (window.top === window.self) return;

    let lastUrl = window.location.href;
    let publishTimer = null;

    const schedulePublish = () => {
      window.clearTimeout(publishTimer);
      publishTimer = window.setTimeout(() => {
        if (window.location.href !== lastUrl) {
          lastUrl = window.location.href;
        }
        postCandidatesToTop();
      }, 150);
    };

    const observer = new MutationObserver(schedulePublish);
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'href', 'data', 'data-src', 'objectid']
      });
    }

    window.addEventListener('load', schedulePublish);
    window.addEventListener('hashchange', schedulePublish);
    window.addEventListener('message', event => {
      if (event.source !== window.top || !event.data || event.data.type !== REQUEST_TYPE) {
        return;
      }
      schedulePublish();
    });

    window.setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        schedulePublish();
      }
    }, 500);

    postCandidatesToTop();
  }

  if (window.top !== window.self) {
    watchFrameChanges();
    return;
  }

  if (document.getElementById(ROOT_ID)) {
    return;
  }

  function rememberSharedCandidates(sourceUrl, texts, timestamp) {
    if (typeof sourceUrl === 'string' && sourceUrl) {
      for (const [text, meta] of sharedCandidates.entries()) {
        if (meta.sourceUrl === sourceUrl) {
          sharedCandidates.delete(text);
        }
      }
    }

    for (const text of texts) {
      if (typeof text === 'string' && text) {
        sharedCandidates.set(text, {
          sourceUrl,
          timestamp: typeof timestamp === 'number' ? timestamp : Date.now()
        });
      }
    }
  }

  window.addEventListener('message', event => {
    if (event.source === window || !event.data || event.data.type !== MESSAGE_TYPE) {
      return;
    }
    const texts = Array.isArray(event.data.texts) ? event.data.texts : [];
    rememberSharedCandidates(event.data.sourceUrl, texts, event.data.timestamp);
  });

  function requestFreshCandidates() {
    for (const iframe of document.querySelectorAll('iframe')) {
      try {
        iframe.contentWindow?.postMessage({ type: REQUEST_TYPE }, '*');
      } catch {}
    }
  }

  function clampPosition(x, y, width, height) {
    const margin = 12;
    return {
      x: Math.min(Math.max(x, margin), window.innerWidth - width - margin),
      y: Math.min(Math.max(y, margin), window.innerHeight - height - margin)
    };
  }

  function savePosition(position) {
    try {
      window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
    } catch {}
  }

  function loadPosition() {
    try {
      const raw = window.localStorage.getItem(POSITION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.x !== 'number' || typeof parsed?.y !== 'number') {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function applyRootPosition(root, position) {
    const rect = root.getBoundingClientRect();
    const next = clampPosition(position.x, position.y, rect.width, rect.height);
    root.style.left = `${next.x}px`;
    root.style.top = `${next.y}px`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
    savePosition(next);
  }

  function initializeRootPosition(root) {
    const saved = loadPosition();
    if (saved) {
      applyRootPosition(root, saved);
      return;
    }

    const rect = root.getBoundingClientRect();
    applyRootPosition(root, {
      x: window.innerWidth - rect.width - 24,
      y: window.innerHeight - rect.height - 24
    });
  }

  function attachDragHandlers(root) {
    const button = root.querySelector(`#${BUTTON_ID}`);
    if (!button) return;

    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      const rect = root.getBoundingClientRect();
      dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: rect.left,
        originY: rect.top,
        moved: false
      };
      button.setPointerCapture(event.pointerId);
    });

    button.addEventListener('pointermove', event => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      if (!dragState.moved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) {
        return;
      }

      dragState.moved = true;
      const rect = root.getBoundingClientRect();
      const next = clampPosition(
        dragState.originX + deltaX,
        dragState.originY + deltaY,
        rect.width,
        rect.height
      );
      root.style.left = `${next.x}px`;
      root.style.top = `${next.y}px`;
      root.style.right = 'auto';
      root.style.bottom = 'auto';
    });

    const finishDrag = event => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      if (dragState.moved) {
        suppressNextClick = true;
        const rect = root.getBoundingClientRect();
        savePosition({ x: rect.left, y: rect.top });
        window.setTimeout(() => {
          suppressNextClick = false;
        }, 0);
      }
      button.releasePointerCapture(event.pointerId);
      dragState = null;
    };

    button.addEventListener('pointerup', finishDrag);
    button.addEventListener('pointercancel', finishDrag);
    button.addEventListener('click', event => {
      if (!suppressNextClick) return;
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }

  function createUi() {
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = `
      <button id="${BUTTON_ID}" type="button">抓 PDF</button>
      <div id="${PANEL_ID}" hidden>
        <div id="${STATUS_ID}">等待操作</div>
        <a id="${LINK_ID}" href="#" target="_blank" rel="noreferrer noopener" hidden></a>
        <button id="${CLOSE_ID}" type="button">关闭</button>
      </div>
    `;
    document.documentElement.appendChild(root);

    initializeRootPosition(root);
    attachDragHandlers(root);

    root.querySelector(`#${BUTTON_ID}`).addEventListener('click', handleExtractClick);
    root.querySelector(`#${CLOSE_ID}`).addEventListener('click', () => {
      root.querySelector(`#${PANEL_ID}`).hidden = true;
    });

    window.addEventListener('resize', () => {
      const rect = root.getBoundingClientRect();
      applyRootPosition(root, { x: rect.left, y: rect.top });
      positionPanel();
    });
  }

  function positionPanel() {
    const button = document.getElementById(BUTTON_ID);
    const panel = document.getElementById(PANEL_ID);
    if (!button || !panel || panel.hidden) return;

    const gap = 10;
    const margin = 12;
    const buttonRect = button.getBoundingClientRect();

    panel.style.left = '0px';
    panel.style.top = '0px';

    const panelRect = panel.getBoundingClientRect();
    const panelWidth = panelRect.width;
    const panelHeight = panelRect.height;

    let left = buttonRect.right - panelWidth;
    let top = buttonRect.top - panelHeight - gap;

    if (left < margin) {
      left = margin;
    }
    if (left + panelWidth > window.innerWidth - margin) {
      left = window.innerWidth - panelWidth - margin;
    }

    if (top < margin) {
      top = buttonRect.bottom + gap;
    }
    if (top + panelHeight > window.innerHeight - margin) {
      top = window.innerHeight - panelHeight - margin;
    }
    if (top < margin) {
      top = margin;
    }

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function setButtonState(text, disabled) {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    button.textContent = text;
    button.disabled = disabled;
  }

  function showPanel(message, link) {
    const panel = document.getElementById(PANEL_ID);
    const status = document.getElementById(STATUS_ID);
    const anchor = document.getElementById(LINK_ID);
    if (!panel || !status || !anchor) return;

    status.textContent = message;
    if (link) {
      anchor.hidden = false;
      anchor.href = link;
      anchor.textContent = link;
    } else {
      anchor.hidden = true;
      anchor.removeAttribute('href');
      anchor.textContent = '';
    }
    panel.hidden = false;
    positionPanel();
  }

  function extractObjectIdByPatterns(text, patterns) {
    if (!text) return null;
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1].toLowerCase();
    }
    return null;
  }

  function isLikelyDocumentUrl(text) {
    return /\/screen\/v2\/file_|\/screen\/file\?|objectid=|\/ananas\/status\//i.test(text);
  }

  function collectCandidateTexts() {
    const candidates = collectLocalCandidateTexts();
    const seen = new Set(candidates);
    const shared = [...sharedCandidates.entries()]
      .sort((a, b) => b[1].timestamp - a[1].timestamp)
      .map(([text]) => text);

    for (const text of shared) {
      if (seen.has(text)) continue;
      seen.add(text);
      candidates.push(text);
    }

    return candidates;
  }

  function findObjectId() {
    const texts = collectCandidateTexts();
    const strongPatterns = [
      /\/ananas\/status\/([a-f0-9]{32})\b/i,
      /\/screen\/v2\/file_([a-f0-9]{32})\b/i,
      /\/screen\/file\?[^\s"']*\bobjectid=([a-f0-9]{32})\b/i,
      /[?&]objectid=([a-f0-9]{32})\b/i,
      /"objectid"\s*[:=]\s*"([a-f0-9]{32})"/i,
      /'objectid'\s*[:=]\s*'([a-f0-9]{32})'/i
    ];

    for (const text of texts) {
      const objectId = extractObjectIdByPatterns(text, strongPatterns);
      if (objectId) return objectId;
    }

    for (const text of texts) {
      if (!isLikelyDocumentUrl(text)) continue;
      const objectId = extractObjectIdByPatterns(text, [
        /file_([a-f0-9]{32})\b/i,
        /objectid=([a-f0-9]{32})\b/i,
        /\/status\/([a-f0-9]{32})\b/i
      ]);
      if (objectId) return objectId;
    }

    return null;
  }

  async function fetchStatus(objectId) {
    const url = `https://mooc1.chaoxing.com/ananas/status/${objectId}?flag=normal&_dc=${Date.now()}`;
    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    });

    if (!response.ok) {
      throw new Error(`状态请求失败：${response.status}`);
    }

    return response.json();
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }

  async function handleExtractClick() {
    if (busy) return;
    busy = true;
    requestFreshCandidates();
    setButtonState('抓取中...', true);
    showPanel('正在定位课件...', null);

    try {
      await new Promise(resolve => window.setTimeout(resolve, 250));
      const objectId = findObjectId();
      if (!objectId) {
        throw new Error('未找到当前课件的 objectid，请先打开目标 PPT/课件页面。');
      }

      const payload = await fetchStatus(objectId);
      if (!payload || payload.status !== 'success' || !payload.pdf) {
        throw new Error('已找到课件，但返回结果里没有 pdf 字段。');
      }

      await copyToClipboard(payload.pdf);
      showPanel(`已复制：${payload.filename || objectId}`, payload.pdf);
      setButtonState('已复制', false);
      window.setTimeout(() => setButtonState('抓 PDF', false), 1800);
    } catch (error) {
      showPanel(error instanceof Error ? error.message : '抓取失败', null);
      setButtonState('重试', false);
      window.setTimeout(() => setButtonState('抓 PDF', false), 1800);
    } finally {
      busy = false;
    }
  }

  function boot() {
    if (document.body || document.documentElement) {
      createUi();
      return;
    }

    const observer = new MutationObserver(() => {
      if (document.body || document.documentElement) {
        observer.disconnect();
        createUi();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  boot();
})();
