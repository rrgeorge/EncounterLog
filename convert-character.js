const turndown = require('turndown');
const turndownGfm = require('@joplin/turndown-plugin-gfm');

const { slugify, camelCase, fixDDBLinks, fixDDBTag, markDownLinks } = require('./ddbutils');

function convertCharacter(ddb,rules) {
    const tdSvc = new turndown()
    tdSvc.use(turndownGfm.gfm)
    this.v5LinkAdj = (m,p1,p2,p3) => {
        return `${p1}${fixDDBLinks(p2,rules,true)}${p3}`
    }
    applyModifier = (m) => {
        if (m.type == "bonus" && m.entityTypeId==1472902489) {
            const stat = rules.stats.find(s=>s.id==m.entityId).key.toLowerCase()
            if (data.abilities[stat].otherBonus === undefined) data.abilities[stat].otherBonus = 0
            data.abilities[stat].otherBonus = m.fixedValue + data.abilities[stat].otherBonus
        } else if (m.type == "language") {
            if (!data.languages.includes(m.subType)) data.languages.push(m.subType)
        } else if (m.type == "resistance") {
            if (!data.damageResistances.includes(m.subType)) data.damageResistances.push(m.subType)
        } else if (m.type == "set-base" && m.entityTypeId == 668550506) {
            data.senses[rules.senses.find(s=>s.id==m.entityId).name.toLowerCase()] = m.fixedValue
        } else if (m.type == "half-proficiency") {
            if (m.subType == "initiative") {
                data.initiativeBonus += Math.floor(data.proficiencyBonus*.5)
            } else if (m.subType == "ability-checks") {
                for (const skill of Object.keys(data.skills)) {
                    if (!data.skills[skill].proficiency)
                        data.skills[skill].proficiency = "half"
                }
            } else if (m.entityTypeId == 1958004211) {
                const skill = camelCase(m.friendlySubtypeName)
                if (!data.skills[skill].proficiency)
                    data.skills[skill].proficiency = "half"
            }
            else { console.log(m.type,m.subType) }
        } else if (m.type == "proficiency") {
            if (m.subType.endsWith("-saving-throws")) {
                if (ddb.classes.slice(1).find(c=>
                    c.classFeatures.find(f=>
                        f.definition.name.match(/Proficiencies/)&&f.definition.id==m.componentId
                    )
                )) return
                let stat = data.abilities[m.subType.substring(0,3)]
                if (!stat.savingThrow) stat.savingThrow = {}
                stat.savingThrow.proficiency = "proficient"
            } else if (m.entityTypeId == 1782728300 || m.entityTypeId == 660121713) {
                let type = camelCase(m.subType)
                if (type == "simpleWeapons") type = "simple"
                if (type == "martialWeapons") type = "martial"
                if (type == "firearms") type = "firearm"
                if (!data.weaponProficiencies.includes(type)) data.weaponProficiencies.push(type)
            } else if (m.entityTypeId == 174869515) {
                let type = camelCase(m.subType)
                if (type == "lightArmor") type = "light"
                if (type == "mediumArmor") type = "medium"
                if (type == "heavyArmor") type = "heavy"
                if (type == "shields") type = "shield"
                if (!data.armorProficiencies.includes(type)) data.armorProficiencies.push(type)
            } else if (m.entityTypeId == 2103445194) {
                let type = camelCase(m.subType)
                if (!data.toolProficiencies.includes(type)) data.toolProficiencies.push(type)
            } else if (m.entityTypeId == 1958004211) {
                const skill = camelCase(m.friendlySubtypeName)
                if (!data.skills[skill].proficiency || data.skills[skill].proficiency == "half")
                    data.skills[skill].proficiency = "proficient"
            }
            else if (m.subType.startsWith("choose-")) { return }
        } else if (m.type == "expertise") {
            if (m.subType == "initiative") {
                data.initiativeBonus += Math.floor(data.proficiencyBonus*2.0)
            } else if (m.subType == "ability-checks") {
                for (const skill of Object.keys(data.skills)) {
                    data.skills[skill].proficiency = "expertise"
                }
            } else if (m.entityTypeId == 1958004211) {
                const skill = camelCase(m.friendlySubtypeName)
                data.skills[skill].proficiency = "expertise"
            }
        } else if (m.type == "set" && m.subType == "subclass") {
            return
        } else if (m.type == "size") {
            data.race.size = rules.creatureSizes.find(s=>s.id==m.entityId).name.charAt(0).toUpperCase()
        } else {
            console.log(`Unknown modifier ${m.type}: ${m.subType} -> ${m.fixedValue}/${m.value}`)
            //console.log(m)
        }
    }
    const addAction = (m) => {
        const tagRegex = /{{(?<level>characterlevel\+)?\(?(?<tag>classlevel|proficiency|scalevalue|(?:modifier|spellattack|savedc):(?<stat>(?:,?\w{3})+))(?:([-+*\/])(\d+))?\)?(?:@((?<mm>min|max):(?<mmv>\d)?|round(?:up|down)))?(#(?:un)?signed)?}}/g
        const deTag = (match,level,tag,stat,fn,mult,round,mm,mmv,signed) => {
            console.log(match,level,tag,stat,fn,mult,round,mm,mmv,signed)
            console.log(m.name,m.componentTypeId)
            if (signed == '#unsigned') signed = false
            if (tag == 'scalevalue') {
                if (m.componentTypeId == 12168134) {
                    let feature = ddb.classes.find(c=>c.classFeatures.find(f=>f.definition.id==m.componentId))
                        ?.classFeatures.find(f=>f.definition.id==m.componentId)
                    if (feature) {
                        if (feature.levelScale.fixedValue) {
                            const value = feature.levelScale.fixedValue
                            return `${(signed&&value>=0)?'+':''}${value}`
                        } else if (feature.levelScale.dice) {
                            const value = feature.levelScale.dice.diceString
                            return `[${value}](</roll/${value}/${m.name}>)`
                        }
                    }
                } else if (m.componentTypeId == 1960452172) {
                    //race
                } else if (m.componentTypeId == 1088085227) {
                    //feats
                }
            } else if (tag == 'classlevel') {
                if (m.componentTypeId == 12168134) {
                    let cls = ddb.classes.find(c=>c.classFeatures.find(f=>f.definition.id==m.componentId))
                    if (!cls) cls = ddb.classes[0]
                    if (cls) {
                        let value = cls.level
                        if (fn && mult) {
                            if (fn == '+') {
                                value += parseInt(mult)
                            } else if (fn == '-') {
                                value -= parseInt(mult)
                            } else if (fn == '*') {
                                value *= parseInt(mult)
                            } else if (fn == '/') {
                                value /= parseInt(mult)
                            }
                            if (round == "roundup") {
                                value = Math.ceil(value)
                            } else if (round == "rounddown") {
                                value = Math.floor(value)
                            }
                        }
                        console.log(value)
                        return `${(signed&&value>=0)?'+':''}${value}`
                    }
                }
            } else if (tag == 'proficiency') {
                let value  = data.proficiencyBonus
                return `${(signed&&value>=0)?'+':''}${value}`
            } else if (tag.startsWith('savedc') || tag.startsWith('modifier') || tag.startsWith('spellattack')) {
                let values = []
                for (const st of stat.split(/,/)) {
                    let value
                    const modifier = Math.floor((data.abilities[st.toLowerCase()].base
                        + (data.abilities[st.toLowerCase()].otherBonus||0) - 10)*.5)
                    if (tag.startsWith('savedc')) {
                        value = (8+data.proficiencyBonus+modifier)
                    } else if (tag.startsWith('spellattack')) {
                        value = `+${data.proficiencyBonus+modifier}`
                    } else if (tag.startsWith('modifier')) {
                        value = modifier
                    }
                    if (
                        (mm == 'min' && value < parseInt(mmv))
                        || (mm == 'max' && value > parseInt(mmv))
                    )
                        value = mmv
                    if (level) value += overallLevel
                    values.push(value)
                }
                return values.join('/')
            }
            return match
        }
        let unit = camelCase(rules.activationTypes.find(a=>a.id==m.activation.activationType).name)
        let text = tdSvc.turndown(m.snippet.replace(tagRegex,deTag).replace(/(\r)?\n/g,'<br>'))
        let limitedUse
        if (m.limitedUse) {
            let reset = rules.limitedUseResetTypes.find(r=>r.id==m.limitedUse.resetType)
            limitedUse = {
                maxUses: m.limitedUse.maxUses,
                numberUsed: m.limitedUse.used,
                resetOn: camelCase(reset.name)
            }
            if (!limitedUse.used && m.limitedUse.statModifierUsesId) {
                const stat = rules.stats.find(s=>s.id==m.limitedUse.statModifierUsesId).key.toLowerCase()
                limitedUse.maxUses = Math.floor((data.abilities[stat].base
                    + (data.abilities[stat].otherBonus||0) - 10)*.5)
            }
        }
        data.actions.push({
            id: m.id.toString(),
            name: m.name,
            activation: { unit: unit, time: m.activation.activationTime },
            limitedUse: limitedUse,
            descr: text,
            reference: m.reference,
            attackType: m.attackType,
            attack: m.attack,
            savingThrow: m.savingThrow,
            ability: m.ability,
            damage: m.damage,
            damageType: m.damageType,
            range: m.attackRange
        })
    }
    const addSpell = (m,i) => {
        spellName = (m.definition.isLegacy)?`${m.definition.name} [Legacy]`:m.definition.name
            //(m.definition.sources.find(s=>s.sourceId<=5))?`${m.definition.name} (2014)`:m.definition.name
        data.spells.push({
            name: spellName,
            reference: `/spell/${slugify(spellName)}`,
            level: m.definition.level
        })
        const damage = m.definition.modifiers.find(mod=>mod.type=='damage')
        if (damage && (m.definition.requiresSavingThrow||m.definition.requiresAttackRoll) && !m.definition.asPartOfWeaponAttack) {
            const spellcastingAbility=(m.spellCastingAbilityId)?rules.stats.find(s=>s.id==m.spellCastingAbilityId).key.toLowerCase()
                :(ddb.classes[i].definition.canCastSpells)?
                rules.stats.find(s=>s.id==ddb.classes[i].definition.spellCastingAbilityId).key.toLowerCase()
                    :(ddb.classes[i].subclassDefinition?.canCastSpells)?
                        rules.stats.find(s=>s.id==ddb.classes[i].subclassDefinition.spellCastingAbilityId).key.toLowerCase()
                        :undefined
            const attack = Math.floor((data.abilities[spellcastingAbility].base
                + (data.abilities[spellcastingAbility].otherBonus||0) - 10)*.5)
                + data.proficiencyBonus
            const savedc = (8+attack)
            console.log(`This is an attack: ${m.definition.name}, ${attack}, DC ${savedc}`)
            let action = m.definition
            action.name = spellName
            action.attackType = "spell"
            action.reference = `/spell/${slugify(spellName)}`
            if (m.definition.requiresAttackRoll) action.attack = attack
            if (m.definition.requiresSavingThrow) {
                action.savingThrow = savedc
                action.ability = rules.stats.find(s=>s.id==m.definition.saveDcAbilityId).key.toLowerCase()
            }
            action.damage = damage.fixedValue||damage.die?.diceString||damage.value
            action.damageType = damage.subType
            if (m.definition.range?.rangeValue) action.attackRange = m.definition.range?.rangeValue
            addAction(action)
        }
    }
    overallLevel = ddb.classes.map(c=>c.level).reduce((a,b)=>a+b,0)
    data = { }
    character = {
        data: data,
        id: ddb.id.toString(),
        name: ddb.name,
        slug: slugify(ddb.name)
    }
    data.abilities = {}
    for (const s of ddb.stats) {
        const stat = rules.stats.find(st=>st.id==s.id).key.toLowerCase()
        data.abilities[stat] = { base: s.value }
    }
    for (const s of ddb.overrideStats) {
        const stat = rules.stats.find(st=>st.id==s.id).key.toLowerCase()
        if (s.value)
            data.abilities[stat].base = s.value
    }
    for (const s of ddb.bonusStats) {
        const stat = rules.stats.find(st=>st.id==s.id).key.toLowerCase()
        if (s.value)
            data.abilities[stat].base += s.value
    }
    data.hp = {
        current: ddb.baseHitPoints-ddb.removedHitPoints,
        maximum: ddb.baseHitPoints,
        temporary: (ddb.temporaryHitPoints>0)?ddb.temporaryHitPoints:null
    }
    data.proficiencyBonus = Math.floor(2+((overallLevel-1)*.25))
    data.initiativeBonus = 0
    data.skills = {
        athletics: {},
        acrobatics: {},
        sleightOfHand: {},
        stealth: {},
        arcana: {},
        history: {},
        investigation: {},
        nature: {},
        religion: {},
        animalHandling: {},
        insight: {},
        medicine: {},
        perception: {},
        survival: {},
        deception: {},
        intimidation: {},
        performance: {},
        persuasion: {},
    }
    data.actions = []
    data.languages = []
    data.senses = {}
    data.damageVulnerabilities = []
    data.damageResistances = []
    data.damageImmunities = []
    data.conditionImmunities = []
    data.weaponProficiencies = []
    data.armorProficiencies = []
    data.toolProficiencies = []
    data.limitedUseActions = {}
    let raceName = (ddb.race.isLegacy)?`${ddb.race.fullName} [Legacy]`:ddb.race.fullName
        //(ddb.race.sources.find(s=>s.sourceId<=5))?`${ddb.race.fullName} (2014)`:ddb.race.fullName
    data.race = {
        name: raceName,
        descr: tdSvc.turndown(ddb.race.description),
        reference: `/race/${slugify(raceName)}`,
        size: rules.creatureSizes.find(s=>s.id==ddb.race.sizeId)?.name.charAt(0).toUpperCase(),
        speed: {
            walk: ddb.race.weightSpeeds?.normal?.walk,
            fly: ddb.race.weightSpeeds?.normal?.fly,
            burrow: ddb.race.weightSpeeds?.normal?.burrow,
            swim: ddb.race.weightSpeeds?.normal?.swim,
            climb: ddb.race.weightSpeeds?.normal?.climb
        },
        traits: ddb.race.racialTraits.map(t=>({
            name: t.definition.name,
            text: tdSvc.turndown(t.definition.description)
        }))
    }
    ddb.modifiers.race.forEach(applyModifier)
    if (ddb.background?.definition) {
        let backgroundName = (ddb.background.definition.sources.find(s=>s.sourceId<=5))?`${ddb.background.definition.name} [Legacy]`:ddb.background.definition.name
        data.background = {
            name: backgroundName,
            descr: tdSvc.turndown(ddb.background.definition.shortDescription.replace(/(<table[^>]*>)<caption>(.*)<\/caption>/s,'$2\n$1')).replaceAll(markDownLinks,this.v5LinkAdj),
            reference: `/background/${slugify(backgroundName)}`,
        }
        if (ddb.background.definition.featureDescription) {
            data.background.entries = [
                {
                    name: ddb.background.definition.featureName,
                    text: tdSvc.turndown(ddb.background.definition.featureDescription)
                }
            ]
        }
        ddb.modifiers.background.forEach(applyModifier)
    }
    data.classes = ddb.classes.sort((a,b)=>a.isStartingClass?-1:b.isStartingClass?1:0).map(c=>({
        name: (c.definition.sources.find(s=>s.sourceId<=5))?`${c.definition.name} [Legacy]`:c.definition.name,
        level: c.level,
        reference: `/class/${slugify((c.definition.sources.find(s=>s.sourceId<=5))?`${c.definition.name} [Legacy]`:c.definition.name)}`,
        descr: tdSvc.turndown(c.definition.description),
        castSpells: c.definition.canCastSpells||c.subclassDefinition?.canCastSpells,
        spellcastingAbility: (c.definition.canCastSpells)?
            rules.stats.find(s=>s.id==c.definition.spellCastingAbilityId).key.toLowerCase()
                :(c.subclassDefinition?.canCastSpells)?
                    rules.stats.find(s=>s.id==c.subclassDefinition.spellCastingAbilityId).key.toLowerCase()
                    :undefined,
        features: c.classFeatures
            .filter(f=>
                f.definition.requiredLevel<=c.level
                && !f.definition.name.match(/(Hit Points|Proficiencies|Equipment)/)
            )
            .sort((a,b)=>a.definition.displayOrder-b.definition.displayOrder)
            .map(f=>({
                level: f.definition.requiredLevel,
                name: f.definition.name,
                text: tdSvc.turndown(f.definition.description)
            })),
        subclass: c.subclassDefinition?.name
    }))
    ddb.modifiers.class.forEach(applyModifier)

    data.feats = ddb.feats.map(f=>{
        return {
            name: (f.definition.sources.find(s=>s.sourceId<=5))?`${f.definition.name} [Legacy]`:f.definition.name,
            descr: tdSvc.turndown(f.definition.description).replaceAll(markDownLinks,v5LinkAdj),
            reference: `/feat/${slugify((f.definition.sources.find(s=>s.sourceId<=5))?`${f.definition.name} [Legacy]`:f.definition.name)}`
        }
    })
    ddb.modifiers.feat.forEach(applyModifier)

    data.items = ddb.inventory.map(i=>{
        let name = (i.definition.isLegacy)?`${i.definition.name} [Legacy]`:i.definition.name
            //(i.definition.sources.find(s=>s.sourceId<=5))?`${i.definition.name} (2014)`:i.definition.name
        return({
            id: i.id.toString(),
            name: name,
            descr: i.definition.decription,
            container: i.definition.isContainer,
            equipped: i.equipped,
            quantity: i.quantity,
            parentId: (i.containerEntityId!=ddb.id)?i.containerEntityId.toString():null,
            reference: `/item/${slugify(name)}`
        })
    }
    )
    ddb.modifiers.item.forEach(applyModifier)

    ddb.actions.race?.forEach(addAction)
    ddb.actions.background?.forEach(addAction)
    ddb.actions.class?.forEach(addAction)
    ddb.actions.feat?.forEach(addAction)

    data.spells = []
    data.spellSlots = {}
    if (ddb.classes.length > 1) {
        const spellLevel = ddb.classes
            .filter(c=>c.definition.canCastSpells||c.subclassDefinition?.canCastSpells)
            .map(c=>Math.floor(c.level*1.0/c.definition.spellRules.multiClassSpellSlotDivisor))
            .reduce((a,b)=>a+b,0)
        if (spellLevel > 0)
            rules.multiClassSpellSlots[spellLevel].forEach((v,i)=>{
                data.spellSlots[i+1] = { available: v }
            })
    } else {
        if (ddb.classes[0].definition.canCastSpells||ddb.classes[0].subclassDefinition?.canCastSpells)
            ddb.classes[0].definition.spellRules.levelSpellSlots[overallLevel].forEach((v,i)=>{
                data.spellSlots[i+1] = { available: v }
            })
    }
    ddb.spells.race?.forEach(addSpell)
    ddb.spells.background?.forEach(addSpell)
    ddb.classSpells?.forEach((c,i)=>c.spells.forEach(s=>addSpell(s,i)))
    ddb.spells.feat?.forEach(addSpell)

    data.currency = ddb.currencies
    data.hp.maximum += Math.floor((data.abilities.con.base-10)*.5)*overallLevel
    data.hp.current = data.hp.maximum - ddb.removedHitPoints
    data.initiativeBonus += Math.floor((data.abilities.dex.base-10)*.5)

    data.xp = { current: ddb.currentXp }

    return character
}
module.exports = convertCharacter
