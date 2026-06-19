const sel = document.getElementById('sel')
let startX = 0, startY = 0, dragging = false

function rect(x1, y1, x2, y2) {
  return {
    x: Math.min(x1, x2), y: Math.min(y1, y2),
    w: Math.abs(x2 - x1), h: Math.abs(y2 - y1)
  }
}

window.addEventListener('mousedown', (e) => {
  dragging = true
  startX = e.clientX; startY = e.clientY
  sel.style.display = 'block'
  Object.assign(sel.style, { left: startX + 'px', top: startY + 'px', width: '0px', height: '0px' })
})

window.addEventListener('mousemove', (e) => {
  if (!dragging) return
  const r = rect(startX, startY, e.clientX, e.clientY)
  Object.assign(sel.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' })
})

window.addEventListener('mouseup', async (e) => {
  if (!dragging) return
  dragging = false
  const r = rect(startX, startY, e.clientX, e.clientY)
  sel.style.display = 'none'
  if (r.w < 5 || r.h < 5) { window.api.cancelCapture(); return }
  await window.api.captureRegion(r)
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.cancelCapture()
})
