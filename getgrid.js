const { ipcRenderer } = require('electron');
Module = {
  onRuntimeInitialized() {
    ipcRenderer.send("openCVWorkerReady",null)
  }
}
const cv = require('./opencv');
async function getGrid (imgBuffer,info) {
    console.log("Getting grid...")
    const grn = [ 36,255,12 ];
    let grid = {
        size: 0,
        freq: 0,
        scale: 1,
        x: 0,
        y: 0
    }
    try { 
    const anchor = new cv.Point( -1,-1 );
    let image = cv.matFromImageData({data: imgBuffer, width: info.width, height: info.height});
    cv.cvtColor(image,image,cv.COLOR_BGRA2GRAY);
    cv.adaptiveThreshold(image,image,255,cv.ADAPTIVE_THRESH_GAUSSIAN_C,cv.THRESH_BINARY_INV,11,2)
    const hKern = cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(30,1));
    const vKern = cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(1,30));
    for (let iter = 18; iter > 0; iter --) {
        ipcRenderer.send("gridProgress",`${(100*((19-iter)/18)).toFixed()}%`)
        let hDetect = new cv.Mat();
        let vDetect = new cv.Mat();
        cv.morphologyEx(image,hDetect,cv.MORPH_OPEN,hKern,anchor,iter);
        cv.morphologyEx(image,vDetect,cv.MORPH_OPEN,vKern,anchor,iter);
        let hLines = new cv.MatVector();
        let hHierarchy = new cv.Mat();
        let vLines = new cv.MatVector();
        let vHierarchy = new cv.Mat();
        cv.findContours(hDetect,hLines,hHierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
        cv.findContours(vDetect,vLines,vHierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
        let rows = [];
        let cols = [];
        for(let i = 0; i < hLines.size(); ++i) {
            let line = hLines.get(i).data32S
            let y = line[0]
            for( let xy = 0; xy < line.length; xy+=2 ) {
                y=(y+line[xy])/2
            }
            rows.push(y);
        }
        for(let i = 0; i < vLines.size(); ++i) {
            let line = vLines.get(i).data32S
            let x = line[1]
            for( let xy = 1; xy < line.length; xy+=2 ) {
                x=(x+line[xy])/2
            }
            cols.push(x);
        }
        hDetect.delete()
        vDetect.delete()
        hLines.delete()
        hHierarchy.delete()
        vLines.delete()
        vHierarchy.delete()
        if (rows.length < 2 || cols.length < 2) {
            continue
        }
        let diff = {
            x: [],
            y: []
        }
        let last = {
            x: cols[0],
            y: rows[0]
        }
        for(let row of rows) {
            let d = Math.abs(row-last.y)
            if (d > 30) {
                let diffRec = diff.y.find(s=>Math.abs(d-s.d)<2)
                if (diffRec) {
                    diffRec.count ++;
                    diffRec.total += d;
                    diffRec.offset = row;
                } else {
                    diff.y.push({
                        d: d,
                        count: 1,
                        total: d,
                        offset: row
                    })
                }
            }
            last.y = row
        }
        for(let col of cols) {
            let d = Math.abs(col-last.x)
            if (d > 30) {
                let diffRec = diff.x.find(s=>Math.abs(d-s.d)<2)
                if (diffRec) {
                    diffRec.count ++;
                    diffRec.total += d;
                    diffRec.offset = col;
                } else {
                    diff.x.push({
                        d: d,
                        count: 1,
                        total: d,
                        offset: col
                    })
                }
            }
            last.x = col
        }
        for(const row of diff.y) {
            let x = row.d;
            if (row.count <= 1) continue
            for(const col of diff.x) {
                let y = col.d
                if (col.count <= 1) continue
                if (Math.abs(x-y) > 2) continue
                if ((row.count+col.count) > grid.freq) {
                    grid.freq = (row.count+col.count);
                    grid.size = Math.round((row.total+col.total)/grid.freq);
                    grid.scale = grid.size/((row.total+col.total)/grid.freq);
                    grid.x = Math.floor(grid.scale*col.offset) % grid.size;
                    grid.y = Math.floor(grid.scale*row.offset) % grid.size;
                    if (grid.x > (grid.size/2)) grid.x -= grid.size;
                    if (grid.y > (grid.size/2)) grid.y -= grid.size;
                }
            }
        }
        if (grid.freq) {
            console.log(`Grid found with ${iter} iterations: `,grid);
            image.delete()
            break;
        }
    }
    } catch (e) {
        console.log('Error analyzing grid: ', e)
    }
    ipcRenderer.send("grid",grid)
    return grid;
}

