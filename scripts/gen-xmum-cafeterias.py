# 从 data/xmum-cafeterias.json 生成 data/xmum-cafeterias.js（页面用 <script> 读，file:// 下测试也能用）
import json, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.load(open(os.path.join(root, 'data/xmum-cafeterias.json'), encoding='utf-8'))
out = {'blocks': d['blockCoords'], 'shops': [s for s in d['shops'] if not s['comingSoon']]}
open(os.path.join(root, 'data/xmum-cafeterias.js'), 'w', encoding='utf-8').write(
    '/* 自动生成：python scripts/gen-xmum-cafeterias.py（源数据 data/xmum-cafeterias.json，学校公布的营业时间，可能有变） */\nwindow.XMUM_CAFES = ' + json.dumps(out, ensure_ascii=False) + ';\n')
