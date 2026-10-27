# 雪团地点库（数据分支）

餐厅、咖啡店、景点、商场、住宿等地点，供雪团的店名搜索和“从照片批量加”使用。
只用来一次性导入 Supabase 的 `poi` 表，App 不会直接读这里的文件。

来源：[Overture Maps Foundation](https://overturemaps.org) places 主题，release 2026-10-21.0，
许可 CDLA-Permissive-2.0（部分来源为 Apache-2.0 / ODbL，详见 Overture 的 attribution 说明）。

| 文件 | 范围 | 内容 | 条数 |
| --- | --- | --- | --- |
| `data/my-*.tsv` | 马来西亚全国 | 吃 + 玩 | 266,098 |
| `data/sg-*.tsv` | 新加坡全国 | 吃 + 玩 | 26,837 |
| `data/jp-*.tsv` | 东京 23 区一带、大阪、京都市区 | 只有吃 | 156,365 |
| `data/th-*.tsv` | 曼谷、清迈、普吉 | 只有吃 | 90,105 |

筛选：confidence ≥ 0.45，未标记为停业，国家对得上，分类能对应到雪团的吃 / 玩分类。
新加坡、日本、泰国这批用 `scripts/fetch.py`（按经纬度范围从 Overture 的 S3 取数据）和
`scripts/build.py`（分类对照和筛选）生成；不收酒吧，分类只写了 restaurant 的店再按店名猜一次。
马来西亚那批是更早生成的，脚本没留下，规则大体相同。

列（TSV，无表头）：overture_id, name, alt_name, mode, cat, lat, lng, locality, confidence
