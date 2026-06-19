import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

// Cấu hình lưu trong userData. API key được mã hóa bằng safeStorage (DPAPI trên Windows).
const CONFIG_PATH = () => join(app.getPath('userData'), 'config.json')

const DEFAULTS = {
  sourceLang: 'eng',        // ngôn ngữ OCR — BẮT BUỘC người dùng chọn, không auto-detect
  targetLang: 'vi',         // ngôn ngữ dịch đích
  geminiKeysEnc: [],        // mảng key Gemini đã mã hóa (base64) — xoay vòng khi 429
  cloudTranslateKeyEnc: null, // key Cloud Translation API (fallback cuối)
  geminiModel: 'gemini-2.5-flash',  // 2.0-flash đã bị Google ngừng phục vụ
  captureHotkey: 'CommandOrControl+Alt+T' // hotkey chụp & dịch — có thể tuỳ chỉnh
}

// Model cũ đã ngừng phục vụ → tự nâng cấp về default khi load config cũ
const DEPRECATED_MODELS = new Set(['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro'])

let cache = null

function load() {
  if (cache) return cache
  try {
    if (existsSync(CONFIG_PATH())) {
      cache = { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_PATH(), 'utf-8')) }
    } else {
      cache = { ...DEFAULTS }
    }
  } catch {
    cache = { ...DEFAULTS }
  }
  // Migration model cũ
  if (DEPRECATED_MODELS.has(cache.geminiModel)) {
    cache.geminiModel = DEFAULTS.geminiModel
  }
  // Migration: key đơn cũ (geminiKeyEnc) → mảng geminiKeysEnc
  let migrated = false
  if (cache.geminiKeyEnc && (!cache.geminiKeysEnc || cache.geminiKeysEnc.length === 0)) {
    cache.geminiKeysEnc = [cache.geminiKeyEnc]
    migrated = true
  }
  if ('geminiKeyEnc' in cache) { delete cache.geminiKeyEnc; migrated = true }
  if (!Array.isArray(cache.geminiKeysEnc)) { cache.geminiKeysEnc = []; migrated = true }
  if (migrated) {
    try { persist() } catch { /* ignore */ }
  }
  return cache
}

function persist() {
  writeFileSync(CONFIG_PATH(), JSON.stringify(cache, null, 2), 'utf-8')
}

// ---- mã hóa / giải mã dùng chung ----
function encrypt(plain) {
  if (!plain) return null
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plain).toString('base64')
  }
  // môi trường thiếu DPAPI: lưu base64 thường (không lý tưởng nhưng giữ chức năng)
  return Buffer.from(plain, 'utf-8').toString('base64')
}

// Giải mã 1 chuỗi. Trả về { value, broken }: broken=true nếu là dạng mã hóa nhưng decrypt fail.
function decrypt(enc) {
  if (!enc) return { value: null, broken: false }
  const buf = Buffer.from(enc, 'base64')
  // key mã hóa bằng safeStorage (DPAPI) bắt đầu bằng magic header "v10"/"v11"
  const looksEncrypted = buf.length >= 3 && buf.subarray(0, 3).toString('latin1').startsWith('v1')
  if (looksEncrypted && safeStorage.isEncryptionAvailable()) {
    try {
      return { value: safeStorage.decryptString(buf), broken: false }
    } catch {
      return { value: null, broken: true } // không giải mã được → hỏng
    }
  }
  return { value: buf.toString('utf-8'), broken: false }
}

// Che key để hiển thị an toàn ra renderer: 4 ký tự đầu + 4 cuối, giữa là dấu …
function maskKey(k) {
  if (!k) return ''
  if (k.length <= 10) return k[0] + '…' + k[k.length - 1]
  return `${k.slice(0, 4)}…${k.slice(-4)}`
}

export function getConfig() {
  const c = load()
  const geminiKeys = getGeminiKeys()
  const cloudKey = getCloudTranslateKey()
  return {
    sourceLang: c.sourceLang,
    targetLang: c.targetLang,
    geminiModel: c.geminiModel,
    captureHotkey: c.captureHotkey,
    // Danh sách key đã che — đủ để nhận ra key nào, không lộ toàn bộ
    geminiKeysMasked: geminiKeys.map(maskKey),
    geminiKeyCount: geminiKeys.length,
    cloudTranslateKeyMasked: cloudKey ? maskKey(cloudKey) : null,
    hasCloudTranslateKey: !!cloudKey
  }
}

export function setConfig(patch) {
  load()
  if (typeof patch.sourceLang === 'string') cache.sourceLang = patch.sourceLang
  if (typeof patch.targetLang === 'string') cache.targetLang = patch.targetLang
  if (typeof patch.geminiModel === 'string') cache.geminiModel = patch.geminiModel
  if (typeof patch.captureHotkey === 'string') cache.captureHotkey = patch.captureHotkey
  persist()
  return getConfig()
}

// THÊM các key mới vào danh sách (không ghi đè), bỏ trùng. Mỗi phần tử là plain text.
export function addGeminiKeys(plainKeys) {
  load()
  const incoming = (plainKeys || []).map((k) => k.trim()).filter(Boolean)
  const existing = getGeminiKeys() // các key đang lưu (đã giải mã, loại key hỏng)
  for (const k of incoming) {
    if (!existing.includes(k)) {
      const enc = encrypt(k)
      if (enc) cache.geminiKeysEnc.push(enc)
      existing.push(k)
    }
  }
  persist()
  return getConfig()
}

// Xóa 1 key Gemini theo vị trí (index trong danh sách đã giải mã).
export function removeGeminiKey(index) {
  load()
  // tái dựng danh sách enc khớp với thứ tự đã giải mã (loại key hỏng)
  const goodEnc = []
  for (const enc of cache.geminiKeysEnc) {
    const { broken } = decrypt(enc)
    if (!broken) goodEnc.push(enc)
  }
  if (index >= 0 && index < goodEnc.length) {
    goodEnc.splice(index, 1)
  }
  cache.geminiKeysEnc = goodEnc
  persist()
  return getConfig()
}

export function setCloudTranslateKey(plainKey) {
  load()
  cache.cloudTranslateKeyEnc = plainKey ? encrypt(plainKey.trim()) : null
  persist()
  return getConfig()
}

// Trả mảng key Gemini đã giải mã (bỏ key hỏng + tự dọn khỏi file).
export function getGeminiKeys() {
  const c = load()
  const good = []
  let changed = false
  for (const enc of c.geminiKeysEnc) {
    const { value, broken } = decrypt(enc)
    if (broken) { changed = true; continue } // bỏ key hỏng
    if (value) good.push({ enc, value })
  }
  if (changed) {
    cache.geminiKeysEnc = good.map((g) => g.enc)
    persist()
  }
  return good.map((g) => g.value)
}

export function getCloudTranslateKey() {
  const c = load()
  const { value, broken } = decrypt(c.cloudTranslateKeyEnc)
  if (broken) {
    cache.cloudTranslateKeyEnc = null
    persist()
    return null
  }
  return value
}
