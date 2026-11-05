# 给 Claude 的项目说明

- 开始改动前先看 `docs/PLAN.md` 最后几节（复选框是当前进度）。改到产品方向/范围时再读 `docs/PRD-V2.md`；V2 没写到的才翻 `docs/PRD.md`。不用每次三份全读。
- 省 token：代码太大，不要整份读，先 grep 找到位置，再按行号读那一段（`tests/test_app.py` 也一样）。改样式只看 `css/app.css`。
- `docs/PRD-V2.md`（V2.0，2026-10-27）是现在的方向，不是不可推翻；和 PRD.md 冲突时以 V2 为准。现在只做 V2 的 P0。
- 大改动先给方案，确认后再写代码（PRD 第 16 节的要求）。
- 区分“PRD 里的需求”和“你的建议”。
- 改界面（大小、颜色、文案、动效）先看 `docs/UI-STYLE.md`（2026-11-01 定的风格，以后小改照它来）。
- 应用 = `index.html`（页面骨架）+ `css/app.css`（全部样式）+ `js/01-core.js`…`js/09-actions-boot.js`（按序号加载，共用一个全局作用域，启动代码在最后一个）。没有构建步骤。MapLibre 固定在 5.24.0，不要随意升级。
- 改完跑 `python tests/test_app.py`（默认只打印失败项和总数，`-v` 才列出全部），保持全部通过；新功能要加对应检查。
- 完成 PLAN.md 里的一项就把它勾上。

- 离线缓存：改到 index.html / css / js / data / assets / manifest / sw.js 后，提交前运行 `python tools/update_offline_version.py`。全站测试校验版本指纹，保证旧用户能升级到完整的新版本；新运行时文件也要加入 sw.js 的 SHELL。旧标签页关闭后启用新版，不要强制刷新写到一半的表单。专项 `python tests/test_offline.py` 用本机HTTP和合成账号测试，不连真实后台。

- 分页/区域读取已启用（2026-11-04）：先看 `js/00-reads.js`、`js/09-reads-ui.js` 和 `docs/READ-PERFORMANCE.md`。新路径不要恢复为首次下载所有人的 visits；总评分/条数/照片数用完整权限内摘要，不对当前页重新算总计；本人分享先完整读取本人的数据。迁移 `20261104072920_bounded_reads.sql` 已线上启用，勿再次应用或覆盖活动时间规则。新路径专项 `python tests/test_bounded_reads.py`（隔离SQL/HTTP）及 `node tests/test_bounded_reads.mjs <PGlite路径>`；不要在真实库造压测帖子/照片。
