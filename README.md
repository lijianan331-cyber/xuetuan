# 雪团 XueTuan

以厦门大学马来西亚分校（XMUM）为起点的社区吃喝玩乐地图：记录自己去过的地方，打分、拍照、写点评，公开的部分合并到公共地图上。

- 需求文档：[`docs/PRD.md`](docs/PRD.md)
- 改进方案和步骤：[`docs/PLAN.md`](docs/PLAN.md)

## 运行

直接用浏览器打开 `index.html` 即可（需要联网加载地图和 MapLibre）。

## 测试

```bash
pip install playwright pillow
python tests/test_app.py
```

测试用 `tests/stub_maplibre.js` 替换真实地图库、用假数据替换地点搜索（Photon），所以不需要联网。

## 地图数据

底图 © [OpenFreeMap](https://openfreemap.org) © OpenMapTiles © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors。
地点搜索：[Photon](https://photon.komoot.io)，数据来自 OpenStreetMap。
