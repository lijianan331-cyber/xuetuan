# 给 Claude 的项目说明

- 开始任何改动前先读 `docs/PRD-V2.md`、`docs/PRD.md` 和 `docs/PLAN.md`。PLAN.md 里的复选框是当前进度。
- `docs/PRD-V2.md`（V2.0，2026-10-27）是现在的方向，不是不可推翻；和 PRD.md 冲突时以 V2 为准。现在只做 V2 的 P0。
- 大改动先给方案，确认后再写代码（PRD 第 16 节的要求）。
- 区分“PRD 里的需求”和“你的建议”。
- `index.html` 是整个应用；MapLibre 固定在 5.24.0，不要随意升级。
- 改完跑 `python tests/test_app.py`，保持全部通过；新功能要加对应检查。
- 完成 PLAN.md 里的一项就把它勾上。
