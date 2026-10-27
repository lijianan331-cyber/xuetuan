# 从 Overture places（2026-10-21.0）按范围取地点，存成本地 parquet
import sys, os, json, pyarrow as pa, pyarrow.fs as fs, pyarrow.parquet as pq, pyarrow.compute as pc
OUT = sys.argv[1]
AREAS = {
  'sg':  (103.59, 1.15, 104.10, 1.48),
  'tokyo': (139.55, 35.52, 139.95, 35.82),
  'osaka': (135.40, 34.58, 135.60, 34.78),
  'kyoto': (135.67, 34.93, 135.82, 35.07),
  'bangkok': (100.40, 13.62, 100.70, 13.90),
  'chiangmai': (98.93, 18.74, 99.05, 18.84),
  'phuket': (98.25, 7.75, 98.45, 8.20),
}
only = sys.argv[2].split(',') if len(sys.argv) > 2 else list(AREAS)
s3 = fs.S3FileSystem(anonymous=True, region='us-west-2')
base = 'overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/'
files = [i.path for i in s3.get_file_info(fs.FileSelector(base))]
COLS = ['id', 'confidence', 'names', 'addresses', 'operating_status', 'basic_category', 'taxonomy', 'bbox']
for key in only:
  x0, y0, x1, y1 = AREAS[key]
  parts = []
  for path in files:
    f = pq.ParquetFile(path, filesystem=s3)
    md = f.metadata
    ci = {md.schema.column(i).path: i for i in range(md.num_columns)}
    rgs = []
    for r in range(md.num_row_groups):
      rg = md.row_group(r)
      xmn, xmx = rg.column(ci['bbox.xmin']).statistics, rg.column(ci['bbox.xmax']).statistics
      ymn, ymx = rg.column(ci['bbox.ymin']).statistics, rg.column(ci['bbox.ymax']).statistics
      if xmx.max < x0 or xmn.min > x1 or ymx.max < y0 or ymn.min > y1: continue
      rgs.append(r)
    if not rgs: continue
    t = f.read_row_groups(rgs, columns=COLS)
    bb = t.column('bbox')
    xmin = pc.struct_field(bb, 'xmin'); ymin = pc.struct_field(bb, 'ymin')
    m = pc.and_(pc.and_(pc.greater_equal(xmin, x0), pc.less_equal(xmin, x1)), pc.and_(pc.greater_equal(ymin, y0), pc.less_equal(ymin, y1)))
    t = t.filter(m)
    print(key, path.split('/')[-1][:10], len(rgs), 'rgs ->', t.num_rows, flush=True)
    parts.append(t)
  tab = pa.concat_tables(parts) if parts else None
  if tab is not None:
    pq.write_table(tab, os.path.join(OUT, key + '.parquet'))
    print('DONE', key, tab.num_rows, flush=True)
