const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('duo', Object.freeze({
  act: (action, value) => ipcRenderer.invoke('duo:action', action, value),
  onState: callback => ipcRenderer.on('duo:state', (_event, state) => callback(state)),
  onFocusAddress: callback => ipcRenderer.on('duo:focus-address', () => callback()),
  onAddressChosen: callback => ipcRenderer.on('duo:address-chosen', (_event, url) => callback(url))
}));
