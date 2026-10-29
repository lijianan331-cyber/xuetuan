# 雪团 上线步骤

代码已经接好 Supabase（项目 `xuetuan`，新加坡机房）。下面这些要在网页后台里点，只能你本人操作。

## 1. 部署到 Vercel（拿到网址）

1. 打开 <https://vercel.com>，用 GitHub 账号登录（Hobby 免费版）。
2. Add New → Project → 选 `lijianan331-cyber/xuetuan` → Import。
3. Framework Preset 选 **Other**，Build Command 和 Output Directory 都留空，点 Deploy。
4. 部署完会得到一个网址，比如 `https://xuetuan.vercel.app`。以后每次合并到 `main`，Vercel 会自动重新部署。

## 2. 告诉 Supabase 网址

Supabase 后台 → 项目 `xuetuan` → Authentication → URL Configuration：

- **Site URL**：填上一步的网址，比如 `https://xuetuan.vercel.app`
- **Redirect URLs**：加 `https://xuetuan.vercel.app/**`

不填的话，登录后会跳回 `localhost`。

## 3. 开 Google 登录（推荐，同学最方便）

1. 打开 <https://console.cloud.google.com>，新建一个项目（名字随便，比如 xuetuan）。
2. APIs & Services → OAuth consent screen：User type 选 External，填应用名“雪团”和你的邮箱，保存。
3. APIs & Services → Credentials → Create Credentials → OAuth client ID：
   - Application type：**Web application**
   - Authorized redirect URIs：`https://pshxrwfjcbvqlixdxlzs.supabase.co/auth/v1/callback`
4. 复制生成的 Client ID 和 Client Secret。
5. Supabase 后台 → Authentication → Sign In / Providers → Google → 打开，粘贴 Client ID 和 Secret，保存。

## 4. 邮箱登录要配发信服务

Supabase 自带的发信服务**只能发给项目团队成员的邮箱**（就是你自己），每小时也只能发几封。要让同学用邮箱登录，得接一个发信服务：

1. 注册 <https://resend.com>（免费版每月 3000 封）。需要有一个自己的域名并按提示验证。
2. Supabase 后台 → Authentication → Emails → SMTP Settings → 打开 Custom SMTP，填 Resend 给的 Host / Port / 用户名 / 密码（API key）。

没有域名的话，可以先只开 Google 登录，邮箱登录以后再说。

## 5. 要知道的限制

- **Supabase 免费版一周没人访问会暂停**，暂停后网站读不到数据，要去后台点 Restore。有了固定用户就不会暂停。
- 免费额度：数据库 500 MB，照片存储 1 GB（约五千张压缩后的照片），每月流量 5 GB。
- Vercel Hobby 只能个人、非商业使用。挂广告或佣金链接需要升级 Pro。
- 照片桶是公开读的：照片网址里有随机编号，猜不到；但私密记录的照片如果网址被人拿到，是能打开的。

## 本地开发

- 直接打开 `index.html` 用的就是线上数据库。
- 地址后面加 `?local`（比如 `index.html?local`）用本地版：数据只存在这个浏览器里，带示例数据，不需要登录。
- 以前在本地版存的记录：登录后在“我的资料 → 数据”里点“上传这台设备上的旧记录”。

## 店名搜索的地点库（poi 表）

搜店名时先查 Supabase 里的 `poi` 表，再用 Photon（OpenStreetMap）补城市和国外的地方。

