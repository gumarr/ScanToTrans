import { app } from 'electron'
import { join } from 'path'
import { createWorker } from 'tesseract.js'

// OCR provider: chỉ Tesseract.js. Người dùng BẮT BUỘC chọn ngôn ngữ — không auto-detect, không multi-lang.
// Worker được "warm" và tái sử dụng giữa các lần để tránh cold start (~2-3s).

const langDataPath = () => join(app.getPath('userData'), 'tessdata')

let worker = null
let loadedLang = null

async function ensureWorker(lang) {
  if (worker && loadedLang === lang) return worker

  // Đổi ngôn ngữ → tạo lại worker để chỉ nạp đúng 1 ngôn ngữ (nhanh + chính xác nhất).
  if (worker) {
    await worker.terminate()
    worker = null
    loadedLang = null
  }

  worker = await createWorker(lang, 1, {
    // cache traineddata vào userData để không tải lại mỗi lần
    cachePath: langDataPath()
  })
  loadedLang = lang
  return worker
}

// Ngôn ngữ CJK không dùng dấu cách giữa từ → khi nối dòng KHÔNG chèn space.
const CJK_LANGS = new Set(['jpn', 'chi_sim', 'chi_tra', 'kor'])

// Tesseract ngắt dòng theo layout vật lý của ảnh, nên một câu bị wrap thành nhiều dòng.
// Hàm này nối các dòng thuộc cùng một câu/đoạn, nhưng GIỮ ngắt đoạn thật (dòng trống)
// và ngắt dòng có chủ đích (sau dấu kết câu, hoặc dòng bắt đầu bằng gạch đầu dòng).
function normalizeOcrText(raw, lang) {
  if (!raw) return ''
  const isCjk = CJK_LANGS.has(lang)
  const joiner = isCjk ? '' : ' '

  // Chuẩn hóa xuống dòng + bỏ khoảng trắng thừa cuối mỗi dòng
  const lines = raw.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim())

  const out = []
  let buf = ''

  const endsSentence = (s) => /[.!?:;…。！？：；]$/.test(s)
  const looksLikeListItem = (s) => /^([-*•·●○]|\d+[.)]|[a-z][.)])\s/i.test(s)

  const flush = () => { if (buf) { out.push(buf); buf = '' } }

  for (const line of lines) {
    if (line === '') {        // dòng trống = ngắt đoạn thật
      flush()
      out.push('')            // giữ một dòng trống làm ranh giới đoạn
      continue
    }
    if (!buf) { buf = line; continue }

    // Bắt đầu khối mới nếu: câu trước đã kết thúc, hoặc dòng này là mục danh sách
    if (endsSentence(buf) || looksLikeListItem(line)) {
      flush()
      buf = line
    } else {
      // nối tiếp cùng câu: bỏ gạch nối cuối dòng (word-break) nếu có
      if (/[A-Za-zÀ-ỹ]-$/.test(buf)) buf = buf.slice(0, -1) + line
      else buf += joiner + line
    }
  }
  flush()

  // gộp nhiều dòng trống liên tiếp thành tối đa một ranh giới đoạn
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * @param {Buffer|string} image  buffer PNG hoặc data URL
 * @param {string} lang  mã ngôn ngữ Tesseract (eng, vie, jpn, chi_sim, ...)
 */
export async function recognize(image, lang) {
  if (!lang) throw new Error('Phải chọn ngôn ngữ nguồn trước khi OCR')
  const w = await ensureWorker(lang)
  const { data } = await w.recognize(image)
  const text = normalizeOcrText(data.text || '', lang)
  return { text, confidence: data.confidence }
}

export { normalizeOcrText }

export async function disposeOcr() {
  if (worker) {
    await worker.terminate()
    worker = null
    loadedLang = null
  }
}
