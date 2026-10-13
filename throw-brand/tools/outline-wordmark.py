#!/usr/bin/env python3
"""Optional source-font recreation. Requires fontTools; runtime assets use frozen SVG paths."""
from pathlib import Path
import json, hashlib
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT=Path(__file__).resolve().parents[1]
font_path=ROOT/'wordmarks/source/Manrope-wght.ttf'
font=instantiateVariableFont(TTFont(font_path),{'wght':800},inplace=False)
gs=font.getGlyphSet(); cmap=font.getBestCmap()
def kern(a,b):
    total=0
    if 'GPOS' not in font: return 0
    gpos=font['GPOS'].table
    ids=set(i for f in gpos.FeatureList.FeatureRecord if f.FeatureTag=='kern' for i in f.Feature.LookupListIndex)
    for i in sorted(ids):
        lookup=gpos.LookupList.Lookup[i]
        for s in lookup.SubTable:
            typ=lookup.LookupType
            if typ==9: typ=s.ExtensionLookupType;s=s.ExtSubTable
            if typ!=2 or a not in s.Coverage.glyphs: continue
            v=None
            if s.Format==1:
                pairs=s.PairSet[s.Coverage.glyphs.index(a)].PairValueRecord
                v=next((p.Value1 for p in pairs if p.SecondGlyph==b),None)
            elif s.Format==2:
                c1=s.ClassDef1.classDefs.get(a,0);c2=s.ClassDef2.classDefs.get(b,0)
                v=s.Class1Record[c1].Class2Record[c2].Value1
            if v: total+=getattr(v,'XAdvance',0) or 0
    return total
chars='Throw'; x=0; items=[]; bounds=[]
for i,ch in enumerate(chars):
    name=cmap[ord(ch)]; bp=BoundsPen(gs);gs[name].draw(bp);b=bp.bounds
    k=kern(name,cmap[ord(chars[i+1])]) if i+1<len(chars) else 0
    tracking=-18 if i+1<len(chars) else 0
    advance=font['hmtx'][name][0]
    items.append({'character':ch,'name':name,'x':x,'advance':advance,'kerningToNext':k,'trackingToNext':tracking,'bounds':b})
    bounds.append([b[0]+x,b[1],b[2]+x,b[3]]);x+=advance+k+tracking
bb=[min(b[0] for b in bounds),min(b[1] for b in bounds),max(b[2] for b in bounds),max(b[3] for b in bounds)]
scale=1024/(bb[3]-bb[1]);width=round((bb[2]-bb[0])*scale,8)
paths=[]
for i,item in enumerate(items):
    pen=SVGPathPen(gs,ntos=lambda n:format(n,'.5f').rstrip('0').rstrip('.') if n else '0')
    gs[item['name']].draw(TransformPen(pen,(scale,0,0,-scale,(item['x']-bb[0])*scale,bb[3]*scale)))
    paths.append(f'<path id="letter-{i}-{item["character"]}" d="{pen.getCommands()}"/>')
for variant,ink in [('dark','#292B2D'),('light','#FFF9F0')]:
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="1024" viewBox="0 0 {width} 1024" role="img" aria-label="Throw"><title>Throw outlined wordmark</title><g id="throw-wordmark-outlines" fill="{ink}">'+'\n'.join(paths)+'</g></svg>\n'
    (ROOT/f'wordmarks/throw-wordmark-{variant}.svg').write_text(svg)
prov={'family':'Manrope','style':'ExtraBold','weight':800,'text':chars,'fontVersion':font['name'].getDebugName(5),'unitsPerEm':font['head'].unitsPerEm,'trackingFontUnits':-18,'trackingEm':-.009,'glyphEdits':'none','inkBoundsFontUnits':bb,'positionedGlyphs':items,'outlineScale':scale,'visibleInkViewBox':[0,0,width,1024],'fontSha256':hashlib.sha256(font_path.read_bytes()).hexdigest(),'sourceUrl':'https://github.com/google/fonts/tree/main/ofl/manrope','license':'SIL Open Font License 1.1','licenseFile':'OFL-Manrope.txt','authority':'Frozen SVG outlines; do not recreate from an updated font.'}
(ROOT/'wordmarks/source/throw-wordmark-provenance.json').write_text(json.dumps(prov,indent=2)+'\n')
horizontal={'canvas':[1280+width*600/1024,1024],'iconBox':[0,0,1024,1024],'wordmarkInkBox':[1280,204,width*600/1024,600],'wordmarkScale':600/1024,'gap':256,'opticalVerticalShift':-8}
stacked={'canvas':[1536,1216+1024*1536/width],'iconBox':[256,0,1024,1024],'wordmarkInkBox':[0,1216,1536,1024*1536/width],'wordmarkScale':1536/width,'gap':192}
tokens={'brand':'Throw','text':'Throw','tagline':'Throw yourself into it.','canonicalWordmark':'throw-wordmark-dark.svg','lightWordmark':'throw-wordmark-light.svg','canonicalWordmarkSha256':hashlib.sha256((ROOT/'wordmarks/throw-wordmark-dark.svg').read_bytes()).hexdigest(),'typeface':{'family':'Manrope','style':'ExtraBold','weight':800,'trackingEm':-.009,'nativeKerning':True,'runtime':'five outlined paths; no font dependency'},'canvas':[width,1024],'ink':{'dark':'#292B2D','light':'#FFF9F0'},'layouts':{'horizontal':horizontal,'stacked':stacked},'clearSpace':192,'minimumDisplay':{'horizontalWidthCssPx':112,'stackedWidthCssPx':96,'wordmarkOnlyInkHeightCssPx':18},'iconTierSelection':'Use shared icon size rules based on displayed icon width, not raster density or lockup width.','taglineUsage':'Supporting text only; sentence case; never inside launcher icons/favicons; retain existing UI font or Manrope Medium 500 in dedicated brand collateral. No tagged lockup artwork is prescribed.'}
(ROOT/'wordmarks/throw-wordmark-tokens.json').write_text(json.dumps(tokens,indent=2)+'\n')
print('Outlined Throw in Manrope ExtraBold 800:',width,'× 1024. Native pair kerning:',[i['kerningToNext'] for i in items])
