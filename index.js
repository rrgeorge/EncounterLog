const {app, session, BrowserWindow, ipcMain, net, Menu, MenuItem, dialog, shell} = require('electron')
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
var _ws = null
var _win = null
var ddb

app.userAgentFallback = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:88.0) Gecko/20100101 Firefox/88.0'
var ignored = []
var campaignChars = []
var encounterhost = undefined

const preferences = new ElectronPreferences({
	'dataStore': path.resolve(app.getPath('userData'), 'preferences.json'),
	'sections': [ {
		'id': "main",
		'label': "Settings",
		'icon': "settings-gear-63",
		'form': {
			'groups': [ {
				'fields': [ {
					'label': "EncounterPlus Server URL",
					'key': 'encounterhost',
					'type': 'text',
					'help': "Example: http://192.168.1.10:8080"
				} ]
			} ]
		}
	} ],
        'browserWindowOverrides': {
            'width': 750,
            'height': 500,
            }
})
encounterhost = preferences.value('main.encounterhost');
preferences.on('save', (preferences) => {
	encounterhost = preferences.main.encounterhost
})
app.on('ready', () => {
	const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: {nodeIntegration: true, contextIsolation: false,nativeWindowOpen: true} })
	_win = win
        ddb = new DDB()
	var menu = Menu.buildFromTemplate([
	      {
		  label: 'File',
		  submenu: [
			{'click': function() { preferences.show() },'label': "Preferences"},
		      	{role:'quit'}
		  ]
	      },
              {label: "Campaigns", id: 'campaignMenu', submenu: [] },
              {label: "Compendium", id: 'compendium', enabled: false, submenu: [] },
              {role: 'help', submenu: [
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
            ddb.populateCampaigns().then(() => {
                const campaignMenu = menu.getMenuItemById('campaignMenu')
                campaignMenu.submenu.clear()
                campaignMenu.submenu.append( new MenuItem({
                    label: "Campaign List",
                    toolTip: "Jump to campaign list",
                    click: (m) => _win?.loadURL(`https://www.dndbeyond.com/my-campaigns`)
                }))
                campaignMenu.submenu.append(new MenuItem({type: 'separator'}))
                for (var campaign of ddb.campaigns) {
                    campaignMenu.submenu.append( new MenuItem({
                        label: he.decode(campaign.name).replaceAll("&","&&"),
                        id: campaign.id,
                        toolTip: "Jump to campaign",
                        click: (m) => _win?.loadURL(`https://www.dndbeyond.com/campaigns/${m.id}`)
                    }))
                }
                Menu.setApplicationMenu(menu)
            }).catch(e=>displayError(`Error populating campaigns: ${e}`))
            win.show()
        })
        win.webContents.on('did-navigate',(e,u,r,m) => {
            if (r==200) {
            win.webContents.once('did-finish-load',()=> {
                    console.log(win.webContents.getURL())
                    if (win.webContents.getURL().match(/\/campaigns\/[0-9]+/)) {
                            win.webContents.executeJavaScript(`
                                    const {ipcRenderer} = require('electron')
                                    var characters = document.getElementsByClassName('ddb-campaigns-character-card')
                                    for (var character of characters) {
                                            var cHeader = character.getElementsByClassName('ddb-campaigns-character-card-header')[0]
                                            var cFooter = character.getElementsByClassName('ddb-campaigns-character-card-footer')[0]
                                            var cN = cHeader.getElementsByClassName('ddb-campaigns-character-card-header-upper-character-info-primary')[0].textContent.trim()
                                            var cBox = document.createElement("INPUT")
                                            cBox.setAttribute("type","checkbox")
                                            cBox.setAttribute("id","logfilter-"+cN)
                                            cBox.setAttribute("value",cN)
                                            cBox.setAttribute("checked",true)
                                            cBox.style.padding = "3px 3px"
                                            var cLabel = document.createElement("LABEL")
                                            cLabel.setAttribute("for","logfilter-"+cN)
                                            cLabel.innerText = "Send Log Entries to Encounter Plus"
                                            cLabel.style.display = "inline"
                                            var cDiv = document.createElement("DIV")
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
                    if (win.webContents.getURL().match(/\/my-campaigns/)) {
                        const menu = Menu.getApplicationMenu()
                        ddb.populateCampaigns().then(() => {
                            const campaignMenu = menu.getMenuItemById('campaignMenu')
                            campaignMenu.submenu.clear()
                            campaignMenu.submenu.append( new MenuItem({
                                label: "Campaign List",
                                toolTip: "Jump to campaign list",
                                click: (m) => _win?.loadURL(`https://www.dndbeyond.com/my-campaigns`)
                            }))
                            campaignMenu.submenu.append(new MenuItem({type: 'separator'}))
                            for (var campaign of ddb.campaigns) {
                                campaignMenu.submenu.append( new MenuItem({
                                    label: he.decode(campaign.name).replaceAll("&","&&"),
                                    id: campaign.id,
                                    toolTip: "Jump to campaign",
                                    click: (m) => _win?.loadURL(`https://www.dndbeyond.com/campaigns/${m.id}`)
                                }))
                            }
                            Menu.setApplicationMenu(menu)
                        }).then(
                            ddb.getSources().then(() => {
                                const compendiumMenu = menu.getMenuItemById('compendium')
                                compendiumMenu.submenu.clear()
                                for (const book of ddb.books) {
                                  compendiumMenu.submenu.append( new MenuItem({
                                      label: book.book,
                                      toolTip: book.bookCode,
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
                                      //click: (m) => _win?.loadURL(srcUrl)
                                  }))
                                }
                                compendiumMenu.submenu.append( new MenuItem({ type: 'separator' }))
                                var sharedSubmenu = []
                                for (const book of ddb.sharedBooks) {
                                  sharedSubmenu.push( new MenuItem({
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
                                          })
                                      ]
                                      //click: (m) => _win?.loadURL(srcUrl)
                                  }))
                                }
                                if (sharedSubmenu.length > 0) {
                                    compendiumMenu.submenu.append(
                                        new MenuItem({ label: "Shared Books", submenu: sharedSubmenu })
                                    )
                                    compendiumMenu.submenu.append( new MenuItem({ type: 'separator' }))
                                }
                                var uaSubMenu = []
                                uaSubMenu.push( new MenuItem({
                                    label: "Download UA Monsters",
                                    click: () => {
                                        dialog.showSaveDialog(win,{
                                            title: "Save monsters compendium",
                                            filters: [ { name: "EncounterPlus Compendium", extensions: ["compendium"]} ],
                                            defaultPath: `ua_monsters.compendium`,
                                        }).then((save) => {
                                            if (save.filePath)
                                                ddb.getMonsters(29,save.filePath)
                                            }
                                        )
                                    }
                                    }))
                                uaSubMenu.push( new MenuItem({
                                    label: "Download UA Items",
                                    click: () => {
                                        dialog.showSaveDialog(win,{
                                            title: "Save items compendium",
                                            filters: [ { name: "EncounterPlus Compendium", extensions: ["compendium"]} ],
                                            defaultPath: `ua_items.compendium`,
                                        }).then((save) => {
                                            if (save.filePath)
                                                ddb.getItems(29,save.filePath)
                                            }
                                        )
                                    }
                                    }))
                                uaSubMenu.push( new MenuItem({
                                    label: "Download UA Spells",
                                    click: () => {
                                        dialog.showSaveDialog(win,{
                                            title: "Save spells compendium",
                                            filters: [ { name: "EncounterPlus Compendium", extensions: ["compendium"]} ],
                                            defaultPath: `ua_spells.compendium`,
                                        }).then((save) => {
                                            if (save.filePath)
                                                ddb.getSpells(29,save.filePath)
                                            }
                                        )
                                    }
                                    }))
                                compendiumMenu.submenu.append(
                                    new MenuItem({ label: "Unearthed Arcana", submenu: uaSubMenu })
                                )
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
                                                ddb.getSpells(null,save.filePath,null,null,null,true)
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
	ipcMain.on("changefilter", (event,data) => {
		let name = data[0];
		let filter = data[1];
		if (ignored.includes(name) && filter) {
			ignored = ignored.filter((v,i,a) => {return v != name})
		} else if (!filter && !ignored.includes(name)) {
			ignored.push(name)
		}
	})
	if (encounterhost === undefined) {
		preferences.show();
	} else {
		console.log(encounterhost)
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
                                click: (m) => _win?.loadURL(`https://www.dndbeyond.com/my-campaigns`)
                            }))
                            campaignMenu.submenu.append(new MenuItem({type: 'separator'}))
                            for (var campaign of ddb.campaigns) {
                                campaignMenu.submenu.append( new MenuItem({
                                    label: he.decode(campaign.name).replaceAll("&","&&"),
                                    id: campaign.id,
                                    toolTip: "Jump to campaign",
                                    click: (m) => _win?.loadURL(`https://www.dndbeyond.com/campaigns/${m.id}`)
                                }))
                            }
                            campaignMenu.submenu.append(new MenuItem({type: 'separator'}))
                            campaignMenu.submenu.append(new MenuItem({
                                label: "Convert These Characters for EncounterPlus",
                                click: () => {
                                    dialog.showSaveDialog(_win,{
                                        title: "Save exported characters",
                                        filters: [ { name: "EncounterPlus Compendium", extensions: ["compendium"]} ],
                                        defaultPath: `${thisCampaign.label}.compendium`,
                                    }).then((save) => {
                                        if (save.filePath) {
                                            const prog = new ProgressBar({text: "Converting campaign characters...", detail: "Please wait..."})
                                            download(_win,`https://w.bobg.us/ddb.php?tokenmap=true&circles=true&campaign=https://ddb.ac/characters/${campaignChars[0].id}`,{
                                                filename: path.basename(save.filePath),
                                                directory: path.dirname(save.filePath),
                                                onStarted: () => prog.setCompleted()
                                            })
                                        }
                                    })
                                }
                            }))
                            Menu.setApplicationMenu(menu)
			} catch (e) {
			  console.log(e.message)
			  console.log(body)
			}
		    	resolve("ok")
		  })
		})
		request.end()
	})
}
async function connectGameLog(gameId,userId,campaignName) {
	const cobalt = await ddb.getCobaltAuth()
	requestCampaignChars(gameId,cobalt).catch((r) => console.log(`Unable to retrieve characters: ${r}`))
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
		_win?.webContents?.executeJavaScript(`
		if (document.getElementsByClassName('gamelog-button')[0]) {
			document.getElementsByClassName('gamelog-button')[0].style.backgroundColor = 'Crimson';
		}
		`,true).catch((e) => console.log(e))
		clearInterval(_ws.pingInterval);
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
