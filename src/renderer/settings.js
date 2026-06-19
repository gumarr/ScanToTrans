const $ = (id) => document.getElementById(id)

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
}

function renderKeyList(masked) {
  const el = $('keyList')
  if (!masked || masked.length === 0) {
    el.innerHTML = '<div class="key-empty">Chưa có key nào.</div>'
    return
  }
  el.innerHTML = masked
    .map((m, i) => `<div class="key-row"><code>${esc(m)}</code><button class="del" data-i="${i}">Xóa</button></div>`)
    .join('')
  el.querySelectorAll('.del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cfg = await window.api.removeGeminiKey(Number(btn.dataset.i))
      apply(cfg)
    })
  })
}

function apply(cfg) {
  $('sourceLang').value = cfg.sourceLang
  $('targetLang').value = cfg.targetLang
  $('geminiModel').value = cfg.geminiModel
  $('keyState').textContent = cfg.geminiKeyCount > 0 ? `(${cfg.geminiKeyCount} key)` : ''
  renderKeyList(cfg.geminiKeysMasked)
  $('cloudState').textContent = cfg.hasCloudTranslateKey
    ? `✓ Đã lưu: ${cfg.cloudTranslateKeyMasked}`
    : '✗ Chưa có'
  // Hiển thị hotkey hiện tại
  const display = acceleratorToDisplay(cfg.captureHotkey || 'CommandOrControl+Alt+T')
  $('hotkeyDisplay').textContent = display
  $('footerHotkey').textContent = display
}

async function load() {
  apply(await window.api.getConfig())
}

$('save').addEventListener('click', async () => {
  await window.api.setConfig({
    sourceLang: $('sourceLang').value,
    targetLang: $('targetLang').value,
    geminiModel: $('geminiModel').value
  })

  // Thêm key Gemini mới (append, không ghi đè)
  const geminiText = $('geminiKeys').value.trim()
  if (geminiText) {
    const keys = geminiText.split('\n').map((s) => s.trim()).filter(Boolean)
    await window.api.addGeminiKeys(keys)
    $('geminiKeys').value = ''
  }

  const cloud = $('cloudKey').value.trim()
  if (cloud) {
    await window.api.setCloudTranslateKey(cloud)
    $('cloudKey').value = ''
  }

  apply(await window.api.getConfig())
  $('status').textContent = 'Đã lưu ✓'
  setTimeout(() => ($('status').textContent = ''), 2000)
})

// ===================== Hotkey Recorder =====================

const DEFAULT_HOTKEY = 'CommandOrControl+Alt+T'

// Chuyển accelerator (Electron format) thành dạng hiển thị thân thiện
function acceleratorToDisplay(acc) {
  return acc
    .replace(/CommandOrControl/gi, 'Ctrl')
    .replace(/CmdOrCtrl/gi, 'Ctrl')
    .replace(/Control/gi, 'Ctrl')
    .replace(/Command/gi, 'Cmd')
}

// Map KeyboardEvent.code / key → tên phím Electron accelerator
function keyToAcceleratorPart(e) {
  // Bỏ qua phím modifier đơn lẻ
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null

  // Phím chữ cái
  if (/^Key([A-Z])$/.test(e.code)) return e.code.slice(3) // KeyA → A

  // Phím số hàng trên
  if (/^Digit(\d)$/.test(e.code)) return e.code.slice(5) // Digit1 → 1

  // F-keys
  if (/^F(\d+)$/.test(e.key)) return e.key // F1, F2...

  // Phím đặc biệt phổ biến
  const map = {
    'Space': 'Space', ' ': 'Space',
    'Enter': 'Return', 'Backspace': 'Backspace', 'Delete': 'Delete',
    'Tab': 'Tab', 'Escape': 'Escape',
    'ArrowUp': 'Up', 'ArrowDown': 'Down', 'ArrowLeft': 'Left', 'ArrowRight': 'Right',
    'Home': 'Home', 'End': 'End', 'PageUp': 'PageUp', 'PageDown': 'PageDown',
    'Insert': 'Insert', 'PrintScreen': 'PrintScreen',
    '-': '-', '=': '=', '[': '[', ']': ']',
    '\\': '\\', ';': ';', "'": "'", ',': ',', '.': '.', '/': '/',
    '`': '`',
    'Minus': '-', 'Equal': '=', 'BracketLeft': '[', 'BracketRight': ']',
    'Backslash': '\\', 'Semicolon': ';', 'Quote': "'", 'Comma': ',',
    'Period': '.', 'Slash': '/', 'Backquote': '`',
    'NumpadAdd': 'numadd', 'NumpadSubtract': 'numsub',
    'NumpadMultiply': 'nummult', 'NumpadDivide': 'numdiv',
    'NumpadDecimal': 'numdec',
  }

  // Numpad digits
  if (/^Numpad(\d)$/.test(e.code)) return 'num' + e.code.slice(6)

  // Tìm theo code trước, rồi key
  if (map[e.code]) return map[e.code]
  if (map[e.key]) return map[e.key]

  // Fallback: dùng key nếu là ký tự đơn
  if (e.key.length === 1) return e.key.toUpperCase()

  return null // phím không hỗ trợ
}

