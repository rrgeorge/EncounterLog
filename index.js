const {app, session, BrowserWindow, ipcMain, net, Menu, MenuItem, dialog, shell, globalShortcut} = require('electron')
const ElectronPreferences = require('electron-preferences')
const WebSocket = require('ws')
const path = require('path')
const { electron } = require('process')
const { remote } = require('electron/renderer')
const {download} = require("electron-dl")
const ProgressBar = require("electron-progressbar")
const AdmZip = require('adm-zip')
const he = require('he')
const DDB = require('./ddb')
const fs = require('fs')
const { autoUpdater } = require('electron-updater')
const { convert } = require('html-to-text')

var _ws = null
var _win = null
var _dmScreen = null
var ddb

app.userAgentFallback = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:88.0) Gecko/20100101 Firefox/88.0'
var ignored = []
var campaignChars = []
var encounterhost = undefined

function readableFileSize(size) {
        var units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
        var i = 0;
        while(size >= 1024) {
                    size /= 1024;
                    ++i;
                }
        return size.toFixed(1) + ' ' + units[i];
}

const preferences = new ElectronPreferences({
	'dataStore': path.resolve(app.getPath('userData'), 'preferences.json'),
        'defaults': {
            'main': {
                'art': [ 'artwork', 'tokens' ],
                'maps': 'nomaps',
                'mapsloc': 'group',
                'remotemaps': [ ]
            }
        },
	'sections': [ {
		'id': "main",
		'label': "Settings",
		'icon': "settings-gear-63",
		'form': {
			'groups': [ {
				'fields': [
                                    {
					'heading': "Preferences",
					'key': 'prefs_message',
                                        'type': 'message',
					'content': '<p>If you would like to forward dice rolls to EncounterPlus from a Campaign\'s Game Log, enter the EncounterPlus Server URL below. Then load a campaign page, and EncounterLog will automatically connect the Game Log to EncounterPlus</p>',
				    },
                                    {
					'label': "EncounterPlus Server URL",
					'key': 'encounterhost',
					'type': 'text',
					'help': "Example: http://192.168.1.10:8080"
                                    },
                                    {
					'label': "Include compendium artwork",
					'key': 'art',
					'type': 'checkbox',
                                        'options': [
                                            { 'label': 'Artwork', 'value': 'artwork' },
                                            { 'label': 'Tokens', 'value': 'tokens' },
                                        ]
                                    },
                                    {
					'label': "Attempt to create maps",
					'key': 'maps',
					'type': 'radio',
                                        'options': [
                                            { 'label': 'Do not look for maps', 'value': 'nomaps' },
                                            { 'label': 'Look for maps', 'value': 'maps' },
                                            { 'label': 'Look for maps and search for markers with Google Vision', 'value': 'markers' },
                                        ],
                                        'help': 'EncounterLog will attempt to identify and align the grid in discovered maps. If you choose to search for markers, EncounterLog will upload the maps to Google Vision to try to find label text and match it to headers in the page.'
                                    },
                                    {
					'label': "Location for discovered maps",
					'key': 'mapsloc',
					'type': 'radio',
                                        'options': [
                                            { 'label': 'Under page parent', 'value': 'page' },
                                            { 'label': 'In "Maps" group', 'value': 'group' },
                                        ],
                                    },
                                    {
					'label': "Check to see if a higher resolution maps exist on the site. This can make the module significantly larger, take a lot longer to process, and may not work with every module.",
					'key': 'remotemaps',
					'type': 'checkbox',
                                        'options': [
                                            { 'label': 'Check for higher resolution maps', 'value': 'remote' }
                                        ]
                                    },
                                    {
					'heading': "",
					'key': 'prefs_okay',
                                        'type': 'message',
					'content': '<div align="right"><input type="submit" class="bt" onclick="window.close()" value="Okay"></div>',
				    },
                                ]
			} ]
		}
	} ],
        'browserWindowOverrides': {
            title: 'Preferences',
            width: 800,
            height: 400,
            }
})
encounterhost = preferences.value('main.encounterhost');
app.on('ready', () => {
        autoUpdater.autoDownload = false
        autoUpdater.on('update-available',update=>
            dialog.showMessageBox(_win,{
                title: "Update Available",
                message: update.releaseName,
                detail: convert(update.releaseNotes,{wordwrap: 0}),
                defaultId: 0,
                cancelId: 1,
                buttons: ["Install Now","Remind me Later"]
            }).then(msg=>{
                if (msg.response === 0) {
                    let progress = new ProgressBar({title: "Downloading Update", text: `Downloading ${update.releaseName}`, detail: "",indeterminate:false,maxValue: 100})
                    autoUpdater.on('download-progress',dl=>{
                        if (!progress.isCompleted()) {
                            progress.value = dl.percent
                            progress.detail = `${readableFileSize(dl.transferred)}/${readableFileSize(dl.total)} ${readableFileSize(dl.bytesPerSecond)}/s`
                        }
                    })
                    autoUpdater.on('update-downloaded',()=>{
                        if (!progress?.isCompleted()) progress.setCompleted()
                    })
                    setImmediate(()=>autoUpdater.quitAndInstall(false,true))
                    autoUpdater.downloadUpdate()
                }
            })
        )
        autoUpdater.checkForUpdates()
	const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: {nodeIntegration: true, contextIsolation: false,nativeWindowOpen: true} })
	_win = win
        ddb = new DDB()
        ddb.art = preferences.value('main.art');
        ddb.maps = preferences.value('main.maps') ?? "nomaps";
        ddb.mapsloc = preferences.value('main.mapsloc') ?? "group";
        ddb.remotemaps = preferences.value('main.remotemaps');

        console.log(ddb.art,ddb.maps)
        preferences.on('save', (preferences) => {
                encounterhost = preferences.main.encounterhost
                ddb.art = preferences.main.art
                ddb.maps = preferences.main.maps
                ddb.mapsloc = preferences.main.mapsloc
                ddb.remotemaps = preferences.main.remotemaps
        })
	var menu = Menu.buildFromTemplate([
	      {
		  label: 'File',
		  submenu: [
			{
                            'click': function() { preferences.show() },
                            'label': "Preferences",
                            accelerator: "CommandOrControl+,",
                        },
		      	{role:'quit'}
		  ]
	      },
              {label: "Campaigns", id: 'campaignMenu', submenu: [ { label: "Loading...", enabled: false } ] },
              {label: "Compendium", id: 'compendium', submenu: [ {label: "Loading...", enabled: false } ] },
              {role: 'help', submenu: [
                  { label: `${app.getName()} v${app.getVersion()}`, enabled: false }, 
                  { label: "About", click: () => shell.openExternal("https://github.com/rrgeorge/EncounterLog") },
                  { label: "Support this project", click: () => shell.openExternal("https://github.com/sponsors/rrgeorge") }
              ] },
	  ])
	Menu.setApplicationMenu(menu);
        session.defaultSession.webRequest.onCompleted(
            {urls: [
                'https://*.dndbeyond.com/*css',
                'https://fonts.googleapis.com/css*']
            },(d)=>{
                if (ddb.css.indexOf(d.url)<0)ddb.css.push(d.url)
            }
        )
        win.loadURL('https://www.dndbeyond.com/my-campaigns')
        win.once('ready-to-show', () => {
            win.show()
        })
        globalShortcut.register('CommandOrControl+R', () => win.reload())
        win.webContents.on('did-navigate',(e,u,r,m) => {
            if (r==200) {
            win.webContents.once('did-finish-load',()=> {
                    if (win.webContents.getURL().match(/dndbeyond.com\/campaigns\/[0-9]+/)) {
                            win.webContents.executeJavaScript(`
                                    const {ipcRenderer} = require('electron')
                                    let characters = document.getElementsByClassName('ddb-campaigns-character-card')
                                    for (let character of characters) {
                                            let cHeader = character.getElementsByClassName('ddb-campaigns-character-card-header')[0]
                                            let cFooter = character.getElementsByClassName('ddb-campaigns-character-card-footer')[0]
                                            let cN = cHeader.getElementsByClassName('ddb-campaigns-character-card-header-upper-character-info-primary')[0].textContent.trim()
                                            let cBox = document.createElement("INPUT")
                                            cBox.setAttribute("type","checkbox")
                                            cBox.setAttribute("id","logfilter-"+cN)
                                            cBox.setAttribute("value",cN)
                                            cBox.setAttribute("checked",true)
                                            cBox.style.padding = "3px 3px"
                                            let cLabel = document.createElement("LABEL")
                                            cLabel.setAttribute("for","logfilter-"+cN)
                                            cLabel.innerText = "Send Log Entries to Encounter Plus"
                                            cLabel.style.display = "inline"
                                            let cDiv = document.createElement("DIV")
                                            cDiv.appendChild(cBox)
                                            cDiv.appendChild(cLabel)
                                            cFooter.insertBefore(cDiv,cFooter.firstChild)
                                            cBox.addEventListener('change',e => ipcRenderer.send("changefilter",[e.target.value,e.target.checked]))
                                    }
                                    [
                                    document.getElementById('message-broker-client').dataset.gameid,
                                    document.getElementById('message-broker-client').dataset.userid,
                                    document.getElementsByClassName('page-title')[0].textContent.trim()
                                    ];`)
                            .then(result => connectGameLog(result[0],result[1],result[2]))
                            .catch(err => console.log(err))
                    } else if (_ws !== null) {
                            _ws.isDisconnecting = true
                            _ws.close(1001,"Going away")
                    }
                    if (win.webContents.getURL().match(/dndbeyond.com\/my-campaigns/)) {
                        let manifestVersion = 0
                        if (fs.existsSync(path.join(app.getPath("userData"),"manifest.zip"))) {
                            let manifest = new AdmZip(path.join(app.getPath("userData"),"manifest.zip"))
                            manifestVersion = parseInt(manifest.readAsText("version.txt").trim())
                            if (fs.existsSync(path.join(app.getPath("userData"),"skeleton.db3"))) {
                                const stat = fs.statSync(path.join(app.getPath("userData"),"skeleton.db3"))
                                const mstat = fs.statSync(path.join(app.getPath("userData"),"manifest.zip"))
                                if (mstat.mtime > stat.mtime) 
                                    manifest.extractEntryTo("skeleton.db3",app.getPath("userData"),false,true)
                            }
                        }
                        ddb.checkManifestVersion(manifestVersion).then(res=>{
                            if (res?.data?.manifestUpdateAvailable) {
                                let prog
                                download(_win,"https://www.dndbeyond.com/mobile/api/v6/download-manifest",{
                                    filename: "manifest.zip",
                                    directory: app.getPath("userData"),
                                    onStarted: (d) => {
                                        prog = new ProgressBar({title: "Retrieving Manifest...", text: "Downloading latest manifest...", detail: "Retrieving manifest from D&D Beyond...",indeterminate: (d.getTotalBytes())?false:true,maxValue: 100})
                                    },
                                    onProgress: (p) => {if(!prog.isCompleted())prog.value=p.percent*100},
                                    onCompleted: () => {
                                        let manifest = new AdmZip(path.join(app.getPath("userData"),"manifest.zip"))
                                        manifest.extractEntryTo("skeleton.db3",app.getPath("userData"),false,true)
                                    }
                                }).catch(e=>console.log(e))
                            } else { console.log(res) }
                        })
                        const menu = Menu.getApplicationMenu()
                        ddb.populateCampaigns().then(() => {
                            const campaignMenu = menu.getMenuItemById('campaignMenu')
                            campaignMenu.submenu.clear()
                            campaignMenu.submenu.append( new MenuItem({
                                label: "Campaign List",
                                toolTip: "Jump to campaign list",
                                accelerator: "CommandOrControl+Shift+C",
                                click: (m) => _win?.loadURL(`https://www.dndbeyond.com/my-campaigns`)
                            }))
                            campaignMenu.submenu.append(new MenuItem({type: 'separator'}))
                            for (const campaign of ddb.campaigns) {
                                campaignMenu.submenu.append( new MenuItem({
                                    label: he.decode(campaign.name).replaceAll("&","&&"),
                                    id: campaign.id,
                                    toolTip: "Jump to campaign",
                                    click: (m) => _win?.loadURL(`https://www.dndbeyond.com/campaigns/${m.id}`),
                                }))
                            }
                            campaignMenu.submenu.append(new MenuItem({type: 'separator'}))
                            campaignMenu.submenu.append( new MenuItem({
                                label: "Export All Encounters",
                                toolTip: "Export all Encounters from the Encounter Builder",
                                click: () => {
                                    dialog.showSaveDialog(win,{
                                        title: "Save Encounters",
                                        filters: [ { name: "EncounterPlus Campaign", extensions: ["campaign"]} ],
                                        defaultPath: `encounters.campaign`,
                                    }).then((save) => {
                                        if (save.filePath)
                                            ddb.getEncounters(null,save.filePath).catch(e=>displayError(e))
                                        }
                                    )
                                }
                            }))
                            Menu.setApplicationMenu(menu)
                        }).then(
                            ddb.getSources().then(() => {
                                const compendiumMenu = menu.getMenuItemById('compendium')
                                while (compendiumMenu.submenu.items.length > 0) {
                                    compendiumMenu.submenu.items.pop()
                                }
                                compendiumMenu.submenu.clear()
                                for (const book of ddb.books.sort((a, b) => a.id-b.id)) {
                                  let categoryMenu = menu.getMenuItemById(`category-${book.category}`)
                                  if (!categoryMenu) {
                                      categoryMenu = new MenuItem({
                                          id: `category-${book.category}`,
                                          label: he.decode(ddb.ruledata.sourceCategories.find(s=>book.category===s.id)?.name||"Unknown Category").replaceAll("&","&&"),
                                          submenu: []
                                      })
                                      compendiumMenu.submenu.append(categoryMenu)
                                  }
                                  if (book.bookCode.toLowerCase() == 'tftyp') {
                                      var tftypMenu = menu.getMenuItemById(`tftyp-menu`)
                                      if (!tftypMenu) {
                                          tftypMenu = new MenuItem({
                                              id: 'tftyp-menu',
                                              label: he.decode("Tales from the Yawning Portal").replaceAll("&","&&"),
                                              toolTip: he.decode("TftYP"),
                                              submenu: []
                                          })
                                          categoryMenu.submenu.append(tftypMenu)
                                      }
                                      continue
                                  } else if (book.url.startsWith('https://www.dndbeyond.com/sources/tftyp/')) {
                                      var tftypMenu = menu.getMenuItemById(`tftyp-menu`)
                                      if (!tftypMenu) {
                                          tftypMenu = new MenuItem({
                                              id: 'tftyp-menu',
                                              label: he.decode("Tales from the Yawning Portal").replaceAll("&","&&"),
                                              toolTip: he.decode("TftYP"),
                                              submenu: []
                                          })
                                          categoryMenu.submenu.append(tftypMenu)
                                      }
                                      categoryMenu = tftypMenu
                                  }
                                  categoryMenu.submenu.append( new MenuItem({
                                      label: he.decode(book.book).replaceAll("&","&&"),
                                      toolTip: he.decode(book.bookCode),
                                      submenu: [
                                          new MenuItem({
                                              label: "Open",
                                              click: () => win.loadURL(book.url),
                                          }),
                                          new MenuItem({ type: 'separator' }),
                                          new MenuItem({
                                              label: "Download Module",
                                              click: () => {
                                                dialog.showSaveDialog(win,{
                                                    title: "Save Book",
                                                    filters: [ { name: "EncounterPlus Module", extensions: ["module"]} ],
                                                    defaultPath: `${book.bookCode.toLowerCase()}.module`,
                                                }).then((save) => {
                                                    if (save.filePath)
                                                        ddb.getModule(book.id,save.filePath,win).catch(e=>displayError(e))
                                                    }
                                                )
                                              }
                                          }),
                                          new MenuItem({
                                              label: "Download Only Monsters",
                                              click: () => {
                                                dialog.showSaveDialog(win,{
                                                    title: "Save monsters compendium",
                                                    filters: [ { name: "EncounterPlus Compendium", extensions: ["compendium"]} ],
                                                    defaultPath: `${book.bookCode.toLowerCase()}-monsters.compendium`,
                                                }).then((save) => {
                                                    if (save.filePath)
                                                        ddb.getMonsters(book.id,save.filePath)
                                                    }
                                                )
                                              }
                                          }),
                                          new MenuItem({
                                              label: "Download Only Items",
                                              click: () => {
                                                dialog.showSaveDialog(win,{
                                                    title: "Save items compendium",
                                                    filters: [ { name: "EncounterPlus Compendium", extensions: ["compendium"]} ],
                                                    defaultPath: `${book.bookCode.toLowerCase()}-items.compendium`,
                                                }).then((save) => {
                                                    if (save.filePath)
                                                        ddb.getItems(book.id,save.filePath)
                                                    }
                                                )
                                              }
                                          }),
                                          new MenuItem({
                                              label: "Download Only Spells",
                                              click: () => {
                                                dialog.showSaveDialog(win,{
                                                    title: "Save spells compendium",
                                                    filters: [ { name: "EncounterPlus Compendium", extensions: ["compendium"]} ],
                                                    defaultPath: `${book.bookCode.toLowerCase()}-spells.compendium`,
                                                }).then((save) => {
                                                    if (save.filePath)
                                                        ddb.getSpells(book.id,save.filePath)
                                                    }
                                                )
                                              }
                                          })
                                      ]
                                  }))
                                }
                                compendiumMenu.submenu.append( new MenuItem({ type: 'separator' }))
                                if (ddb.sharedBooks.length > 0) {
                                    compendiumMenu.submenu.append( new MenuItem({ type: 'separator' }))
                                    sharedSubmenu = new MenuItem({ label: "Shared Books", submenu: [] })
                                    compendiumMenu.submenu.append(sharedSubmenu)
                                    for (const book of ddb.sharedBooks.sort((a, b) => a.id-b.id)) {
                                      let categoryMenu = menu.getMenuItemById(`sharedCategory-${book.category}`)
                                      if (!categoryMenu) {
                                          categoryMenu = new MenuItem({
                                              id: `sharedCategory-${book.category}`,
                                              label: he.decode(ddb.ruledata.sourceCategories.find(s=>book.category===s.id)?.name||"Unknown Category").replaceAll("&","&&"),
                                              submenu: []
                                          })
                                          sharedSubmenu.submenu.append(categoryMenu)
                                      }
                                      if (book.bookCode.toLowerCase() == 'tftyp') {
                                          var tftypMenu = menu.getMenuItemById(`tftyp-menu`)
                                          if (!tftypMenu) {
                                              tftypMenu = new MenuItem({
                                                  id: 'tftyp-menu',
                                                  label: he.decode("Tales from the Yawning Portal").replaceAll("&","&&"),
                                                  toolTip: he.decode("TftYP"),
                                                  submenu: []
                                              })
                                              categoryMenu.submenu.append(tftypMenu)
                                          }
                                          continue
                                      } else if (book.url.startsWith('https://www.dndbeyond.com/sources/tftyp/')) {
                                          var tftypMenu = menu.getMenuItemById(`tftyp-menu`)
                                          if (!tftypMenu) {
                                              tftypMenu = new MenuItem({
                                                  id: 'tftyp-menu',
                                                  label: he.decode("Tales from the Yawning Portal").replaceAll("&","&&"),
                                                  toolTip: he.decode("TftYP"),
                                                  submenu: []
                                              })
                                              categoryMenu.submenu.append(tftypMenu)
                                          }
                                          categoryMenu = tftypMenu
                                      }
                                      categoryMenu.submenu.append( new MenuItem({
                                          label: book.book,
                                          toolTip: book.bookCode,
                                          submenu: [
                                              new MenuItem({
                                                  label: "Open",
                                                  click: () => win.loadURL(book.url),
                                              }),
                                              new MenuItem({
                                                  label: "Download Module",
                                                  click: () => {
                                                    dialog.showSaveDialog(win,{
                                                        title: "Save Book",
                                                        filters: [ { name: "EncounterPlus Module", extensions: ["module"]} ],
                                                        defaultPath: `${book.bookCode.toLowerCase()}.module`,
                                                    }).then((save) => {
                                                        if (save.filePath)
                                                            ddb.getModule(book.id,save.filePath,win).catch(e=>displayError(e))
                                                        }
                                                    )
                                                  }
                                              }),
                                          ]
                                      }))
                                    }
                                }
                                var homebrewSubMenu = []
                                homebrewSubMenu.push( new MenuItem({
                                    label: "Download Homebrew Monsters",
                                    click: () => {
                                        dialog.showSaveDialog(win,{
                                            title: "Save monsters compendium",
                                            filters: [ { name: "EncounterPlus Compendium", extensions: ["compendium"]} ],
                                            defaultPath: `homebrew_monsters.compendium`,
                                        }).then((save) => {
                                            if (save.filePath)
                                                ddb.getMonsters(null,save.filePath,null,null,null,true)
                                            }
                                        )
                                    }
                                    }))
                                homebrewSubMenu.push( new MenuItem({
                                    label: "Download Homebrew Items",
                                    click: () => {
                                        dialog.showSaveDialog(win,{
                                            title: "Save items compendium",
                                            filters: [ { name: "EncounterPlus Compendium", extensions: ["compendium"]} ],
                                            defaultPath: `homebrew_items.compendium`,
                                        }).then((save) => {
                                            if (save.filePath)
                                                ddb.getItems(null,save.filePath,null,null,null,true)
                                            }
                                        )
                                    }
                                    }))
                                homebrewSubMenu.push( new MenuItem({
                                    label: "Download Homebrew Spells",
                                    click: () => {
                                        dialog.showSaveDialog(win,{
                                            title: "Save spells compendium",
                                            filters: [ { name: "EncounterPlus Compendium", extensions: ["compendium"]} ],
                                            defaultPath: `homebrew_spells.compendium`,
                                        }).then((save) => {
                                            if (save.filePath)
                                                ddb.getSpells(null,save.filePath,null,null,true)
                                            }
                                        )
                                    }
                                    }))
                                compendiumMenu.submenu.append(
                                    new MenuItem({ label: "Homebrew Collection", submenu: homebrewSubMenu })
                                )
                                compendiumMenu.submenu.append( new MenuItem({ type: 'separator' }))
                                compendiumMenu.submenu.append( new MenuItem({
                                    label: "Download All Monsters",
                                    click: () => {
                                        dialog.showSaveDialog(win,{
                                            title: "Save monsters compendium",
                                            filters: [ { name: "EncounterPlus Compendium", extensions: ["compendium"]} ],
                                            defaultPath: `monsters.compendium`,
                                        }).then((save) => {
                                            if (save.filePath)
                                                ddb.getMonsters(null,save.filePath)
                                            }
                                        )
                                    }
                                    }))
                                compendiumMenu.submenu.append( new MenuItem({
                                    label: "Download All Items",
                                    click: () => {
                                        dialog.showSaveDialog(win,{
                                            title: "Save items compendium",
                                            filters: [ { name: "EncounterPlus Compendium", extensions: ["compendium"]} ],
                                            defaultPath: `items.compendium`,
                                        }).then((save) => {
                                            if (save.filePath)
                                                ddb.getItems(null,save.filePath)
                                            }
                                        )
                                    }
                                    }))
                                compendiumMenu.submenu.append( new MenuItem({
                                    label: "Download All Spells",
                                    click: () => {
                                        dialog.showSaveDialog(win,{
                                            title: "Save spells compendium",
                                            filters: [ { name: "EncounterPlus Compendium", extensions: ["compendium"]} ],
                                            defaultPath: `spells.compendium`,
                                        }).then((save) => {
                                            if (save.filePath)
                                                ddb.getSpells(null,save.filePath)
                                            }
                                        )
                                    }
                                    }))
                                compendiumMenu.enabled = true
                                Menu.setApplicationMenu(menu)
                            }).catch(e=>displayError(`Error populating sources: ${e}`))
                        ).catch(e=>displayError(`Error populating campaigns: ${e}`))
                    }
                })
            }
        })
        win.on('closed',()=>app.quit())
	ipcMain.on("changefilter", (event,data) => {
		let name = data[0];
		let filter = data[1];
		if (ignored.includes(name) && filter) {
			ignored = ignored.filter((v,i,a) => {return v != name})
		} else if (!filter && !ignored.includes(name)) {
			ignored.push(name)
		}
	})
	if (encounterhost !== undefined) {
	    console.log(`EncounterPlus URL: ${encounterhost}`)
	}
});
function displayError(e) {
    _win.loadURL("http://www.dndbeyond.com/my-campaigns")
    dialog.showErrorBox("Error",e)
}
app.on('will-quit', () => {
		if (_ws !== null) {
		    _ws.isDisconnecting = true
		    _ws.close(1001,"Going away")
		}
	})

