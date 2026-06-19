import { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer, screen } from 'electron'
import { join } from 'path'
import { recognize, disposeOcr } from './ocr.js'
import { translate } from './translate.js'
import { getConfig, setConfig, addGeminiKeys, removeGeminiKey, setCloudTranslateKey } from './config.js'

// Lưu accelerator hiện tại của hotkey chụp để có thể unregister khi đổi
let currentCaptureHotkey = null

// Đặt tên app cố định để userData + safeStorage (DPAPI) nhất quán giữa dev và bản đóng gói.
// Nếu không, key mã hóa ở môi trường này có thể không giải mã được ở môi trường kia.
app.setName('scantotrans')

// __dirname có sẵn trong bundle CJS của electron-vite
const PRELOAD = join(__dirname, '../preload/index.js')

const webPrefs = { preload: PRELOAD, contextIsolation: true, nodeIntegration: false }

// electron-vite cung cấp biến môi trường này khi dev
const DEV_SERVER = process.env.ELECTRON_RENDERER_URL

let overlayWin = null
let tooltipWin = null
let settingsWin = null

function rendererUrl(page) {
  // dev: vite server; prod: file build
  if (DEV_SERVER) return `${DEV_SERVER}/${page}.html`
  return join(__dirname, `../renderer/${page}.html`)
}

function loadPage(win, page) {
  if (DEV_SERVER) win.loadURL(rendererUrl(page))
  else win.loadFile(rendererUrl(page))
}

// ---------- Overlay chụp vùng ----------
async function startCapture() {
  if (overlayWin) return

  const primary = screen.getPrimaryDisplay()
  const { width, height } = primary.size
  const scaleFactor = primary.scaleFactor

  // Chụp toàn màn hình trước (ở độ phân giải vật lý) để crop chính xác trên màn HiDPI
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(width * scaleFactor), height: Math.round(height * scaleFactor) }
  })
  const screenSource = sources[0]
  const fullShot = screenSource.thumbnail // nativeImage

  overlayWin = new BrowserWindow({
    x: 0, y: 0, width, height,
    frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, resizable: false, movable: false, fullscreen: true,
    webPreferences: webPrefs
  })
  overlayWin.setAlwaysOnTop(true, 'screen-saver')

  loadPage(overlayWin, 'overlay')
  // Lưu ảnh full để dùng khi nhận vùng chọn
  overlayWin.__fullShot = fullShot
  overlayWin.__scaleFactor = scaleFactor

  overlayWin.on('closed', () => { overlayWin = null })
}

function closeOverlay() {
  if (overlayWin) { overlayWin.close(); overlayWin = null }
}

// ---------- Tooltip kết quả ----------
function showTooltip(payload, anchor) {
  if (!tooltipWin) {
    tooltipWin = new BrowserWindow({
      width: 380, height: 220,
      frame: false, transparent: true, alwaysOnTop: true,
      skipTaskbar: true, resizable: false,
      webPreferences: webPrefs
    })
    tooltipWin.setAlwaysOnTop(true, 'screen-saver')
    loadPage(tooltipWin, 'tooltip')
    tooltipWin.on('closed', () => { tooltipWin = null })
  }
  // đặt vị trí gần vùng chọn (dưới vùng)
  if (anchor) {
    const x = Math.min(anchor.x, screen.getPrimaryDisplay().size.width - 390)
    const y = Math.min(anchor.y + anchor.h + 8, screen.getPrimaryDisplay().size.height - 230)
    tooltipWin.setBounds({ x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)), width: 380, height: 220 })
  }
  const send = () => tooltipWin.webContents.send('tooltip:update', payload)
  if (tooltipWin.webContents.isLoading()) tooltipWin.webContents.once('did-finish-load', send)
  else send()
  tooltipWin.showInactive()
}

// ---------- Settings ----------
function openSettings() {
  if (settingsWin) { settingsWin.focus(); return }
  settingsWin = new BrowserWindow({
    width: 480, height: 540, title: 'ScanToTrans — Settings',
    backgroundColor: '#0a0a12',
    webPreferences: webPrefs
  })
  loadPage(settingsWin, 'settings')
  settingsWin.on('closed', () => { settingsWin = null })
}

