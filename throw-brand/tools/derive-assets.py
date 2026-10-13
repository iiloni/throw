#!/usr/bin/env python3
"""Derive portable SVG variants from one geometry source and explicit paint tokens. Stdlib only."""
import argparse, copy, hashlib, json, re
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
NS='http://www.w3.org/2000/svg';ET.register_namespace('',NS)
def tag(n):return '{'+NS+'}'+n
def byid(root,i):return next(e for e in root.iter() if e.get('id')==i)
def encode(root):return ET.tostring(root,encoding='unicode')+'\n'
def fresh(label,view='0 0 1024 1024'):
    r=ET.Element(tag('svg'),{'width':view.split()[2],'height':view.split()[3],'viewBox':view,'role':'img','aria-label':label});ET.SubElement(r,tag('title')).text=label;return r
def matrix(m):return 'matrix('+ ' '.join(format(v,'.12g') for v in m)+')'
def namespace(root,prefix):
    for e in root.iter():
        if 'id' in e.attrib:e.set('id',prefix+e.get('id'))
        for k,v in list(e.attrib.items()):
            v=re.sub(r'url\(#([^)]*)\)',lambda m:'url(#'+prefix+m[1]+')',v)
            if k.endswith('href') and v.startswith('#'):v='#'+prefix+v[1:]
            e.set(k,v)
    return root
def remove_unused_defs(r):
    defs=r.find(tag('defs'))
    if defs is None:return
    s=encode(r)
    for e in list(defs):
        if 'url(#'+e.get('id','')+')' not in s:defs.remove(e)
    if not list(defs):r.remove(defs)
def shape(r,channel,tier='primary'):
    r=copy.deepcopy(r)
    r.set('aria-label','Throw '+channel+' '+tier+' icon');r.find(tag('title')).text=r.get('aria-label')
    ct=json.loads((ROOT/f'{channel}/throw-{channel}-tokens.json').read_text());pal=ct['palette']
    for stop,definition in zip(byid(r,'tile-surface-paint'),shared['surfaceGradient']['stops']):
        stop.set('offset',str(definition['offset']));stop.set('stop-color',shared['sharedColors'][definition['color']]['hex'])
    byid(r,'project-line').set('fill',shared['sharedColors']['tileLine']['hex'])
    for role,g in ct['gradientOverrides'].items():
        grad=byid(r,g['gradientId'])
        for e,stop in zip(grad,g['stops']):e.set('offset',str(stop['offset']));e.set('stop-color',pal[stop['color']]['hex'])
    shadow=byid(r,'tile-depth').find(tag('feDropShadow'));shadow.set('flood-color',pal[ct['shadowOverride']['color']]['hex']);shadow.set('flood-opacity',str(ct['shadowOverride']['opacity']))
    if tier!='primary':
        byid(r,'project-surface').attrib.pop('filter',None);byid(r,'project-surface').set('fill',shared['sharedColors']['cream']['hex'])
    if tier=='micro':
        byid(r,'ribbon-upper').set('fill',pal[ct['microOverrides']['upper']]['hex']);byid(r,'ribbon-lower').set('fill',pal[ct['microOverrides']['lower']]['hex']);byid(r,'project-accent').set('fill',pal[ct['microOverrides']['accent']]['hex'])
        rule=shared['variantRules']['micro'];ln=byid(r,'project-line')
        for key,value in zip(('x','y','width','height'),rule['lineLocalRect']):ln.set(key,str(value))
        ln.set('rx',str(rule['lineRx']));ln.set('fill',shared['sharedColors'][rule['lineColor']]['hex'])
    remove_unused_defs(r);return r
def background(channel):
    r=shape(master,channel);r.remove(byid(r,'arc-forward-foreground'));byid(r,'background-tile').attrib.pop('rx');remove_unused_defs(r);r.set('aria-label','Throw '+channel+' full-bleed adaptive background');r.find(tag('title')).text=r.get('aria-label');return r
