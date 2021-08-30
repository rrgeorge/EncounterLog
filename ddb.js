const { net, session, app, dialog } = require('electron')
const qs = require('querystring')
const ProgressBar = require('electron-progressbar')
const Slugify = require('slugify')
const { v5: uuid5 } = require('uuid')
const he = require('he')
const { convert } = require('html-to-text')
const { toXML } = require('jstoxml')
const AdmZip = require('adm-zip')
const sharp = require('sharp')
const {download} = require("electron-dl")
const sqlite3 = require('@journeyapps/sqlcipher').verbose()
const tmp = require('tmp')
const path = require('path')
const url = require('url')
const vision = require('@google-cloud/vision');

function slugify(str) {
    return Slugify(str,{ lower: true, strict: true })
}
function sanitize(text,rulesdata=null) {
    return convert(text,{
        wordwrap: null,
        formatters: {
            'keepA': function (elem, walk, builder, formatOptions) {
                if (rulesdata) {
                    var ddburl = elem?.attribs?.href?.match(/https:\/\/(?:www\.)?dndbeyond\.com\/(sources\/[^\/]*)/)
                    if (ddburl) {
                        var source = rulesdata.sources?.find(s=>s.sourceURL==ddburl[1])
                        if (source) {
                            elem.attribs.href=elem.attribs.href.replaceAll(new RegExp(`https:\/\/(?:www\.)?dndbeyond\.com\/${source.sourceURL}`,'g'),`/module/${source.name.toLowerCase()}/page`)
                        }
                    }
                }
                builder.addInline(`<${elem.name} href="${elem.attribs.href}">`);
                walk(elem.children, builder);
                builder.addInline('</a>');
            },
            'bold': function (elem, walk, builder, formatOptions) {
                builder.addInline(`<b>`);
                walk(elem.children, builder);
                builder.addInline('</b>');
            },
            'italic': function (elem, walk, builder, formatOptions) {
                builder.addInline(`<i>`);
                walk(elem.children, builder);
                builder.addInline('</i>');
            },
            'underline': function (elem, walk, builder, formatOptions) {
                builder.addInline(`<u>`);
                walk(elem.children, builder);
                builder.addInline('</u>');
            },
            'quote': function (elem, walk, builder, formatOptions) {
		builder.openBlock({leadingLineBreaks:1});
                builder.addInline('-'.repeat(40));
		walk(elem.children, builder);
                builder.addInline('-'.repeat(40));
 		builder.closeBlock({trailingLineBreaks:1});
            }
        },
        selectors: [
            {selector: 'table', format: 'dataTable', options: { maxColumnWidth: 20 }},
            {selector: 'a',format: 'keepA'},
            {selector: 'b',format: 'bold'},
            {selector: 'strong',format: 'bold'},
            {selector: 'i',format: 'italic'},
            {selector: 'em',format: 'italic'},
            {selector: 'u',format: 'underline'},
            {selector: 'blockquote',format: 'quote'}
        ]
    })
}

class DDB {
    searchCookies() {
	return new Promise((resolve,reject) => {
	    session.defaultSession.cookies.get({})
		.then(cookies => {
		    for(var cookie of cookies) {
			if (cookie.name == "CobaltSession") {
			    resolve(cookie.value)
                            break
			}
		    }
                    reject(null)
	        })
	})
    }

    async setCobaltSession() {
        const sess = await this.searchCookies().catch(e => console.log(e))
        this.cobaltsession = sess
    }
    async getUserData() {
        if (!this.cobaltsession) await this.setCobaltSession()
        const url = "https://www.dndbeyond.com/mobile/api/v6/user-data"
        const body = qs.stringify({ 'token': this.cobaltsession })
        const res = await this.postRequest(url,body).catch(e => console.log(`Could not populate userdata: ${e}`))
        this.userId = res?.userId
    }
    async getRuleData() {
        //const url = "https://character-service.dndbeyond.com/character/v4/rule-data"
        if (!this.cobaltauth) await this.getCobaltAuth()
        const url = "https://www.dndbeyond.com/api/config/json"
        const res = await this.getRequest(url,true).catch(e => console.log(`Could not retrieve rule data: ${e}`))
        this.ruledata = res
    }
    async getCobaltAuth() {
        try {
                if (this.expiration <= new Date().getTime()) {
                    const cobalt = await this.postRequest("https://auth-service.dndbeyond.com/v1/cobalt-token")
                    this.cobaltauth = cobalt.token
                    this.expiration = new Date(new Date().getTime()+(cobalt.ttl*1000)).getTime()
                    console.log(`Expiration is ${this.expiration}`)
                }
                return this.cobaltauth
        } catch (e) {
                console.log(`Error: ${e}`)
                return null
        }
    }

    postRequest(url,postbody='',auth=false) {
            return new Promise((resolve,reject) => {
                    const request = net.request({url: url,useSessionCookies: true,method: "POST"})
                    request.setHeader('Content-Type', "application/x-www-form-urlencoded")
                    if (auth) {
		        request.setHeader('Authorization',`Bearer ${this.cobaltauth}`)
                    }
                    request.on('response', (response) => {
                      let body = ''
                      if (response.statusCode != 200) {
                              reject(response.statusCode)
                      }
                      response.on('data', (chunk) => {
                        body += chunk.toString()
                      })
                      response.on('end', () => {
                        try{
                            resolve(JSON.parse(body))
                        } catch(e) {
                            reject(e)
                        }
                      })
                    })
                    request.write(postbody)
                    request.end()
            })
    }

    getRequest(url,auth=false) {
            return new Promise((resolve,reject) => {
                    const request = net.request({url: url,useSessionCookies: true})
                    if (auth) {
		        request.setHeader('Authorization',`Bearer ${this.cobaltauth}`)
                    }
                    request.on('response', (response) => {
                      let body = ''
                      if (response.statusCode != 200) {
                              reject(response.statusCode)
                      }
                      response.on('data', (chunk) => {
                        body += chunk.toString()
                      })
                      response.on('end', () => {
                        try{
                            resolve(JSON.parse(body))
                        } catch(e) {
                            reject(e)
                        }
                      })
                    })
                    request.end()
            })
    }

    getImage(url,auth=false) {
            return new Promise((resolve,reject) => {
                    const request = net.request({url: url,useSessionCookies: true,})
                    if (auth) {
		        request.setHeader('Authorization',`Bearer ${this.cobaltauth}`)
                    }
                    request.on('response', (response) => {
                      let body = new Buffer.alloc(0)
                      if (response.statusCode != 200) {
                              reject(response.statusCode)
                      }
                      response.on('data', (chunk) => {
                        body = Buffer.concat([body,chunk])
                      })
                      response.on('end', () => {
                        try{
                            resolve(body)
                        } catch(e) {
                            reject(e)
                        }
                      })
                    })
                    request.on('error',(e)=>reject(e))
                    request.end(null, null)
            })
    }

