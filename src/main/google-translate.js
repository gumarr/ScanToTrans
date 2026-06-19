import { getCloudTranslateKey } from './config.js'

// Fallback provider: Google Cloud Translation API v2 (chính thức).
// Free tier 500k ký tự/tháng. Người dùng tự nhập key (bật billing trên Google Cloud).
// Để Google tự detect ngôn ngữ nguồn (không truyền `source`) — vì source của app là mã
// Tesseract (eng/vie/jpn...) khác với mã ISO của Cloud Translate.

const TIMEOUT_MS = 15000

export class GoogleTranslateError extends Error {
  constructor(message, { kind } = {}) {
    super(message)
    this.name = 'GoogleTranslateError'
    this.kind = kind // 'auth' | 'quota' | 'network' | 'unknown'
  }
}

export function hasCloudTranslate() {
  return !!getCloudTranslateKey()
}

export async function translateGoogle(text, { to }) {
  const key = getCloudTranslateKey()
  if (!key) throw new GoogleTranslateError('Chưa có Cloud Translation key', { kind: 'auth' })
  if (!text || !text.trim()) return ''

  const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, target: to, format: 'text' }),
      signal: controller.signal
    })
  } catch (e) {
    if (e.name === 'AbortError') throw new GoogleTranslateError('Hết thời gian chờ Google Translate', { kind: 'network' })
    throw new GoogleTranslateError('Không kết nối được Google Translate', { kind: 'network' })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 403 || res.status === 400) {
      // 403 có thể là key sai / chưa bật API / hết quota tháng
      if (/quota|rateLimit|userRateLimitExceeded|dailyLimitExceeded/i.test(body)) {
        throw new GoogleTranslateError('Cloud Translation đã hết hạn mức tháng (500k ký tự).', { kind: 'quota' })
      }
      throw new GoogleTranslateError('Cloud Translation key không hợp lệ hoặc chưa bật API.', { kind: 'auth' })
    }
    throw new GoogleTranslateError(`Google Translate lỗi ${res.status}: ${body.slice(0, 200)}`, { kind: 'unknown' })
  }

  const data = await res.json()
  const out = data?.data?.translations?.[0]?.translatedText ?? ''
  return out.trim()
}
