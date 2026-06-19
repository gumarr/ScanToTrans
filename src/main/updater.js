// Auto-updater sử dụng electron-updater (GitHub Releases).
// Chỉ chạy trong bản đóng gói (packaged), bỏ qua khi dev.
// Khi có phiên bản mới: tải nền → thông báo → restart.

import { autoUpdater } from 'electron-updater'
import { app, dialog, BrowserWindow } from 'electron'

// Tắt auto-download — ta muốn hỏi người dùng trước khi cài
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

// Logger đơn giản ra console (có thể thay bằng electron-log sau)
autoUpdater.logger = {
  info: (...args) => console.log('[updater]', ...args),
  warn: (...args) => console.warn('[updater]', ...args),
  error: (...args) => console.error('[updater]', ...args),
  debug: (...args) => console.log('[updater:debug]', ...args)
}

export function initAutoUpdater() {
  // Không chạy updater khi dev — app.isPackaged = false trong dev mode
  if (!app.isPackaged) {
    console.log('[updater] Bỏ qua — đang chạy dev mode')
    return
  }

  // Kiểm tra cập nhật sau khi app sẵn sàng (đợi 5s để UI load xong)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] Lỗi kiểm tra cập nhật:', err.message)
    })
  }, 5000)

  // Kiểm tra định kỳ mỗi 4 giờ
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 4 * 60 * 60 * 1000)
}

// ---------- Sự kiện ----------

autoUpdater.on('update-available', async (info) => {
  console.log('[updater] Có phiên bản mới:', info.version)

  const focusedWin = BrowserWindow.getFocusedWindow()
  const result = await dialog.showMessageBox(focusedWin || null, {
    type: 'info',
    title: 'Có bản cập nhật mới',
    message: `ScanToTrans v${info.version} đã sẵn sàng.`,
    detail: `Phiên bản hiện tại: v${app.getVersion()}\nPhiên bản mới: v${info.version}\n\nBạn có muốn tải và cài đặt ngay?`,
    buttons: ['Cập nhật ngay', 'Để sau'],
    defaultId: 0,
    cancelId: 1
  })

  if (result.response === 0) {
    autoUpdater.downloadUpdate().catch((err) => {
      console.error('[updater] Lỗi tải cập nhật:', err.message)
      dialog.showErrorBox('Lỗi cập nhật', `Không thể tải bản cập nhật:\n${err.message}`)
    })
  }
})

autoUpdater.on('update-not-available', () => {
  console.log('[updater] Đang dùng phiên bản mới nhất')
})

autoUpdater.on('download-progress', (progress) => {
  console.log(`[updater] Đang tải: ${Math.round(progress.percent)}%`)
})

autoUpdater.on('update-downloaded', async (info) => {
  console.log('[updater] Đã tải xong bản cập nhật:', info.version)

  const focusedWin = BrowserWindow.getFocusedWindow()
  const result = await dialog.showMessageBox(focusedWin || null, {
    type: 'info',
    title: 'Cập nhật đã sẵn sàng',
    message: `ScanToTrans v${info.version} đã tải xong.`,
    detail: 'Khởi động lại để hoàn tất cập nhật?',
    buttons: ['Khởi động lại', 'Để sau (cài khi thoát)'],
    defaultId: 0,
    cancelId: 1
  })

  if (result.response === 0) {
    autoUpdater.quitAndInstall(false, true)
  }
  // Nếu chọn "Để sau", autoInstallOnAppQuit = true sẽ tự cài khi thoát app
})

autoUpdater.on('error', (err) => {
  console.error('[updater] Lỗi:', err.message)
})