    async populateCampaigns() {
        const url = "https://www.dndbeyond.com/api/campaign/active-campaigns"
        const res = await this.getRequest(url).catch(e => console.log(`Could not populate campaings: ${e}`))
        this.campaigns = res?.data || []
    }
    async getSources() {
        if (!this.cobaltsession) await this.setCobaltSession()
        const url = "https://www.dndbeyond.com/mobile/api/v6/available-user-content"
        const body = qs.stringify({ 'token': this.cobaltsession })
        const sources = await this.postRequest(url,body).then(r => r.data).catch(e =>{ throw new Error(`Cannot retrieve avaialable sources: ${e}`)})
        if (!this.ruledata) await this.getRuleData().catch(e=>{throw new Error(e)})
        const books = sources.Licenses.filter(f => f.EntityTypeID == "496802664")
                .map((block) =>
                    block.Entities
                      .filter((b) => b.isOwned)
                      .filter(f=>![4,26,29,30,31,53,42].includes(f.id))
                      .filter((b) => this.ruledata.sources.some((s)  => b.id === s.id && s.isReleased))
                      .map((b) => {
                        const book = this.ruledata.sources.find((s)  => b.id === s.id);
                        return {
                          id: b.id,
                          book: book.description,
                          bookCode: book.name,
                          category: book.sourceCategoryId,
                          url: `https://www.dndbeyond.com/${book.sourceURL}`
                        };
                      })
                  )
                .flat()
        const shared = sources.Licenses.filter((f) => f.EntityTypeID == "496802664")
                .map((block) =>
                    block.Entities
                      .filter((b) => !b.isOwned)
                      .filter(f=>![4,26,29,30,31,53,42].includes(f.id))
                      .filter((b) => this.ruledata.sources.some((s)  => b.id === s.id && s.isReleased))
                      .map((b) => {
                        const book = this.ruledata.sources.find((s)  => b.id === s.id);
                        return {
                          id: b.id,
                          book: book.description,
                          bookCode: book.name,
                          category: book.sourceCategoryId,
                          url: `https://www.dndbeyond.com/${book.sourceURL}`
                        };
                      })
                  )
                .flat()
        this.books = books
        this.sharedBooks = shared
    }
    async getClassList(prog=null) {
        const cparams = qs.stringify({ 'sharingSetting': 2 })
        const curl = "https://character-service.dndbeyond.com/character/v5/game-data/classes"
        const classes = await this.getRequest(`${curl}?${cparams}`,true).catch((e)=>console.log(`Error getting classess: ${e}`))
        var classlist = []
        if (prog) {
            prog.detail = `Retrieving class list`
        }
        if (classes?.data) {
            for (const aClass of classes.data) {
                if (aClass.canCastSpells) {
                    if (prog) {
                        prog.detail = `Retrieving class list ${aClass.name}`
                    }
                    classlist.push({
                        id: aClass.id, name: aClass.name, prep: aClass.spellPrepareType
                    })
                }
                const sparams = qs.stringify({ 'sharingSetting': 2, 'baseClassId': aClass.id })
                const surl = "https://character-service.dndbeyond.com/character/v5/game-data/subclasses"
                const subclasses = await this.getRequest(`${surl}?${sparams}`,true).catch((e)=>console.log(`Error getting ${aClass.name} subclassess: ${e}`))
                if (subclasses?.data) {
                    for (const subClass of subclasses.data) {
                        if (aClass.canCastSpells || subClass.canCastSpells) {
                            if (prog) {
                                prog.detail = `Retrieving class list ${aClass.name}/${subClass.name}`
                            }
                            classlist.push({
                                id: subClass.id, name: `${aClass.name}/${subClass.name}`, prep: subClass.spellPrepareType, baseClass: aClass.name
                            })
                        }
                    }
                }
            }
        }
        this.classlist = classlist
        return classlist
    }
    async getAllSpells(prog=null) {
        const urls = [ "https://character-service.dndbeyond.com/character/v5/game-data/spells",
            "https://character-service.dndbeyond.com/character/v5/game-data/always-known-spells",
            "https://character-service.dndbeyond.com/character/v5/game-data/always-prepared-spells"]
        if (!this.ruledata) await this.getRuleData()
        if (!this.cobaltauth) await this.getCobaltAuth()
        let allSpells = []
        if (!this.classlist) await this.getClassList(prog)
        for (const ddbClass of this.classlist) {
            if (prog) {
                prog.detail = `Retrieving spells for ${ddbClass.name}`
            }
            console.log(`Retrieving spells for ${ddbClass.name}`)
            //if (/(ua|archived)/i.test(ddbClass.name)) continue
            let requests = []
            for (const url of urls) {
                const params = qs.stringify({ 'sharingSetting': 2, 'classId': ddbClass.id, "classLevel": 20 })
                //const response = await 
                requests.push(
                    this.getRequest(`${url}?${params}`,true).catch((e)=>console.log(`Error getting spells: ${e}`))
                )
            }
            const allResponses = await Promise.all(requests)
            for(const response of allResponses) {
                if (response?.data) {
                    for (let spell of response.data) {
                        let existing = allSpells.find(s=>s.id===spell.definition.id)
                        if (existing) {
                            if (!existing.classes.includes(ddbClass.name)) {
                                if (!ddbClass.baseClass || !existing.classes.includes(ddbClass.baseClass)) {
                                    existing.classes.push(ddbClass.name)
                                    existing.classes.sort((a,b)=>{
                                        if (a.includes('/') && !b.includes('/')) {
                                            return 1
                                        } else if (b.includes('/') && !a.includes('/')) {
                                            return -1
                                        } else if (a.startsWith('Blood') && !b.startsWith('Blood')) {
                                            return 1
                                        } else if (b.startsWith('Blood') && !a.startsWith('Blood')) {
                                            return -1
                                        } else {
                                            return a<b
                                        }
                                    })
                                }
                            }
                        } else {
                            let newSpell = spell.definition
                            newSpell.classes = [ddbClass.name]
                            allSpells.push(newSpell)
                        }
                    }
                }
            }
            if (prog) {
                prog.value += (1/this.classlist.length)*10
            }
        }
        return allSpells
    }

    async getSpells(source=null,filename,zip=null,prog=null,homebrew=false) {
        const spellSchools = [
            { code: "A", name: "abjuration" },
            { code: "C", name: "conjuration" },
            { code: "D", name: "divination" },
            { code: "EN", name: "enchantment" },
            { code: "EV", name: "evocation" },
            { code: "I", name: "illusion" },
            { code: "N", name: "necromancy" },
            { code: "T", name: "transmutation" }
        ]
        if(!prog) prog = new ProgressBar({title: "Please wait...", text: "Converting spells...", detail: "Please wait...", indeterminate: false, maxValue: 100})
        const allSpells = await this.getAllSpells(prog)
        const spells = allSpells.filter(s=>(source)?s.sources.some(b=>(source===10&&(b.sourceId===10||b.sourceId===4))||b.sourceId===source):!s.sources.some(b=>b.sourceId===29))
        if (filename) zip = new AdmZip()
        var compendium = { 
            _name: "compendium",
            _content: []
        }
        for (let spell of spells) {
            prog.detail = spell.name
            if (filename) {
                prog.value += (1/spells.length)*90
            } else {
                prog.value += (1/spells.length)*5
            }
            if (spell.isHomebrew !== homebrew) {
                continue
            }
            var spellEntry = {
                _name: "spell",
                _attrs: { id: uuid5(`ddb://spells/${spell.id}`,uuid5.URL) },
                _content: [
                    {name: spell.name},
                    {slug: slugify(spell.name)},
                    {level: spell.level},
                    {school: spellSchools.find(s=>s.name==spell.school.toLowerCase())?.code||spell.school},
                    {ritual: (spell.ritual)?'YES':"NO"},
                    {time: `${spell.activation.activationTime} ${this.ruledata.activationTypes.find(s=>s.id==spell.activation.activationType)?.name}`},
                    {classes: spell.classes.join(",")},
                ]
            }
            let components = []
            for (let component of spell.components) {
                let code = this.ruledata.spellComponents.find(s=>s.id===component).shortName
                if (code == 'M' && spell.componentsDescription) code += ` (${spell.componentsDescription})`
                components.push(code)
            }
            spellEntry._content.push({components: components.join(", ")})
            if (!spell.duration.durationUnit) {
                spellEntry._content.push({duration: spell.duration.durationType})
            } else if (spell.duration.durationType == "Time") {
                spellEntry._content.push({duration: `${spell.duration.durationInterval} ${spell.duration.durationUnit}${(spell.duration.durationInterval>1)?"s":""}`})
            } else {
                spellEntry._content.push({duration: `${spell.duration.durationType}, ${spell.duration.durationInterval} ${spell.duration.durationUnit}${(spell.duration.durationInterval>1)?"s":""}`})
            }
            let range
            if (spell.range.origin == "Ranged") {
                range =`${spell.range.rangeValue} ft`
            } else if (spell.range.origin == "Self" && spell.range.rangeValue) {
                range =`${spell.range.origin} (${spell.range.rangeValue} ft radius)`
            } else {
                range = spell.range.origin
            }
            if (spell.range.aoeType && spell.range.aoeValue) range += ` (${spell.range.aoeValue} ft ${spell.range.aoeType})`
            spellEntry._content.push({range: range})
            let description = sanitize(spell.description,this.ruledata)
            let sources = []
            for (let source of spell.sources) {
                let sourceName = this.ruledata.sources.find(s=>s.id===source.sourceId)?.description
                sources.push((source.pageNumber)?`${sourceName} p. ${source.pageNumber}`:sourceName)
            }
            if (sources.length>0) description += `\n<i>Source: ${sources.join(', ')}</i>`
            spellEntry._content.push({text: description})
            spellEntry._content.push({source: sources.join(", ")})
            compendium._content.push(spellEntry)
        }
        if (filename) {
            if (compendium._content.length === 0) {
                dialog.showMessageBox({message:"No spells are available from this source.",type:"info"})
                    .then(prog.setCompleted())
                return
            }
            prog.detail = `Creating XML`
            var compendiumXML = toXML(compendium,{indent:'\t'})
            await zip.addFile("compendium.xml",Buffer.from(compendiumXML,'utf8'),null)
            prog.detail = `Writing compendium file`
            zip.writeZip(filename)
            prog.detail = `Saved compendium`
            setTimeout(()=>prog.setCompleted(),1000)
        }
        return compendium
    }

