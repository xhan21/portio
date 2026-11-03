const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('passwordCandidates', Object.freeze({
  onShow: callback => ipcRenderer.on('duo:password-candidates', (_event, value) => callback(value)),
  onHighlight: callback => ipcRenderer.on('duo:password-highlight', (_event, value) => callback(value)),
  choose: (serial, index) => ipcRenderer.send('duo:password-choice', { serial, index })
}));
