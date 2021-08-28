const sharp = require('sharp');
const cv = require('opencv4nodejs-prebuilt');

async function getGrid (imgBuffer) {
    const grn = new cv.Vec3(36,255,12);
    const anchor= new cv.Point2(-1,-1);
    let image = cv.imdecode(imgBuffer);
    let gray = image.cvtColor(cv.COLOR_BGR2GRAY);
    let thresh = gray.adaptiveThreshold(255,cv.ADAPTIVE_THRESH_GAUSSIAN_C,cv.THRESH_BINARY_INV,11,2)
    let grid = {
        size: 0,
        freq: 0,
        scale: 1,
        x: 0,
        y: 0
    }
    for (let iter = 18; iter > 0; iter --) {
        const hSize = new cv.Size(30,1);
        const hKern = cv.getStructuringElement(cv.MORPH_RECT,hSize);
        const hDetect = thresh.morphologyEx(hKern,cv.MORPH_OPEN,anchor,iter);
        const vSize = new cv.Size(1,30);
        const vKern = cv.getStructuringElement(cv.MORPH_RECT,vSize);
        const vDetect = thresh.morphologyEx(vKern,cv.MORPH_OPEN,anchor,iter);
        const hLines = hDetect.findContours(cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
        const vLines = vDetect.findContours(cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
        

        let rows = [];
        let cols = [];
        for(let line of hLines) {
            let y = line.getPoints()[0].y
            for( let xy of line.getPoints() ) {
                y=(y+xy.y)/2
            }
            rows.push(y);
        }
        for(let line of vLines) {
            let x = line.getPoints()[0].x
            for( let xy of line.getPoints() ) {
                x=(x+xy.x)/2
            }
            cols.push(x);
        }
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
            break;
        }
    }
    return grid;
}

module.exports = getGrid

