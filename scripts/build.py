# 把 Overture 地点对到雪团的吃 / 玩分类，写成 poi 表要的 TSV
# 用法：python3 -I build.py <parquet 目录> <输出目录> [--count]
import sys, os, re, collections, pyarrow.parquet as pq

SRC, OUT = sys.argv[1], sys.argv[2]
COUNT_ONLY = '--count' in sys.argv
MIN_CONF = 0.45

# key: (国家, 要不要“玩”, 泰文地名换成的英文名, 文件前缀)
AREAS = {
  'sg':        ('SG', True,  None,         'sg'),
  'tokyo':     ('JP', False, None,         'jp'),
  'osaka':     ('JP', False, None,         'jp'),
  'kyoto':     ('JP', False, None,         'jp'),
  'bangkok':   ('TH', False, 'Bangkok',    'th'),
  'chiangmai': ('TH', False, 'Chiang Mai', 'th'),
  'phuket':    ('TH', False, 'Phuket',     'th'),
}

def has(path, words):
  # 只认词头，免得 himalayan 被当成 malay
  return any(re.search(r'(?<![a-z])' + w, path) for w in words)

FOOD_SKIP = ('alcoholic_beverage_venue', 'internet_cafe', 'hookah')
FOOD_RULES = [  # 按顺序，先中先得
  ('street', ('food_court', 'cafeteria', 'food_truck', 'food_stand', 'hawker', 'street_vendor', 'kiosk')),
  ('sweet',  ('bakery', 'cupcake', 'cheesecake', 'dessert', 'ice_cream', 'gelato', 'cake', 'donut', 'chocolat', 'candy', 'patisserie', 'frozen_yogurt', 'waffle', 'creperie', 'pastry')),
  ('cafe',   ('cafe', 'coffee', 'tea_room', 'bubble_tea', 'smoothie_juice', 'juice_bar', 'tea_house')),
  ('jpkr',   ('japanese', 'ramen', 'sushi', 'korean', 'izakaya', 'udon', 'soba', 'tempura', 'yakitori', 'teppanyaki', 'shabu', 'tonkatsu', 'okonomiyaki', 'takoyaki', 'kaiseki', 'yakiniku')),
  ('cn',     ('chinese', 'cantonese', 'dim_sum', 'szechuan', 'sichuan', 'taiwanese', 'hong_kong', 'hot_pot', 'dumpling', 'shanghainese', 'hainan', 'teochew', 'hakka')),
  ('malay',  ('malaysian', 'indonesian', 'singaporean', 'peranakan', 'malay')),
  ('mamak',  ('indian', 'pakistani', 'sri_lankan', 'bangladeshi')),
  ('west',   ('american', 'italian', 'pizza', 'burger', 'fast_food', 'steak', 'french', 'european', 'mexican', 'sandwich', 'diner', 'chicken_wings', 'gastropub', 'breakfast', 'brunch', 'bistro', 'pancake', 'bagel', 'latin_american', 'spanish', 'german', 'mediterranean', 'salad', 'british', 'australian', 'fish_and_chips', 'tapas')),
]

# 分类只写了 restaurant 这种笼统的，再看店名
NAME_RULES = [
  ('street', ('hawker', 'food centre', 'food center', 'food court', 'kopitiam', 'ก๋วยเตี๋ยว')),
  ('sweet',  ('bakery', 'cake', 'dessert', 'gelato', 'ice cream', 'patisserie', 'ベーカリー', 'ケーキ', '菓子', 'スイーツ', 'เบเกอรี่', 'ไอศกรีม')),
  ('cafe',   ('cafe', 'café', 'coffee', 'カフェ', '珈琲', 'コーヒー', '喫茶', 'กาแฟ', 'คาเฟ่')),
  ('jpkr',   ('ramen', 'sushi', 'izakaya', 'yakiniku', 'udon', 'tempura', 'tonkatsu', 'korean', 'ラーメン', 'らーめん', '拉麺', '寿司', '鮨', 'すし', '居酒屋', '焼肉', '焼き肉', 'うどん', '蕎麦', 'そば', '天ぷら', 'とんかつ', '焼鳥', '焼き鳥', 'やきとり', 'お好み焼', 'たこ焼', '定食', '和食', '割烹', '料亭', '韓国', '한식')),
  ('cn',     ('dim sum', '中華', '中国料理', '餃子', '点心', '火鍋', 'ติ่มซำ')),
  ('malay',  ('nasi', 'satay', 'laksa', 'rendang')),
  ('mamak',  ('prata', 'briyani', 'biryani', 'tandoor')),
  ('west',   ('pizza', 'burger', 'steak', 'pasta', 'trattoria', 'ristorante', 'bistro', 'ピザ', 'バーガー', 'ステーキ', 'パスタ', 'イタリアン', 'フレンチ', 'ビストロ')),
]

def name_has(name, words):
  return any(re.search(r'(?<![a-z])' + re.escape(w), name) if w.isascii() else w in name for w in words)

def food_cat(path, name, country):
  if has(path, FOOD_SKIP): return None
  for cat, words in FOOD_RULES:
    if has(path, words): return cat
  if country == 'JP' and 'barbecue' in path: return 'jpkr'  # 日本的 barbecue 基本是烧肉
  low = name.lower()
  for cat, words in NAME_RULES:
    if name_has(low, words): return cat
  return 'other'

