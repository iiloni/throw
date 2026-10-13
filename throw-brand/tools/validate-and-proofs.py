#!/usr/bin/env python3
"""Validate sources and assemble proof sheets after render-validation.cjs. Requires Pillow/numpy."""
import json,math,hashlib,re,subprocess,sys
from pathlib import Path
import xml.etree.ElementTree as ET
from PIL import Image,ImageDraw,ImageFont
import numpy as np

ROOT=Path(__file__).resolve().parents[1];WORK=ROOT.parent/'throw-work';V=ROOT/'validation'
fontpath='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
def font(n):return ImageFont.truetype(fontpath,n)
INK='#292B2D';PAPER='#F4F5F3'
def canvas(w,h,title,subtitle=''):
 im=Image.new('RGB',(w,h),PAPER);d=ImageDraw.Draw(im);d.text((28,20),title,font=font(25),fill=INK)
 if subtitle:d.text((28,56),subtitle,font=font(14),fill='#656866')
 return im,d
def paste(im,p,xy,size=None):
 p=Image.open(p).convert('RGBA') if not isinstance(p,Image.Image) else p.convert('RGBA')
 if size:p=p.resize(size,Image.Resampling.LANCZOS)
 im.paste(p,xy,p)
def save(im,name):im.save(V/name)
def checker(w,h):
 im=Image.new('RGB',(w,h),'#E8EBE8');d=ImageDraw.Draw(im)
 for y in range(0,h,12):
  for x in range(0,w,12):
   if (x//12+y//12)%2:d.rectangle((x,y,x+11,y+11),fill='#F7F8F5')
 return im

svgs=list(ROOT.rglob('*.svg'));jsons=list(ROOT.rglob('*.json'))
for p in jsons:json.loads(p.read_text())
for p in svgs:
 tree=ET.parse(p).getroot();ids=[e.get('id') for e in tree.iter() if e.get('id')]
 assert len(ids)==len(set(ids)),p
 for e in tree.iter():
  assert e.tag.split('}')[-1] not in ('image','text','script','foreignObject'),p
  for k,v in e.attrib.items():
   assert not k.endswith('href'),p
   for id in re.findall(r'url\(#([^)]*)\)',v):assert id in ids,(p,id)
 assert 'data:' not in p.read_text(),p
def geom(p):
 r=ET.parse(p).getroot();keys={'d','x','y','width','height','rx','ry','cx','cy','r','transform','viewBox','x1','x2','y1','y2'}
 return [(e.tag,sorted((k,v) for k,v in e.attrib.items() if k in keys)) for e in r.iter()]
for template in ['throw-icon-{}.svg','throw-icon-{}-small.svg','throw-favicon-{}.svg','throw-adaptive-foreground-{}.svg','throw-adaptive-background-{}.svg','throw-maskable-{}.svg']:
 paths=[ROOT/c/template.format(c) for c in ('stable','preview','dev')]
 assert geom(paths[0])==geom(paths[1])==geom(paths[2]),template
assert geom(ROOT/'shared/throw-icon-geometry.svg')==geom(ROOT/'stable/throw-icon-stable.svg')
shared=json.loads((ROOT/'shared/throw-brand-tokens.json').read_text());safe=shared['adaptive']['safeCircle']['radius']
def alpha_metrics(p):
 a=np.asarray(Image.open(p).convert('RGBA'))[:,:,3];yy,xx=np.where(a>1)
 radius=np.hypot((xx+.5)*1024/a.shape[1]-512,(yy+.5)*1024/a.shape[0]-512)
 return {'maxPaintedRadius':float(radius.max()),'alphaThreshold':'>1/255','bounds':[float(xx.min()*1024/a.shape[1]),float(yy.min()*1024/a.shape[0]),float((xx.max()+1)*1024/a.shape[1]),float((yy.max()+1)*1024/a.shape[0])],'renderSize':list(a.shape)}
adaptive={c:alpha_metrics(WORK/f'adaptive-foreground-{c}.png') for c in ('stable','preview','dev')}
adaptive['monochrome']=alpha_metrics(WORK/'adaptive-monochrome.png')
assert all(m['maxPaintedRadius']<safe for m in adaptive.values()),adaptive
pwa={c:alpha_metrics(WORK/f'maskable-foreground-{c}.png') for c in ('stable','preview','dev')}
assert all(m['maxPaintedRadius']<shared['pwaMaskable']['safeCircle']['radius'] for m in pwa.values()),pwa
for c in ('stable','preview','dev'):
 p=ROOT/c/f'throw-adaptive-foreground-{c}.svg';s=p.read_text();assert '<filter' not in s and 'background-tile' not in s
 a=np.asarray(Image.open(WORK/f'maskable-{c}.png').convert('RGBA'))[:,:,3];assert int(a.min())==255

im,d=canvas(940,484,'Throw — build treatments','Shared Arc Forward geometry; channel-specific paint only.')
for i,c in enumerate(('stable','preview','dev')):
 x=28+i*308;paste(im,V/f'sizes/{c}-512.png',(x,94),(260,260));d.text((x,372),c.capitalize(),font=font(21),fill=INK)
 paste(im,V/f'sizes/{c}-48.png',(x,412));paste(im,V/f'sizes/{c}-16.png',(x+90,428));d.text((x+56,427),'48',font=font(12),fill=INK);d.text((x+114,427),'16 px',font=font(12),fill=INK)
save(im,'throw-channel-comparison.png')

im,d=canvas(1160,610,'Throw — approved reference / production SVG','Reference tile normalized to a square; no raster artwork is present in the SVG.')
ref=Image.open(V/'throw-approved-reference.png').convert('RGBA').crop((75,83,1462,1459))
paste(im,ref,(28,116),(480,480));paste(im,V/'sizes/stable-512.png',(652,116),(480,480));d.text((28,88),'Approved reference',font=font(18),fill=INK);d.text((652,88),'Final stable vector',font=font(18),fill=INK)
save(im,'throw-reference-comparison.png')

for c in ('stable','preview','dev'):
 im,d=canvas(1400,820,f'Throw {c} — size validation','Actual-size proofs below; 1024 px source is reduced only in the labeled overview.')
 paste(im,V/f'sizes/{c}-1024.png',(28,100),(512,512));d.text((28,620),'1024 source shown at 512 px',font=font(12),fill=INK)
 sizes=[512,192,128,64,48,32,24,16];positions=[(572,100),(1110,100),(1110,330),(572,700),(694,700),(800,700),(898,700),(990,700)]
 for s,xy in zip(sizes,positions):
  paste(im,V/f'sizes/{c}-{s}.png',xy);d.text((xy[0],xy[1]+s+8),str(s)+' px',font=font(13),fill=INK)
 save(im,f'throw-size-sheet-{c}.png')

im,d=canvas(950,590,'Throw — small-size simplification','Top: full primary shrunk. Bottom: assigned small/micro variant. Enlargements use nearest-neighbor pixels.')
for i,c in enumerate(('stable','preview','dev')):
 x=28+308*i;d.text((x,91),c.capitalize(),font=font(18),fill=INK)
 for j,s in enumerate((64,32,16)):
  xx=x+j*95
  for row,p in enumerate([WORK/f'primary-{c}-{s}.png',V/f'sizes/{c}-{s}.png']):
   raw=Image.open(p).convert('RGBA');paste(im,raw,(xx,128+row*198));paste(im,raw.resize((80,80),Image.Resampling.NEAREST),(xx,208+row*198))
  d.text((xx,548),f'{s} px',font=font(13),fill=INK)
save(im,'throw-small-simplifications.png')

def masked(c,which,s=2048):
 fg=Image.open(WORK/f'adaptive-foreground-{c}.png').convert('RGBA');bg=Image.open(WORK/f'adaptive-background-{c}.png').convert('RGBA');layer=Image.alpha_composite(bg,fg)
 mask=Image.new('L',(s,s),0);md=ImageDraw.Draw(mask);l=s/6;r=s*5/6
 if which=='circle':md.ellipse((l,l,r,r),fill=255)
 elif which=='rounded-square':md.rounded_rectangle((l,l,r,r),radius=s*.155,fill=255)
 elif which=='squircle':
  yy,xx=np.mgrid[:s,:s];a=(np.abs((xx+.5-s/2)/(s/3))**4+np.abs((yy+.5-s/2)/(s/3))**4)<=1;mask=Image.fromarray(a.astype('uint8')*255)
 layer.putalpha(mask);return layer.crop((int(l),int(l),math.ceil(r),math.ceil(r)))
im,d=canvas(1140,794,'Throw — Android adaptive mask proofs','108 dp layers; 72 dp viewport; all essential geometry inside the conservative 66 dp safe circle.')
for i,c in enumerate(('stable','preview','dev')):
 x=28+i*370;d.text((x,88),c.capitalize(),font=font(20),fill=INK)
 for j,which in enumerate(('circle','rounded-square','squircle')):
  xx=x+j*112;paste(im,masked(c,which),(xx,130),(96,96));d.text((xx,240),which if which!='rounded-square' else 'rounded',font=font(12),fill=INK);paste(im,masked(c,which),(xx,278),(48,48))
 # Full layer with safe zone; the ring is a QA overlay, absent from sources.
 fg=Image.open(WORK/f'adaptive-foreground-{c}.png').convert('RGBA').resize((260,260),Image.Resampling.LANCZOS)
 proof=checker(260,260).convert('RGBA');proof.alpha_composite(fg);dr=ImageDraw.Draw(proof);q=safe/1024*260;dr.ellipse((130-q,130-q,130+q,130+q),outline='#D14A56',width=1)
 paste(im,proof,(x,382));d.text((x,653),'Foreground + safe-circle overlay',font=font(13),fill=INK)
mono=Image.open(WORK/'adaptive-monochrome.png').convert('RGBA').resize((110,110),Image.Resampling.LANCZOS)
paste(im,checker(110,110),(28,684));paste(im,mono,(28,684));d.text((155,712),'Shared monochrome layer; system tint replaces channel colors.',font=font(15),fill=INK)
save(im,'throw-adaptive-mask-proof.png')

im,d=canvas(930,428,'Throw — PWA maskable safe-zone proof')
for i,c in enumerate(('stable','preview','dev')):
 proof=Image.open(WORK/f'maskable-{c}.png').convert('RGBA').resize((260,260),Image.Resampling.LANCZOS)
 dr=ImageDraw.Draw(proof);q=260*.4;dr.ellipse((130-q,130-q,130+q,130+q),outline='#FFFFFF',width=2)
 paste(im,proof,(28+i*304,85));d.text((28+i*304,365),c.capitalize(),font=font(18),fill=INK)
d.text((28,402),'Safe-circle overlays are validation annotations, absent from source artwork.',font=font(13),fill='#656866')
save(im,'throw-pwa-maskable-proof.png')

im,d=canvas(1100,848,'Throw — outlined wordmark lockups','Manrope ExtraBold 800; identical lettering across builds; proof surfaces are not new UI tokens.')
for row,ink in enumerate(('dark','light')):
 y=95+row*365;bg='#FFF9F0' if ink=='dark' else '#292B2D';d.rectangle((20,y,1080,y+340),fill=bg)
 for i,c in enumerate(('stable','preview','dev')):
  x=36+i*354;d.text((x,y+12),c.capitalize(),font=font(16),fill=INK if ink=='dark' else '#FFF9F0')
  p=WORK/'svg-renders'/f'wordmarks__{c}__throw-lockup-horizontal-{c}-{ink}-small.svg.png';raw=Image.open(p);ww=310;hh=round(raw.height/raw.width*ww);paste(im,raw,(x,y+55),(ww,hh))
  p=WORK/'svg-renders'/f'wordmarks__{c}__throw-lockup-stacked-{c}-{ink}-small.svg.png';raw=Image.open(p);ww=150;hh=round(raw.height/raw.width*ww);paste(im,raw,(x+80,y+155),(ww,hh))
save(im,'throw-wordmark-proof.png')

report={'checks':{'svgXmlParsing':f'passed: {len(svgs)} SVGs','jsonParsing':f'passed: {len(jsons)} JSON files at validation time','noRasterOrRuntimeFonts':'passed','uniqueIdsAndResolvedPaintReferences':'passed','allChannelGeometryEqual':'passed for primary, small, micro, adaptive layers and PWA maskable','canonicalEqualsStableGeometry':'passed','adaptiveNoBackgroundTileOrShadow':'passed','adaptiveSafeCircle':'passed','maskableFullBleedOpaque':'passed'},'adaptiveSafeRadius':safe,'adaptivePaintMetrics':adaptive,'limitations':['Proof masks and bounds are source-level tests, not an Android emulator/device build.','No application or platform integration/build was performed.','No current external Catch repository palette was supplied; preview follows the saved Catch token file.'],'manualReview':'Pending visual inspection of generated sheets before final release.'}
report['checks']['pwaMaskableSafeCircle']='passed';report['pwaForegroundMetrics']=pwa
(V/'validation-report.json').write_text(json.dumps(report,indent=2)+'\n')
print(f'Parsed {len(svgs)} SVGs and {len(jsons)} JSON files; channel geometry invariant. Adaptive maximum radii:',{c:round(m['maxPaintedRadius'],3) for c,m in adaptive.items()},'safe radius',round(safe,3))