    async getItems(source=null,filename,zip=null,imageMap=null,prog=null,homebrew=false) {
        const itemTypeCodes = [
            { code: "AA", names: [ "armor" ] },
            { code: "WW", names: [ "weapon" ] },
            { code: "LA", names: [ "light armor" ] },
            { code: "MA", names: [ "medium armor" ] },
            { code: "HA", names: [ "heavy armor" ] },
            { code: "S", names: [ "shield" ] },
            { code: "M", names: [ "melee weapon" ] },
            { code: "R", names: [ "ranged weapon" ] },
            { code: "A", names: [ "ammunition" ] },
            { code: "RD", names: [ "rod" ] },
            { code: "ST", names: [ "staff" ] },
            { code: "WD", names: [ "wand" ] },
            { code: "RG", names: [ "ring" ] },
            { code: "P", names: [ "potion" ] },
            { code: "SC", names: [ "scroll" ] },
            { code: "W", names: [ "wondrous item" ] },
            { code: "G", names: [ "adventuring gear" ] },
            { code: "$", names: [ "wealth","gemstone" ] },
        ]
        const url = "https://character-service.dndbeyond.com/character/v4/game-data/items"
        const params = qs.stringify({ 'sharingSetting': 2 })
        await this.getCobaltAuth()
        const response = await this.getRequest(`${url}?${params}`,true).catch((e)=>console.log(`Error getting items: ${e}`))
        if (response?.data) {
            const items = response.data.filter(s=>(source)?(s.sources.some(b=>b.sourceId===source&&b.sourceId!==29)||(source<=2&&s.sources.length==0)):true)
            if (!prog) prog = new ProgressBar({title: "Please wait...",text: "Converting items...", detail: "Please wait...", indeterminate: false, maxValue: items.length})
            if (filename) zip = new AdmZip()
            var compendium = { 
                _name: "compendium",
                _content: []
            }
            for (const item of items) {
                if (item.isHomebrew !== homebrew) {
                    prog.value += (!filename)? (15*(1/items.length)) : 1
                    continue
                }
                prog.detail = item.name
                let itemurl = "ddb://"
                let itemType = "Item"
                if (item.magic) {
                    itemurl += "magicitems"
                } else if (item.baseTypeId==this.ruledata.baseTypeArmorId) {
                    itemurl += "armor"
                } else if (item.baseTypeId==this.ruledata.baseTypeWeaponId) {
                    itemurl += "weapon"
                } else {
                    itemurl += "adventuring-gear"
                }
                var itemEntry = {
                    _name: "item",
                    _attrs: { id: uuid5(`${itemurl}/${item.id}`,uuid5.URL) },
                    _content: [
                        {name: (items.some(s=>s.groupedId===item.id))? `${item.name} (Group)` : item.name},
			{slug: slugify(item.name)},
			{value: item.cost||''},
			{weight: item.weight||''},
			{rarity: item.rarity||''},
                    ]
                }
                if (item.canAttune) {
                    let attunement = "requires attunement"
                    if (item.attunementDescription) attunement += ` by a ${item.attunementDescription}`
                    itemEntry._content.push({attune: attunement})
                }
                let type = ((item.baseTypeId==this.ruledata.baseTypeArmorId)? "AA" :
                        (item.baseTypeId==this.ruledata.baseTypeWeaponId)? "WW" :
                        (item.baseTypeId==this.ruledata.baseTypeGearId)? "G" : null)
                if (type == "AA") {
                    itemType = "Armor"
                    type = itemTypeCodes.find(s=>s.names.some(n=>n==this.ruledata.armorTypes.find(n=>n.id===item.armorTypeId)?.name.toLowerCase()))?.code || type
                    let ac = item.armorClass
                    for (let mod of item.grantedModifiers) {
                        if (mod.type=="bonus" && mod.subType=="armor-class") {
                            ac += mod.value
                        }
                    }
                    itemEntry._content.push({ac: ac||''})
                } else if (type == "WW") {
                    itemType = "Weapon"
                    type = itemTypeCodes.find(s=>s.names.some(n=>(n==this.ruledata.weaponCategories.find(n=>n.id===item.categoryId)||n==item.type.toLowerCase())))?.code || type
                    if (type == "WW" && item.attackType) {
                        type = (item.attackType == 2)? "R" : "M"
                    }
                    if ( item.damage
                        || item.grantedModifiers.some(s=>(s.type=="bonus"&&s.subType=="magic"))
                        || item.grantedModifiers.some(s=>(s.type=="damage"))
                        ) {
                        let damage = []
                        if (item.damage?.diceString) damage.push(item.damage.diceString)
                        for (let mod of item.grantedModifiers) {
                            if (mod.type == "bonus" && mod.subType == "magic") {
                                if (mod.value) damage.push((mod.value>0)?`+${mod.value}`:mod.value.toString())
                            } else if (mod.type=="damage") {
                                if (mod.value) damage.push(`(${mod.dice?.diceString||((mod.value>0)?"+"+mod.value.toString():mod.value.toString())} ${mod.subType})`)
                            }
                        }
                        itemEntry._content.push({dmg1: damage.join(" ") })
                    }
                    let props = []
                    for (let prop of item.properties) {
                        switch(prop.name) {
                            case "Loading":
                                props.push("LD"); break
                            case "Range":
                                props.push("RN"); break
                            case "Two-Handed":
                                props.push("2H"); break
                            case "Versatile":
                                props.push("V"); itemEntry._content.push({dmg2: prop.notes}); break
                            default:
                                props.push(prop.name[0])
                        }
                    }
                    if (props.length > 0) itemEntry._content.push({property: props.join(",")})
                    if (item.damageType) {
                        itemEntry._content.push({dmgType: item.damageType[0] })
                    }
                } else {
                    type = itemTypeCodes.find(s=>s.names.some(n=>n==item.type?.toLowerCase()||n==item.subType?.toLowerCase()))?.code || type
                }
                itemEntry._content.push({type: type})
                let description = sanitize(item.description,this.ruledata)
                if (items.some(s=>s.groupedId===item.id)) {
                    let linkedItems = items.filter(s=>s.groupedId===item.id)
                    description += `\nApplicable ${itemType}${(itemType!="Armor"&&linkedItems.length>1)?'s':''}\n`
                    for (let linked of linkedItems) {
                        let linkedurl = "ddb://"
                        if (linked.magic) {
                            linkedurl += "magicitems"
                        } else if (linked.baseTypeId==this.ruledata.baseTypeArmorId) {
                            linkedurl += "armor"
                        } else if (linked.baseTypeId==this.ruledata.baseTypeWeaponId) {
                            linkedurl += "weapon"
                        } else {
                            linkedurl += "adventuring-gear"
                        }
                        let linkedId = uuid5(`${linkedurl}/${linked.id}`,uuid5.URL)
                        description += `<a href="/item/${linkedId}">${linked.name}</a>\n`
                    }
                }
                let sources = []
                for (let source of item.sources) {
                    let sourceName = this.ruledata.sources.find(s=>s.id===source.sourceId)?.description
                    sources.push((source.pageNumber)?`${sourceName} p. ${source.pageNumber}`:sourceName)
                }
                if (sources.length>0) description += `\n<i>Source: ${sources.join(', ')}</i>`
		itemEntry._content.push({text: description})
		itemEntry._content.push({source: sources.join(", ")})
                try{
                    item.avatarUrl = imageMap?.find(s=>s.id===item.id&&s.type===item.entityTypeId)?.avatar || item.avatarUrl
                    item.largeAvatarUrl = imageMap?.find(s=>s.id===item.id&&s.type===item.entityTypeId)?.largeAvatar || item.largeAvatarUrl
                    if ((item.largeAvatarUrl||item.avatarUrl)&&this.art?.includes('artwork')) {
                        var imageFile = `${uuid5(item.largeAvatarUrl||item.avatarUrl,uuid5.URL)}${path.extname(item.largeAvatarUrl||item.avatarUrl)}`
                        if (!zip.getEntry(`items/${imageFile}`)) {
                            if ((item.avatarUrl||item.largeAvatarUrl).startsWith("listing_images/")) {
                                await zip.addFile(`items/${imageFile}`,zip.readFile((item.largeAvatarUrl||item.avatarUrl)))
                                zip.deleteFile(item.avatarUrl||item.largeAvatarUrl)
                            } else {
                                let imagesrc = await this.getImage(item.largeAvatarUrl||item.avatarUrl).catch(e=>console.log(`Could not retrieve image: ${e}`))
                                imageFile = `${path.basename(imageFile,path.extname(imageFile))}.webp`
                                let image = await sharp(imagesrc).webp().toBuffer()
                                await zip.addFile(`items/${imageFile}`,image)
                            }
                        }
                        itemEntry._content.push( { image: `${imageFile}` } )
                    }
                } catch (e) {
                    console.log(`Could not load item image: ${e}`)
                }
                compendium._content.push(itemEntry)
                prog.value += (!filename)? (15*(1/items.length)) : 1
            }
            console.log(`Total items ${compendium._content.length}`)
            if (filename) {
                if (compendium._content.length === 0) {
                    dialog.showMessageBox({message:"No items are available from this source.",type:"info"})
                        .then(prog.setCompleted())
                    return
                }
                prog.detail = `Creating XML`
                var compendiumXML = toXML(compendium,{indent:'\t'})
                await zip.addFile("compendium.xml",Buffer.from(compendiumXML,'utf8'),null)
                prog.detail = `Writing compendium file`
                zip.writeZip(filename)
                prog.detail = `Saved compendium`
                setTimeout(()=>prog.setCompleted(),1000)
                console.log("Wrote compendium")
            }
            return compendium
        }
    }
    async getMonsterCount(source = 0,homebrew = false) {
        const url = "https://monster-service.dndbeyond.com/v1/Monster"
        var params
        if (source) {
            params = qs.stringify({ 'skip': 0, 'take': 1, 'sources': source })
        } else {
            params = qs.stringify({ 'skip': 0, 'take': 1, 'showHomebrew': (homebrew)?'t':'f' })
        }
        await this.getCobaltAuth()
        const response = await this.getRequest(`${url}?${params}`,true).catch((e)=>console.log(`Error getting monster count for source id ${source}: ${e}`))
        return response.pagination.total
    }
    async getMonsters(source = 0,filename,zip=null,imageMap=null,prog=null,homebrew=false) {
        const url = "https://monster-service.dndbeyond.com/v1/Monster"
        var params
        const count = await this.getMonsterCount(source,homebrew).catch((e)=>console.log(e))
        console.log(`Source ${source} has ${count} monsters`)
        let pos = 0
        if(!prog) prog = new ProgressBar({title: "Please wait...",text: "Converting monsters...", detail: "Please wait...", indeterminate: false, maxValue: count})
        //prog.on('progress', (v) => prog.detail = `Converting ${v} of ${prog.getOptions().maxValue}`)
        if (filename) zip = new AdmZip()
        var compendium = { 
            _name: "compendium",
            _content: []
        }
        while ( pos <= count ) {
            console.log("Retrieving 100...")
            if (source) {
                params = qs.stringify({ 'skip': pos, 'take': 100, 'sources': source })
            } else {
                params = qs.stringify({ 'skip': pos, 'take': 100, 'showHomebrew': (homebrew)?'t':'f' })
            }
            const response = await this.getRequest(`${url}?${params}`,true).catch((e)=>console.log(`Error getting monster count for source id ${source}: ${e}`))
            console.log(`Retrieved ${response.data.length}`)
            for (const monster of response.data) {
                if (!monster.isReleased&&!monster.isHomebrew) {
                    prog.value += (!filename)? (15*(1/count)) : 1
                    console.log(`Skipping ${monster.isReleased} ${monster.isHomebrew}`)
                    continue
                }
                if (monster.isHomebrew !== homebrew) {
                    prog.value += (!filename)? (15*(1/count)) : 1
                    continue
                }
                if (source !== 29 && monster.sourceId === 29) {
                    prog.value += (!filename)? (15*(1/count)) : 1
                    continue
                }
                prog.detail = `${monster.name}`
                monster.avatarUrl = imageMap?.find(s=>s.id===monster.id&&s.type===monster.entityTypeId)?.avatar || monster.avatarUrl
                monster.basicAvatarUrl = imageMap?.find(s=>s.id===monster.id&&s.type===monster.entityTypeId)?.basicAvatar || monster.basicAvatarUrl
                compendium._content.push(await this.getMonsterEntry(monster,zip))
                prog.value += (!filename)? (15*(1/count)) : 1
            }
            pos += 100
        }
        if (filename) {
            if (compendium._content.length === 0) {
                dialog.showMessageBox({message:"No monsters are available from this source.",type:"info"})
                    .then(prog.setCompleted())
                return
            }
            prog.detail = `Creating XML`
            var compendiumXML = toXML(compendium,{indent:'\t'})
            await zip.addFile("compendium.xml",Buffer.from(compendiumXML,'utf8'),null)
            prog.detail = `Writing compendium file`
            zip.writeZip(filename)
            prog.detail = `Saved compendium`
            setTimeout(()=>prog.setCompleted(),1000)
        }
        return compendium
    }

