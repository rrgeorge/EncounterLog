const { ipcRenderer, contextBridge } = require('electron');

console.log("Preloading...");

contextBridge.exposeInMainWorld('EncounterLog', {
    Filter: (filter) => ipcRenderer.send("changefilter",filter),
    Refresh: () => ipcRenderer.send('refreshCharacterStatus')
})
