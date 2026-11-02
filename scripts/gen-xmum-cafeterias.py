# 从 data/xmum-cafeterias.json 生成 data/xmum-cafeterias.js（页面用 <script> 读，file:// 下测试也能用）
import json, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.load(open(os.path.join(root, 'data/xmum-cafeterias.json'), encoding='utf-8'))
import re
# 每家店在地点库(poi)里的编号、坐标、中文类别，取自已经写进库的 scripts/xmum-cafeterias.sql，两边保持一致
sql = open(os.path.join(root, 'scripts/xmum-cafeterias.sql'), encoding='utf-8').read()
poi = {}
for m in re.finditer(r"\('(xmum-[^']+)', '((?:[^']|'')*)', '([^']*)', 'food', '[^']*', ([\d.]+), ([\d.]+), 'XMUM ([^']*)'", sql):
    poi[m.group(6)] = {'id': m.group(1), 'alt': m.group(3), 'lat': float(m.group(4)), 'lng': float(m.group(5))}
for s in d['shops']:
    s.update(poi.get(s['block'] + ' · ' + s['lot'], {}))
out = {'blocks': d['blockCoords'], 'shops': [s for s in d['shops'] if not s['comingSoon']]}
open(os.path.join(root, 'data/xmum-cafeterias.js'), 'w', encoding='utf-8').write(
    '/* 自动生成：python scripts/gen-xmum-cafeterias.py（源数据 data/xmum-cafeterias.json，学校公布的营业时间，可能有变） */\nwindow.XMUM_CAFES = ' + json.dumps(out, ensure_ascii=False) + ';\n')