async function getOffset(dmMapImgRaw,dmMapInfo,pcMapImg,info) {
    let markerOffset = {x:0,y:0,s:1}
    try {
        let dmImage = cv.matFromImageData({data: dmMapImgRaw,width: dmMapInfo.width, height: dmMapInfo.height})
        let pcImage = cv.matFromImageData({data: pcMapImg,width: info.width, height: info.height})
        let correlation = 0;
        let rows = dmImage.rows
        cv.resize(dmImage,dmImage,new cv.Size(dmImage.cols*1.5,dmImage.rows*1.5))
        if (dmMapInfo.width>info.width||dmMapInfo.height>info.height) {
            cv.cvtColor(pcImage,pcImage,cv.COLOR_BGRA2GRAY)
            cv.Canny(pcImage,pcImage,50,200)
            while(dmImage.rows >= pcImage.rows && dmImage.cols >= pcImage.cols) {
                let res = new cv.Mat()
                let tmpImg = new cv.Mat()
                cv.cvtColor(dmImage,tmpImg,cv.COLOR_BGRA2GRAY)
                cv.Canny(tmpImg,tmpImg,50,200)
                cv.matchTemplate(tmpImg,pcImage,res,cv.TM_CCOEFF)
                let loc = cv.minMaxLoc(res)
                if (loc.maxVal > correlation) {
                    markerOffset.x = -1*loc.maxLoc.x
                    markerOffset.y = -1*loc.maxLoc.y
                    markerOffset.s = dmImage.rows/rows
                    correlation = loc.maxVal
                    console.log(`${playerMap._attrs.id}: Better correlation @ ${markerOffset.s}`)
                }
                cv.resize(dmImage,dmImage,new cv.Size(dmImage.cols*.9,dmImage.rows*.9))
            }
        } else {
            console.log("DM Map is significantly smaller than PC Map",dmImage.cols,pcImage.cols)
            rows = pcImage.rows
            cv.resize(pcImage,pcImage,new cv.Size(pcImage.cols*1.5,pcImage.rows*1.5))
            cv.cvtColor(dmImage,dmImage,cv.COLOR_BGRA2GRAY)
            cv.Canny(dmImage,dmImage,50,200)
            while(dmImage.rows <= pcImage.rows && dmImage.cols <= pcImage.cols) {
                let res = new cv.Mat()
                let tmpImg = new cv.Mat()
                cv.cvtColor(pcImage,tmpImg,cv.COLOR_BGRA2GRAY)
                cv.Canny(tmpImg,tmpImg,50,200)
                cv.matchTemplate(tmpImg,dmImage,res,cv.TM_CCOEFF)
                let loc = cv.minMaxLoc(res)
                if (loc.maxVal > correlation) {
                    markerOffset.x = loc.maxLoc.x
                    markerOffset.y = loc.maxLoc.y
                    markerOffset.s = pcImage.rows/rows
                    correlation = loc.maxVal
                    console.log(`${playerMap._attrs.id}: Better correlation @ ${markerOffset.s}`)
                }
                cv.resize(pcImage,pcImage,new cv.Size(pcImage.cols*.9,pcImage.rows*.9))
            }
        }
    } catch (e) {
        console.log("OpenCV Error",e)
    }
    ipcRenderer.send("mapOffset",markerOffset)
}


ipcRenderer.on('getGrid',(ev,map,info)=>{
    getGrid(map,info)
})
ipcRenderer.on('getOffset',(ev,dmMapImgRaw,dmMapInfo,pcMapImg,info)=>{
    getOffset(dmMapImgRaw,dmMapInfo,pcMapImg,info)
})
//module.exports = getGrid

