const body = document.getElementById('body')
document.getElementById('close').addEventListener('click', () => window.api.closeTooltip())
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.api.closeTooltip() })

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
}

function meta(t, provider) {
  const parts = []
  if (provider === 'google') parts.push('Google Translate')
  else if (provider === 'google-free') parts.push('Google Translate (free)')
  else if (provider === 'gemini') parts.push('Gemini')
  if (t?.ocr != null) parts.push(`OCR ${t.ocr}ms`)
  if (t?.translate != null) parts.push(`Dịch ${t.translate}ms`)
  return parts.length ? `<div class="meta">${parts.join(' · ')}</div>` : ''
}

window.api.onTooltipUpdate((p) => {
  if (p.status === 'loading') {
    body.innerHTML = '<span class="spin">Đang xử lý…</span>'
  } else if (p.status === 'done') {
    body.innerHTML =
      `<div class="src">${esc(p.source)}</div>` +
      `<div class="trans">${esc(p.translation)}</div>` +
      meta(p.timing, p.provider)
  } else if (p.status === 'partial') {
    body.innerHTML =
      `<div class="src">${esc(p.source)}</div>` +
      `<div class="err">Lỗi dịch: ${esc(p.message)}</div>` +
      settingsBtn(p.kind) + meta(p.timing)
    wireSettings()
  } else if (p.status === 'error') {
    body.innerHTML = `<div class="err">${esc(p.message)}</div>` + settingsBtn(p.kind)
    wireSettings()
  }
})

// Với lỗi key/quota, cho người dùng mở Settings ngay để đổi key
function settingsBtn(kind) {
  if (kind === 'auth' || kind === 'quota') {
    return `<button id="openSettings" class="btn">Mở Settings</button>`
  }
  return ''
}

function wireSettings() {
  const b = document.getElementById('openSettings')
  if (b) b.addEventListener('click', () => window.api.openSettings())
}
