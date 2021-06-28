const { net, session, app } = require('electron')
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
function slugify(str) {
    return Slugify(str,{ lower: true, strict: true })
}
function sanitize(text) {
    return convert(text,{
        wordwrap: null,
        formatters: {
            'keepA': function (elem, walk, builder, formatOptions) {
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
            }
        },
        selectors: [
            { selector: 'table', format: 'dataTable', options: { maxColumnWidth: 15 }},
            {selector: 'a',format: 'keepA'},
            {selector: 'b',format: 'bold'},
            {selector: 'strong',format: 'bold'},
            {selector: 'i',format: 'italic'},
            {selector: 'em',format: 'italic'},
            {selector: 'u',format: 'underline'}
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
        const url = "https://www.dndbeyond.com/mobile/api/v6/user-data"
        const body = qs.stringify({ 'token': this.cobaltsession })
        const res = await this.postRequest(url,body).catch(e => console.log(`Could not populate userdata: ${e}`))
        this.userId = res?.userId
    }
    async getRuleData() {
        //const url = "https://character-service.dndbeyond.com/character/v4/rule-data"
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
        const url = "https://www.dndbeyond.com/mobile/api/v6/available-user-content"
        const body = qs.stringify({ 'token': this.cobaltsession })
        const sources = await this.postRequest(url,body).then(r => r.data).catch(e =>{ throw new Error(`Cannot retrieve avaialable sources: ${e}`)})
        if (!this.ruledata) await this.getRuleData().catch(e=>{throw new Error(e)})
        const books = sources.Licenses.filter((f) => f.EntityTypeID == "496802664")
                .map((block) =>
                    block.Entities
                      .filter((b) => b.isOwned)
                      .filter((b) => this.ruledata.sources.some((s)  => b.id === s.id && s.isReleased))
                      .map((b) => {
                        const book = this.ruledata.sources.find((s)  => b.id === s.id);
                        return {
                          id: b.id,
                          book: book.description,
                          bookCode: book.name,
                          url: `https://www.dndbeyond.com/${book.sourceURL}`
                        };
                      })
                  )
                .flat()
        const shared = sources.Licenses.filter((f) => f.EntityTypeID == "496802664")
                .map((block) =>
                    block.Entities
                      .filter((b) => !b.isOwned)
                      .filter((b) => this.ruledata.sources.some((s)  => b.id === s.id && s.isReleased))
                      .map((b) => {
                        const book = this.ruledata.sources.find((s)  => b.id === s.id);
                        return {
                          id: b.id,
                          book: book.description,
                          bookCode: book.name,
                          url: `https://www.dndbeyond.com/${book.sourceURL}`
                        };
                      })
                  )
                .flat()
        this.books = books
        this.sharedBooks = shared
    }
    async getAllSpells() {
        const urls = [ "https://character-service.dndbeyond.com/character/v4/game-data/spells",
            "https://character-service.dndbeyond.com/character/v4/game-data/always-known-spells",
            "https://character-service.dndbeyond.com/character/v4/game-data/always-prepared-spells"]
        if (!this.ruledata) await this.getRuleData
        let allSpells = []
        for (let ddbClass of this.ruledata.classConfigurations) {
            if (/(ua|archived)/i.test(ddbClass.name)) continue
            for (const url of urls) {
                const params = qs.stringify({ 'sharingSetting': 2, 'classId': ddbClass.id, "classLevel": 20 })
                await this.getCobaltAuth()
                const response = await this.getRequest(`${url}?${params}`,true).catch((e)=>console.log(`Error getting spells: ${e}`))
                if (response?.data) {
                    for (let spell of response.data) {
                        let existing = allSpells.find(s=>s.id===spell.definition.id)
                        if (existing) {
                            existing.classes.push(ddbClass.name)
                        } else {
                            let newSpell = spell.definition
                            newSpell.classes = [ddbClass.name]
                            allSpells.push(newSpell)
                        }
                    }
                }
            }
        }
        return allSpells
    }

    async getSpells(source=null,filename,zip=null) {
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
        const prog = new ProgressBar({text: "Converting spells...", detail: "Please wait...", indeterminate: true})
        const allSpells = await this.getAllSpells()
        const spells = allSpells.filter(s=>(source)?s.sources.some(b=>b.sourceId===source):true)
        if (filename) zip = new AdmZip()
        var compendium = { 
            _name: "compendium",
            _content: []
        }
        for (let spell of spells) {
            prog.detail = spell.name
            var spellEntry = {
                _name: "spell",
                _attrs: { id: uuid5(`ddb://spells/${spell.id}`,uuid5.URL) },
                _content: [
                    {name: spell.name},
                    {slug: slugify(spell.name)},
                    {level: spell.level},
                    {school: spellSchools.find(s=>s.name==spell.school.toLowerCase())?.code||spell.school},
                    {ritual: (spell.level)?'YES':"NO"},
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
            let description = sanitize(spell.description)
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
            prog.detail = `Creating XML`
            var compendiumXML = toXML(compendium,{indent:'\t'})
            await zip.addFile("compendium.xml",Buffer.from(compendiumXML,'utf8'),null)
            prog.detail = `Writing compendium file`
            zip.writeZip(filename)
            prog.detail = `Saved compendium`
            setTimeout(()=>prog.setCompleted(),1000)
        } else {
            prog.setCompleted()
        }
        return compendium
    }

    async getItems(source=null,filename,zip=null,imageMap=null) {
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
            const items = response.data.filter(s=>(source)?s.sources.some(b=>b.sourceId===source):true)
            const prog = new ProgressBar({text: "Converting items...", detail: "Please wait...", indeterminate: false, maxValue: items.length})
            if (filename) zip = new AdmZip()
            var compendium = { 
                _name: "compendium",
                _content: []
            }
            for (const item of items) {
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
                        {name: item.name},
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
                let description = sanitize(item.description)
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
                    if (item.largeAvatarUrl||item.avatarUrl) {
                        if (!zip.getEntry(`items/${uuid5(item.largeAvatarUrl||item.avatarUrl,uuid5.URL)}.webp`)) {
                            let imagesrc = ((item.avatarUrl||item.largeAvatarUrl).startsWith("listing_images/"))? zip.readFile((item.largeAvatarUrl||item.avatarUrl)) : await this.getImage(item.largeAvatarUrl||item.avatarUrl).catch(e=>console.log(`Could not retrieve image: ${e}`))
                            let image = await sharp(imagesrc).webp().toBuffer()
                            await zip.addFile(`items/${uuid5(item.largeAvatarUrl||item.avatarUrl,uuid5.URL)}.webp`,image)
                        }
                        itemEntry._content.push( { image: `${uuid5(item.largeAvatarUrl||item.avatarUrl,uuid5.URL)}.webp` } )
                    }
                } catch (e) {
                    console.log(`Could not load item image: ${e}`)
                }
                compendium._content.push(itemEntry)
                prog.value += 1
            }
            if (filename) {
                prog.detail = `Creating XML`
                var compendiumXML = toXML(compendium,{indent:'\t'})
                await zip.addFile("compendium.xml",Buffer.from(compendiumXML,'utf8'),null)
                prog.detail = `Writing compendium file`
                zip.writeZip(filename)
                prog.detail = `Saved compendium`
                setTimeout(()=>prog.setCompleted(),1000)
            } else {
                prog.setCompleted()
            }
            return compendium
        }
    }
    async getMonsterCount(source = 0) {
        const url = "https://monster-service.dndbeyond.com/v1/Monster"
        var params
        if (source) {
            params = qs.stringify({ 'skip': 0, 'take': 1, 'sources': source })
        } else {
            params = qs.stringify({ 'skip': 0, 'take': 1 })
        }
        await this.getCobaltAuth()
        const response = await this.getRequest(`${url}?${params}`,true).catch((e)=>console.log(`Error getting monster count for source id ${source}: ${e}`))
        return response.pagination.total
    }
    async getMonsters(source = 0,filename,zip=null,imageMap=null) {
        const url = "https://monster-service.dndbeyond.com/v1/Monster"
        var params
        const count = await this.getMonsterCount(source).catch((e)=>console.log(e))
        console.log(`Source ${source} has ${count} monsters`)
        let pos = 0
        const prog = new ProgressBar({text: "Converting monsters...", detail: "Please wait...", indeterminate: false, maxValue: count})
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
                params = qs.stringify({ 'skip': pos, 'take': 100 })
            }
            const response = await this.getRequest(`${url}?${params}`,true).catch((e)=>console.log(`Error getting monster count for source id ${source}: ${e}`))
            console.log(`Retrieved ${response.data.length}`)
            for (const monster of response.data) {
                if (!monster.isReleased) {
                    prog.value += 1
                    continue
                }
                prog.detail = `${monster.name}`
                monster.avatarUrl = imageMap?.find(s=>s.id===monster.id&&s.type===monster.entityTypeId)?.avatar || monster.avatarUrl
                monster.basicAvatarUrl = imageMap?.find(s=>s.id===monster.id&&s.type===monster.entityTypeId)?.basicAvatar || monster.basicAvatarUrl
                compendium._content.push(await this.getMonsterEntry(monster,zip))
                prog.value += 1
            }
            pos += 100
        }
        if (filename) {
            prog.detail = `Creating XML`
            var compendiumXML = toXML(compendium,{indent:'\t'})
            await zip.addFile("compendium.xml",Buffer.from(compendiumXML,'utf8'),null)
            prog.detail = `Writing compendium file`
            zip.writeZip(filename)
            prog.detail = `Saved compendium`
            setTimeout(()=>prog.setCompleted(),1000)
        } else {
            prog.setCompleted()
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
                movement.push((this.ruledata.movements.find(s=>s.id===move.movemnetId)?.name||move.movementId.toString()) + `${move.speed} ft.${(move.notes)? ` (${move.notes})` : ''}`)
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
                for (let t of sanitize(field).split(/\r\n|\n/)) {
                    let m = traitRegex.exec(t); if (!m||!m[0]) continue
                    let txt = m[0].replace(m[1],'')
                    if (monsterEntry._content[monsterEntry._content.length-1]?.[type] && !m[1]) {
                        monsterEntry._content[monsterEntry._content.length-1][type].text += "\n"+txt
                        continue
                    }
                    monsterEntry._content.push( {[type]: { name: `${prefix}${m[2]}`, text: txt }} )
                }
            }
            handleTraits(monster.specialTraitsDescription,"trait")
            handleTraits(monster.actionsDescription,"action")
            handleTraits(monster.bonusActionsDescription,"action","Bonus Action: ")
            handleTraits(monster.reactionsDescription,"reaction")
            handleTraits(monster.legendaryActionsDescription,"legendary")
            handleTraits(monster.mythicActionsDescription,"legendary","Mythic Action: ")
            monsterEntry._content.push({
                description: `${sanitize(monster.characteristicsDescription)}

<i>Source: ${this.ruledata.sources.find((s)=> monster.sourceId === s.id).description}${(monster.sourcePageNumber)?  ` p. ${monster.sourcePageNumber}` : '' }</i>`
            })
            try{
                if (monster.basicAvatarUrl) {
                    if (!zip.getEntry(`monsters/${uuid5(monster.basicAvatarUrl,uuid5.URL)}.webp`)) {
                        let imagesrc = (monster.basicAvatarUrl.startsWith('listing_images/'))? zip.readFile(monster.basicAvatarUrl) : await this.getImage(monster.basicAvatarUrl).catch(e=>console.log(`Could not retrieve image: ${e}`))
                        let image = await sharp(imagesrc).webp().toBuffer()
                        await zip.addFile(`monsters/${uuid5(monster.basicAvatarUrl,uuid5.URL)}.webp`,image)
                    }
                    monsterEntry._content.push( { image: `${uuid5(monster.basicAvatarUrl,uuid5.URL)}.webp` } )
                }
            } catch (e) {
                console.log(`Error adding artwork: ${e}\n${monster.basicAvatarUrl}`)
            }
            try {
                if (monster.avatarUrl) {
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
            onStarted: (d) => {
                prog = new ProgressBar({
                    text: "Converting book...",
                    detail: "Downloading book...",
                    indeterminate: (d.getTotalBytes())?false:true,
                    maxValue: d.getTotalBytes()
                })
            },
            onProgress: (p) => {

                if (p.totalBytes && !prog.isCompleted()) prog.value = p.transferredBytes
            },
            onCompleted: (f) => {
                prog.setCompleted()
                this.convertModule(moduleId,bookkey.data[0].data,filename)
            }
        })
    }

    convertModule(moduleId,key,filename) {
        const book = this.ruledata.sources.find(s=>s.id===moduleId)
        const temp = tmp.dirSync()
        const prog = new ProgressBar({
            text: "Converting book...",
            detail: "Extracting database...",
            indeterminate: true,
        })
        var mod = {
            _name: "module",
            _attrs: { id: `https://www.dndbeyond.com/${book.sourceURL}` },
            _content: [
                { name: book.description },
                { slug: book.name.toLowerCase() },
                { image: `images/cover.jpg` }
            ]
        }
        var zip = AdmZip(filename)
        zip.extractEntryTo(`${book.name.toLowerCase()}.db3`,temp.name,false,true)
        var db = new sqlite3.Database(path.join(temp.name,`${book.name.toLowerCase()}.db3`))
        var imageMap = []
        db.serialize(() => {
            db.run(`PRAGMA key='${Buffer.from(key,'base64').toString('utf8')}'`)
            db.run("PRAGMA cipher_compatibility = 3")
            db.each("SELECT M.ID,A.EntityID AS AID,A.EntityTypeID AS AET,B.EntityID AS BID,B.EntityTypeID AS BET,A.FileName as AFile,B.FileName as BFile FROM RPGMonster M LEFT JOIN Avatar AS A ON M.AvatarID = A.ID LEFT JOIN Avatar AS B ON M.BasicAvatarID = B.ID WHERE M.AvatarID IS NOT NULL OR M.BasicAvatarID IS NOT NULL",(e,c)=>{
                imageMap.push( {
                    id: c.ID||c.AID||c.BID,
                    type: c.AET||c.BET,
                    avatar: (c.AFile)?`listing_images/${c.AFile}`:null,
                    basicAvatar: (c.BFile)?`listing_images/${c.BFile}`:null
                } )
            })
            db.each("SELECT M.ID,A.EntityID as AID,A.EntityTypeID as AET,A.FileName as AFile,B.EntityID AS BID,B.EntityTypeID as BET,B.FileName as BFile FROM RPGMagicItem M LEFT JOIN Avatar AS A ON M.AvatarID = A.ID LEFT JOIN Avatar AS B ON M.LargeAvatarID = B.ID WHERE M.AvatarID IS NOT NULL OR M.LargeAvatarID IS NOT NULL",(e,c)=>{
                imageMap.push( {
                    id: c.ID||c.AID||c.BID,
                    type: c.AET||c.BET,
                    avatar: (c.AFile)?`listing_images/${c.AFile}`:null,
                    largeAvatar: (c.BFile)?`listing_images/${c.BFile}`:null
                } )
            })
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
                        content: ((zip.getEntry(`images/chapter-backgrounds/${c.Slug}.jpg`))?`<img src="images/chapter-backgrounds/${c.Slug}.jpg">`:'') + he.decode(c.RenderedHtml
                            .replaceAll(/ddb:\/\/compendium\/(.*?)\//g,"/module/$1/page/")
                            //.replaceAll(/\/page\/([^"]*?)#/g,"/page/$1-")
                            //.replaceAll(/\/page\/([^"]*?)#/g,"/page/$1-")
                            .replaceAll(new RegExp(`ddb:\/\/image\/${book.name.toLowerCase()}\/`,'g'),"")
                            .replaceAll(new RegExp(`\\./${book.name.toLowerCase()}/`,'g'),"")
                            .replaceAll(/ddb:\/\/conditions\/([0-9]*)/g, (m,m1)=>
                                {
                                    const condition = this.ruledata.conditions.find(s=>s.definition.id===parseInt(m1)).name
                                    return `/module/br/appendix-a-conditions#${condition}`
                                }
                            )
                            .replaceAll(/ddb:\/\/(.*?)\/([0-9]*)/g, (m,root,n)=>
                                {
                                    var repl = m
                                    switch(root) {
                                        case "skills":
                                            n = this.ruledata.abilitySkills.find(s=>s.id===parseInt(n)).name
                                            repl =  `/module/br/using-ability-scores-UsingEachAbility#${n}`
                                            break
                                        case "actions":
                                            n = this.ruledata.basicActions.find(s=>s.id===parseInt(n)).name
                                            repl = `/module/br/combat-ActionsinCombat#${n}`
                                            break
                                        case "senses":
                                            n = this.ruledata.senses.find(s=>s.id===parseInt(n)).name
                                            repl = `/module/br/monsters-MonsterStatistics#${n}`
                                            break
                                        case "spells":
                                            repl = `/spell/${uuid5(m,uuid5.URL)}`
                                            break
                                        case "monsters":
                                            repl = `/monster/${uuid5(m,uuid5.URL)}`
                                            break
                                        case "magicitems":
                                        case "adventuring-gear":
                                        case "weapon":
                                        case "armor":
                                            repl = `/item/${uuid5(m,uuid5.URL)}`
                                            break
                                        default:
                                            console.log(`Unknown URL: ${repl}`)
                                    }
                                    return repl
                                }
                            )
                            )
                    }
                }
                if (c.ParentSlug) {
                    page.page._attrs.parent = uuid5(`https://www.dndbeyond.com/${book.sourceURL}/${c.ParentSlug}`,uuid5.URL)
                    let parentpage = mod._content.find(s=>s.page?._attrs?.id==page.page._attrs.parent)?.page
                    if (parentpage) {
                        parentpage.content = parentpage.content.concat("\n",page.page.content)
                    } else {
                        mod._content.push(page)
                    }
                } else {
                    mod._content.push(page)
                }
            },
            async () => {
                prog.detail = "Writing CSS"
                var customcss = ""
                for (let css of this.css) {
                    try {
                        console.log(`Retrieving ${css}`)
                        let cssBuf = await this.getImage(css).catch(e=>console.log(`Error retrieving ${css}: ${e}`))
                        customcss = customcss.concat(
                            cssBuf.toString('utf8').replaceAll(/url\((['"]?)((?:https?:)?\/\/.*?)(?:\1)\)/g,(m,m1,m2)=>{
                                if (!m2.startsWith("http")) m2 = "https:" + m2
                                if (m2.startsWith("http://i.imgur.com")) return m
                                let resName = uuid5(m2,uuid5.URL)
                                if (path.extname(m2)) resName += path.extname(m2)
                                this.getImage(m2).then(r=>zip.addFile(`assets/res/${resName}`,r)).catch(e=>console.log(`${m2}-${e}`))
                                return `url(${resName})`
                            })
                        )
                        console.log("Added to custom.css")
                    } catch (e) {
                        console.log('Error loading css: ${e}')
                    }
                }
                console.log("Adding book.css to custom.css")
                customcss = customcss.concat(zip.readAsText("css/book.css"))
                console.log("Adding light.css to custom.css")
                customcss = customcss.concat(zip.readAsText("css/light.css"))
                console.log("Adding fixing css line endings")
                customcss = customcss.replaceAll(/(\.\.\/)+/g,"../../").replaceAll(/\/images\/letters\//g,"/images/").replaceAll(/\r\n/g,"\n")
                console.log("Adding custom.css to zip")
                zip.addFile('assets/css/custom.css',customcss)
                console.log("Storing module.xml")
                prog.detail = "Writing Module XML"
                zip.addFile('module.xml',toXML(mod,{indent: '\t'}))
                console.log("Retrieving Monsters...")
                var compendium = await this.getMonsters(moduleId,null,zip,imageMap)
                console.log("Retrieving Items...")
                var compI = await this.getItems(moduleId,null,zip,imageMap)
                console.log("Retrieving Spells...")
                var compS = await this.getSpells(moduleId,null,zip)
                console.log("Merging compendiums...")
                compendium._content = compendium._content.concat(compI._content,compS._content)
                console.log("Storing compendium.xml")
                prog.detail = "Writing Compendium XML"
                zip.addFile('compendium.xml',toXML(compendium,{indent: '\t'}))
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
        this.setCobaltSession().then(
            this.getUserData().then(
                this.populateCampaigns().then(
                    this.getRuleData()
                )
            )
        )
    }
}

module.exports = DDB
