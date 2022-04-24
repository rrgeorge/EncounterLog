const { cv, cvErrorPrinter } = require('opencv-wasm');
async function getGrid (imgBuffer,info,prog=null) {
    let detail = prog?.detail
    const grn = [ 36,255,12 ];
    const anchor = new cv.Point( -1,-1 );
    let image = cv.matFromImageData({data: imgBuffer, width: info.width, height: info.height});
    cv.cvtColor(image,image,cv.COLOR_BGRA2GRAY);
    cv.adaptiveThreshold(image,image,255,cv.ADAPTIVE_THRESH_GAUSSIAN_C,cv.THRESH_BINARY_INV,11,2)
    let grid = {
        size: 0,
        freq: 0,
        scale: 1,
        x: 0,
        y: 0
    }
    const hKern = cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(30,1));
    const vKern = cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(1,30));
    for (let iter = 18; iter > 0; iter --) {
        if (detail) prog.detail = `${detail} ${(100*((19-iter)/18)).toFixed()}%`
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

