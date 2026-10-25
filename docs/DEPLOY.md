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