    async getMonsterEntry(monster,zip) {
            var monsterEntry = {
                _name: "monster",
                _attrs: { id: uuid5(`ddb://monsters/${monster.id}`,uuid5.URL) },
                _content: [
                    {name: monster.name},
                    {slug: slugify(monster.name)},
                    {size: this.ruledata.creatureSizes.find(s=>s.id===monster.sizeId).name.charAt(0).toUpperCase()},
                    {alignment: this.ruledata.alignments.find(s=>s.id===monster.alignmentId)?.name||monster.alignmentId},
                    {ac: `${monster.armorClass} ${monster.armorClassDescription}`},
                    {hp: `${monster.averageHitPoints} (${monster.hitPointDice.diceString})`},
                    {role: 'enemy'},
                    {skill: sanitize(monster.skillsHtml)},
                    {senses: sanitize(monster.sensesHtml)},
                    {passive: monster.passivePerception},
                ] }
            var cr = this.ruledata.challengeRatings.find(s=>s.id===monster.challengeRatingId).value
            if (cr==0.125) {
                monsterEntry._content.push({cr: "1/8"})
            } else if (cr==0.25) {
                monsterEntry._content.push({cr: "1/4"})
            } else if (cr==0.5) {
                monsterEntry._content.push({cr: "1/2"})
            } else {
                monsterEntry._content.push({cr: cr.toString()})
            }
            if (monster.subTypes?.length>0) {
                var subtypes = []
                for (let subtype of monster.subTypes) {
                    subtypes.push(this.ruledata.monsterSubTypes.find(s=>s.id===subtype)?.name||subtype)
                }
                monsterEntry._content.push({type: `${this.ruledata.monsterTypes.find(s=>s.id===monster.typeId)?.name||monster.typeId} (${subtypes.join(", ")})`})
            } else {
                monsterEntry._content.push({type: this.ruledata.monsterTypes.find(s=>s.id===monster.typeId)?.name||monster.typeId})
            }
            var proficiency = this.ruledata.challengeRatings.find(s=>s.id===monster.challengeRatingId).proficiencyBonus
            monsterEntry._content.push({proficiency: proficiency})
            var languages = []
            for (let lang of monster.languages) {
                languages.push((this.ruledata.languages.find(s=>s.id===lang.languageId)?.name||lang.languageId.toString())+((lang.notes)? lang.notes : ""))
            }
            monsterEntry._content.push({languages: languages.join(", ")})
            var environments = []
            for (let environ of monster.environments) {
                environments.push(this.ruledata.environments.find(s=>s.id===environ)?.name||environ.toString())
            }
            monsterEntry._content.push({environments: environments.join(", ")})
            var movement = []
            for (let move of monster.movements) {
                if (move.movementId === 1) {
                    movement.unshift(`${move.speed} ft.${(move.notes)? ` (${move.notes})` : ''}`)
                } else {
                    movement.push((this.ruledata.movements.find(s=>s.id===move.movementId)?.name||move.movementId.toString()).toLowerCase() + ` ${move.speed} ft.${(move.notes)? ` (${move.notes})` : ''}`)
                }
            }
            monsterEntry._content.push({speed: movement.join(", ")})
            for (let stat of monster.stats) {
                switch(stat.statId) {
                    case 1: monsterEntry._content.push({str: stat.value}); break;
                    case 2: monsterEntry._content.push({dex: stat.value}); break;
                    case 3: monsterEntry._content.push({con: stat.value}); break;
                    case 4: monsterEntry._content.push({int: stat.value}); break;
                    case 5: monsterEntry._content.push({wis: stat.value}); break;
                    case 6: monsterEntry._content.push({cha: stat.value}); break;
                    default: console.log(stat)
                }
            }
            var saves = []
            for (let save of monster.savingThrows) {
                let bonus = Math.floor((monster.stats.find(s=>s.statId===save.statId).value-10)/2)+proficiency
                if (save.bonusModifier) bonus += save.bonusModifier
                bonus = (bonus<0)? bonus.toString() : "+"+bonus.toString()
                switch(save.statId) {
                    case 1: saves.push(`STR ${bonus}`); break;
                    case 2: saves.push(`DEX ${bonus}`); break;
                    case 3: saves.push(`CON ${bonus}`); break;
                    case 4: saves.push(`INT ${bonus}`); break;
                    case 5: saves.push(`WIS ${bonus}`); break;
                    case 6: saves.push(`CHA ${bonus}`); break;
                    default: console.log(stat)
                }
            }
            monsterEntry._content.push({save: saves.join(", ")})
            const handleTraits = (field,type,prefix="")=>{
                const traitRegex = /^(?:<i>)?(<b>(.*?)<\/b>)?.*$/g
                for (let t of sanitize(field,this.ruledata).split(/\r\n|\n/)) {
                    let m = traitRegex.exec(t); if (!m||!m[0]) continue
                    let txt = m[0].replace(m[1],'')
                    if (monsterEntry._content[monsterEntry._content.length-1]?.[type] && !m[1]) {
                        monsterEntry._content[monsterEntry._content.length-1][type].text += "\n"+txt
                        continue
                    }
                    monsterEntry._content.push( {[type]: { name: `${prefix}${m[2]||''}`, text: txt }} )
                }
            }
            handleTraits(monster.specialTraitsDescription,"trait")
            handleTraits(monster.actionsDescription,"action")
            handleTraits(monster.bonusActionsDescription,"action","Bonus Action: ")
            handleTraits(monster.reactionsDescription,"reaction")
            handleTraits(monster.legendaryActionsDescription,"legendary")
            handleTraits(monster.mythicActionsDescription,"legendary","Mythic Action: ")
            monsterEntry._content.push({
                description: `${(monster.lairDescription)?sanitize(monster.lairDescription+'<hr/>',this.ruledata)+'\n':''}${sanitize(monster.characteristicsDescription,this.ruledata)}

${(monster.sourceId)?`<i>Source: ${this.ruledata.sources.find((s)=> monster.sourceId === s.id)?.description}${(monster.sourcePageNumber)?  ` p. ${monster.sourcePageNumber}` : '' }</i>`:''}`
            })
            try{
                if ((monster.basicAvatarUrl||monster.largeAvatarUrl)&&this.art?.includes('artwork')) {
                    var imageFile = `${uuid5(monster.basicAvatarUrl||monster.largeAvatarUrl,uuid5.URL)}${path.extname(monster.basicAvatarUrl||monster.largeAvatarUrl)}`
                    if (!zip.getEntry(`monsters/${imageFile}`)) {
                        if ((monster.basicAvatarUrl||monster.largeAvatarUrl).startsWith("listing_images/")) {
                            await zip.addFile(`monsters/${imageFile}`,zip.readFile(monster.basicAvatarUrl||monster.largeAvatarUrl))
                            zip.deleteFile(monster.basicAvatarUrl||monster.largeAvatarUrl)
                        } else if (!zip.getEntry(`monsters/${path.basename(imageFile,path.extname(imageFile))}.webp`)) {
                            let imagesrc = await this.getImage(monster.basicAvatarUrl||monster.largeAvatarUrl).catch(e=>console.log(`Could not retrieve image: ${e}`))
                            imageFile = `${path.basename(imageFile,path.extname(imageFile))}.webp`
                            let image = await sharp(imagesrc).webp().toBuffer()
                            await zip.addFile(`monsters/${imageFile}`,image)
                        }
                    }
                    monsterEntry._content.push( { image: `${imageFile}` } )
                }
            } catch (e) {
                console.log(`Error adding artwork: ${e}\n${monster.name}: ${monster.basicAvatarUrl||monster.largeAvatarUrl}`)
            }
            try {
                if (monster.avatarUrl&&this.art?.includes('tokens')) {
                    if (!zip.getEntry(`monsters/${uuid5(monster.avatarUrl,uuid5.URL)}_token.webp`)) {
                        let imagesrc = (monster.avatarUrl.startsWith('listing_images/'))? zip.readFile(monster.avatarUrl) : await this.getImage(monster.avatarUrl).catch(e=>console.log(`Could not retrieve image: ${e}`))
                        let image = sharp(imagesrc)
                        let metadata = await image.metadata().catch(e=>console.log(`Could not read image: ${e}`))
                        let r = (metadata.width>metadata.height)?metadata.height:metadata.width
                        image = await image
                            .composite([{
                                input:Buffer.from(`<svg><circle cx="${r/2}" cy="${r/2}" r="${r/2}"/></svg>`),
                                blend: 'dest-in'
                            }])
                            .webp().toBuffer().catch(e=>console.log(`Could not create token: ${e}`))
                        await zip.addFile(`monsters/${uuid5(monster.avatarUrl,uuid5.URL)}_token.webp`,image)
                    }
                    monsterEntry._content.push( { token: `${uuid5(monster.avatarUrl,uuid5.URL)}_token.webp` } )
                }
            } catch (e) {
                console.log(`Error creating token: ${e}\n${monster.avatarUrl}`)
            }
        return monsterEntry
    }

