const { app } = require('electron')
const express = require('express')
const { networkInterfaces } = require('os')
const path = require('path')
class http {
    get ipaddr() {
        return this.app.locals.ip
    }
    get port() {
        return this.app.locals.port
    }

    constructor(filename,code,name) {
        this.app = express()
        this.app.locals.filename = filename
        this.app.locals.code = code
        this.app.locals.name = name

        this.app.get('/:filename', function(req,res) {
            if (req.params.filename != path.basename(req.app.locals.filename)) {
                res.sendStatus(404)
            } else {
                res.setHeader('Content-Disposition',`attachment; filename=${encodeURIComponent(path.basename(req.app.locals.filename))}`)
                    .sendFile(filename,()=>{})
            }
        })

        this.app.get('/', function(req,res) {
            res.contentType('application/json')
                .send(JSON.stringify(
                        {
                            "id": code,
                            "name": name,
                            "type": "module",
                            "version": app.getVersion(),
                            "description": `EncounterLog Export of ${name}`,
                            "download": `http://${req.app.locals.ip}:${req.app.locals.port}/${path.basename(req.app.locals.filename)}`
                        }
                    )
                )
        })

        this.server = new Promise((resolve,reject)=>{
            try{
                let server = this.app.listen(0,'::',()=>{
                    console.log("Server started.")
                    const nets = networkInterfaces()
                    for (const net of Object.keys(nets)) {
                        for(const ip of nets[net]) {
                            if (ip.family == 'IPv4' && !ip.internal) {
                                this.app.locals.ip = ip.address
                                break;
                            }
                        }
                        if (this.app.locals.ip) break;
                    }
                    console.log(server.address())
                    this.app.locals.port = server.address()?.port
                    resolve(server)
                })
            } catch(e) {
                reject(e)
            }
        })
    }
}
module.exports = http;
