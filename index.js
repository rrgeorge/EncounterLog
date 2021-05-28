const {app, session, BrowserWindow, ipcMain, net, Menu, MenuItem} = require('electron')
const ElectronPreferences = require('electron-preferences');
const WebSocket = require('ws')
const path = require('path');
var _ws = null
var _win = null

app.userAgentFallback = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:88.0) Gecko/20100101 Firefox/88.0'
var ignored = []
var campaignChars = []
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
	} ]
})
encounterhost = preferences.value('main.encounterhost');
preferences.on('save', (preferences) => {
	encounterhost = preferences.main.encounterhost
})
app.on('ready', () => {
	const win = new BrowserWindow({ width: 800, height: 600, webPreferences: {nodeIntegration: true, contextIsolation: false,nativeWindowOpen: true} })
	_win = win
	  var menu = Menu.buildFromTemplate([
	      {
		  label: 'File',
		  submenu: [
			{'click': function() { preferences.show() },'label': "Preferences"},
		      	{role:'quit'}
		  ]
	      }
	  ])
	  Menu.setApplicationMenu(menu);
	win.loadURL('https://www.dndbeyond.com/my-campaigns');
	win.webContents.on('did-finish-load',event => {
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
	})
	win.on('beforeunload',() => {
		if (_ws !== null) {
			_ws.isDisconnecting = true
			_ws.close(1001,"Going away")
		}
		win.loadURL('https://www.dndbeyond.com/my-campaigns')
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

async function getCobaltAuth() {
	try {
		const cobaltauth = await requestAuthToken()
		return cobaltauth.token
	} catch (e) {
		console.log(`Error: ${cobaltauth}`)
		return null
	}
}
function requestAuthToken() {
	return new Promise((resolve,reject) => {
		const url = "https://auth-service.dndbeyond.com/v1/cobalt-token"
		const request = net.request({url: url,useSessionCookies: true,method: "POST"})
		let body = ''
		request.on('response', (response) => {
		  if (response.statusCode != 200) {
			  reject(response.StatusCode)
		  }
		  response.on('data', (chunk) => {
		    body += chunk.toString()
		  })
		  response.on('end', () => {
		    resolve(JSON.parse(body))
		  })
		})
		request.write('')
		request.end()
	})
}
function requestCampaignChars(gameId,cobalt) {
	return new Promise((resolve,reject) => {
		const url = `https://www.dndbeyond.com/api/campaign/stt/active-characters/${gameId}`
		const request = net.request({url: url,useSessionCookies: true})
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
	const cobalt = await getCobaltAuth()
	requestCampaignChars(gameId,cobalt)
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
		_win.webContents.executeJavaScript(`
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
		const msgData = JSON.parse(data)
		var character = msgData.data.context.name?.trim() || ""
		if (character == "") {
			for (var cchar of campaignChars) {
				if (cchar.id.toString() == msgData.data.context.entityId) {
					character = cchar.name.trim()
					break
				}
			}
		}
		if (msgData.eventType == "dice/roll/fulfilled" && !ignored.includes(character)) {
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
	})
}
