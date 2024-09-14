const Slugify = require('slugify')
const { convert } = require('html-to-text')

function slugify(str) {
   return Slugify(str,{ lower: true, strict: true })
}
function camelCase(str) {
    return str.trim().replace(/^\w|\b\w/g,(w,i)=>(i===0)?w.toLowerCase():w.toUpperCase()).replace(/(\s|-)+/g,'')
}
                        
function fixDDBLinks(text,rulesdata,v5=false) {
        let orig = text
        text = text.replace(/^https?:\/\/dndbeyond.com\/linkout\?remoteUrl=/,'')
        if (rulesdata) {
            if (text.match(/^(https?:\/\/(?:www\.|draft\.)?dndbeyond\.com)?\/+compendium\/(rules|adventures)\/.*/)) {
                text = text.replace(/^(https?:\/\/(?:www\.|draft\.)?dndbeyond\.com)?\/+compendium\/(rules|adventures)\//,"https://www.dndbeyond.com/sources/")
            }
            if (v5) {
                let m
                if (m = text.match(/appendix-a-conditions#(\w+)/))
                    if (rulesdata.conditions.find(r=>slugify(r.definition.name)==slugify(m[1])))
                        return `/condition/${slugify(m[1])}`
                if (m = text.match(/using-ability-scores#(\w+)/)) {
                    let match = rulesdata.abilitySkills.find(r=>
                        slugify(r.name)==slugify(m[1])
                        || slugify(r.name.replace(/\s+/g,'')) == slugify(m[1])
                    )
                    if (match) {
                        return `/ability-skill/${slugify(match.name)}`
                    } else if (rulesdata.stats.find(r=>slugify(r.name)==slugify(m[1]))) {
                        return `/ability-score/${slugify(m[1])}`
                    }
                }
                if (m = text.match(/combat#(\w+)/)) {
                    let match = rulesdata.basicActions.find(r=>
                        slugify(r.name)==slugify(m[1])
                        || slugify(r.name.replace(/\s+/g,'')) == slugify(m[1])
                        || ( r.name.toLowerCase() == "grapple" && 
                            m[1].toLowerCase() == "grappling")
                        || ( r.name.toLowerCase() == "opportunity attack" &&
                            m[1].toLowerCase() == "opportunityattacks")
                    )
                    if (match)
                        return `/action/${slugify(match.name)}`
                }
                if (m = text.match(/monsters#(\w+)/))
                    if (rulesdata.senses.find(r=>slugify(r.name)==slugify(m[1])))
                        return `/sense/${slugify(m[1])}`
            }
            if (
                text.match(/appendix-a-conditions#(\w+)/) ||
                text.match(/using-ability-scores#(\w+)/) ||
                text.match(/monsters#(\w+)/)
                ) {
                console.warn('BR Didnt match!',text)
            }
            let ddburl = text.match(/^https:\/\/(?:www\.|draft\.)?dndbeyond\.com\/(sources\/[^\/ ]*)/)
            if (ddburl) {
                let source = rulesdata.sources?.find(s=>{
                    if (s.sourceURL.toLowerCase()==ddburl[1].toLowerCase()) {
                        return true
                    } else if (s.sourceURL.toLowerCase().replace('/dnd','')==ddburl[1].toLowerCase()) {
                        return true
                    } else if (s.sourceURL.toLowerCase().replace(/-2014$/,'')==ddburl[1].toLowerCase()) {
                        return true
                    } else if (s.sourceURL.toLowerCase().replace('/dnd','').replace(/-2014$/,'')==ddburl[1].toLowerCase()) {
                        return true
                    }
                    return false
                })
                if (source) {
                    text=text.replaceAll(new RegExp(`https:\/\/(?:www\.|draft\.)?dndbeyond\.com\/${ddburl[1]}`,'ig'),`/module/${source.name.toLowerCase()}/page`).replaceAll(/\/page$/g,`/page/${source.name.toLowerCase()}`)
                    if (source.name.toLowerCase()=='sais') {
                        text=text.replace(/(\/sais\/page\/(?:bam|aag|lox))\/(.*)/,'$1-$2')
                    }
                }
            }
            if (text.match(/^https:/)) {
                text=text.replace(/^(?:https:\/\/(?:www\.|draft\.)?dndbeyond\.com)?\/(?:(background|class|subclass|feat|vehicle)e?s)\/([^ #]*)(?:#([^ ]+))?/,(match,p1,p2,p3)=>{
                    if (p1 == "class") {
                        if (rulesdata.classConfigurations.find(c=>slugify(c.name)==p2) && p3 != 'BattleMaster') {
                            console.log(match,p1,p2,p3,'->',`/${p1}/${p2}`)
                            return `/${p1}/${p2}`;
                        } else {
                            console.log(match,p1,p2,p3,`/sub${p1}/${slugify((p3||p2).replace(/(?<=[a-z])(?=[A-Z])/,' '))}`)
                            return `/sub${p1}/${slugify((p3||p2).replace(/(?<=[a-z])(?=[A-Z])/,' '))}`;
                        }
                    } else {
                        return `/${p1}/${p2}`;
                    }
                })
            }
        }
        text=text.replace(/^(?:https:\/\/(?:www\.|draft\.)?dndbeyond\.com)?\/(monsters|spells|armor|weapons|adventuring-gear|magic-items|equipment)\/(?:([0-9]+)-?)?(.*)?/,(m,p1,p2,p3)=>{
            if (!p3) {
                console.log(orig,m)
            }
            switch(p1) {
                case "monsters":
                    return `/monster/${(p3)?p3:uuid5(`ddb://${p1}/${p2}`,uuid5.URL)}`;
                case "spells":
                    return `/spell/${(p3)?p3:uuid5(`ddb://${p1}/${p2}`,uuid5.URL)}`;
                default:
                    return `/item/${(p3)?p3:uuid5(`ddb://${p1}/${p2}`,uuid5.URL)}`;
            }
        })
        if (orig==text && !text.startsWith('/')) console.warn('NO MATCH:',orig)
        return text
}

function fixDDBTag(text,markdown = false) {
    const tags = /(\\|)\[([^\]]*)\1\]([^[;]*)(?:;([^[]*))?\1\[\/\2\1\]/gs
    const convert = (m,_,p1,p2,p3) => {
        let slug = slugify(sanitize(p2))
        let path = p1
        let label = p3||p2
        if (p1 == "magicitem") path = "item"
        if (p1 == "rollable") {
            label = p2
            let roll = {}
            try{
                let json = p3.replaceAll(/<(\w+).*>(.*)<\/\1>/gm,'$2')
                diceNotation = JSON.parse(json)
            } catch(e) {
                console.log(`Error ${e}`,p3)
            }
            if (!roll.diceNotation) roll.diceNotation = '1d20'
            if (!roll.rollType) roll.rollType = 'roll'
            if (!roll.rollAction) roll.rollAction = label
            path = 'roll'
            slug = `${roll.diceNotation}/${roll.rollAction}/${roll.rollType}`

        }
        if (p1 == "skill" || p1 == "sense" || p1 == "stat") path = "custom"
        if (markdown) {
            return `(${label})[/${path}/${slug}]`
        } else {
            return `<a href="/${path}/${slug}">${label}</a>`
        }
    }
    return text.replaceAll(tags,convert)
}


const markDownLinks = /(\[(?:[^\]]*)?\]\()((?:https?:\/\/)?[A-Za-z0-9\:\/\.\?#=-]+)((?: "[^"]*?")?\))/gm
const markDownImages = /(\!\[(?:[^\]]*)?\]\()((?:https?:\/\/)?[A-Za-z0-9\:\/\.\?#=-]+)((?: "[^"]*?")?\))/gm

function sanitize(text,rulesdata=null) {
    return convert(text,{
        wordwrap: null,
        formatters: {
            'keepA': function (elem, walk, builder, formatOptions) {
                if (elem?.attribs?.href) {
                    elem.attribs.href = fixDDBLinks(elem.attribs.href,rulesdata)
                }
                builder.addInline(`<${elem.name} href="${elem.attribs.href}">`)
                walk(elem.children, builder);
                builder.addInline(`</${elem.name}>`);
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
    }).replaceAll(/[\p{Pd}−]/gu, "-").replaceAll(/<[^>]*[\n][^>]*>/g,m=>m.replaceAll("\n"," "))
}

module.exports = { slugify, camelCase, fixDDBLinks, fixDDBTag, markDownLinks, markDownImages, sanitize }
