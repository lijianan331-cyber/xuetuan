# 给 Codex（和其他 AI 助手）的交接说明

先读 `CLAUDE.md`，规则一样：`docs/PRD-V2.md`（现在的方向）、`docs/PRD.md`、`docs/PLAN.md`（复选框 = 进度，最后几条是最新的）。部署和后台设置见 `docs/DEPLOY.md`。

用户命名约定：本 GitHub / Vercel 版本叫 **A**；另一套 Codex Sites 版本叫 **B**，两者代码和数据库不自动同步。

## 现在的状态（2026-10-28）
- 全部代码在 `index.html`（MapLibre 固定 5.24.0）。后台是 Supabase（项目 `pshxrwfjcbvqlixdxlzs`，新加坡），建表 / 改表的 SQL 在 `supabase/migrations/`。
- 最新工作在分支 `claude/project-thread-ze8a57`（PR #7 → main，还没合并；用户说「上线」才合并）。在这个分支上接着做，或从它开新分支。
- 预览（连正式数据库）：https://xuetuan-git-claude-project-thread-ze8a57-ganan1.vercel.app ；正式站 https://xuetuan.vercel.app 跟着 main。
- 测试：`pip install playwright==1.63.0 pillow` 后 `python tests/test_app.py`，要全部通过；新功能加检查。用假的 MapLibre / Supabase（`tests/stub_*.js`），不连网。「last form row can scroll above the tab bar」这一项以前就时好时坏。

## 用户的习惯
- 简体中文，消息短；在华为手机自带浏览器上测（宽约 370px，顶上有「相关搜索」一行、底部有工具栏）。
- 不喜欢被指出小的界面问题：交付前自己在手机尺寸截图检查。
- 改数据库要用户同意；不用付费 API、不接 AI 接口（用户 2026-10-28 说的）；用户的私人照片不能进这个公开仓库。

## 正在等用户的
- 批量加照片（每张一组 + 「↑ 和上一组是同一个地方」合并）在手机上是否还崩；单个添加选照片时还会加载认图小模型，崩的话也关掉。
- 打开时下栏被挡（滚 1 像素的办法）在他手机上是否管用。
- 谷歌登录：Supabase 里 Site URL 要设成正式站、Redirect URLs 加预览和正式站。
- 之后：旅行照片认著名地标自动定位、单个添加读照片 GPS、Grab 叫车 / 复制店名地址。
