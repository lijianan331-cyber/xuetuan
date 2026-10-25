# 雪团地点库（数据分支）

马来西亚的餐厅、咖啡店、景点、商场、住宿等地点，供雪团的店名搜索使用。
只用来一次性导入 Supabase 的 `poi` 表，App 不会直接读这里的文件。

来源：[Overture Maps Foundation](https://overturemaps.org) places 主题，release 2026-10-21.0，
许可 CDLA-Permissive-2.0（部分来源为 Apache-2.0 / ODbL，详见 Overture 的 attribution 说明）。

筛选：国家 = MY，confidence ≥ 0.45，未标记为停业，分类能对应到雪团的吃 / 玩分类。

列（TSV，无表头）：overture_id, name, alt_name, mode, cat, lat, lng, locality, confidence
