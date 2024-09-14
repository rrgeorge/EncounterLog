const {app, session, BrowserWindow, ipcMain, net, Menu, MenuItem, dialog, shell, Notification, webContents, screen} = require('electron')
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
const { networkInterfaces } = require('os')
const { isObject } = require('util')
const http = require('./http')

var _ws = null
var _eWs = null
var _eWsDelay = 1000;
var _eCreatures = []
var _eTokens = []
var _knownConditions = []
var _win = null
var _dmScreen = null
var ddb
let platform = app.userAgentFallback.match(/\(([^)]+)\)/)[1]
const firefox = `Mozilla/5.0 (${platform}; rv:129.0) Gecko/20100101 Firefox/129.0`
const chrome = `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`
app.userAgentFallback = chrome
var ignored = []
var campaignChars = []
var encounterhost = "http://localhost:8080"
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
    app.quit()
}
process.on("uncaughtException", err => {
      dialog.showErrorBox("Uh oh...", `${err}`);
});
app.setAsDefaultProtocolClient('encounterlog')
app.on('second-instance', (e,argv)=>{
    _win?.isMinimized() && _win.restore()
    _win?.focus()
    openURL(argv.find((arg) => arg.startsWith('encounterlog://')))
})
app.on('open-url', (e, u) => {
    e.preventDefault()
    openURL(u)
})
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
                'encounterhost': 'http://localhost:8080',
            },
            'export': {
                'art': [ 'artwork', 'tokens' ],
                'legacy': 'mark',
                'maps': 'maps',
                'mapsloc': 'group',
            }
        },
	'sections': [ {
		'id': "main",
		'label': "EncounterPlus",
		'icon': "multiple-11",
		'form': {
			'groups': [ {
                                'label': "EncounterPlus Settings",
				'fields': [
                                    {
					'heading': "Preferences",
					'key': 'prefs_message',
                                        'type': 'message',
					'content': '<p>If you would like to forward dice rolls to EncounterPlus from a Campaign\'s Game Log, update Token health and hitpoints, and notify of character statuses, enter the EncounterPlus Server URL below.<br>Then load a campaign page, and EncounterLog will automatically connect the Game Log to EncounterPlus</p>',
				    },
                                    {
					'label': "EncounterPlus Server URL",
					'key': 'encounterhost',
					'type': 'text',
					'help': "Example: http://192.168.1.10:8080"
				    },
                                    {
					'label': "During combat, you can have characters announce any current conditions set in D&D Beyond over chat. You can optionally have any condition changes announce as they happen.",
					'key': 'chatconditions',
					'type': 'checkbox',
                                        'options': [
                                            { 'label': 'Announce Conditions on Turn', 'value': 'turn' },
                                            { 'label': 'Announce Conditions on Change', 'value': 'change' }
                                        ]
                                    }],
                            },
                            {
                                'fields': [
                                    {
					'heading': "",
					'key': 'prefs_okay',
                                        'type': 'message',
					'content': '<div align="right"><input type="submit" class="bt" onclick="window.close()" value="Okay"></div>',
				    },
                                ]
			} ]
                }
            },
            {
		'id': "export",
		'label': "Export Settings",
		'icon': "archive-paper",
		'form': {
			'groups': [ {
                                'label': "Export Settings",
                                'fields': [
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
					'label': "Legacy Monsters",
					'key': 'legacy',
					'type': 'radio',
                                        'options': [
                                            { 'label': 'Prefer Legacy Monsters', 'value': 'uselegacy' },
                                            { 'label': 'Prefer Updated Monsters', 'value': 'useupdated' },
                                            { 'label': 'Keep Both and Mark Legacy Monsters', 'value': 'mark' },
                                        ]
                                    },
                                    {
					'label': "Attempt to create maps",
					'key': 'maps',
					'type': 'radio',
                                        'options': [
                                            { 'label': 'Do not look for maps', 'value': 'nomaps' },
                                            { 'label': 'Look for maps', 'value': 'maps' },
                                            { 'label': 'Look for maps and search for missing markers with Google Vision', 'value': 'markers' },
                                        ]
                                    },
                                    {
                                        'key': 'mapsdetail',
                                        'type': 'message',
                                        'content': 'EncounterLog will attempt to identify maps and prepare the grid, walls, lighting, tokens, and markers using crowdsourced data from: <a target="_blank" href="https://github.com/MrPrimate/ddb-meta-data" style="color: white;">Mr. Primate&apos;s ddb-meta-data</a>.<br>EncounterLog will then use computer vision to attempt automatically detect and align the grid for any maps without existing meta data.<br>If you choose to search for missing markers, EncounterLog will upload any maps without markers to Google Vision to try to find label text and match it to headers in the page.'
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
					'label': "After conversion is complete, EncounterLog can launch a web server for E+ to download the manifest and data from",
					'key': 'launchserver',
					'type': 'checkbox',
                                        'options': [
                                            { 'label': 'Launch Server After Conversion', 'value': true },
                                        ]
                                    },
                                ],
                            },
                            {
                                'fields': [
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
            }
})
function openURL(u) {
    if (!u) return
    const url = u.replace(/(https?)\/\//,"$1://")
    if (url.match(/dndbeyond.com/)) {
        const ddburl = url.replace(/encounterlog:\/?\/?/,'')
        app.whenReady().then(()=>
            _win.loadURL((ddburl.startsWith("http"))?ddburl:`https://${ddburl}`)
        )
    } else {
        const epurl = url.replace(/encounterlog:\/?\/?(https?:\/\/)?([^?]*)(?:\/?\?remoteHost=(.*))?.*/,(_,p1,p2,p3)=>{
            if (p3) return (p3.startsWith('http'))?p3:`http://${p3}`
            let host = (p1)?`${p1}${p2}`:`http://${p2}`
            return host.replace(/(\/client)?\/?$/,'')
        })
        app.whenReady().then(()=>{
            dialog.showMessageBox(_win,{ title: 'EncounterPlus Host', message: `EncounterPlus Server has been set to: ${epurl}`})
            preferences.value('main.encounterhost',epurl)
            preferences.save()
            encounterhost = epurl
            if (_eWs?.readyState === WebSocket.OPEN) _eWs.close(1001,"Going away")
        })
    }
}
encounterhost = preferences.value('main.encounterhost');
app.on('ready', () => {
        if (!fs.existsSync(path.join(app.getPath("cache"),app.getName(),"imagecache"))) {
            fs.mkdir(path.join(app.getPath("cache"),app.getName(),"imagecache"),{recursive:true},()=>{})
        }
        if (!fs.existsSync(path.join(app.getPath("cache"),app.getName(),"datacache"))) {
            fs.mkdir(path.join(app.getPath("cache"),app.getName(),"datacache"),{recursive:true},()=>{})
        }
        if (!fs.existsSync(path.join(app.getPath("cache"),app.getName(),"modcache"))) {
            fs.mkdir(path.join(app.getPath("cache"),app.getName(),"modcache"),{recursive:true},()=>{})
        }
        const imgcache = path.join(app.getPath("cache"),app.getName(),"imagecache")
        const modcache = path.join(app.getPath("cache"),app.getName(),"modcache")
        fs.readdir(imgcache,(e,files)=>{
            if (e) {
                console(e)
                return
            }
            files.forEach(f=>{
                if (!f.match(/\.zip$/)) return
                fs.rename(path.join(imgcache,f),path.join(modcache,f),()=>{})
            })
        })
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
	const win = new BrowserWindow({
            show: false,
            width: 800,
            height: 600,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                nativeWindowOpen: true,
                sandbox: true,
                preload: path.join(__dirname,'preload.js')
            }
        })
        const splash = new BrowserWindow({
            show: false,
            width: 256,
            height: 256,
            transparent: true,
            frame: false,
            alwaysOnTop: true
        })
        const winSize = preferences.value('window.size')
        if (winSize) {
            win.setSize(winSize[0],winSize[1],false)
        }
        const winPos = preferences.value('window.position');
        if (winPos && winPos[0] < screen.getPrimaryDisplay().size.width && winPos[1] < screen.getPrimaryDisplay().size.height) {
            win.setPosition(winPos[0],winPos[1],false)
        }
        splash.center()
        splash.loadFile("splash.html")
        splash.show()
        //win.webContents.openDevTools()
	_win = win
        ddb = new DDB()
        if (preferences.value('main.art')) {
            preferences.value('export.art',preferences.value('main.art'))
            delete preferences.preferences.main.art
            preferences.save()
        }
        if (preferences.value('main.maps') ) {
            preferences.value('export.maps',preferences.value('main.maps'))
            delete preferences.preferences.main.maps
            preferences.save()
        }
        if (preferences.value('main.mapsloc')) {
            preferences.value('export.mapsloc',preferences.value('main.mapsloc'))
            delete preferences.preferences.main.mapsloc
            preferences.save()
        }
        ddb.art = preferences.value('export.art');
        ddb.maps = preferences.value('export.maps') ?? "nomaps";
        ddb.mapsloc = preferences.value('export.mapsloc') ?? "group";
        ddb.legacy = preferences.value('export.legacy') ?? "mark";

        console.log(ddb.art,ddb.maps)
        preferences.on('save', (preferences) => {
                if (encounterhost != preferences.main.encounterhost && _eWs?.readyState === WebSocket.OPEN)
                    _eWs.close(1001,"Going away")
                encounterhost = preferences.main.encounterhost
                ddb.art = preferences.export.art
                ddb.maps = preferences.export.maps
                ddb.mapsloc = preferences.export.mapsloc
                ddb.legacy = preferences.export.legacy
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
              {role: 'editMenu'},
              {role: 'viewMenu'},
              {label: "Campaigns", id: 'campaignMenu', submenu: [ { label: "-- Not available yet--", enabled: false } ] },
              {label: "Compendium", id: 'compendium', submenu: [ {label: "-- Not available yet--", enabled: false }] },
              {role: 'windowMenu'},
              {role: 'help', submenu: [
                  { label: `${app.getName()} v${app.getVersion()}`, enabled: false }, 
                  { label: "About", click: () => shell.openExternal("https://github.com/rrgeorge/EncounterLog") },
                  { label: "Support this project", click: () => shell.openExternal("https://github.com/sponsors/rrgeorge") },
                  { label: "Refresh menus",
                      click: ()=>{
                            populateCampaignMenu(true)
                            populateCompendiumMenu(true)
                    }},
                  {
                      'click': function() {
                            fs.rm(path.join(app.getPath("cache"),app.getName(),"imagecache"),{recursive: true},(e)=>{
                                if (e) {
                                    dialog.showErrorBox("Error",`Could not remove image cache: ${e}`)
                                } else {
                                    fs.mkdir(path.join(app.getPath("cache"),app.getName(),"imagecache"),{recursive: true},()=>{})
                                    dialog.showMessageBox(_win,{title:"Image Cache Cleared",message: "Image cache has been cleared."})
                                }
                            })
                      },
                      'label': "Clear image cache",
                  },
                  {
                      'click': function() {
                          win.webContents.session.clearStorageData().then(()=>
                              dialog.showMessageBox(_win,{title:"Data Cleared",message: "All cache and cookies have been cleared."}).then(()=>_win.loadURL("https://www.dndbeyond.com/sign-in?returnUrl=/my-campaigns",{httpReferrer: "https://www.dndbeyond.com/my-campaigns"})))
                      },
                      'label': "Clear all Cache and Cookies",
                  },
              ] },
	  ])
	Menu.setApplicationMenu(menu);
        session.defaultSession.webRequest.onBeforeSendHeaders({
            urls: [
                '*://accounts.google.com/*'
            ]},
            (d,c)=>{
                const requestHeaders = {...d.requestHeaders, ...{
                    ['User-Agent']: firefox
                }}
                c({
                    requestHeaders: requestHeaders
                })
            }
        )
        session.defaultSession.webRequest.onCompleted(
            {urls: [
                'https://*.dndbeyond.com/*css',
                'https://fonts.googleapis.com/css*']
            },(d)=>{
                if (ddb.css.indexOf(d.url)<0)ddb.css.push(d.url)
            }
        )
        win.once('ready-to-show', () => {
            let splashInt = setInterval(()=>{
                    if (!splash?.isVisible()) 
                        clearInterval(splashInt)
                    const op = splash.getOpacity()
                    if (op > 0) {
                        splash.setOpacity(op - .02)
                    } else {
                        clearInterval(splashInt)
                        splash.close()
                    }
                },5)
            win.show()
        })
        
        const checkLogin = (e,u,r,m) => {
            console.log(e,u,r,m)
            if (r == 200 && u.startsWith("https://www.dndbeyond.com")) {
                (() => new Promise(resolve => setTimeout(resolve, Math.floor(Math.random()*500))))().then(()=>
                ddb.getUserData()
                    .then(()=>{
                        updateManifest().then(()=>{
                                populateCampaignMenu()
                                populateCompendiumMenu()
                            }
                        )
                    })
                    .catch(e=>{
                        if (e == "Not logged in" && !u.startsWith("https://www.dndbeyond.com/sign-in")) {
                            win.loadURL("https://www.dndbeyond.com/sign-in?returnUrl=/my-campaigns",{httpReferrer: "https://www.dndbeyond.com/my-campaigns"})
                        }
                        console.log(`Unable to get userdata: ${e}`)
                        win.webContents.once('did-navigate',checkLogin)
                    })
                )
            } else {
                win.webContents.once('did-navigate',checkLogin)
            }
        }
          
        win.webContents.on('will-navigate',(e,u)=>{
            if (u.match(/\/characters?\/[0-9]+/)) {
                e.preventDefault()
                const newWin = new BrowserWindow({
                    show: true,
                    width: 800,
                    height: 600,
                    webPreferences: {
                        nodeIntegration: false,
                        contextIsolation: true,
                        nativeWindowOpen: true,
                        sandbox: true,
                        plugins: true,
                    }
                })
                newWin.loadURL(u)
            }
        })
        win.webContents.on('did-navigate',(e,u,r,m) => {
            if (r==200) {
            win.webContents.once('did-finish-load',()=> {
                    if (win.webContents.getURL().match(/dndbeyond.com\/campaigns\/[0-9]+/)) {
                            win.webContents.executeJavaScript(`
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
                                            cBox.addEventListener('change',e => window.EncounterLog.Filter([e.target.value,e.target.checked]))
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
                        ddb.userId && win.webContents.executeJavaScript("Array.from(document.querySelectorAll('.ddb-campaigns-listing-active .ddb-campaigns-list-item-body-title')).map(t=>t?.textContent?.trim())").then(r=>{
                            const c = ddb.campaigns.map(c=>he.decode(c.name))
                            if (!r.every(i=>c.includes(i)) || !c.every(i=>r.includes(i))) {
                                console.log("Campaign list differs, repopulating")
                                populateCampaignMenu(true)
                            }
                        })
                        //ddb.userId && populateCampaignMenu()
                    }
                })
            }
        })
        win.on('resized',()=>{ preferences.value('window.size', win.getSize()); preferences.save() })
        win.on('moved',()=>{ preferences.value('window.position', win.getPosition()); preferences.save() })
        win.on('closed',()=>{
            app.quit()
        })
	ipcMain.on("changefilter", (event,data) => {
		let name = data[0];
		let filter = data[1];
                console.log(data)
		if (ignored.includes(name) && filter) {
			ignored = ignored.filter((v,i,a) => {return v != name})
		} else if (!filter && !ignored.includes(name)) {
			ignored.push(name)
		}
	})
	if (encounterhost !== undefined) {
	    console.log(`EncounterPlus URL: ${encounterhost}`)
	}
        console.log("Checking menu cache...")
    if (fs.existsSync(path.join(app.getPath("cache"),app.getName(),"datacache",`campaignscache.json`))) {
            const res = JSON.parse(fs.readFileSync(path.join(app.getPath("cache"),app.getName(),"datacache",`campaignscache.json`)))
            if (res && ddb.manifestTimestamp<res.lastUpdate) {
                console.log("Using cached campagins")
                populateCampaignMenu()
            }
        }
        if (fs.existsSync(path.join(app.getPath("cache"),app.getName(),"datacache",`sourcescache.json`))) {
            const res = JSON.parse(fs.readFileSync(path.join(app.getPath("cache"),app.getName(),"datacache",`sourcescache.json`)))
            if (res && ddb.manifestTimestamp<res.lastUpdate) {
                console.log("Using cached compendium")
                populateCompendiumMenu()
            }
        }
        win.webContents.once('did-navigate',checkLogin)
        win.loadURL("https://www.dndbeyond.com/my-campaigns" )
        if (Notification.isSupported()) new Notification()
});
function displayError(e) {
    _win.loadURL("https://www.dndbeyond.com/my-campaigns")
    console.log(e)
    dialog.showErrorBox("Error",e)
}
app.on('will-quit', () => {
		if (_ws !== null) {
		    _ws.isDisconnecting = true
		    _ws.close(1001,"Going away")
		}
	})
function updateManifest() {
    return new Promise((resolve,reject)=>{
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
                        resolve("Updated")
                    }
                }).catch(e=>{
                    console.log(`Manifest Download Error: ${e}`)
                    return reject(e)
                })
            } else {
                console.log(res)
                resolve(res)
            }
        })
    })
}
function populateCampaignMenu(force=false) {
    const menu = Menu.getApplicationMenu()
    ddb.populateCampaigns(force).then(() => {
        const campaignMenu = menu.getMenuItemById('campaignMenu')
        campaignMenu.submenu.clear()
        campaignMenu.submenu.append( new MenuItem({
            label: "Campaign List",
            toolTip: "Jump to campaign list",
            accelerator: "CommandOrControl+Shift+C",
            click: (m) => _win?.loadURL(`https://www.dndbeyond.com/my-campaigns`,{httpReferrer: "https://www.dndbeyond.com"})
        }))
        campaignMenu.submenu.append(new MenuItem({type: 'separator'}))
        for (const campaign of ddb.campaigns) {
            campaignMenu.submenu.append( new MenuItem({
                label: he.decode(campaign.name).replaceAll("&","&&"),
                id: campaign.id,
                toolTip: "Jump to campaign",
                click: (m) => _win?.loadURL(`https://www.dndbeyond.com/campaigns/${m.id}`,{httpReferrer: "https://www.dndbeyond.com/my-campaigns"}),
            }))
        }
        campaignMenu.submenu.append(new MenuItem({type: 'separator'}))
        campaignMenu.submenu.append( new MenuItem({
            label: "Export All Encounters",
            toolTip: "Export all Encounters from the Encounter Builder",
            click: () => {
                dialog.showSaveDialog(_win,{
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
    }).catch(e=>displayError(`Error populating campaigns: ${e}`))
}
function populateCompendiumMenu(force=false) {
    return new Promise((resolve,reject)=>{
        const menu = Menu.getApplicationMenu()
        ddb.getSources(force).then(() => {
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
              categoryMenu.submenu.append( new MenuItem({
                  label: he.decode(book.book).replaceAll("&","&&"),
                  toolTip: he.decode(book.bookCode),
                  submenu: [
                      new MenuItem({
                          label: "Open",
                          click: () => _win.loadURL(book.url,{httpReferrer: "https://www.dndbeyond.com"}),
                      }),
                      new MenuItem({ type: 'separator' }),
                      new MenuItem({
                          label: "Download Module",
                          click: () => {
                            dialog.showSaveDialog(_win,{
                                title: "Save Book",
                                filters: [ { name: "EncounterPlus Module", extensions: ["module"]} ],
                                defaultPath: `${book.bookCode.toLowerCase()}.module`,
                            }).then((save) => {
                                if (save.filePath)
                                    ddb.getModule(book.id,save.filePath,_win).then(()=>{
                                            if (preferences.value('export.launchserver').includes(true)) {
                                                let httpServer = new http(save.filePath,book.bookCode.toLowerCase(),book.book)
                                                httpServer.server.then((s)=>{
                                                    dialog.showMessageBox(_win,{
                                                        title: 'Server Running',
                                                        message: `The web server is running. Set the manifest to:\nhttp://${httpServer.ipaddr}:${httpServer.port}\nIt will shutdown after you close this dialog.`,
                                                        type: "info"
                                                    }).then((r)=>{
                                                        s.close()
                                                    })
                                                })
                                            }
                                        }
                                        ).catch(e=>displayError(e))
                                }
                            )
                          }
                      }),
                      new MenuItem({
                          label: "Download Only Monsters",
                          click: () => {
                            dialog.showSaveDialog(_win,{
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
                            dialog.showSaveDialog(_win,{
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
                            dialog.showSaveDialog(_win,{
                                title: "Save spells compendium",
                                filters: [ { name: "EncounterPlus Compendium", extensions: ["compendium"]} ],
                                defaultPath: `${book.bookCode.toLowerCase()}-spells.compendium`,
                            }).then((save) => {
                                if (save.filePath)
                                    ddb.getSpells(book.id,save.filePath)
                                }
                            )
                          }
                      }),
                      new MenuItem({
                          label: "Download Only v5 Compendium",
                          click: () => {
                            dialog.showSaveDialog(_win,{
                                title: "Save V5 compendium",
                                filters: [ { name: "EncounterPlus Compendium", extensions: ["compendium"]} ],
                                defaultPath: `${book.bookCode.toLowerCase()}-v5.compendium`,
                            }).then((save) => {
                                if (save.filePath)
                                    ddb.getV5Compendium(book.id,save.filePath).then(()=>{
                                        if (preferences.value('export.launchserver').includes(true)) {
                                            let httpServer = new http(save.filePath,'all','Complete Compendium')
                                            httpServer.server.then((s)=>{
                                                dialog.showMessageBox(_win,{
                                                    title: 'Server Running',
                                                    message: `The web server is running. Set the manifest to:\nhttp://${httpServer.ipaddr}:${httpServer.port}\nIt will shutdown after you close this dialog.`,
                                                    type: "info"
                                                }).then((r)=>{
                                                    s.close()
                                                })
                                            })
                                        }
                                    })

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
                              click: () => _win.loadURL(book.url,{httpReferrer: "https://www.dndbeyond.com"}),
                          }),
                          new MenuItem({
                              label: "Download Module",
                              click: () => {
                                dialog.showSaveDialog(_win,{
                                    title: "Save Book",
                                    filters: [ { name: "EncounterPlus Module", extensions: ["module"]} ],
                                    defaultPath: `${book.bookCode.toLowerCase()}.module`,
                                }).then((save) => {
                                    if (save.filePath)
                                        ddb.getModule(book.id,save.filePath,_win).then(()=>{
                                            if (preferences.value('export.launchserver').includes(true)) {
                                                let httpServer = new http(save.filePath,book.bookCode.toLowerCase(),book.book)
                                                httpServer.server.then((s)=>{
                                                    dialog.showMessageBox(_win,{
                                                        title: 'Server Running',
                                                        message: `The web server is running. Set the manifest to:\nhttp://${httpServer.ipaddr}:${httpServer.port}\nIt will shutdown after you close this dialog.`,
                                                        type: "info"
                                                    }).then((r)=>{
                                                        s.close()
                                                    })
                                                })
                                            }
                                        }
                                        ).catch(e=>displayError(e))
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
                    dialog.showSaveDialog(_win,{
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
                    dialog.showSaveDialog(_win,{
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
                    dialog.showSaveDialog(_win,{
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
                    dialog.showSaveDialog(_win,{
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
                    dialog.showSaveDialog(_win,{
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
                    dialog.showSaveDialog(_win,{
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
            compendiumMenu.submenu.append( new MenuItem({
                  label: "Download v5 Compendium",
                  click: () => {
                    dialog.showSaveDialog(_win,{
                        title: "Save V5 compendium",
                        filters: [ { name: "EncounterPlus Compendium", extensions: ["compendium"]} ],
                        defaultPath: `v5.compendium`,
                    }).then((save) => {
                        if (save.filePath)
                            ddb.getV5Compendium(null,save.filePath).then(()=>{
                                if (preferences.value('export.launchserver').includes(true)) {
                                    let httpServer = new http(save.filePath,'all','Complete Compendium')
                                    httpServer.server.then((s)=>{
                                        dialog.showMessageBox(_win,{
                                            title: 'Server Running',
                                            message: `The web server is running. Set the manifest to:\nhttp://${httpServer.ipaddr}:${httpServer.port}\nIt will shutdown after you close this dialog.`,
                                            type: "info"
                                        }).then((r)=>{
                                            s.close()
                                        })
                                    })
                                }
                            })
                        }
                    )
                  }
              }))
            compendiumMenu.enabled = true
            Menu.setApplicationMenu(menu)
            resolve(menu)
        }).catch(e=>{
            displayError(`Error populating sources: ${e}`)
            return reject(e)
        })
    })
}


function requestCampaignChars(gameId,cobalt) {
	return new Promise((resolve,reject) => {
		const url = `https://www.dndbeyond.com/api/campaign/characters/${gameId}`
		const request = net.request({url: url,useSessionCookies:true})
		request.setHeader('Authorization',`Bearer ${cobalt}`)
                //request.setHeader('Cookie',`CobaltSession=${ddb.cobaltsession}`)
                request.setHeader('Accept','application/json')
		let body = ''
		request.on('response', (response) => {
		  response.on('data', (chunk) => {
		    body += chunk.toString()
		  })
		  response.on('end', () => {
                        if (response.statusCode != 200) {
                            /*
                            const newWin = new BrowserWindow({
                                show: true,
                                width: 800,
                                height: 600,
                                webPreferences: {
                                    nodeIntegration: false,
                                    contextIsolation: true,
                                    nativeWindowOpen: true,
                                    sandbox: true,
                                    plugins: true,
                                }
                            })
                        newWin.a
                        */  console.log(body)
                            return reject(response.statusCode)
                        }
                        console.log(response.statusCode)
			try {
                            campaignChars = JSON.parse(body).data
                            campaignChars.forEach(character=>{
                                ddb.getCharacterSheet(character.id).then(sheet=>character.sheet = sheet)
                            })
                            const menu = Menu.getApplicationMenu()
                            const campaignMenu = menu.getMenuItemById('campaignMenu')
                            const thisCampaign = campaignMenu.submenu.getMenuItemById(parseInt(gameId))
                            campaignMenu.submenu.clear()
                            campaignMenu.submenu.append( new MenuItem({
                                label: "Campaign List",
                                toolTip: "Jump to campaign list",
                                accelerator: "CommandOrControl+Shift+C",
                                click: (m) => _win?.loadURL(`https://www.dndbeyond.com/my-campaigns`,{httpReferrer: "https://www.dndbeyond.com"})
                            }))
                            campaignMenu.submenu.append(new MenuItem({type: 'separator'}))
                            for (const campaign of ddb.campaigns) {
                                campaignMenu.submenu.append( new MenuItem({
                                    label: he.decode(campaign.name).replaceAll("&","&&"),
                                    id: campaign.id,
                                    toolTip: "Jump to campaign",
                                    click: (m) => _win?.loadURL(`https://www.dndbeyond.com/campaigns/${m.id}`,{httpReferrer: "https://www.dndbeyond.com/my-campaigns"})
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
                                            console.log(JSON.stringify(campaignChars).length);
                                            let prog = new ProgressBar({title: "Converting campaign characters...", text: "Converting campaign characters...", detail: "Uploading character data...",maxValue: 1,indeterminate: false})
                                            const request = net.request({url: "https://play5e.online",method: "POST"})
                                            request.setHeader('Content-Type', "application/json")
                                            request.chunkedEncoding = true
                                            request.on('response', (response) => {
                                              let body = new Buffer.alloc(0)
                                              let size = 1
                                              if (response.statusCode == 422) {
                                                  prog.text = "Error"
                                                  prog.detail = "Error converting characters."
                                                  prog.close()
                                                  let err = response.headers["x-ddb-error"]
                                                  console.log(err)
                                                  dialog.showErrorBox("Error",`Could not convert characters:\n${err}`)
                                              } else if (response.statusCode == 200) {
                                                  prog.detail = "Downloading..."
                                                  size = response.headers["content-length"]*1.00
                                                  prog.value = 0;
                                              } else {
                                                  prog.text = "Error"
                                                  prog.detail = "Error converting characters."
                                                  prog.close()
                                                  dialog.showErrorBox("Error",`Could not convert characters:\nError ${response.statusCode}`)
                                              }
                                              response.on('data', (chunk) => {
                                                  body = Buffer.concat([body,chunk])
                                                  prog.value = ((body.length*1.00)/(size*1.00))
                                              })
                                              response.on('end', () => {
                                                  if (response.statusCode == 200) {
                                                      try {
                                                        fs.writeFileSync(save.filePath,body)
                                                          const notification = new Notification({title: "Export Complete", body: `Characters exported to ${save.filePath}`})
                                                          notification.show()
                                                      } catch (e) {
                                                            fs.rm(save.filePath,()=>{})
                                                            if (prog.isInProgress()) prog.close()
                                                            dialog.showErrorBox("Error",`Could not convert characters: ${e}`)
                                                      }
                                                      if (prog.isInProgress()) prog.close()
                                                  }
                                              })
                                            })
                                            prog.detail = "Uploading data..."
                                            request.write(JSON.stringify({
                                                api: true,
                                                tokenmap: true,
                                                circles: true,
                                                campaignoverride: thisCampaign.label.replaceAll("&&","&"),
                                                characterSheets: campaignChars.map(c=>c.sheet)
                                            }),()=>prog.detail = "Processing (this could take a minute)...")
                                            let upload
                                            while(upload = request.getUploadProgress()) {
                                                if (!upload.active) break;
                                                if (!upload.started) continue;
                                                prog.detail = "Uploading data..."+((upload.current*100.00)/(upload.total*1.00)).toFixed(0)+"%"
                                            }
                                            request.end()
                                        }
                                    })
                                }
                            }))
                            campaignMenu.submenu.append(new MenuItem({
                                label: "Export this Campaign's v5 Characters",
                                click: () => {
                                    dialog.showSaveDialog(_win,{
                                        title: "Save exported characters",
                                        filters: [ { name: "EncounterPlus Compendium", extensions: ["compendium"]} ],
                                        defaultPath: `${thisCampaign.label.replaceAll("&&","&")}-characters.compendium`,
                                    }).then((save) => {
                                        if (save.filePath) {
                                            ddb.getCampaignCharacters(thisCampaign.id,campaignChars,save.filePath).then(()=>{
                                            if (preferences.value('export.launchserver').includes(true)) {
                                                let httpServer = new http(save.filePath,`characters.${thisCampaign.id}`,`${thisCampaign.label.replaceAll("&&","&")} characters}`)
                                                httpServer.server.then((s)=>{
                                                    dialog.showMessageBox(_win,{
                                                        title: 'Server Running',
                                                        message: `The web server is running. Set the manifest to:\nhttp://${httpServer.ipaddr}:${httpServer.port}\nIt will shutdown after you close this dialog.`,
                                                        detail: `This will load ${path.basename(save.filePath)}`,
                                                        type: "info"
                                                    }).then((r)=>{
                                                        s.close()
                                                    })
                                                })
                                            }
                                        }
                                        ).catch(e=>displayError(e))
                                        }
                                    })
                                }
                            }))
                            Menu.setApplicationMenu(menu)
			} catch (e) {
                          return reject(e.message)
			}
		    	return resolve(campaignChars)
		  })
		})
		request.end()
	})
}
async function connectGameLog(gameId,userId,campaignName) {
        connectEWS(null,true)
	const cobalt = await ddb.getCobaltAuth()
        ddb.gameId = gameId
        let updateChars = () => {}
        _knownConditions = []
	requestCampaignChars(gameId,cobalt).then(chars=>{
            const charIds = chars.map(c=>c.id)
            updateChars = (chars=charIds)=>{
                if (_dmScreen) clearTimeout(_dmScreen)
                const screenTimeout = Math.floor(Math.random() * (120 - 50 + 1) + 50)
                ddb.getCampaignCharacterStatus(chars).then(found=>{
                    _win.webContents.executeJavaScript(`(()=>{
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
                            timer.innerHTML = \`Will refresh in \${countdown}s <button onclick="window.EncounterLog.Refresh()">Refresh Now</button>\`
                            if (countdown <= 0) {
                                clearInterval(interval)
                            }
                        },1000)
                        })()`).catch(e=>console.log(`Could not set timer: ${e}`))
                    if (_eWs?.readyState !== WebSocket.open)
                        connectEWS()
                    for(let f of found) {
                        let conditions = f.conditions.map(c=>`i-condition-white-${c.name.toLowerCase()}`)
                        let senses = f.senses.map(s=>`${s.name} ${s.distance}`)
                        let exhaustion = f.conditions.find(c=>c.name.toLowerCase()=="exhaustion")?.level||0
                        const token = _eTokens.filter(t=>t.reference?.startsWith('/player/')).find(t=>t.name?.trim()==f.name.trim())
                        if (token && (token.health != (f.hitPointInfo.current+f.hitPointInfo.temp) || token.hitpoints != f.hitPointInfo.maximum)) {
                            console.log(`Update ${f.name}`)
                            const model = {
                                name: "updateModel",
                                model: "token",
                                data: {
                                    id: token.id,
                                    health: f.hitPointInfo.current+f.hitPointInfo.temp,
                                    hitpoints: f.hitPointInfo.maximum
                                }
                            }
                            if (_eWs?.readyState === WebSocket.OPEN) {
                                _eWs.send(JSON.stringify(model))
                            } else {
                                connectEWS(JSON.stringify(model))
                            }
                        }
                        let knownCondition = _knownConditions.find(kc=>kc.name==f.name)
                        if (!knownCondition) {
                            _knownConditions.push({name: f.name.trim(), conditions: f.conditions})
                            if (preferences.value("main.chatconditions")?.includes("change")) {
                                for (let c of f.conditions) {
                                    const msgJson = {
                                        "source": f.name.trim(),
                                        "type":     "chat",
                                        "content": `I am ${(c.name=="Exhaustion")?`Exhausted (${c.level})`:c.name}`
                                    };
                                    _eWs.send(JSON.stringify({name: "createMessage", data: msgJson}))
                                }
                            }
                        } else {
                            if (preferences.value("main.chatconditions")?.includes("change")) {
                                for (let c of knownCondition.conditions) {
                                    if (!f.conditions.find(nc=>nc.name==c.name&&nc.level==c.level)) {
                                        const msgJson = {
                                            "source": f.name.trim(),
                                            "type":     "chat",
                                            "content": `I am no longer ${(c.name=="Exhaustion")?`Exhausted (${c.level})`:c.name}`
                                        };
                                        _eWs.send(JSON.stringify({name: "createMessage", data: msgJson}))
                                    }
                                }
                                for (let c of f.conditions) {
                                    if (!knownCondition.conditions.find(nc=>nc.name==c.name&&nc.level==c.level)) {
                                        const msgJson = {
                                            "source": f.name.trim(),
                                            "type":     "chat",
                                            "content": `I am ${(c.name=="Exhaustion")?`Exhausted (${c.level})`:c.name}`
                                        };
                                        _eWs.send(JSON.stringify({name: "createMessage", data: msgJson}))
                                    }
                                }
                            }
                            knownCondition.conditions = f.conditions
                        }
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
		if (document.querySelector('#game-log-client button')) {
			document.querySelector('#game-log-client button').style.backgroundColor = 'LimeGreen';
		}
		`,true).catch((e) => console.log(e))
            /*
		let msgJson = {
		    "source": "EncounterLog",
		    "type":     "chat",
		    "content": "Connected to D&D Beyond GameLog for " + campaignName.trim()
		};
		const request = net.request({url: encounterhost+"/api/messages",method: "POST"})
		request.on('error',e => console.error(e))
		request.write(JSON.stringify(msgJson))
		request.end()
                */
                const msgJson = {
                    "source": "EncounterLog",
                    "type":     "chat",
                    "content": "Connected to D&D Beyond GameLog for " + campaignName.trim()
                };
                if (_eWs?.readyState === WebSocket.OPEN) {
                    _eWs.send(JSON.stringify({name: "createMessage", data: msgJson}))
		    _win.webContents.executeJavaScript(`{
                        let eplusws = document.getElementById('eWsStatus')
                        if (!eplusws) {
                            eplusws = document.createElement('div')
                            eplusws.id = 'eWsStatus'
                            eplusws.style.position = 'absolute'
                            eplusws.style.top = '122px'
                            eplusws.style.right = '0'
                            eplusws.style.width = 'auto'
                            eplusws.style.zIndex = '99999999999'
                            document.body.appendChild(eplusws)
                        }
                        eplusws.innerHTML = "Connected to EncounterPlus at ${encounterhost} &#x1F7E2;"
                        }`,true).catch(e=>console.log(e))
                } else if (!encounterhost) {
                    _win.webContents.executeJavaScript(`{
                        let eplusws = document.getElementById('eWsStatus')
                        if (!eplusws) {
                            eplusws = document.createElement('div')
                            eplusws.id = 'eWsStatus'
                            eplusws.style.position = 'absolute'
                            eplusws.style.top = '122px'
                            eplusws.style.right = '0'
                            eplusws.style.width = 'auto'
                            eplusws.style.zIndex = '99999999999'
                            document.body.appendChild(eplusws)
                        }
                        eplusws.innerHTML = "EncounterPlus remote host not configured &#x1F6AB;"
                        }`,true).catch(e=>console.log(e))
                } else {
                    _win.webContents.executeJavaScript(`{
                        let eplusws = document.getElementById('eWsStatus')
                        if (!eplusws) {
                            eplusws = document.createElement('div')
                            eplusws.id = 'eWsStatus'
                            eplusws.style.position = 'absolute'
                            eplusws.style.top = '122px'
                            eplusws.style.right = '0'
                            eplusws.style.width = 'auto'
                            eplusws.style.zIndex = '99999999999'
                            document.body.appendChild(eplusws)
                        }
                        eplusws.innerHTML = "Disconnected from EncounterPlus at ${encounterhost} &#x1F534;"
                        }`,true).catch(e=>console.log(e))
                    connectEWS(JSON.stringify({name: "createMessage", data: msgJson}))
                }
            updateChars()
	})
	ws.on('close',(code,reason) => {
		console.log(`WebSocket closed: ${reason} (${code})`)
                if (_dmScreen) clearTimeout(_dmScreen)
		_win?.webContents?.executeJavaScript(`
		if (document.querySelector('#game-log-client button')) {
			document.querySelector('#game-log-client button').style.backgroundColor = 'Crimson';
		}
		`,true).catch((e) => console.log(e))
		if (_ws?.pingInterval) clearInterval(_ws.pingInterval);
		if (code == 1001 && !_ws.isDisconnecting) {
			setTimeout(() => connectGameLog(gameId,userId,campaignName),1000)
                }
		_ws = null
		let msgJson = {
		    "source": "EncounterLog",
		    "type":     "chat",
		    "content": "Disconnected from D&D Beyond GameLog for " + campaignName.trim()
		};
                if (_eWs?.readyState === WebSocket.OPEN) {
                    _eWs.send(JSON.stringify({name: "createMessage", data: msgJson}))
                } else {
                    connectEWS(JSON.stringify({name: "createMessage", data: msgJson}))
                }
	})
	ws.on('error',(e) => console.log(e))
        const msgEvent = (data,isBin) => {
                try {
		    const msgData = JSON.parse(data.toString()
                        .replaceAll(/\x18/g,"\u2018")
                        .replaceAll(/\x19/g,"\u2019")
                        .replaceAll(/\x1a/g,"\u201a")
                        .replaceAll(/\x1b/g,"\u201b")
                        .replaceAll(/\x1c/g,"\u201c")
                        .replaceAll(/\x1d/g,"\u201d")
                        .replaceAll(/\x1e/g,"\u201e")
                        .replaceAll(/\x1f/g,"\u201f")
                    )
                    if (msgData.eventType == "character-sheet/character-update/fulfilled") {
                        if (msgData.data.characterId) updateChars([msgData.data.characterId])
                        return;
                    }
                    if (msgData.eventType != "dice/roll/fulfilled") {
                        return
                    }
                    if (data.toString().match(/\uFFFD/u)) {
                        console.log("Junk characters detected")
                        ddb.getCobaltAuth().then(()=>{
                            ddb.getRequest(`https://game-log-rest-live.dndbeyond.com/v1/getmessages?gameId=${gameId}&userId=${userId}`,true).then(msgs=>{
                                const msg = msgs?.data?.find(m=>m.id==msgData.id)
                                if (msg) {
                                    msgEvent(Buffer.from(JSON.stringify(msg)),false)
                                } else {
                                    throw("Roll not in log yet. Retrying")
                                }
                            }).catch(e=>{
                                console.log(`Could not retrieve active log: ${e}`);
                                (() => new Promise(resolve => setTimeout(resolve, 500)))().then(()=>{
                                    ddb.getRequest(`https://game-log-rest-live.dndbeyond.com/v1/getmessages?gameId=${gameId}&userId=${userId}`,true).then(msgs=>{
                                        const msg = msgs?.data?.find(m=>m.id==msgData.id)
                                        if (msg) {
                                            msgEvent(Buffer.from(JSON.stringify(msg)),false)
                                        } else {
                                            console.log("Roll not in log...")
                                        }
                                    }).catch(e=>console.log(`Could not retrieve active log: ${e}`))
                                })
                            })
                        })
                        return
                    }
                    var character = msgData.data.context.name?.trim() || ""
                    //if (character == "") {
                            for (var cchar of campaignChars) {
                                    if (cchar.id.toString() == msgData.data.context.entityId) {
                                            character = cchar.name.trim()
                                            break
                                    }
                            }
                    //}
                    if (!ignored.includes(character)) {
                            for (var roll of msgData.data.rolls) {
                                //{"diceNotation":{"set":[{"count":1,"dieType":"d4","dice":[{"dieType":"d4","dieValue":1}],"operation":0}],"constant":1},"rollType":"damage","rollKind":"","result":{"constant":1,"values":[1],"total":2,"text":"1+1"}}
                                let formula = roll.diceNotation?.set?.map(m=>{
                                        return `${m.count||''}${m.dieType||''}`
                                    })?.join('+')
                                    if (roll.diceNotation?.constant != 0) {
                                        formula += `${roll.diceNotation.constant<0?'':'+'}${roll.diceNotation.constant}`
                                    }
                                    let rollJson = {
                                        "source": character,
                                        "type":     "roll",
                                        "content": {
                                                "formula": formula || "",
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
                                    if (_eWs?.readyState === WebSocket.OPEN) {
                                        _eWs?.send(JSON.stringify({name: "createMessage", data: rollJson}))
                                    } else {
                                        connectEWS(JSON.stringify({name: "createMessage", data: rollJson}))
                                    }
                            }
                    }
                } catch (e) {
                    console.log("Error",e.message)
                    console.log(e)
                    console.log(data.toString())
                    console.log(Buffer.from(e.message).toString('hex'))
                    console.log(Buffer.from(data).toString('hex'))
                    return
                }

	}
        ws.on('message',msgEvent)
}

function getEAPI () {
    if (!encounterhost) return
    const request = net.request({url: (new URL("api",encounterhost)).href,method: "GET"})
    request.on('error',e=>console.log(e))
    request.on('response',r=>{
        if (r.statusCode == 200) {
            let body = ''
            r.on('end',()=>{
                try {
                    const eAPI = JSON.parse(body)
                    _eTokens = eAPI?.map?.tokens || []
                    _eCreatures = eAPI?.game?.creatures || []
                } catch (e) {
                    console.log(`API Error: ${e}`)
                    console.log(body)
                    _eTokens = []
                }
            })
            r.on('data',c=>body+=c.toString())
        } else {
            console.log(`API Error: ${r.statusMessage}`)
        }
    })
    request.end()
}
function connectEWS(msg=null,initial=false) {
    if (!encounterhost) {
        if (initial) {
            dialog.showMessageBox(_win,{
                title: "No Remote Host Set",
                message: "EncounterPlus remote host not set.",
                detail: "EncounterLog will not be able to send dice rolls or health updates to EncounterPlus.\nPlease set the EncounterPlus remote host in Preferences, then reload this page.",
                type: "warning"
            })
        }
        return
    }
    getEAPI()
    if (!_eWs || _eWs.readyState !== WebSocket.OPEN) {
        let epWs = new URL("ws",encounterhost)
        epWs.protocol = epWs.protocol.replace("http","ws")
        _eWs = new WebSocket(epWs.href)
        _eWs.on('error',(e)=>{
            console.log(e)
            if (_eWsDelay < 60000) {
                _eWsDelay += 1000;
            }
            console.log(`Increasing delay to ${_eWsDelay/1000}`)
        })
        _eWs.on('open',() => {
            console.log("Connected to E+")
            _eWsDelay = 1000;
            _win.webContents.executeJavaScript(`{
                let eplusws = document.getElementById('eWsStatus')
                if (!eplusws) {
                    eplusws = document.createElement('div')
                    eplusws.id = 'eWsStatus'
                    eplusws.style.position = 'absolute'
                    eplusws.style.top = '122px'
                    eplusws.style.right = '0'
                    eplusws.style.width = 'auto'
                    eplusws.style.zIndex = '99999999999'
                    document.body.appendChild(eplusws)
                }
                eplusws.innerHTML = "Connected to EncounterPlus at ${encounterhost} &#x1F7E2;"
                }`,true).catch(e=>console.log(e))
            _eWs.on('message',(data)=>{
                const msg = JSON.parse(data)
                if (msg?.name == 'tokensUpdated') {
                    _eTokens = msg.data
                } else if (msg?.name == 'tokenUpdated') {
                    let token = _eTokens.findIndex(t=>t.id==msg.data.id)
                    if (token>=0)
                        _eTokens[token] = msg.data
                } else if (msg?.name == 'creatureUpdated') {
                    let creature = _eCreatures.findIndex(t=>t.id==msg.data.id)
                    if (creature>=0)
                        _eCreatures[creature] = msg.data
                } else if (msg?.name == 'gameUpdated' && msg?.data.started) {
                    const game = msg?.data
                    const active = _eCreatures.filter( creature => { return creature.initiative != -10 } ).sort((a, b) => (a.rank > b.rank  ) ? 1 : -1)
                    const current = active[game.turn-1]
                    if (current && preferences.value("main.chatconditions")?.includes("turn")) {
                        const knownCondition = _knownConditions.find(kc=>kc.name==current.name?.trim())
                        if (knownCondition && knownCondition.conditions) {
                            if (knownCondition.old) {
                                for(c of knownCondition.old) {
                                    if (!knownCondition.conditions.find(nc=>nc.name==c.name&&nc.level==c.level)) {
                                        const msgJson = {
                                            "source": current.name.trim(),
                                            "type":     "chat",
                                            "content": `I am no longer ${(c.name=="Exhaustion")?`Exhausted (${c.level})`:c.name}`
                                        };
                                        _eWs.send(JSON.stringify({name: "createMessage", data: msgJson}))
                                    }
                                }
                            }
                            knownCondition.old = JSON.parse(JSON.stringify(knownCondition.conditions))
                            for (c of knownCondition.conditions) {
                                const msgJson = {
                                    "source": current.name.trim(),
                                    "type":     "chat",
                                    "content": `I am ${(c.name=="Exhaustion")?`Exhausted (${c.level})`:c.name}`
                                };
                                _eWs.send(JSON.stringify({name: "createMessage", data: msgJson}))
                            }
                        }
                    }
                } else if (msg?.name == 'mapUpdated' || msg?.name == 'mapLoaded') {
                    getEAPI()
                }
            })
        })
        _eWs.on('close',(code,reason) => {
            _win.webContents.executeJavaScript(`{
                let eplusws = document.getElementById('eWsStatus')
                if (!eplusws) {
                    eplusws = document.createElement('div')
                    eplusws.id = 'eWsStatus'
                    eplusws.style.position = 'absolute'
                    eplusws.style.top = '122px'
                    eplusws.style.right = '0'
                    eplusws.style.width = 'auto'
                    eplusws.style.zIndex = '99999999999'
                    document.body.appendChild(eplusws)
                }
                eplusws.innerHTML = "Disconnected from EncounterPlus at ${encounterhost} &#x1F534;"
                }`,true).catch(e=>console.log(e))
            if (!_ws?.isDisconnecting) {
                    setTimeout(connectEWS,_eWsDelay)
            }
        })
        if (msg)
            _eWs.once('open',()=>_eWs.send(msg))
    }
}