// ---------- IPC ----------
// Overlay gửi vùng chọn (toạ độ theo CSS pixel của overlay) → crop → OCR → dịch → tooltip
ipcMain.handle('capture:region', async (_e, region) => {
  const win = overlayWin
  if (!win || !win.__fullShot) throw new Error('Overlay không sẵn sàng')
  const scale = win.__scaleFactor
  const full = win.__fullShot

  // region: { x, y, w, h } theo CSS pixel → đổi sang pixel vật lý
  const crop = {
    x: Math.round(region.x * scale),
    y: Math.round(region.y * scale),
    width: Math.round(region.w * scale),
    height: Math.round(region.h * scale)
  }
  const cropped = full.crop(crop)
  const pngBuffer = cropped.toPNG()

  closeOverlay()

  const cfg = getConfig()
  const anchor = { x: region.x, y: region.y, w: region.w, h: region.h }

  // hiện tooltip loading ngay
  showTooltip({ status: 'loading' }, anchor)

  try {
    const t0 = Date.now()
    const { text } = await recognize(pngBuffer, cfg.sourceLang)
    const tOcr = Date.now() - t0
    if (!text) {
      showTooltip({ status: 'error', message: 'Không nhận được text từ vùng chọn' }, anchor)
      return { ok: false }
    }
    let translated = ''
    let provider = 'gemini'
    let tTrans = 0
    try {
      const t1 = Date.now()
      const r = await translate(text, { to: cfg.targetLang })
      translated = r.text
      provider = r.provider
      tTrans = Date.now() - t1
    } catch (err) {
      showTooltip({ status: 'partial', source: text, message: err.message, kind: err.kind, timing: { ocr: tOcr } }, anchor)
      return { ok: false }
    }
    showTooltip({ status: 'done', source: text, translation: translated, provider, timing: { ocr: tOcr, translate: tTrans } }, anchor)
    return { ok: true }
  } catch (err) {
    showTooltip({ status: 'error', message: err.message }, anchor)
    return { ok: false }
  }
})

ipcMain.handle('capture:cancel', () => { closeOverlay() })
ipcMain.handle('tooltip:close', () => { if (tooltipWin) tooltipWin.hide() })

ipcMain.handle('config:get', () => getConfig())
ipcMain.handle('config:set', (_e, patch) => setConfig(patch))
ipcMain.handle('config:addGeminiKeys', (_e, keys) => addGeminiKeys(keys))
ipcMain.handle('config:removeGeminiKey', (_e, index) => removeGeminiKey(index))
ipcMain.handle('config:setCloudTranslateKey', (_e, key) => setCloudTranslateKey(key))
ipcMain.handle('settings:open', () => openSettings())

// Đổi hotkey chụp tại runtime: unregister cũ → register mới → lưu config
ipcMain.handle('config:setCaptureHotkey', (_e, accelerator) => {
  if (!accelerator || typeof accelerator !== 'string') return { ok: false, error: 'Hotkey không hợp lệ' }
  // Thử đăng ký trước, nếu lỗi (tổ hợp bị trùng / không hợp lệ) thì báo về renderer
  try {
    if (currentCaptureHotkey) globalShortcut.unregister(currentCaptureHotkey)
    const ok = globalShortcut.register(accelerator, () => { startCapture() })
    if (!ok) {
      // đăng ký lại cái cũ nếu có
      if (currentCaptureHotkey) globalShortcut.register(currentCaptureHotkey, () => { startCapture() })
      return { ok: false, error: 'Không thể đăng ký hotkey — có thể bị app khác chiếm' }
    }
    currentCaptureHotkey = accelerator
    setConfig({ captureHotkey: accelerator })
    return { ok: true }
  } catch (err) {
    // khôi phục cái cũ
    if (currentCaptureHotkey) {
      try { globalShortcut.register(currentCaptureHotkey, () => { startCapture() }) } catch { /* bỏ qua */ }
    }
    return { ok: false, error: err.message }
  }
})

// ---------- App lifecycle ----------
app.whenReady().then(() => {
  // Đọc hotkey chụp từ config (có thể đã được user tuỳ chỉnh)
  const cfg = getConfig()
  currentCaptureHotkey = cfg.captureHotkey || 'CommandOrControl+Alt+T'
  globalShortcut.register(currentCaptureHotkey, () => { startCapture() })
  globalShortcut.register('CommandOrControl+Alt+S', () => { openSettings() })
  // mở settings lần đầu để người dùng nhập key + chọn ngôn ngữ
  openSettings()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  disposeOcr()
})

// Không thoát khi đóng hết cửa sổ — app chạy nền chờ hotkey
app.on('window-all-closed', (e) => { /* giữ chạy nền */ })