HERITAGE = r'\b(fort|heritage|monument|memorial|temple|mosque|masjid|church|cathedral|museum|gallery|shrine|pagoda|lighthouse|palace|old|historic)\b'
NOT_NATURE = r'car ?park|parking|mscp|multi.?stor|connector|playground|\bblk\b|\bblock\b|fitness corner'

def travel_cat(path, name):
  h = path.split('/')
  top = h[0]
  if top == 'lodging': return 'stay'
  if top == 'cultural_and_historic':
    # 新加坡的 historic_site 大多其实是公寓楼，只留名字像古迹的
    if h[1:2] == ['historic_site']:
      return 'culture' if len(h) > 2 or re.search(HERITAGE, name, re.I) else None
    if h[1:2] in (['place_of_worship'], ['memorial_site'], ['cultural_center']): return 'culture'
    return None
  if top == 'arts_and_entertainment':
    if has(path, ('museum', 'art_gallery', 'sculpture_statue', 'theatre_venue')): return 'culture'
    if has(path, ('amusement_attraction', 'animal_attraction', 'arcade', 'escape_room', 'movie_theater', 'science_attraction', 'karaoke')): return 'fun'
    return None
  if top == 'sports_and_recreation':
    if has(path, ('water_park', 'bowling', 'laser_tag', 'skating_rink', 'go_kart', 'indoor_playcenter', 'trampoline')): return 'fun'
    if path in ('sports_and_recreation/park', 'sports_and_recreation/park/national_park') or has(path, ('hiking_trail', 'nature_reserve', 'botanical_garden')):
      return None if re.search(NOT_NATURE, name, re.I) else 'nature'
    return None
  if top == 'geographic_entities':
    if 'island' in path: return 'island'
    if re.search(r'phuket|langkawi|bali|batam|bintan', name, re.I): return None  # 店在别处、坐标却落在这里
    if 'land_feature' in path and re.search(r'\b(island|pulau)\b', name, re.I): return 'island'
    if has(path, ('beach', 'nature_reserve', 'mountain', 'forest', 'garden', 'lake', 'waterfall')):
      return None if re.search(NOT_NATURE, name, re.I) else 'nature'
    return None
  if top == 'shopping' and h[1:2] in (['shopping_mall'], ['department_store']): return 'mall'
  return None

def clean(s):
  return re.sub(r'\s+', ' ', (s or '').replace('\t', ' ')).strip()

def alt_of(names, primary):
  seen, out = {primary.lower()}, []
  for ru in names.get('rules') or []:
    if ru.get('variant') not in ('language', 'alternate', 'official', 'short'): continue
    if ru.get('language') not in (None, 'en', 'zh', 'zh-Hans', 'zh-Hant'): continue
    v = clean(ru.get('value'))
    if v and v.lower() not in seen and len(v) <= 80:
      seen.add(v.lower()); out.append(v)
  return ' / '.join(out[:2])

THAI = re.compile('[฀-๿]')
stats = collections.Counter()
rows_by_prefix = collections.defaultdict(list)
for key, (country, with_travel, th_name, prefix) in AREAS.items():
  t = pq.read_table(os.path.join(SRC, key + '.parquet')).to_pylist()
  for r in t:
    if (r['confidence'] or 0) < MIN_CONF: continue
    if r['operating_status'] and r['operating_status'] != 'open': continue
    a = (r['addresses'] or [None])[0] or {}
    if a.get('country') != country: continue
    names = r['names'] or {}
    name = clean(names.get('primary'))
    if not name or len(name) > 120: continue
    path = '/'.join((r['taxonomy'] or {}).get('hierarchy') or [])
    if path.startswith('food_and_drink'):
      mode, cat = 'food', food_cat(path, name, country)
    elif with_travel:
      mode, cat = 'travel', travel_cat(path, name)
    else:
      cat = None
    if not cat: continue
    loc = clean(a.get('locality'))
    if th_name and (not loc or THAI.search(loc)): loc = th_name
    if country == 'SG': loc = 'Singapore' if not loc or loc.upper() == 'SINGAPORE' else loc
    bb = r['bbox']
    rows_by_prefix[prefix].append((r['id'], name, alt_of(names, name), mode, cat,
                                   '%.6f' % bb['ymin'], '%.6f' % bb['xmin'], loc[:60], '%.2f' % r['confidence']))
    stats[(key, mode, cat)] += 1

for key in AREAS:
  tot = sum(v for (k, m, c), v in stats.items() if k == key)
  parts = ', '.join('%s/%s %d' % (m, c, v) for (k, m, c), v in sorted(stats.items(), key=lambda x: -x[1]) if k == key)
  print('%-10s %7d  %s' % (key, tot, parts))
print('TOTAL', sum(stats.values()))

if not COUNT_ONLY:
  os.makedirs(OUT, exist_ok=True)
  seen = set()
  for prefix, rows in rows_by_prefix.items():
    rows = [x for x in rows if not (x[0] in seen or seen.add(x[0]))]
    rows.sort(key=lambda x: (x[7], x[1]))
    per = 50000
    for i in range(0, len(rows), per):
      with open(os.path.join(OUT, '%s-%03d.tsv' % (prefix, i // per)), 'w', encoding='utf-8') as f:
        for x in rows[i:i + per]: f.write('\t'.join(x) + '\n')
    print(prefix, len(rows), 'rows ->', (len(rows) + per - 1) // per, 'files')
