import { PNG } from "pngjs";
import { readFileSync, writeFileSync } from "node:fs";
const dir = "C:/Users/mustafa/.quake-code/agent/extensions/quake-chrome-bridge/chrome-extension/icons";
const src = PNG.sync.read(readFileSync(dir + "/icon-512.png"));
function resize(src, tw, th) {
  const out = new PNG({ width: tw, height: th });
  const sx = src.width / tw, sy = src.height / th;
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const x0=Math.floor(x*sx),x1=Math.min(src.width,Math.ceil((x+1)*sx));
    const y0=Math.floor(y*sy),y1=Math.min(src.height,Math.ceil((y+1)*sy));
    let r=0,g=0,b=0,a=0,n=0;
    for(let yy=y0;yy<y1;yy++)for(let xx=x0;xx<x1;xx++){const i=(src.width*yy+xx)<<2;r+=src.data[i];g+=src.data[i+1];b+=src.data[i+2];a+=src.data[i+3];n++;}
    const o=(tw*y+x)<<2;out.data[o]=r/n;out.data[o+1]=g/n;out.data[o+2]=b/n;out.data[o+3]=a/n;
  }
  return out;
}
for (const s of [128,48,32,16]) { writeFileSync(dir+"/icon-"+s+".png", PNG.sync.write(resize(src,s,s))); console.log("wrote icon-"+s); }