let isRecording = false
const hotkeyEl = $('hotkeyDisplay')
const hotkeyStatus = $('hotkeyStatus')

hotkeyEl.addEventListener('focus', () => {
  isRecording = true
  hotkeyEl.classList.add('recording')
  hotkeyEl.textContent = 'Nhấn tổ hợp phím…'
  hotkeyStatus.textContent = ''
  hotkeyStatus.className = ''
})

hotkeyEl.addEventListener('blur', () => {
  isRecording = false
  hotkeyEl.classList.remove('recording')
  // Nếu vẫn đang hiện placeholder thì khôi phục giá trị cũ
  if (hotkeyEl.textContent === 'Nhấn tổ hợp phím…') {
    load() // reload config value
  }
})

hotkeyEl.addEventListener('keydown', async (e) => {
  if (!isRecording) return
  e.preventDefault()
  e.stopPropagation()

  const mainKey = keyToAcceleratorPart(e)
  if (!mainKey) return // chỉ modifier, bỏ qua

  // Xây dựng accelerator string
  const parts = []
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  // Phải có ít nhất 1 modifier
  if (parts.length === 0) {
    hotkeyStatus.textContent = '⚠ Cần ít nhất 1 modifier (Ctrl, Alt, Shift)'
    hotkeyStatus.className = 'err'
    return
  }

  parts.push(mainKey)
  const accelerator = parts.join('+')
  const display = acceleratorToDisplay(accelerator)

  // Hiển thị ngay
  hotkeyEl.textContent = display
  hotkeyEl.classList.remove('recording')
  isRecording = false
  hotkeyEl.blur()

  // Gửi lên main process để đăng ký
  hotkeyStatus.textContent = 'Đang đăng ký…'
  hotkeyStatus.className = ''
  const result = await window.api.setCaptureHotkey(accelerator)

  if (result.ok) {
    hotkeyStatus.textContent = '✓ Đã đặt hotkey: ' + display
    hotkeyStatus.className = 'ok'
    $('footerHotkey').textContent = display
    setTimeout(() => { hotkeyStatus.textContent = ''; hotkeyStatus.className = '' }, 3000)
  } else {
    hotkeyStatus.textContent = '✗ ' + (result.error || 'Không thể đăng ký hotkey')
    hotkeyStatus.className = 'err'
    // Khôi phục hiển thị cũ
    load()
  }
})

// Nút khôi phục mặc định
$('hotkeyReset').addEventListener('click', async () => {
  hotkeyStatus.textContent = 'Đang khôi phục…'
  hotkeyStatus.className = ''
  const result = await window.api.setCaptureHotkey(DEFAULT_HOTKEY)
  if (result.ok) {
    const display = acceleratorToDisplay(DEFAULT_HOTKEY)
    hotkeyEl.textContent = display
    $('footerHotkey').textContent = display
    hotkeyStatus.textContent = '✓ Đã khôi phục mặc định: ' + display
    hotkeyStatus.className = 'ok'
    setTimeout(() => { hotkeyStatus.textContent = ''; hotkeyStatus.className = '' }, 3000)
  } else {
    hotkeyStatus.textContent = '✗ ' + (result.error || 'Lỗi')
    hotkeyStatus.className = 'err'
  }
})

load()
