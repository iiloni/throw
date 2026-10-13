/* Actual SVG rasterization for source QA, not application integration.
   Requires Node.js and sharp (libvips/librsvg). */
const fs=require('fs');const path=require('path');const sharp=require('sharp');
const root=path.resolve(__dirname,'..');const work=path.resolve(root,'../throw-work');
const sizes=[1024,512,192,128,64,48,32,24,16];
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
async function main(){
 fs.mkdirSync(path.join(work,'svg-renders'),{recursive:true});fs.mkdirSync(path.join(root,'validation/sizes'),{recursive:true});
 const svgs=walk(root).filter(p=>p.endsWith('.svg'));
 for(const p of svgs){
  const output=path.join(work,'svg-renders',path.relative(root,p).replaceAll(path.sep,'__')+'.png');
  await sharp(p,{density:96}).resize({width:256,height:256,fit:'inside'}).png().toFile(output);
 }
 for(const c of ['stable','preview','dev']){
  for(const s of sizes){
   const name=s>=128?`throw-icon-${c}.svg`:s>=48?`throw-icon-${c}-small.svg`:`throw-favicon-${c}.svg`;
   await sharp(path.join(root,c,name),{density:96}).resize(s,s).png().toFile(path.join(root,'validation/sizes',`${c}-${s}.png`));
  }
  // Additional primary-versus-simplified comparisons at small sizes.
  for(const s of [64,32,16])await sharp(path.join(root,c,`throw-icon-${c}.svg`)).resize(s,s).png().toFile(path.join(work,`primary-${c}-${s}.png`));
  // Rasterize the complete layers at high resolution for bounds/masking tests.
  for(const what of ['foreground','background'])await sharp(path.join(root,c,`throw-adaptive-${what}-${c}.svg`)).resize(2048,2048).png().toFile(path.join(work,`adaptive-${what}-${c}.png`));
  await sharp(path.join(root,c,`throw-maskable-${c}.svg`)).resize(2048,2048).png().toFile(path.join(work,`maskable-${c}.png`));
  const pwaForeground=fs.readFileSync(path.join(root,c,`throw-maskable-${c}.svg`),'utf8').replace(/<rect\b[^>]*id="background-tile"[^>]*\/>/,'');
  await sharp(Buffer.from(pwaForeground)).resize(2048,2048).png().toFile(path.join(work,`maskable-foreground-${c}.png`));
 }
 await sharp(path.join(root,'shared/throw-adaptive-monochrome.svg')).resize(2048,2048).png().toFile(path.join(work,'adaptive-monochrome.png'));
 const report={renderer:'sharp '+sharp.versions.sharp,versions:sharp.versions,allSourceSvgCount:svgs.length,allSourceSvgRenderSize:'fit inside 256 × 256',iconTargetSizes:sizes,selectedTier:'primary >=128; small 48–127; micro 16–47',renderedSvgs:svgs.map(p=>path.relative(root,p))};
 fs.writeFileSync(path.join(root,'validation/render-report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(`Rendered all ${svgs.length} SVGs and ${sizes.length*3} assigned-size icon proofs with librsvg ${sharp.versions.rsvg}.`);
}
main().catch(e=>{console.error(e);process.exit(1)});