def foreground(channel):
    r=shape(master,channel,'small');r.remove(byid(r,'background-tile'));byid(r,'arc-forward-foreground').set('transform',matrix(shared['adaptive']['foregroundTransform']['matrix']));remove_unused_defs(r);r.set('aria-label','Throw '+channel+' adaptive foreground');r.find(tag('title')).text=r.get('aria-label');return r
def maskable(channel):
    r=shape(master,channel,'small');byid(r,'background-tile').attrib.pop('rx');byid(r,'arc-forward-foreground').set('transform',matrix(shared['pwaMaskable']['foregroundTransform']['matrix']));r.set('aria-label','Throw '+channel+' maskable PWA icon');r.find(tag('title')).text=r.get('aria-label');return r
def mono(ink,adaptive=False):
    r=fresh('Throw monochrome mark');defs=ET.SubElement(r,tag('defs'))
    clearance=ET.SubElement(defs,tag('mask'),{'id':'ribbon-clearance','maskUnits':'userSpaceOnUse','x':'0','y':'0','width':'1024','height':'1024','style':'mask-type:luminance'})
    ET.SubElement(clearance,tag('rect'),{'width':'1024','height':'1024','fill':'white'})
    cg=ET.SubElement(clearance,tag('g'),{'transform':byid(master,'project-tile').get('transform')});card=copy.deepcopy(byid(master,'project-surface'));card.attrib.pop('filter',None);card.set('fill','black');card.set('stroke','black');card.set('stroke-width',str(shared['monochrome']['tileClearance']*2));cg.append(card)
    box={key:byid(master,'project-surface').get(key) for key in ('x','y','width','height')}
    cm=ET.SubElement(defs,tag('mask'),{'id':'tile-detail-knockouts','maskUnits':'userSpaceOnUse',**box,'style':'mask-type:luminance'})
    ET.SubElement(cm,tag('rect'),{**box,'fill':'white'})
    for id in ['project-accent','project-line']:
        e=copy.deepcopy(byid(master,id));e.attrib.pop('id',None);e.set('fill','black');cm.append(e)
    fg=ET.SubElement(r,tag('g'),{'id':'monochrome-foreground','fill':ink})
    ribbons=copy.deepcopy(byid(master,'motion-ribbons'));ribbons.set('mask','url(#ribbon-clearance)')
    for e in ribbons:e.set('fill',ink)
    fg.append(ribbons)
    g=ET.SubElement(fg,tag('g'),{'transform':byid(master,'project-tile').get('transform')});card=copy.deepcopy(byid(master,'project-surface'));card.attrib.pop('filter',None);card.set('fill',ink);card.set('mask','url(#tile-detail-knockouts)');g.append(card)
    if adaptive:fg.set('transform',matrix(shared['adaptive']['foregroundTransform']['matrix']))
    # Ensure each definition and visible element has a unique ID.
    for e in clearance.iter():
        if e.get('id')=='project-surface':e.set('id','clearance-project-surface')
    return r
def lockup(channel,orientation,ink,tier):
    layout=wordtokens['layouts'][orientation];w,h=layout['canvas'];r=fresh('Throw '+channel+' '+orientation+' wordmark',f'0 0 {w:.12g} {h:.12g}')
    x,y,iw,ih=layout['iconBox'];icon=namespace(shape(master,channel,tier),'icon-');icon.set('x',str(x));icon.set('y',str(y));icon.set('width',str(iw));icon.set('height',str(ih));icon.attrib.pop('role',None);icon.attrib.pop('aria-label',None);r.append(icon)
    outlines=copy.deepcopy(byid(wordmaster,'throw-wordmark-outlines'));outlines.set('fill',wordtokens['ink'][ink]);x,y,*_=layout['wordmarkInkBox'];s=layout['wordmarkScale'];outlines.set('transform',f'translate({x} {y}) scale({s:.12g})');r.append(outlines);return r

parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--check',action='store_true');args=parser.parse_args()
shared=json.loads((ROOT/'shared/throw-brand-tokens.json').read_text());master=ET.parse(ROOT/'shared/throw-icon-geometry.svg').getroot();wordtokens=json.loads((ROOT/'wordmarks/throw-wordmark-tokens.json').read_text());wordfile=ROOT/'wordmarks/throw-wordmark-dark.svg';wordmaster=ET.parse(wordfile).getroot()
assert hashlib.sha256(wordfile.read_bytes()).hexdigest()==wordtokens['canonicalWordmarkSha256'],'Wordmark authority hash differs; review before regeneration.'
assert master.get('viewBox')=='0 0 1024 1024'
# Validate duplicated numeric metadata against the canonical SVG rather than silently letting it drift.
for id,token in [('background-tile',shared['geometry']['background']),('project-surface',shared['geometry']['tile'])]:
    el=byid(master,id);assert float(el.get('rx'))==token['rx']
    if 'width' in token:assert float(el.get('width'))==token['width'] and float(el.get('height'))==token['height']
tile=shared['geometry']['tile'];cx,cy=tile['center'];angle=tile['rotationClockwiseDeg']
assert byid(master,'project-tile').get('transform')==f'translate({cx} {cy}) rotate({angle})'
for id,values in [('project-surface',tile['localRect']),('project-accent',shared['geometry']['accent']['localRect']),('project-line',shared['geometry']['line']['localRect'])]:
    assert [float(byid(master,id).get(k)) for k in ('x','y','width','height')]==values,'Geometry metadata differs: '+id
outputs={}
for c in ('stable','preview','dev'):
    for tier in ('primary','small','micro'):
        name=f'{c}/throw-icon-{c}.svg' if tier=='primary' else f'{c}/throw-icon-{c}-small.svg' if tier=='small' else f'{c}/throw-favicon-{c}.svg'
        outputs[name]=encode(shape(master,c,tier))
    outputs[f'{c}/throw-adaptive-foreground-{c}.svg']=encode(foreground(c))
    outputs[f'{c}/throw-adaptive-background-{c}.svg']=encode(background(c))
    outputs[f'{c}/throw-maskable-{c}.svg']=encode(maskable(c))
    for orient in ('horizontal','stacked'):
        for ink in ('dark','light'):
            for tier in ('primary','small','micro'):
                suffix='' if tier=='primary' else '-'+tier
                name=f'wordmarks/{c}/throw-lockup-{orient}-{c}-{ink}{suffix}.svg';outputs[name]=encode(lockup(c,orient,ink,tier))
outputs['shared/throw-mark-mono-dark.svg']=encode(mono(shared['sharedColors']['charcoal']['hex']))
outputs['shared/throw-mark-mono-light.svg']=encode(mono(shared['sharedColors']['cream']['hex']))
outputs['shared/throw-adaptive-monochrome.svg']=encode(mono('#FFFFFF',True))
manifest={'generator':'tools/derive-assets.py','sourceHashes':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in ['shared/throw-icon-geometry.svg','shared/throw-brand-tokens.json','wordmarks/throw-wordmark-dark.svg','wordmarks/throw-wordmark-tokens.json']+[f'{c}/throw-{c}-tokens.json' for c in ('stable','preview','dev')]},'derivedFiles':{p:hashlib.sha256(s.encode()).hexdigest() for p,s in sorted(outputs.items())}}
outputs['shared/throw-derived-manifest.json']=json.dumps(manifest,indent=2)+'\n'
for p,s in outputs.items():
    file=ROOT/p
    if args.check:
        assert file.exists() and file.read_text()==s,'Derived file differs: '+p
    else:file.parent.mkdir(parents=True,exist_ok=True);file.write_text(s)
print(('Verified' if args.check else 'Generated'),len(outputs)-1,'derived SVG assets and their integrity manifest.')
