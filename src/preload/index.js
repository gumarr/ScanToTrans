import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // overlay
  captureRegion: (region) => ipcRenderer.invoke('capture:region', region),
  cancelCapture: () => ipcRenderer.invoke('capture:cancel'),

  // tooltip
  onTooltipUpdate: (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on('tooltip:update', handler)
    return () => ipcRenderer.removeListener('tooltip:update', handler)
  },
  closeTooltip: () => ipcRenderer.invoke('tooltip:close'),

  // config / settings
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  addGeminiKeys: (keys) => ipcRenderer.invoke('config:addGeminiKeys', keys),
  removeGeminiKey: (index) => ipcRenderer.invoke('config:removeGeminiKey', index),
  setCloudTranslateKey: (key) => ipcRenderer.invoke('config:setCloudTranslateKey', key),
  setCaptureHotkey: (accelerator) => ipcRenderer.invoke('config:setCaptureHotkey', accelerator),
  openSettings: () => ipcRenderer.invoke('settings:open')
})