    async getModule(moduleId,filename,win) {
        if (!this.cobaltsession) await this.setCobaltSession()
        if (!this.ruledata) await this.getRuleData().catch(e=>{throw new Error(e)})
        const params = qs.stringify({ token: this.cobaltsession })
        const kparams = qs.stringify({ token: this.cobaltsession,sources:`[{\"sourceID\":${moduleId},\"versionID\":null}]`})
        const url = `https://www.dndbeyond.com/mobile/api/v6/get-book-url/${moduleId}`
        const keyurl = "https://www.dndbeyond.com/mobile/api/v6/book-codes"
        const bookurl = await this.postRequest(url,params)
            .catch(e=>{throw new Error(`Could not get book url: ${e}`)})
        const bookkey = await this.postRequest(keyurl,kparams)
            .catch(e=>{throw new Error(`Could not get book url: ${e}`)})
        var prog
        download(win,bookurl.data,{
            saveAs: false,
            filename: path.basename(filename),
            directory: path.dirname(filename),
            showBadge: false,
            onStarted: (d) => {
                prog = new ProgressBar({
                    title: "Converting module...",
                    text: "Converting book...",
                    detail: "Downloading book...",
                    indeterminate: (d.getTotalBytes())?false:true,
                    maxValue: 100 //d.getTotalBytes()
                })
            },
            onProgress: (p) => {
                prog.value = p.percent * 25
                //if (p.totalBytes && !prog.isCompleted()) prog.value = p.transferredBytes
            },
            onCompleted: (f) => {
                //prog.setCompleted()
                this.convertModule(moduleId,bookkey.data[0].data,filename,prog)
            }
        })
    }

