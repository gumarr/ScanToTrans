import { getGeminiKeys, getConfig } from './config.js'
import { translateGoogle, hasCloudTranslate } from './google-translate.js'
import { translateGoogleFree } from './google-free-translate.js'

// Dịch theo TẦNG fallback:
//   1. Gemini (xoay vòng nhiều key khi gặp 429)
//   2. Cạn key Gemini / tất cả 429 → Google Cloud Translation (nếu có key)
//   3. Không có Cloud key (hoặc Cloud cũng lỗi) → Google Translate "free" (không cần key)
//   4. Sang ngày mới (giờ Pacific — Gemini reset quota nửa đêm PT) → thử lại Gemini từ đầu
//
// Để không phí thời gian thử lại Gemini suốt cả ngày sau khi đã 429, ta nhớ "ngày Gemini
// kiệt quota" và bỏ qua Gemini cho tới khi sang ngày Pacific mới.

const LANG_NAMES = {
  vi: 'Vietnamese', en: 'English', ja: 'Japanese',
  'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese', ko: 'Korean'
}
const langName = (code) => LANG_NAMES[code] || code

const TIMEOUT_MS = 15000

export class TranslateError extends Error {
  constructor(message, { kind, retryAfterMs } = {}) {
    super(message)
    this.name = 'TranslateError'
    this.kind = kind // 'quota' | 'auth' | 'rate' | 'server' | 'network' | 'blocked' | 'empty' | 'unknown'
    this.retryAfterMs = retryAfterMs
  }
}

// ---- theo dõi ngày Gemini kiệt quota (theo giờ Pacific) ----
// "YYYY-MM-DD" theo America/Los_Angeles
function pacificDay() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date())
}
let geminiExhaustedDay = null
function geminiExhaustedToday() {
  return geminiExhaustedDay === pacificDay()
}
function markGeminiExhausted() {
  geminiExhaustedDay = pacificDay()
}

// ---- Gemini: parse lỗi ----
function parseGeminiError(status, bodyText) {
  let parsed = null
  try { parsed = JSON.parse(bodyText) } catch { /* not json */ }
  const err = parsed?.error
  const apiStatus = err?.status
  const apiMsg = err?.message || bodyText?.slice(0, 200) || ''

  if (status === 429 || apiStatus === 'RESOURCE_EXHAUSTED') {
    return new TranslateError('Gemini hết hạn mức (429).', { kind: 'quota' })
  }
  if (status === 401 || status === 403 || apiStatus === 'PERMISSION_DENIED' || apiStatus === 'UNAUTHENTICATED') {
    return new TranslateError('Gemini key không hợp lệ.', { kind: 'auth' })
  }
  if (status === 400 && /api key not valid/i.test(apiMsg)) {
    return new TranslateError('Gemini key không hợp lệ.', { kind: 'auth' })
  }
  if (status === 503 || apiStatus === 'UNAVAILABLE' || status >= 500) {
    return new TranslateError(`Gemini lỗi máy chủ (${status}).`, { kind: 'server' })
  }
  return new TranslateError(`Gemini lỗi ${status}: ${apiMsg}`, { kind: 'unknown' })
}

// ---- Gemini: gọi 1 lần với 1 key ----
async function callGemini({ key, model, prompt }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } }),
      signal: controller.signal
    })
  } catch (e) {
    if (e.name === 'AbortError') throw new TranslateError('Hết thời gian chờ Gemini (>15s).', { kind: 'network' })
    throw new TranslateError('Không kết nối được Gemini.', { kind: 'network' })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw parseGeminiError(res.status, body)
  }

  const data = await res.json()
  const cand = data?.candidates?.[0]
  if (cand && cand.finishReason && cand.finishReason !== 'STOP' && !cand.content) {
    throw new TranslateError(`Gemini từ chối dịch (${cand.finishReason}).`, { kind: 'blocked' })
  }
  const out = cand?.content?.parts?.map((p) => p.text).join('') ?? ''
  if (!out.trim()) throw new TranslateError('Gemini không trả về bản dịch.', { kind: 'empty' })
  return out.trim()
}

// ---- Thử tất cả key Gemini, xoay vòng khi 429 ----
// Trả về { text } nếu thành công. Ném lỗi nếu mọi key đều 429 (kind:'quota')
// hoặc lỗi không-quota cuối cùng.
async function tryGemini(prompt, model) {
  const keys = getGeminiKeys()
  if (keys.length === 0) throw new TranslateError('Chưa có Gemini key.', { kind: 'auth' })

  let allQuota = true
  let lastErr = null
  for (const key of keys) {
    try {
      return await callGemini({ key, model, prompt })
    } catch (err) {
      lastErr = err
      if (err.kind === 'quota') continue          // key này hết → thử key kế
      if (err.kind === 'auth') continue            // key sai → thử key kế
      // lỗi tạm thời (server/network/blocked/empty) → không phải quota, dừng xoay
      allQuota = false
      throw err
    }
  }
  // hết key
  if (allQuota) {
    markGeminiExhausted() // mọi key đều 429 → đánh dấu Gemini kiệt cho hôm nay
    throw new TranslateError('Tất cả Gemini key đều hết hạn mức.', { kind: 'quota' })
  }
  throw lastErr
}

/**
 * @returns {Promise<{ text: string, provider: 'gemini'|'google'|'google-free' }>}
 */
export async function translate(text, { to }) {
  if (!text || !text.trim()) return { text: '', provider: 'gemini' }
  const { geminiModel } = getConfig()
  const prompt =
    `Translate the following text to ${langName(to)}. ` +
    `Output ONLY the translation, no explanations, no quotes.\n\n` + text

  const cloudAvailable = hasCloudTranslate()

  // Nếu Gemini chưa kiệt hôm nay → ưu tiên Gemini
  if (!geminiExhaustedToday()) {
    try {
      const out = await tryGemini(prompt, geminiModel)
      return { text: out, provider: 'gemini' }
    } catch (err) {
      // Chỉ rơi xuống Cloud khi Gemini hết quota; lỗi khác (auth/server/network) thì:
      //  - nếu có Cloud → vẫn thử Cloud (đảm bảo dịch được)
      //  - nếu không → ném lỗi Gemini
      if (!cloudAvailable) throw err
      // rơi xuống Cloud bên dưới
    }
  }

  // Tầng fallback 2: Google Cloud Translation (chỉ khi có key)
  if (cloudAvailable) {
    try {
      const out = await translateGoogle(text, { to })
      return { text: out, provider: 'google' }
    } catch (gErr) {
      // Cloud cũng lỗi → vẫn còn phao cứu sinh free bên dưới
    }
  }

  // Tầng fallback 3 (cuối cùng): Google Translate "free" — không cần key, luôn sẵn sàng.
  // Đây là phao cứu sinh khi Gemini cạn quota và không có (hoặc lỗi) Cloud Translation key.
  try {
    const out = await translateGoogleFree(text, { to })
    return { text: out, provider: 'google-free' }
  } catch (fErr) {
    throw new TranslateError(
      `Gemini hết hạn mức và Google Translate (free) cũng lỗi: ${fErr.message}`,
      { kind: fErr.kind || 'unknown' }
    )
  }
}
