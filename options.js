const DEFAULT_HOTKEY = { key: 'p', ctrl: true, alt: false, shift: false };
const STORAGE_KEY = 'cx-pdf-extractor-hotkey';

const hotkeyInput = document.getElementById('hotkey-input');
const saveBtn = document.getElementById('save-btn');
const resetBtn = document.getElementById('reset-btn');
const statusDiv = document.getElementById('status');

let currentHotkey = { ...DEFAULT_HOTKEY };

function formatHotkey(hotkey) {
  const parts = [];
  if (hotkey.ctrl) parts.push('Ctrl');
  if (hotkey.alt) parts.push('Alt');
  if (hotkey.shift) parts.push('Shift');
  parts.push(hotkey.key.toUpperCase());
  return parts.join('+');
}

function loadHotkey() {
  chrome.storage.sync.get([STORAGE_KEY], result => {
    if (result[STORAGE_KEY]) {
      currentHotkey = result[STORAGE_KEY];
    }
    hotkeyInput.value = formatHotkey(currentHotkey);
  });
}

function saveHotkey() {
  chrome.storage.sync.set({ [STORAGE_KEY]: currentHotkey }, () => {
    showStatus('快捷键已保存！', 'success');
  });
}

function resetHotkey() {
  currentHotkey = { ...DEFAULT_HOTKEY };
  hotkeyInput.value = formatHotkey(currentHotkey);
  saveHotkey();
}

function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.hidden = false;
  setTimeout(() => {
    statusDiv.hidden = true;
  }, 3000);
}

hotkeyInput.addEventListener('keydown', event => {
  event.preventDefault();

  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
    return;
  }

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  currentHotkey = {
    key: key,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey
  };

  hotkeyInput.value = formatHotkey(currentHotkey);
});

saveBtn.addEventListener('click', saveHotkey);
resetBtn.addEventListener('click', resetHotkey);

loadHotkey();