    convertModule(moduleId,key,filename,prog=null) {
        const book = this.ruledata.sources.find(s=>s.id===moduleId)
        const temp = tmp.dirSync()
        if(!prog) prog = new ProgressBar({
            text: "Converting book...",
            detail: "Extracting database...",
            indeterminate: true,
        })
        prog.text = "Converting book..."
        prog.detail = "Extracting database..."
        var mod = {
            _name: "module",
            _attrs: { id: uuid5(`https://www.dndbeyond.com/${book.sourceURL}`,uuid5.URL) },
            _content: [
                { name: book.description },
                { author: "D&D Beyond" },
                { slug: book.name.toLowerCase() },
                { image: `images/cover.jpg` }
            ]
        }
        var zip = AdmZip(filename)
        zip.extractEntryTo(`${book.name.toLowerCase()}.db3`,temp.name,false,true)
        var db = new sqlite3.Database(path.join(temp.name,`${book.name.toLowerCase()}.db3`))
        var imageMap = []
        var slugIdMap = {}
        db.serialize(() => {
            db.run(`PRAGMA key='${Buffer.from(key,'base64').toString('utf8')}'`)
            db.run("PRAGMA cipher_compatibility = 3")
            var pageCount = 0
            var pos = 0
            db.all("SELECT ID FROM Content",(e,c)=>{
                if (e) {
                    console.log(e)
                    return
                }
                pageCount = c.length
            })
            db.each("SELECT M.*, A.FileName as AFile FROM RPGSource M LEFT JOIN Avatar AS A ON M.AvatarID = A.ID",(e,c)=>{
                if (e) {
                    console.log(e)
                    return
                }
                if (c.ID===moduleId) {
                    mod._content.find(s=>s.image).image = `listing_images/${c.AFile}`
                    mod._content.push({code: c.Name||''})
                    mod._content.push({category: c.Type||''})
                    mod._content.push({description: convert(c.ProductBlurb).trim()||''})
                }
            })
            db.each("SELECT M.ID,A.EntityID AS AID,A.EntityTypeID AS AET,B.EntityID AS BID,B.EntityTypeID AS BET,A.FileName as AFile,B.FileName as BFile FROM RPGMonster M LEFT JOIN Avatar AS A ON M.AvatarID = A.ID LEFT JOIN Avatar AS B ON M.BasicAvatarID = B.ID WHERE M.AvatarID IS NOT NULL OR M.BasicAvatarID IS NOT NULL",(e,c)=>{
                if (e) {
                    console.log(e)
                    return
                }
                imageMap.push( {
                    id: c.ID||c.AID||c.BID,
                    type: c.AET||c.BET,
                    avatar: (c.AFile)?`listing_images/${c.AFile}`:null,
                    basicAvatar: (c.BFile)?`listing_images/${c.BFile}`:null
                } )
            })
            db.each("SELECT M.ID,A.EntityID as AID,A.EntityTypeID as AET,A.FileName as AFile,B.EntityID AS BID,B.EntityTypeID as BET,B.FileName as BFile FROM RPGMagicItem M LEFT JOIN Avatar AS A ON M.AvatarID = A.ID LEFT JOIN Avatar AS B ON M.LargeAvatarID = B.ID WHERE M.AvatarID IS NOT NULL OR M.LargeAvatarID IS NOT NULL",(e,c)=>{
                if (e) {
                    console.log(e)
                    return
                }
                imageMap.push( {
                    id: c.ID||c.AID||c.BID,
                    type: c.AET||c.BET,
                    avatar: (c.AFile)?`listing_images/${c.AFile}`:null,
                    largeAvatar: (c.BFile)?`listing_images/${c.BFile}`:null
                } )
            })
            prog.text = "Converting pages..."
            db.each("SELECT C.*,P.Slug AS ParentSlug FROM Content C LEFT JOIN Content P ON P.CobaltID = C.ParentID ORDER BY C.ParentID ASC, C.CobaltID ASC, C.ID ASC",(e,c)=>{
                if (e) {
                    console.log(e)
                    return
                }
                prog.detail = c.Title
                let page = {
                    page: {
                        _attrs: { id: uuid5(`https://www.dndbeyond.com/${book.sourceURL}/${c.Slug}`, uuid5.URL), sort: c.ID},
                        name: he.decode(c.Title),
                        slug: c.Slug.replaceAll("#","-"),
                        content: ((zip.getEntry(`images/chapter-backgrounds/${c.Slug}.jpg`))?`
            <div class="chapterart view-cover-art" style="background-image: url(images/chapter-backgrounds/${c.Slug}.jpg);">
                <a href="images/chapter-backgrounds/${c.Slug}.jpg">View Art</a>
            </div>
                        `:(c.Slug=="table-of-contents")?`
            <div class="chapterart view-cover-art">
                <a href="images/cover.jpg">View Cover Art</a>
            </div>
                        `:'') +
                        `<div id="content" class="site site-main container main content-container primary-content ${(c.Slug=='table-of-contents')?'body-category':'body-page'}"><article class="p-article p-article-a"><div class="p-article-content u-typography-format" id="mainpage">` +
                        he.decode(c.RenderedHtml
                            .replaceAll(/ddb:\/\/compendium\/([^\/\"]*?)\"/g,"/module/$1/table-of-contents\"")
                            .replaceAll(/ddb:\/\/compendium\/([^\/\"]*?)\//g,"/module/$1/page/")
                            .replaceAll(/\/page\/([^\"]*#[^\"]*)/g,m=>m.replace(/#(?=.*?#)/g,'-'))
                            .replaceAll(new RegExp(`ddb:\/\/image\/${book.name.toLowerCase()}\/`,'g'),"")
                            .replaceAll(new RegExp(`\\./${book.name.toLowerCase()}/`,'g'),"")
                            ) +
                            '</div></article></div>'
                    }
                }
                page.page.content = page.page.content.concat(`<script>window.thisSlug="${page.page.slug}"</script>`)
                if (c.ParentSlug) {
                    page.page._attrs.parent = uuid5(`https://www.dndbeyond.com/${book.sourceURL}/${c.ParentSlug}`,uuid5.URL)
                    var htmlids = /<.*?id="(.*?)".*?>/g
                    var m
                    slugIdMap[page.page.slug] = { parent: page.page._attrs.parent, title: page.page.name, ids: [] }
                    while (m = htmlids.exec(page.page.content)) {
                        if (!m[1].match(/([a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}?)/i)) slugIdMap[page.page.slug].ids.push(m[1])
                    }
                    page.page.content = page.page.content.concat(`<script>window.parentUUID="${page.page._attrs.parent}"</script>`)
                    //let parentpage = mod._content.find(s=>s.page?._attrs?.id==page.page._attrs.parent)?.page
                    mod._content.push(page)
                } else {
                    mod._content.push(page)
                }
                pos += 1
                prog.value = 25+((pos/pageCount)*25)
            },
            async () => {
                prog.detail = "Writing stylesheets"
                var globalcss = "@import '../../css/book.css';\n"
                var customcss = `
@font-face {
    font-family: "Scaly Sans Caps Bold";
    src: url("../fonts/scalysanscapsbold.otf") format("opentype");
    font-weight: bold;
}
@font-face {
    font-family: "Solbera Imitation";
    src: url("../fonts/solberaimitation.otf") format("opentype");
    font-weight: normal;
}
body {
    font-family: '-apple-system', sans-serif;
    font-size: 1.3rem;
    line-height: 1.8rem;
    padding: 0;
    margin: 0;
    color: black;
    background: #fefefc;
}
#content {
    padding: 1.5rem 2rem;
    overflow: hidden;
}
img {
    max-width: 100%;
    height: auto;
}
@media (min-width: 768px) {
    .compendium-image-right,
    .compendium-image-left {
        max-width: 405px;
    }
}
a[href^='ddb://'],
a[href*='/module/'],
a[href*='/page/'] {
  color: #33CC80!important;
}
a[href*='ddb://monsters'],
a[href*='/monster/'] {
  color: #bc0f0e!important;
}
a[href*='ddb://spells'],
a[href*='/spell/'] {
  color: #532bca!important;
  font-style: italic;
}
a[href*='ddb://armor'],
a[href*='ddb://weapons'],
a[href*='ddb://adventuring-gear'],
a[href*='ddb://magic-items'],
a[href*='/item/'] {
  color: #105a92!important;
  font-style: italic;
}
a[href*='/roll/'] {
  color: #d77e20!important;
}
.compendium-toc-blockquote a {
    color: white!important;
}
.compendium-toc-full-text a
{
    color: black!important;
}
.compendium-toc-full-text ul li a:hover,
.compendium-toc-full h4 a {
    color: #47D18C!important;
}
blockquote .view-cover-art {
    display: none!important;
}
.chapterart {
    display: inline-block;
    overflow: hidden;
    height: 250px;
    width:100%;
    text-align:center;
    background-image: url(../../images/cover.jpg);
    position: relative;
}
.chapterart a {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    font-family: "Scaly Sans Caps Bold";
    font-size: x-large;
    color: white;
    font-weight: bold;
    text-align: center;
}

h1 + p:not(.no-fancy)::first-letter {
    font-family: 'Solbera Imitation' !important;
    font-size: 9.3rem;
    text-decoration: none;
    font-style: normal;
    font-weight: normal;
    line-height: 1;
    margin-top: -0.3rem;
    padding-right: 0.8rem;
    float: left;
}
#comp-next-nav {
    display: none;
}

.sidenav-next-nav {
    font-family: "Roboto Condensed", Roboto, Helvetica, sans-serif;
    border: 1px solid #CBC6C3;
    display: flex;
    border-bottom: 0;
    padding: 10px 15px 10px 15px;
    background-color: #fff;
    text-transform: uppercase;
    font-weight: bold;
}

.body-page-details header.p-article-header {
    min-height: 34px;
    margin-bottom: 10px !important;
}

.compendium-quick-actions {
    display: none;
}

.sidenav-next-page {
    text-align: right;
    background-image: url(https://media-waterdeep.cursecdn.com/file-attachments/0/738/chevron-right-green.svg);
    background-repeat: no-repeat;
    background-position: right;
}

.sidenav-next-page.disabled {
    background-image: url(https://media-waterdeep.cursecdn.com/file-attachments/0/739/chevron-right-disabled.svg);
    background-position: right !important;
    padding-right: 20px;
}

.sidenav-next-page a {
    padding: 10px 20px 10px 0;
}

.sidenav-prev-page {
    background-image: url(https://media-waterdeep.cursecdn.com/file-attachments/0/737/chevron-left-green.svg);
    background-repeat: no-repeat;
    background-position: left;
}

.sidenav-prev-page.disabled {
    background-image: url(https://media-waterdeep.cursecdn.com/file-attachments/0/740/chevron-left-disabled.svg);
    padding-left: 20px;
}

.sidenav-prev-page a {
    padding: 10px 0 10px 20px;
}

.sidenav-next-nav a,
.sidenav-next-nav a:hover,
.sidenav-next-nav a:visited,
.sidenav-next-nav a:active {
    color: #878787;
}

.sidenav-next-nav a.disabled {
    color: #d9d9d9;
}

.sidenav-comp-page {
    flex: 1;
}

.sidenav-comp-page a {
    display: block;
    background-image: url(https://media-waterdeep.cursecdn.com/file-attachments/0/741/comp-icon.svg);
    background-repeat: no-repeat;
    width: 20px;
    height: 20px;
    margin: 0 auto;
}

.top-next-nav {
    display: flex;
    background: #fff;
    border: 1px solid #CBC6C3;
    padding: 7px;
    font-weight: bold;
    color: #878787;
    text-transform: uppercase;
    font-family: "Roboto Condensed", serif;
    line-height: 1rem!important
}

.top-next-nav a,
.top-next-nav a:active,
.top-next-nav a:visited {
    color: #878787;
}

.top-next-nav a:hover {
    color: #47D18C;
}

.top-next-nav div {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.top-prev-page {
    background-image: url(https://media-waterdeep.cursecdn.com/file-attachments/0/737/chevron-left-green.svg);
    background-repeat: no-repeat;
    padding-left: 17px;
}

.top-prev-page.disabled {
    background-image: url(https://media-waterdeep.cursecdn.com/file-attachments/0/740/chevron-left-disabled.svg);
}

.top-table-page {
    text-align: center;
}

.top-table-page a {
    background-image: url(https://media-waterdeep.cursecdn.com/file-attachments/0/741/comp-icon.svg);
    background-repeat: no-repeat;
    background-size: 18px;
    background-position: center;
    text-indent: -9999px;
    padding: 0 20px;
    width: 50px;
    display: inline-block;
}
.top-parent-page {
    text-align: center;
}

.top-parent-page a {
    width: 50px;
    display: inline-block;
}

@media (min-width: 800px) {
    .top-table-page a {
        background-position-y: center;
        background-position: inherit;
        text-indent: 0;
        padding: 0 20px;
        width: auto;
        display: inline-block;
    }
}

.top-next-page {
    text-align: right;
    background-image: url(https://media-waterdeep.cursecdn.com/file-attachments/0/738/chevron-right-green.svg);
    background-repeat: no-repeat;
    background-position: right;
    padding-right: 17px;
}

.top-next-page.disabled {
    background-image: url(https://media-waterdeep.cursecdn.com/file-attachments/0/739/chevron-right-disabled.svg);
}

.nav-back-to-top {
    background-image: url(https://media-waterdeep.cursecdn.com/file-attachments/0/742/arrow.svg);
    background-repeat: no-repeat;
    background-position: center;
    width: 50px;
    height: 50px;
    background-color: #47D18C;
    position: fixed;
    bottom: 10px;
    right: 20px;
    border-radius: 50%;
}

.nav-back-to-top a {
    display: block;
    border-radius: 50%;
    width: 50px;
    height: 50px;
}
`.replaceAll(/url\((['"]?)((?:https?:)?\/\/.*?)(?:\1)\)/g,(m,m1,m2)=>{
                                if (!m2.startsWith("http")) m2 = "https:" + m2
                                let resName = uuid5(m2,uuid5.URL)
                                if (path.extname(m2)) resName += path.extname(m2)
                                this.getImage(m2).then(r=>zip.addFile(`assets/css/res/${resName}`,r)).catch(e=>console.log(`${m2}-${e}`))
                                return `url(res/${resName})`
                            })
                this.css.push("https://media.dndbeyond.com/ddb-compendium-client/compendium.590bdb9dc0538e3c4006.css")
                for (let css of this.css) {
                    try {
                        console.log(`Retrieving ${css}`)
                        let cssBuf = await this.getImage(css).catch(e=>console.log(`Error retrieving ${css}: ${e}`))
                        let cssTxt = cssBuf
                            .toString('utf8').replaceAll(/url\((['"]?)((?:(?:https?:)?\/\/|\.\.).*?)(?:\1)\)/g,(m,m1,m2)=>{
                                if (!m2.startsWith("http")&&m2.startsWith("//")) m2 = "https:" + m2
                                if (m2.startsWith("../")) {
                                    if (m2.startsWith("../images/letters","/images/")) {
                                        m2 = m2.replace(/\/images\/letters\//,"/images/")
                                    }
                                    if (zip.getEntry(m2.substr(3))) {
                                        return `url("../${m2}")`
                                    }
                                    m2 = url.resolve(css,m2)
                                }
                                let resName = uuid5(m2,uuid5.URL)
                                if (path.extname(m2)) resName += path.extname(m2)
                                prog.detail = `Adding resource ${m2}`
                                this.getImage(m2).then(r=>zip.addFile(`assets/css/res/${resName}`,r)).catch(()=>{})
                                return `url(res/${resName})`
                            }).replaceAll(/(background:.*) (114px)/g,"$1 0px").replace(/@media\(max-width:1023px\)\{\.tooltip/,"@media(max-width: 10px){.tooltip")
                        zip.addFile(`assets/css/${uuid5(css,uuid5.URL)}.css`,cssTxt)
                        globalcss = globalcss.concat(`@import '${uuid5(css,uuid5.URL)}.css';\n`)
                        console.log("Added to global.css")
                    } catch (e) {
                        console.log(`Error loading css: ${e}`)
                    }
                }
                if (moduleId <= 2) {
                    let dwarfIntro = await this.getImage("https://media-waterdeep.cursecdn.com/attachments/thumbnails/0/619/850/190/dwarfintro.png").catch(e=>console.log(`Error retrieving missing dwarf intro: ${e}`))
                    if (dwarfIntro) zip.addFile("dwarfintro.png",dwarfIntro)
                }
                console.log("Adding fixing css line endings")
                customcss = customcss.replaceAll(/\r\n/g,"\n")
                console.log("Adding global.css to zip")
                zip.addFile('assets/css/global.css',globalcss)
                zip.addFile('assets/css/custom.css',customcss)
                try {
                    zip.addLocalFile(path.join(__dirname,"..","scalysanscapsbold.otf"),'assets/fonts')
                } catch {
                    zip.addLocalFile("scalysanscapsbold.otf",'assets/fonts')
                }
                try {
                    zip.addLocalFile(path.join(__dirname,"..","solberaimitation.otf"),'assets/fonts')
                } catch {
                    zip.addLocalFile("solberaimitation.otf",'assets/fonts')
                }

                const customjs = `
${(await this.getImage("https://cdnjs.cloudflare.com/ajax/libs/uuid/8.1.0/uuidv5.min.js").catch(e=>console.log(`Error retrieving ${css}: ${e}`))).toString('utf8')}
const knownIds = ${JSON.stringify(slugIdMap)}

function makeRollLinks(el) {
    const dice = new RegExp(/[0-9]*[dD][0-9]+( ?[-+] ?[0-9]+)?/,"g")
    if (el.childElementCount > 0) {
        for (var child of el.childNodes) {
            makeRollLinks(child)
        }
    } else {
        if (el.nodeName != "#text") {
            if (el.nodeName == "A") return
            el = el.firstChild
            if (!el) return
        }
        var rolls = []
        while ((m = dice.exec(el.textContent)) !== null) {
            rolls.push(m)
        }
        rolls.reverse()
        for (let roll of rolls) {
            let remainder = el.splitText(roll.index)
            remainder.data = remainder.data.substr(roll[0].length)
            let rollLink = document.createElement("A")
            rollLink.href = \`/roll/\${roll[0]}\`
            rollLink.innerText = roll[0]
            el.parentNode.insertBefore(rollLink,remainder)
        }
    }
}

window.addEventListener('load', function() {
    var pageUrl = window.location
    var pageId = pageUrl.pathname.split('/')[pageUrl.pathname.split('/').length-1].replace('.html','')
    for (let heading of document.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
        if (heading.id) {
            heading.addEventListener('mousedown', function() {
                this.clicktime = new Date().getTime()
            })
            heading.addEventListener('mouseup', function() {
                if (heading.querySelector(".autoHeaderLink")) {
                    if (((new Date().getTime()) - this.clicktime) < 100)
                        heading.querySelector(".autoHeaderLink").remove()
                } else {
                    var url = \`/page/\${pageId}#\${heading.id}\`
                    var link = document.createElement('A')
                    link.className = "autoHeaderLink"
                    link.href = url
                    link.innerText = ' 📍'
                    link.title = heading.innerText
                    heading.appendChild(link)
                }
            })
        }
    }
    for (var el of document.querySelectorAll("p, table")) {
        makeRollLinks(el)
    }
    var frag = window.location.hash
    if (frag && !document.getElementById(frag.substr(1))) {
        for (var slug of Object.keys(knownIds)) {
            if ([pageId,window.parentUUID].includes(knownIds[slug].parent) && knownIds[slug].ids.includes(frag.substr(1))) {
                window.location.assign(\`https://encounter.plus/page/\${slug}\${frag}\`)
            }
        }
    }
    var tables = document.querySelectorAll('table')
    if (tables) {
        for (var table of tables) {
            var wrapper = document.createElement('div');
            wrapper.className = "table-overflow-wrapper"
            table.parentNode.insertBefore(wrapper,table)
            wrapper.appendChild(table)
        }
    }
    var nav = document.querySelector('#comp-next-nav')
    if (nav) {
        var topNav = document.createElement('div')
        topNav.className = "top-next-nav"
        var topPrev = document.createElement('div')
        topPrev.className = "top-prev-page"
        var topTop = document.createElement('div')
        topTop.className = "top-table-page"
        var topNext = document.createElement('div')
        topNext.className = "top-next-page"
        if (nav.dataset.prevTitle && nav.dataset.prevLink) {
            var prevLink = document.createElement('a')
            prevLink.href = \`/page/\${nav.dataset.prevLink}\`
            prevLink.innerText = nav.dataset.prevTitle
            topPrev.appendChild(prevLink)
        } else {
            topPrev.classList.add("disabled")
        }
        if (nav.dataset.nextTitle && nav.dataset.nextLink) {
            var nextLink = document.createElement('a')
            nextLink.href = \`/page/\${nav.dataset.nextLink}\`
            nextLink.innerText = nav.dataset.nextTitle
            topNext.appendChild(nextLink)
        } else {
            topNext.classList.add("disabled")
        }
        var topLink = document.createElement('a')
        topLink.href = "/page/table-of-contents"
        topLink.innerText = "Table of Contents"
        topTop.appendChild(topLink)
        topNav.appendChild(topPrev)
        topNav.appendChild(topTop)
        topNav.appendChild(topNext)
        nav.parentNode.insertBefore(topNav,nav)
    }
    var page = document.querySelector('#mainpage')
    if (!window.parentUUID){
        var bottomNav = document.createElement('div')
        bottomNav.className = "top-next-nav"
        bottomNav.style.display = "block"
        var children = 0
        for (var slug of Object.keys(knownIds)) {
            if (pageId == knownIds[slug].parent) {
                children += 1
                let childNode = document.createElement('div')
                childNode.className = "top-next-page"
                let childLink = document.createElement('a')
                childLink.href = \`/page/\${slug}\`
                childLink.innerText = knownIds[slug].title
                childNode.appendChild(childLink)
                bottomNav.appendChild(childNode)
            }
        }
        if (children > 0) page.appendChild(bottomNav)
    } else {
        var topNav = document.createElement('div')
        topNav.className = "top-next-nav"
        var topPrev = document.createElement('div')
        topPrev.className = "top-prev-page"
        var topTop = document.createElement('div')
        topTop.className = "top-parent-page"
        var topNext = document.createElement('div')
        topNext.className = "top-next-page"
        var pagePrev = null
        var pageNext = null
        for (var slug of Object.keys(knownIds)) {
            if (window.parentUUID == knownIds[slug].parent) {
                if (slug == window.thisSlug) {
                    pageNext = { title: knownIds[slug].title, link: slug }
                } else if (pageNext) {
                    pageNext = { title: knownIds[slug].title, link: slug }
                    break
                } else {
                    pagePrev = { title: knownIds[slug].title, link: slug }
                }
            }
        }
        if (pagePrev) {
            var prevLink = document.createElement('a')
            prevLink.href = \`/page/\${pagePrev.link}\`
            prevLink.innerText = pagePrev.title
            topPrev.appendChild(prevLink)
        } else {
            topPrev.classList.add("disabled")
        }
        if (pageNext && pageNext.link != window.thisSlug) {
            var nextLink = document.createElement('a')
            nextLink.href = \`/page/\${pageNext.link}\`
            nextLink.innerText = pageNext.title
            topNext.appendChild(nextLink)
        } else {
            topNext.classList.add("disabled")
        }
        var topLink = document.createElement('a')
        topLink.href = \`/page/\${window.parentUUID}\`
        topLink.innerText = "UP"
        topTop.appendChild(topLink)
        topNav.appendChild(topPrev)
        topNav.appendChild(topTop)
        topNav.appendChild(topNext)
        page.appendChild(topNav)
    }
})
window.addEventListener('click', function(e) {
    var pageUrl = window.location
    var pageId = pageUrl.pathname.split('/')[pageUrl.pathname.split('/').length-1].replace('.html','')
    var e = window.e || e;
    var target = e.target.closest('a') || e.target;
    if (target.tagName === 'A') {
	var link = target.getAttribute('href');
	if (link.startsWith("#") && !document.getElementById(link.substr(1))) {
	    for (var slug of Object.keys(knownIds)) {
		if ([pageId,window.parentUUID].includes(knownIds[slug].parent) && knownIds[slug].ids.includes(link.substr(1))) {
                    e.preventDefault()
		    window.location.assign(\`https://encounter.plus/page/\${slug}\${link}\`)
		    return
	        }
	    }
        } else if (link.startsWith("ddb://")) {
            e.preventDefault()
            var ddburl = new URL(link)
            if (ddburl.host == "spells") {
                window.location = \`https://encounter.plus/spell/\${uuidv5(link, uuidv5.URL)}\`
            } else if (ddburl.host == "monsters") {
                window.location = \`https://encounter.plus/monster/\${uuidv5(link, uuidv5.URL)}\`
            } else if (["magicitems","adventuring-gear","weapon","armor"].includes(ddburl.host)) {
                window.location = \`https://encounter.plus/item/\${uuidv5(link, uuidv5.URL)}\`
            } else {
                displayModal(ddburl.host,ddburl.pathname.replace(/^\\//,''))
            }
        }
    }
})
function displayModal(path,id) {
        var info = {
            conditions: ${JSON.stringify(this.ruledata.conditions.map(s=>s.definition))},
            skills:     ${JSON.stringify(this.ruledata.abilitySkills)},
            actions:    ${JSON.stringify(this.ruledata.basicActions)},
            senses:     ${JSON.stringify(this.ruledata.senses)},
            weaponproperties: ${JSON.stringify(this.ruledata.weaponProperties)},
            stat:       ${JSON.stringify(this.ruledata.stats)}
        }
        var type = path.slice(0,-1)
        var detail = info[path]?.find(s=>s.id===parseInt(id))
        var subtype = (type=="skill")? info.stat.find(s=>s.id===detail?.stat)?.name : null
        var title = detail?.name || "Unknown"
        var text = detail?.description || \`Could not find \${type} #\${id}\`

        document.querySelector('#db-tooltip-container')?.remove()
	var modal = document.createElement('div')
	modal.id = "db-tooltip-container"
	modal.className = "waterdeep-tooltip"
	modal.style.position = "fixed"
	modal.style.zIndex = 9999
	modal.style.whiteSpace = "nowrap"
	modal.style.display = "block"

	
	var modalBody = document.createElement('div')
	modalBody.className = "body"

	var modalContent = document.createElement('div')
	modalContent.classList = \`tooltip tooltip-\${type}\`
        modalContent.style.minWidth = (document.documentElement.clientWidth<512)?
            \`\${document.documentElement.clientWidth}px\` : "512px"

	var modalHeader = document.createElement('div')
	modalHeader.className = "tooltip-header"
	var modalHeaderI = document.createElement('div')
	modalHeaderI.className = "tooltip-header-icon"
	var modalHeaderIcon = document.createElement('div')
	modalHeaderIcon.classList = \`\${type}-icon \${type}-icon-\${title.toLowerCase()}\`
	if (subtype) modalHeaderIcon.classList.add(\`\${type}-icon-\${subtype.toLowerCase()}\`)
	var modalHeaderT = document.createElement('div')
	modalHeaderT.className = "tooltip-header-text"
	modalHeaderT.innerText = (subtype)? \`\${subtype} (\${title})\`:title
	var modalHeaderId = document.createElement('div')
	modalHeaderId.classList = \`tooltip-header-identifier tooltip-header-identifier-\${type}\`
	modalHeaderId.innerText = type

	var modalContentBody = document.createElement('div')
	modalContentBody.className = "tooltip-body"
        modalContentBody.style.overflow = "scroll"
	var modalContentBodyD = document.createElement('div')
	modalContentBodyD.className = "tooltip-body-description"
	var modalContentBodyDT = document.createElement('div')
	modalContentBodyDT.className = "tooltip-body-description-text"
	modalContentBodyDT.innerHTML = text

	modalHeaderI.appendChild(modalHeaderIcon)
	modalHeader.appendChild(modalHeaderI)
	modalHeader.appendChild(modalHeaderT)
	modalHeader.appendChild(modalHeaderId)
	modalContent.appendChild(modalHeader)
	modalContentBody.appendChild(modalContentBodyD)
	modalContentBodyD.appendChild(modalContentBodyDT)
	modalContent.appendChild(modalContentBody)
	modalBody.appendChild(modalContent)
	modal.appendChild(modalBody)
        modal.onclick = function() { this.remove() }
	document.querySelector('#page').appendChild(modal)
        var modalW = modal.clientWidth
        var modalH = modal.clientHeight
        console.log(modalW,modalH,this.event.x,this.event.y,(modalW/2)-this.event.x)
        if (this.event.x - (modalW/2) < 0) {
            modal.style.left = 0
        } else if (this.event.x + (modalW/2) > document.documentElement.clientWidth) {
            modal.style.left = \`\${document.documentElement.clientWidth - modalW}px\`
        } else {
            modal.style.left = \`\${this.event.x - (modalW/2)}px\`
        }
        if (this.event.y - (modalH/2) < 0) {
            modal.style.top = 0
        } else if (this.event.y + (modalH/2) > document.documentElement.clientHeight) {
            modal.style.bottom = 0
        } else {
            modal.style.top = \`\${this.event.y - (modalH/2)}px\`
        }
}
                `
                zip.addFile('assets/js/custom.js',customjs)
                if (this.maps && this.maps != "nomaps") {
                    const getGrid = require('./getgrid')
                    prog.detail = "Searching for Maps"
                    if (this.maps == "markers") {
                        this.gVisionClient = new vision.ImageAnnotatorClient({
                            keyFile: '.gkey.json'
                        });
                    }
                    var mapJobs = []
                    const mapgroup = uuid5(`https://www.dndbeyond.com/${book.sourceURL}/maps`,uuid5.URL)
                    if (this.mapsloc != "parent") {
                        mod._content.push(
                            {
                                _name: "group",
                                _attrs: { id: mapgroup, sort: 99999999999999 },
                                _content: [
                                    { name: "Maps" },
                                    { slug: 'maps' }
                                ]
                            })
                    }
                    for (const page of mod._content) {
                        if (!page.page) continue
                        let mapsort = page.page._attrs.sort*100
                        mapJobs.push((async ()=>{
                        var mapRE = /<figure.*?id="([^"]*)"[^>]*>.*?<figcaption>(.*?) ?<a[^>]*href="(ddb:\/\/image\/[  ^\/]*?\/)?(.*?)\"[^>]*?>.*?[Pp]layer.*?<\/a>.*?<\/figure>/g
                        if (mapRE.test(page.page.content)) {
                            mapRE.lastIndex = 0
                            var maps
                            while (maps = mapRE.exec(page.page.content)) {
                                mapsort ++
                                prog.detail = `Searching for Maps - ${maps[2]}`
                                prog.detail = `Searching for Maps - ${maps[2]} - locating grid`
                                const grid = await getGrid(await sharp(zip.readFile(maps[4])).toBuffer());
                                console.log(`This might be a map: ${maps[4]}`)
                                let playerMap = {
                                    _name: "map",
                                    _attrs: { id: uuid5(`https://www.dndbeyond.com/${book.sourceURL}/image/${maps[1]}`, uuid5.URL), parent: (this.mapsloc!="group")? page.page._attrs.id : mapgroup, sort: mapsort},
                                    _content: [
                                        { name: he.decode(maps[2]) },
                                        { slug: slugify(maps[2]) },
                                        { image: maps[4] }
                                    ]
                                }
                                if (grid.freq > 0) {
                                    playerMap._content.push( { gridSize: grid.size } )
                                    playerMap._content.push( { gridOffsetX: grid.x } )
                                    playerMap._content.push( { gridOffsetY: grid.y } )
                                    playerMap._content.push( { scale: grid.scale } )
                                }
                                if (this.maps == "markers") {
                                    prog.detail = `Searching for Maps - ${maps[2]} - scanning for markers`
                                    let dmMap = (new RegExp(`<img.*?src="(.*?)".*?>`)).exec(maps[0])
                                    
                                    if (dmMap) {
                                        const dmMapImg = await sharp(zip.readFile(dmMap[1])).toBuffer()
                                        let tasks = []
                                        const headings = [...page.page.content.matchAll(/<(h[1-9]).*?id="(.*?)".*?>((.+?)\. .+?)<\/\1>/gi)]
                                        console.log("Submitting map to Google Vision");
                                        prog.detail = `Searching for Maps - ${maps[2]} - uploading to Google Vision`
                                        const ocrResult = await this.gVisionClient.textDetection(dmMapImg)
                                        ocrResult[0]?.textAnnotations?.forEach((word,i)=>{
                                            let txt = word.description.replaceAll(/[\W_]+/g,'').trim();
                                            let box = word.boundingPoly.vertices
                                            let x = box[0].x, y = box[0].y
                                            let x2=x, y2=y
                                            for(let point of box) {
                                                x = (point.x<x)?point.x:x
                                                x2 = (point.x>x2)?point.x:x2
                                                y = (point.y<y)?point.y:y
                                                y2 = (point.y>y2)?point.y:y2
                                            }
                                            let w = x2-x, h = y2-y
                                            let marker = null
                                            let pageslug = page.page.slug
                                            for (const heading of headings) {
                                                if (heading[4].toLowerCase() == txt.toLowerCase()) {
                                                    marker = heading
                                                    break
                                                }
                                            }
                                            if (!marker) {
                                                for (const nextpage of mod._content) {
                                                    if (!nextpage.page) continue
                                                    if(mapsort > (nextpage.page._attrs.sort*100)) continue
                                                    
                                                    let nxtHeadings = [...nextpage.page.content.matchAll(/<(h[1-9]).*?id="(.*?)".*?>((.+?)\. .+?)<\/\1>/gi)]
                                                    for (const heading of nxtHeadings) {
                                                        if (heading[4].toLowerCase() == txt.toLowerCase()) {
                                                            pageslug = nextpage.page.slug
                                                            marker = heading
                                                            break
                                                        }
                                                    }
                                                    if (marker) break
                                                }
                                            }
                                            if (marker) {
                                                console.log(`Adding marker for ${marker[3]} to ${maps[2]}`)
                                                playerMap._content.push({
                                                    marker: {
                                                        name: "",//marker[3],
                                                        label: txt.toUpperCase(),
                                                        color: "#ff0000",
                                                        shape: "circle",
                                                        size: "medium",
                                                        hidden: "YES",
                                                        locked: "YES",
                                                        x: Math.round(x+(w/2)),
                                                        y: Math.round(y+(h/2)),
                                                        content: {_attrs: { ref: `/page/${pageslug}#${marker[2]}` }}
                                                    }
                                                })
                                            } else {
                                                console.log(`No matching heading found for "${txt}"`)
                                            }
                                        })
                                    }
                                }
                                prog.detail = `Adding Map: ${maps[2]}`
                                console.log(`Adding MAP: ${maps[2]}`)
                                page.page.content = page.page.content.replaceAll(new RegExp(`href="${maps[3]??''}${maps[4]}"`,'g'),`href="/map/${playerMap._attrs.id}"`);
                                mod._content.push(playerMap)
                            }
                        }
                        })())
                    }
                    if (mapJobs.length > 0) await Promise.all(mapJobs)
                }
                console.log("Storing module.xml")
                prog.detail = "Writing Module XML"
                zip.addFile('module.xml',toXML(mod,{indent: '\t'}))
                console.log("Retrieving Monsters...")
                prog.text = "Converting Monsters..."
                prog.detail = "Retrieving Monsters..."
                prog.value = 50
                var compM = await this.getMonsters(moduleId,null,zip,imageMap,prog)||[]
                console.log("Retrieving Items...")
                prog.text = "Converting Items..."
                prog.detail = "Retrieving Items..."
                prog.value = 65
                var compI = await this.getItems(moduleId,null,zip,imageMap,prog)||[]
                console.log("Retrieving Spells...")
                prog.text = "Converting Spells..."
                prog.detail = "Retrieving Spells..."
                prog.value = 80
                var compS = await this.getSpells(moduleId,null,zip,prog)||[]
                prog.value = 95
                prog.text = "Finishing up..."
                console.log("Merging compendiums...")
                var compendium = { 
                    _name: "compendium",
                    _content: []
                }
                compendium._content = compendium._content.concat(compM._content,compI._content,compS._content)
                if (compendium._content.length > 0) {
                    console.log("Storing compendium.xml")
                    prog.detail = "Writing Compendium XML"
                    zip.addFile('compendium.xml',toXML(compendium,{indent: '\t'}))
                }
                prog.value = 99
                console.log("Writing .module")
                prog.detail = "Saving Module"
                zip.writeZip()
                prog.detail = "Module saved."
                setTimeout(()=>prog.setCompleted(),1000)
            })
        })
        console.log("Closing dtabase")
        db.close()
    }

    

    constructor() {
        this.session = session.defaultSession
        this.expiration = new Date().getTime()
        this.campaigns = []
        this.css = []
        console.log(`Expiration is ${this.expiration}`)
        /*
        this.setCobaltSession().then(
            this.getUserData().then(
                this.populateCampaigns().then(
                    this.getRuleData()
                )
            )
        )
        */
    }
}

module.exports = DDB
