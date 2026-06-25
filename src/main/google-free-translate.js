// Fallback CUỐI CÙNG: Google Translate "free" (endpoint không cần key).
// Dùng translate_a/single — chính endpoint mà trang translate.google.com gọi.
// Không cần API key, không cần billing → luôn sẵn sàng làm phao cứu sinh khi:
//   - Gemini đã kiệt quota, VÀ
//   - Người dùng chưa cấu hình Google Cloud Translation key.
//
// Lưu ý: đây là endpoint không chính thức, Google có thể rate-limit theo IP (429)
// hoặc đổi format bất cứ lúc nào. Vì vậy nó chỉ là phao cứu sinh, không phải provider chính.

const TIMEOUT_MS = 15000

// Map mã ngôn ngữ đích của app → mã Google Translate.
// App dùng: vi, en, ja, zh-CN, zh-TW, ko. Google free endpoint:
//   zh-CN, zh-TW giữ nguyên; còn lại trùng mã.
const TL_MAP = {
  vi: 'vi', en: 'en', ja: 'ja', ko: 'ko',
  'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW'
}
const toTl = (code) => TL_MAP[code] || code

export class GoogleFreeTranslateError extends Error {
  constructor(message, { kind } = {}) {
    super(message)
    this.name = 'GoogleFreeTranslateError'
    this.kind = kind // 'quota' | 'network' | 'empty' | 'unknown'
  }
}

export async function translateGoogleFree(text, { to }) {
  if (!text || !text.trim()) return ''

  // sl=auto: để Google tự detect ngôn ngữ nguồn (giống google-translate.js).
  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'auto',
    tl: toTl(to),
    dt: 't',
    q: text
  })
  const url = `https://translate.googleapis.com/translate_a/single?${params.toString()}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal
    })
  } catch (e) {
    if (e.name === 'AbortError') throw new GoogleFreeTranslateError('Hết thời gian chờ Google Translate (free)', { kind: 'network' })
    throw new GoogleFreeTranslateError('Không kết nối được Google Translate (free)', { kind: 'network' })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    if (res.status === 429) {
      throw new GoogleFreeTranslateError('Google Translate (free) bị giới hạn theo IP (429).', { kind: 'quota' })
    }
    const body = await res.text().catch(() => '')
    throw new GoogleFreeTranslateError(`Google Translate (free) lỗi ${res.status}: ${body.slice(0, 200)}`, { kind: 'unknown' })
  }

  let data
  try {
    data = await res.json()
  } catch {
    throw new GoogleFreeTranslateError('Google Translate (free) trả về dữ liệu không đọc được.', { kind: 'unknown' })
  }

  // Định dạng: [ [ [ "câu dịch", "câu gốc", ... ], [ ... ] ], ... ]
  // Ghép các đoạn dịch (phần tử [0] của từng segment) lại với nhau.
  const segments = Array.isArray(data?.[0]) ? data[0] : []
  const out = segments.map((seg) => (Array.isArray(seg) ? seg[0] : '') || '').join('')
  if (!out.trim()) throw new GoogleFreeTranslateError('Google Translate (free) không trả về bản dịch.', { kind: 'empty' })
  return out.trim()
}