function requestCampaignChars(gameId,cobalt) {
	return new Promise((resolve,reject) => {
		const url = `https://www.dndbeyond.com/api/campaign/stt/active-characters/${gameId}`
		const request = net.request({url: url})
		request.setHeader('Authorization',`Bearer ${cobalt}`)
		let body = ''
		request.on('response', (response) => {
		  if (response.statusCode != 200) {
			  reject(response.StatusCode)
		  }
		  response.on('data', (chunk) => {
		    body += chunk.toString()
		  })
		  response.on('end', () => {
			try {
                            campaignChars = JSON.parse(body).data
                            const menu = Menu.getApplicationMenu()
                            const campaignMenu = menu.getMenuItemById('campaignMenu')
                            const thisCampaign = campaignMenu.submenu.getMenuItemById(parseInt(gameId))
                            campaignMenu.submenu.clear()
                            campaignMenu.submenu.append( new MenuItem({
                                label: "Campaign List",
                                toolTip: "Jump to campaign list",
                                accelerator: "CommandOrControl+Shift+C",
                                click: (m) => _win?.loadURL(`https://www.dndbeyond.com/my-campaigns`)
                            }))
                            campaignMenu.submenu.append(new MenuItem({type: 'separator'}))
                            for (const campaign of ddb.campaigns) {
                                campaignMenu.submenu.append( new MenuItem({
                                    label: he.decode(campaign.name).replaceAll("&","&&"),
                                    id: campaign.id,
                                    toolTip: "Jump to campaign",
                                    click: (m) => _win?.loadURL(`https://www.dndbeyond.com/campaigns/${m.id}`)
                                }))
                            }
                            campaignMenu.submenu.append(new MenuItem({type: 'separator'}))
                            campaignMenu.submenu.append( new MenuItem({
                                label: "Export All Encounters",
                                toolTip: "Export all Encounters from the Encounter Builder",
                                click: () => {
                                    dialog.showSaveDialog(win,{
                                        title: "Save Encounters",
                                        filters: [ { name: "EncounterPlus Campaign", extensions: ["campaign"]} ],
                                        defaultPath: `encounters.campaign`,
                                    }).then((save) => {
                                        if (save.filePath)
                                            ddb.getEncounters(null,save.filePath).catch(e=>displayError(e))
                                        }
                                    )
                                }
                            }))
                            campaignMenu.submenu.append(new MenuItem({type: 'separator'}))
                            campaignMenu.submenu.append(new MenuItem({
                                label: "Export this Campaign's Encounters",
                                click: () => {
                                    dialog.showSaveDialog(_win,{
                                        title: "Save exported encounters",
                                        filters: [ { name: "EncounterPlus Campaign", extensions: ["campaign"]} ],
                                        defaultPath: `${thisCampaign.label.replaceAll("&&","&")}-encounters.campaign`,
                                    }).then((save) => {
                                        if (save.filePath) {
                                            ddb.getEncounters(thisCampaign.id,save.filePath).catch(e=>displayError(e))
                                        }
                                    })
                                }
                            }))
                            campaignMenu.submenu.append(new MenuItem({
                                label: "Export this Campaign's Characters",
                                click: () => {
                                    dialog.showSaveDialog(_win,{
                                        title: "Save exported characters",
                                        filters: [ { name: "EncounterPlus Compendium", extensions: ["compendium"]} ],
                                        defaultPath: `${thisCampaign.label.replaceAll("&&","&")}.compendium`,
                                    }).then((save) => {
                                        if (save.filePath) {
                                            let prog = new ProgressBar({title: "Converting campaign characters...", text: "Converting campaign characters...", detail: "Please wait..."})
                                            let dlProg
                                            download(_win,`https://play5e.online/?api=true&tokenmap=true&circles=true&campaign=https://ddb.ac/characters/${campaignChars[0].id}`,{
                                                filename: path.basename(save.filePath),
                                                directory: path.dirname(save.filePath),
                                                onCompleted: (f) => {
                                                    try {
                                                        prog.setCompleted()
                                                        new AdmZip(save.filePath)
                                                    } catch (e) {
                                                        prog.text = "Error"
                                                        const err = fs.readFileSync(save.filePath).toString()
                                                        prog.detail = err
                                                        fs.rm(save.filePath,()=>{})
                                                        dialog.showErrorBox("Error",`Could not convert characters:\n${err}`)
                                                    }
                                                }
                                            }).catch(e=>console.log(e))
                                        }
                                    })
                                }
                            }))
                            Menu.setApplicationMenu(menu)
			} catch (e) {
			  console.log(e.message)
			  console.log(body)
			}
		    	resolve(campaignChars)
		  })
		})
		request.end()
	})
}
async function connectGameLog(gameId,userId,campaignName) {
	const cobalt = await ddb.getCobaltAuth()
	requestCampaignChars(gameId,cobalt).then(chars=>{
            const charIds = chars.map(c=>c.id)
            const updateChars = ()=>{
                if (_dmScreen) clearTimeout(_dmScreen)
                const screenTimeout = Math.floor(Math.random() * (70 - 50 + 1) + 50)
                ddb.getCampaignCharacterStatus(charIds).then(found=>{
                    _win.webContents.executeJavaScript(`(()=>{
                        const {ipcRenderer} = require('electron')
                        document.getElementById("campaign-status-timer")?.remove()
                        let header = document.querySelector('.ddb-campaigns-detail-body-listing-header-secondary')
                        let timer = document.createElement('div')
                        let countdown = ${screenTimeout}
                        timer.textContent = \`Refreshing...\`
                        timer.id = "campaign-status-timer"
                        timer.style.height = "25px"
                        header.appendChild(timer)
                        let interval = setInterval(()=>{
                            countdown -= 1
                            timer.innerHTML = \`Will refresh in \${countdown}s <button onclick="ipcRenderer.send('refreshCharacterStatus')">Refresh Now</button>\`
                            if (countdown <= 0) {
                                clearInterval(interval)
                            }
                        },1000)
                        })()`).catch(e=>console.log(`Could not set timer: ${e}`))
                    for(let f of found) {
                        let conditions = f.conditions.map(c=>`i-condition-white-${c.name.toLowerCase()}`)
                        let senses = f.senses.map(s=>`${s.name} ${s.distance}`)
                        let exhaustion = f.conditions.find(c=>c.name.toLowerCase()=="exhaustion")?.level||0
                        _win.webContents.executeJavaScript(`(()=>{
                            let characters = document.querySelectorAll('.ddb-campaigns-character-card')
                            for (let character of characters) {
                                    let cHeader = character.querySelector('.ddb-campaigns-character-card-header')
                                    let cDetail = cHeader.querySelector('.ddb-campaigns-character-card-header-upper')
                                    let cInfo = cHeader.querySelector('.ddb-campaigns-character-card-header-upper-character-info')
                                    let cFooter = character.querySelector('.ddb-campaigns-character-card-footer')
                                    let viewLink = character.querySelector('.ddb-campaigns-character-card-footer-links-item-view')
                                    if (!viewLink?.href.match(/\\/${f.characterId}$/)) continue
                                    document.getElementById("${f.characterId}-status-health")?.remove()
                                    document.getElementById("${f.characterId}-status-info")?.remove()
                                    let health = document.createElement("div")
                                    health.id = "${f.characterId}-status-health"
                                    let hp = document.createElement("div")
                                    hp.classList = "ddb-campaigns-character-card-header-upper-character-info-primary"
                                    hp.style.minWidth = "100px"
                                    hp.style.textAlign = "center"
                                    hp.style.border = "1px solid ${(f.hitPointInfo.current<(f.hitPointInfo.maximum*.2))?"#bc0f0f":"#1d99f0"}"
                                    hp.style.boxShadow = "inset 0 0 25px ${(f.hitPointInfo.current<(f.hitPointInfo.maximum*.2))?"#bc0f0f":"#1d99f0"}"
                                    hp.style.borderRadius = "2px"
                                    hp.style.padding = "2px"
                                    hp.style.overflow = "visible"
                                    //hp.innerHTML = '<span style="color: ${(f.hitPointInfo.current<(f.hitPointInfo.maximum*.2))?"#bc0f0f":"#1d99f0"}">${f.hitPointInfo.current}</span> / ${f.hitPointInfo.maximum}${(f.hitPointInfo.temp!=0)?` (${f.hitPointInfo.temp})`:''}'
                                    hp.innerHTML = '${f.hitPointInfo.current} / ${f.hitPointInfo.maximum}${(f.hitPointInfo.temp!=0)?` (${f.hitPointInfo.temp})`:''}'
                                    let hpLabel = document.createElement("div")
                                    hpLabel.style.fontSize = "7px"
                                    hpLabel.style.whiteSpace = "pre"
                                    hpLabel.style.textTransform = "uppercase"
                                    hpLabel.textContent = "Hit Points"
                                    if (${f.hitPointInfo.current}<=0) {
                                        hp.textContent = ""
                                        hp.style.boxShadow = "inset 0 0 ${25+(f.deathSaveInfo.failCount*10)}px #bc0f0f"
                                        let deathSave = document.createElement("div")
                                        deathSave.style.display = "flex"
                                        deathSave.style.width = "100%"
                                        deathSave.style.alignItems = "center"
                                        deathSave.style.justifyContent = "space-evenly"
                                        let icon = document.createElement("div")
                                        icon.classList = 'i-condition-white-unconscious'
                                        deathSave.appendChild(icon)
                                        let deathSaves = document.createElement("div")
                                        deathSaves.style.display = "block"
                                        let fails = document.createElement("div")
                                        fails.style.display = "flex"
                                        fails.style.width = "100%"
                                        fails.style.justifyContent = "space-between"
                                        fails.style.alignItems = "center"
                                        let failLabel = document.createElement("div")
                                        failLabel.style.whiteSpace = "pre"
                                        failLabel.style.textTransform = "uppercase"
                                        failLabel.textContent = "FAILURE"
                                        failLabel.style.fontSize = "10px"
                                        failLabel.style.width = "46px"
                                        failLabel.style.textAlign = "left"
                                        fails.appendChild(failLabel)    
                                        for (let i = 1; i<=3; i++) {
                                            let seg = document.createElement("div")
                                            seg.style.backgroundColor = (i<=${f.deathSaveInfo.failCount})?"#ffffff":"#222222"
                                            seg.style.width = "9px"
                                            seg.style.height = "9px"
                                            seg.style.border = "1px solid #555555"
                                            seg.style.borderRadius = "100%"
                                            fails.appendChild(seg)
                                        }
                                        deathSaves.appendChild(fails)
                                        let saves = document.createElement("div")
                                        saves.style.display = "flex"
                                        saves.style.width = "100%"
                                        saves.style.justifyContent = "space-between"
                                        saves.style.alignItems = "center"
                                        let saveLabel = document.createElement("div")
                                        saveLabel.style.whiteSpace = "pre"
                                        saveLabel.style.textTransform = "uppercase"
                                        saveLabel.textContent = "SUCCESS"
                                        saveLabel.style.fontSize = "10px"
                                        saveLabel.style.width = "46px"
                                        saveLabel.style.textAlign = "left"
                                        saves.appendChild(saveLabel)
                                        for (let i = 1; i<=3; i++) {
                                            let seg = document.createElement("div")
                                            seg.style.backgroundColor = (i<=${f.deathSaveInfo.successCount})?"#ffffff":"#222222"
                                            seg.style.width = "9px"
                                            seg.style.height = "9px"
                                            seg.style.border = "1px solid #555555"
                                            seg.style.borderRadius = "100%"
                                            saves.appendChild(seg)
                                        }
                                        deathSaves.appendChild(saves)
                                        deathSave.appendChild(deathSaves)
                                        hp.appendChild(deathSave)
                                        hpLabel.textContent = "Death Saves"
                                    }
                                    hp.appendChild(hpLabel)
                                    health.appendChild(hp)
                                    let exhaust = document.createElement("div")
                                    exhaust.id = "${f.characterId}-status-exhaust"
                                    exhaust.classList = "ddb-campaigns-character-card-header-upper-character-info-primary"
                                    exhaust.style.textAlign = "center"
                                    exhaust.style.overflow = "visible"
                                    exhaust.textContent = "Exhaustion"
                                    exhaust.style.fontSize = "7px"
                                    exhaust.style.textTransform = "uppercase"
                                    let segments = document.createElement("div")
                                    segments.style.display = "flex"
                                    for (let i = 1; i<=6; i++) {
                                        let seg = document.createElement("div")
                                        seg.style.backgroundColor = (i>${exhaustion})? "#bdbdbd" : "#ffffff"
                                        seg.style.width = "100%"
                                        seg.style.height = "2px"
                                        seg.style.marginRight = "2px"
                                        segments.appendChild(seg)
                                    }
                                    exhaust.appendChild(segments)
                                    health.appendChild(exhaust)
                                    let stats = document.createElement("div")
                                    stats.id = "${f.characterId}-status-stats"
                                    stats.classList = "ddb-campaigns-character-card-header-upper-character-info-primary"
                                    stats.style.textAlign = "center"
                                    stats.style.display = "flex"
                                    stats.style.justifyContent = "space-between"
                                    let pp = document.createElement("div")
                                    pp.style.width = "15%"
                                    pp.style.paddingBottom = "2px"
                                    pp.textContent = "${f.passivePerception}"
                                    let ppLabel = document.createElement("div")
                                    ppLabel.style.fontSize = "7px"
                                    ppLabel.style.whiteSpace = "pre"
                                    ppLabel.style.textTransform = "uppercase"
                                    ppLabel.textContent = "Passive\\nPerception"
                                    pp.appendChild(ppLabel)
                                    stats.appendChild(pp)
                                    let piv = document.createElement("div")
                                    piv.style.width = "15%"
                                    piv.style.paddingBottom = "2px"
                                    piv.textContent = "${f.passiveInvestigation}"
                                    let pivLabel = document.createElement("div")
                                    pivLabel.style.fontSize = "7px"
                                    pivLabel.style.whiteSpace = "pre"
                                    pivLabel.style.textTransform = "uppercase"
                                    pivLabel.textContent = "Passive\\nInvestigation"
                                    piv.appendChild(pivLabel)
                                    stats.appendChild(piv)
                                    let pis = document.createElement("div")
                                    pis.style.width = "15%"
                                    pis.style.paddingBottom = "2px"
                                    pis.textContent = "${f.passiveInsight}"
                                    let pisLabel = document.createElement("div")
                                    pisLabel.style.fontSize = "7px"
                                    pisLabel.style.whiteSpace = "pre"
                                    pisLabel.style.textTransform = "uppercase"
                                    pisLabel.textContent = "Passive\\nInsight"
                                    pis.appendChild(pisLabel)
                                    stats.appendChild(pis)
                                    let ac = document.createElement("div")
                                    ac.style.width = "15%"
                                    ac.style.border = "1px solid white"
                                    ac.style.borderRadius = "50% 50% 50% 50% / 12% 12% 88% 88%"
                                    ac.style.boxShadow = "inset 0 0 25px #bdbdbd"
                                    ac.style.paddingBottom = "2px"
                                    ac.textContent = "${f.armorClass}"
                                    let acLabel = document.createElement("div")
                                    acLabel.style.fontSize = "7px"
                                    acLabel.style.whiteSpace = "pre"
                                    acLabel.style.textTransform = "uppercase"
                                    acLabel.textContent = "Armor\\nClass"
                                    ac.appendChild(acLabel)
                                    stats.appendChild(ac)
                                    let senses = document.createElement("div")
                                    senses.id = "${f.characterId}-status-senses"
                                    senses.classList = "ddb-campaigns-character-card-header-upper-character-info-secondary"
                                    senses.textContent = ${JSON.stringify(senses)}.join(", ")
                                    let conditions = document.createElement("div")
                                    conditions.id = "${f.characterId}-status-conditions"
                                    conditions.classList = "ddb-campaigns-character-card-header-upper-character-info-secondary"
                                    conditions.style.height = "16px"
                                    for (let condition of ${JSON.stringify(conditions)}) {
                                        let icon = document.createElement("div")
                                        icon.classList = condition
                                        conditions.appendChild(icon)
                                    }
                                    cDetail.appendChild(health)
                                    let info = document.createElement("div")
                                    info.id = "${f.characterId}-status-info"
                                    info.classList = "ddb-campaigns-character-card-header-upper"
                                    info.style.display = "block"
                                    info.appendChild(stats)
                                    info.appendChild(senses)
                                    info.appendChild(conditions)
                                    cHeader.appendChild(info)
                            }
                            })()`).catch(e=>console.log(`Unable to set statuses: ${e}`))
                    }
                }).catch(e=>console.log(`Unable to retrieve character statuses: ${e}`))
                    _dmScreen = setTimeout(updateChars,screenTimeout*1000)
                    ipcMain.removeAllListeners("refreshCharacterStatus")
                    ipcMain.once("refreshCharacterStatus", ()=>updateChars())
                }
                updateChars()
        }).catch((r) => console.log(`Unable to retrieve characters: ${r}`))
	var url = new URL("wss://game-log-api-live.dndbeyond.com/v1")
	url.searchParams.append('gameId',gameId)
	url.searchParams.append('userId',userId)
	url.searchParams.append('stt',cobalt)
	if (_ws !== null) {
		_ws.isDisconnecting = true
		_ws.close(1001,"Going away")
	}
	const ws = new WebSocket(url.toString())
	ws.on('open',() => {
		_ws = ws
		_ws.isDisconnecting = false
		_ws.pingInterval = setInterval(() => _ws.ping(), 5000);
		_win.webContents.executeJavaScript(`
		if (document.getElementsByClassName('gamelog-button')[0]) {
			document.getElementsByClassName('gamelog-button')[0].style.backgroundColor = 'LimeGreen';
		}
		`,true).catch((e) => console.log(e))
		let msgJson = {
		    "source": "EncounterLog",
		    "type":     "message",
		    "content": "Connected to D&D Beyond GameLog for " + campaignName.trim()
		};
		const request = net.request({url: encounterhost+"/api/messages",method: "POST"})
		request.on('error',e => console.error(e))
		request.write(JSON.stringify(msgJson))
		request.end()
	})
	ws.on('close',(code,reason) => {
		console.log(`WebSocket closed: ${reason} (${code})`)
                if (_dmScreen) clearTimeout(_dmScreen)
		_win?.webContents?.executeJavaScript(`
		if (document.getElementsByClassName('gamelog-button')[0]) {
			document.getElementsByClassName('gamelog-button')[0].style.backgroundColor = 'Crimson';
		}
		`,true).catch((e) => console.log(e))
		if (_ws.pingInterval) clearInterval(_ws.pingInterval);
		if (code == 1001 && !_ws.isDisconnecting) {
			setTimeout(() => connectGameLog(gameId,userId,campaignName),1000)
		}
		_ws = null
		let msgJson = {
		    "source": "EncounterLog",
		    "type":     "message",
		    "content": "Disconnected from D&D Beyond GameLog for " + campaignName.trim()
		};
		const request = net.request({url: encounterhost+"/api/messages",method: "POST"})
		request.on('error',e => console.error(e))
		request.write(JSON.stringify(msgJson))
		request.end()
	})
	ws.on('error',(e) => console.log(e))
	ws.on('message',(data) => {
                try {
		    const msgData = JSON.parse(data)
                    if (msgData.eventType != "dice/roll/fulfilled") {
                        return
                    }
                    var character = msgData.data.context.name?.trim() || ""
                    if (character == "") {
                            for (var cchar of campaignChars) {
                                    if (cchar.id.toString() == msgData.data.context.entityId) {
                                            character = cchar.name.trim()
                                            break
                                    }
                            }
                    }
                    if (!ignored.includes(character)) {
                            for (var roll of msgData.data.rolls) {
                                    let rollJson = {
                                        "source": character,
                                        "type":     "roll",
                                        "content": {
                                                "formula": roll.diceNotationStr,
                                                "result": roll.result.total,
                                                "detail": roll.result.text,
                                                "name":   msgData.data.action
                                        }
                                    };
                                    if (["check","save","attack","damage","heal"].includes(roll.rollType)) {
                                            rollJson.content.type = roll.rollType;
                                    } else if (roll.rollType == "to hit") {
                                            rollJson.content.type = "attack";
                                    }
                                    const request = net.request({url: encounterhost+"/api/messages",method: "POST"})
                                    request.on('error',e => console.error(e))
                                    request.write(JSON.stringify(rollJson))
                                    request.end()
                            }
                    }
                } catch (e) {
                    console.log("Error",e.message)
                    console.log(data)
                    return
                }

	})
}