- 数据：[Overture Maps](https://overturemaps.org) 开放地点数据（release 2026-10-21.0，许可 CDLA-Permissive-2.0），共约 54 万个地点：
  - 马来西亚全国、新加坡全国：餐厅、咖啡店、景点、商场、住宿；
  - 东京、大阪、京都、曼谷、清迈、普吉：只有吃的店。
  - 其他地方（比如美国）靠 Photon。
- 文件放在仓库的 `poi-data` 分支（`data/*.tsv`），筛选条件写在那个分支的 README 里，新加坡、日本、泰国这批的生成脚本在 `scripts/`。
- 表结构和搜索函数 `search_poi` 在 `supabase/migrations/20261025121500_poi_search.sql`。表只读，谁都能查，不能写。
- 导入：在 SQL Editor 里运行 `poi-data` 分支的 `scripts/import.sql`。它临时开启 `http` 扩展，用 `extensions.http_get` 从 raw.githubusercontent.com 读文件，按 `\t` 拆列后 `insert ... on conflict (id) do nothing`，导完删掉 `http` 扩展。要导别的文件就改脚本里的文件名列表。

## 谷歌地图搜索（Places UI Kit）

1. Google Cloud 项目 xuetuan 绑结算账号，启用 Maps JavaScript API、Places API (New) 和 **Places UI Kit**（`placewidgets.googleapis.com`）。
2. 凭据 → API 密钥：API 限制勾上面三个；应用限制选“网站”，加 `https://xuetuan.vercel.app/*` 、分支预览 `https://xuetuan-git-claude-project-thread-ze8a57-ganan1.vercel.app/*` 和 `https://raw.githack.com/*`（浏览器跨站只发域名，不发路径，所以 githack 只能写到域名）。
3. 密钥写在 `index.html` 的 `GOOGLE_KEY`。网页里的谷歌密钥本来就是公开的，靠第 2 步的网站限制保护。
4. 建议在结算里设预算提醒。


### 谷歌搜索不出现时（2026-10-28）

搜索两个字以上后，「谷歌地图上的」现在保留状态说明，不再悄悄隐藏：
- 连接失败 / 超时：点「重试谷歌」；其他来源仍可搜索。
- 当天 60 次用完：说明次日恢复，不重置计数绕过上限；也可用「去 Google 地图搜」打开官方地图。
- 授权失败：核对当前完整域名是否在这把 key 的网站限制内，API 限制是否包含 Maps JavaScript API、Places API (New)、Places UI Kit。不要取消密钥限制。
- `?nogoogle`：明确提示该网址关闭了谷歌搜索；去掉参数后重新打开。
- Vercel 分支预览若要求登录，需先通过 Vercel 的正常登录；这与雪团内部登录、Google Cloud 的网站授权是三件不同的事。

代码等待 Google 自定义元素注册后才设置请求，避免把属性写进尚未升级的空元素。脚本和请求均有超时；失败不会把整个页面会话永久禁用。旧请求的结果/错误不覆盖新词。


### 搜索预热和图片添加

普通搜索/添加页打开时会预加载 Maps JavaScript 的 places 库；图片地点输入框聚焦时也会预热。此时不挂地点查询组件、不记查询次数。停止输入 400ms 后，才挂载官方 UI Kit 并记一次；普通搜索和所有图片组共用同一台设备每天 60 次的上限。网络和谷歌服务本身的耗时仍不能保证。

没有 GPS 的图片直接在地点搜索下显示谷歌结果；有 GPS 的图片可点「搜索其他地点」。默认偏好该照片或相近日期的照片位置。选中谷歌地点时，Google 的店名/评分/照片仍只显示在官方组件内，不读取进雪团；记录名先用自己输入的搜索词，可在已有记录编辑流程里调整。

### 首页帖子标题（2026-10-29）
部署包含首页发帖功能的版本前先应用 `20261029093501_visit_post_title.sql`。只给 visits 新增可为空、最多 80 字符的 title；沿用现有 user_id、place_id 和 RLS。图片/标题必填是首页发帖入口的前端校验，地图普通添加继续允许无图片记录。已在项目 pshxrwfjcbvqlixdxlzs 应用并检查字段和 RLS。

### 首页刷新与快捷可见性（2026-10-29）
首页刷新复用 RLS 过滤后的读取，前台首页每 45 秒轮询，支持手动刷新与回到前台检查；未启用系统推送或新增 Realtime publication。快捷可见性只更新 visits.visibility，批量操作同时按记录 ID 和当前 user_id 过滤；无需新数据库迁移。原有匿名账号/归属权限保留。
