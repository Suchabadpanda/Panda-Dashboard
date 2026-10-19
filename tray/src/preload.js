'use strict';
// The only bridge between the pages and the main process: named calls, no Node access.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('panda', {
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
  shortcut: (i) => ipcRenderer.invoke('panel:shortcut', i),
  toggleLight: (id) => ipcRenderer.invoke('panel:toggleLight', id),
  openDashboard: () => ipcRenderer.invoke('panel:openDashboard'),
  openSettings: () => ipcRenderer.invoke('panel:openSettings'),
  hide: () => ipcRenderer.invoke('panel:hide'),
  resize: (h) => ipcRenderer.invoke('panel:resize', h),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  status: () => ipcRenderer.invoke('settings:status'),
  openTokenPage: () => ipcRenderer.invoke('settings:openTokenPage'),
});
