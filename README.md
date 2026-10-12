# Campus Vault

本地个人课程知识库 —— **液态玻璃（Liquid Glass）UI + Node 后端**。

前后端都已实现：前端是 React 19 + Vite + Tailwind v4，
后端是 Node 24 + Express + SQLite（`node:sqlite`，零原生依赖）。

```
前端  http://127.0.0.1:5174/     ← Vite（/api 代理到后端）
后端  http://127.0.0.1:5175/     ← Express
数据  server/data/vault.db + server/data/files/
```

---

## 快速开始

### Windows：双击就能跑

| 文件 | 作用 |
|---|---|
| **`启动网站.bat`** | 一键起前后端（开发模式，改代码立刻生效），并自动打开浏览器。**关掉窗口 = 停止网站** |
| **`创建桌面快捷方式.bat`** | 在桌面生成「Campus Vault」快捷方式，指向本项目里的 `启动网站.bat`。用的是脚本所在目录（`%~dp0`），所以换目录/换盘符都不用改 |
| `上线启动.bat` | 起**生产形态**（后端直接提供构建好的网页）+ Cloudflare 隧道，给一个 https 公网网址。见 `上线部署.md` |

> 仓库里**不放 `.lnk` 文件**：它是二进制，里面记着创建它的那台机器的绝对路径、卷序列号和用户名 ——
> 换台电脑就失效，还会把别人的机器信息带进仓库。所以用「创建桌面快捷方式.bat」现场生成。

### 手动启动（跨平台）

```bash
pnpm install

# 两个终端各起一个（或只起前端，会看到"连接不到服务器"提示）
pnpm dev                              # 前端 5174
pnpm --filter campus-vault-server dev # 后端 5175
```

首次打开会看到登录页。**默认管理员**：

| 账号 | 密码 |
|---|---|
| `admin` | `Cv-Dev-Only-2026` |

> ⚠️ 这个默认密码只用于本机开发。**对外部署时后端会检查它有没有被改过**，
> 没改就拒绝启动（见 `server/src/lib/deploy.ts` 的守卫，和 `上线部署.md`）。
> 改密码：网站个人中心，或 `node server/tools/set-password.mjs '新密码'`。

也可以点「账号注册」自己开一个 —— 密码需满足规则（≥8 位、含大小写、含数字、
无连续重复或 `abc`/`123` 这类顺序字符），账号由服务端生成 11 位随机数。

> ⚠️ 本机环境有三个坑，已在配置里处理好，换机器时请一并带走：
> 1. `pnpm-workspace.yaml` 里必须是 **`nodeLinker: hoisted`**（camelCase）。
>    默认的隔离布局下，Vite 在包内部执行 `import('rollup')` / `import('picomatch')`
>    会报 `ERR_MODULE_NOT_FOUND`；写成 kebab-case 的 `node-linker` 会被 pnpm 静默忽略。
> 2. `@vitejs/plugin-react` 必须锁 **5.x**。6.x 的 peer 是 `vite@^8`，
>    会引用 vite 8 才有的 `vite/internal` 子路径，在 vite 7 下直接报错。
> 3. 后端要 **Node 22.5+**（用到内置 `node:sqlite`），且能**直接运行 `.ts`**
>    （Node 原生类型擦除），不需要 tsx / ts-node。

## 测试

```bash
pnpm --filter campus-vault-server test        # 接口测试 105 项（自动重置库+起服务）
node server/test/e2e.mjs                      # 端到端：认证 + 题库文件（需前后端都在跑）
node server/test/e2e-data.mjs                 # 端到端：灵感 / 待办 / 书签
```

接口测试的 runner 每次会删掉 `server/data-test/` 重建，
所以**可以反复跑**；直接跑 `api.test.mjs` 而不重置库会因为历史数据误报。

## 界面结构

```
┌──────────────────────────────────────────────────────────┐
│                                    右上角：数据条 + 画质开关 │
│   ╭─╮                                                     │
│  ╱ 我 ╲   ⟶  ╭──────────────────────────────────────╮    │
│  ╲    ╱      │ 我的课程   6 门在修 · 本学期第 12 周      │    │
│   ╰─╯        ╰──────────────────────────────────────╯    │
│  圆环 + 头像  ╭──────────────────────────────────────╮    │
│  四段扇区     │ 我的课表   本周 18 节课 · 周三最满      │    │
│              ╰──────────────────────────────────────╯    │
│              ╭──────────────────────────────────────╮    │
│              │ 我的笔记   142 份笔记 · 38 份作业       │    │
│              ╰──────────────────────────────────────╯    │
│ Ctrl K 搜索                                               │
└──────────────────────────────────────────────────────────┘
```

| 入口 | 位置 | 页面内容 |
|---|---|---|
| 我的题库 | 圆环 | 题库统计 + 题目卡片（展开答案 + SM-2 掌握度评分） |
| 灵感 | 圆环 | 速记输入框 + 瀑布流灵感卡片 |
| 待办事项 | 圆环 | 待办列表（勾选 / 优先级 / 截止时间）+ 本周节奏 |
| 日历 | 圆环 | 月视图 + 学习热力图 + 本月节点 |
| 我的课程 | 胶囊① | 课程卡片网格 + 选中课程的文件区（拖拽落点示意） |
| **课程详情** | 点课程卡片 | 教师 / 地点 / 学分 / 每周课时 + 三个分页签：笔记与作业 · 题库 · 课程信息（含**课表位置**迷你课表） |
| **学分总览** | 点「在修课程」小片 | 已修学分 / 本学期在读 / 平均绩点 / 毕业进度 + **学分占比扇形图**（可按学期或按课程切换）+ 成绩明细 |
| 我的课表 | 胶囊② | 周课表 + 第几周横幅 + 课程图例 |
| 我的笔记 | 胶囊③ | 左侧资料库浏览 + 右侧阅读器（Markdown / 代码 / docx / PDF） |

## 交互清单

- **头像导航**：头像即视觉主体，四个功能名（题库 / 灵感 / 待办 / 日历）分布在四周，
  默认**隐藏**。鼠标移入该区域（不必点击）时文字滑出；
  悬停某个功能名时它会**放大 ~24% 并变白**，同时浮出副标题说明，点击即跳转。
  移开后自动收起。键盘聚焦同样会显现（无障碍需要）
  - 历史：这里原本是 SVG 圆环导航（四瓣扇区 + `feDisplacementMap` 折射滤镜）。
    改版理由：① 圆环尺寸在超宽屏与短屏上很难同时摆对；
    ② 文字放大 + 点击比"点击弧段"更直观；③ 省掉折射滤镜这一最贵的渲染层
- **触屏**：没有 hover，点击头像会同时把功能名切出来并打开个人面板
- **中心头像**：点击打开个人面板。⚠️ 它是**居中模态浮层**，不是侧挂卡片 ——
  实测在 1440~1500px 视口下，圆环右缘与胶囊左端之间只有约 7px 空档，
  任何侧挂面板都必然压住胶囊。面板由 `App` 顶层渲染，
  因为环形导航外层有 `transform` 动画，而带 transform 的祖先会改变
  `position: fixed` 的包含块，导致居中失效
- **自定义头像**：在个人面板里选图或直接把图片拖进去，支持 PNG / JPG / WebP / GIF。
  图片会经 canvas **居中裁剪**并压缩到 512×512（WebP 质量 0.9）后存进 `localStorage`，
  所以不需要后端也能用；实测 1064×604 的 JPEG（77KB）压缩后为 32KB。
  GIF 保留原格式以免丢动图；SVG 直接拒绝（canvas 绘制有限制，且容易被注入脚本）。
  接入后端后改为写入 `data/` 目录即可，前端只需换掉 `src/lib/avatar.ts` 的读写实现
- **胶囊**：悬停时相邻胶囊被"水波"推开 4px、玻璃随鼠标轻微倾斜、镜面高光跟随指针
- **键盘**：`方向键` 在圆环与胶囊之间移动 · `Enter` 进入 · `Esc` 返回首页 · `Ctrl/Cmd + K` 命令面板
- **命令面板**：跨课程 / 文件 / 待办 / 题目 / 灵感做加权模糊搜索，`↑↓` 选择、`Enter` 打开
- **画质档位**：高 / 中 / 省电三档，保存在 `localStorage`。省电档关闭 `backdrop-filter` 与动画
- **壁纸背景**：可在右上角「显示设置」里开关，选择同样持久化
- **无障碍降级**：响应 `prefers-reduced-motion` 与 `prefers-reduced-transparency`

## 背景分层（改背景前必读）

壁纸**沉在最底下**，由上层渐变雾化出朦胧感 —— 不是直接贴在最前面：

| 顺序 | 层 | 职责 |
|---|---|---|
| 1 | `.wall` | 壁纸照片。降饱和 + 提亮 + 极轻模糊，先削弱照片本身的存在感 |
| 2 | `.wall-fog` | 雾化层。白色径向柔光，制造「隔着雾看」的效果 |
| 3 | `.amb-mesh` | 原来的 mesh 渐变，**半透明叠加**，壁纸从缝里透出来 |
| 4 | `.wall-grade` | 暗角调色。压住右侧巫师剪影，保证 UI 可读 |
| 5 | `.amb-blob` | 流动光团，给玻璃提供折射对象 |
| 6 | `.grid-faint` | 极细网格 |
| 7 | `.grain` | 噪点，消除大面积渐变的色带 |

**第 3 层的透明度就是「朦胧度」旋钮**：目前 mesh 用 `0.74~0.86`，
壁纸属于若隐若现的底纹。想更清楚就调低，想更朦胧就调高。

壁纸原图只有 1064×604，放到 1920 宽要拉伸约 1.8 倍，
所以第 1 层的 `saturate(0.82)` + `brightness(1.1)` + `blur(0.6px)`
不只是风格需要，也是在掩盖放大痕迹。
若要换成高分辨率图，可以去掉这个 blur。

关闭壁纸时 `.amb-mesh` 会退回不透明的原渐变，视觉与加壁纸前一致。

## 设计约束（改样式前请先读）

1. **玻璃只承载标题 / 图标 / 短标签**，长文本一律放在 `.deco` 高遮罩深色面板上。
   玻璃上放正文会导致"看着高级但读不清"。
2. **同一屏最多 4~6 个大玻璃面**，列表行用 `.mat` 哑光卡片，不要逐行加玻璃 ——
   `backdrop-filter` 每帧重采样背景，集成显卡上会掉帧。
3. **自定义 CSS 必须写在 `@layer` 内**（见 `src/styles/gl.css` 顶部说明）。
   无层级样式会压掉 Tailwind 的 utilities，表现为"类名在、样式不生效"。
4. 详情面板宽度约 1034px，响应式请用**容器查询**（`@container` + `@3xl:` 等）
   而不是视口断点（`lg:` / `2xl:`），否则在面板内不会触发。

## 目录

```
src/                        前端
  App.tsx                  路由状态、分页、登录门禁、外壳组装
  types.ts                 共享类型
  styles/gl.css            设计系统（单文件，见文件内说明）
  lib/
    api.ts                 统一 API 客户端（凭据走 httpOnly cookie）
    auth.ts                密码规则（共享纯函数）+ 账号接口封装
    useAuth.tsx            登录态：启动时用 cookie 换 /auth/me
    vault.ts               文件类型识别、体积格式化、下载
    vaultStore.ts          文件库持久化（走后端）
    dataApi.ts             灵感/待办/书签的接口 + 前后端形状映射
    github.ts              GitHub 数据（走后端代理，token 不下发）
    markdown.ts            轻量 Markdown 渲染 + 语法高亮
    utils.ts               极坐标、扇形路径、镜面高光等工具
  data/
    nav.ts                 站点地图唯一来源（圆环 + 胶囊）
    heatmap.ts             热力图网格骨架 + 档位（计数来自 /api/activity）
    mock.ts                课程等仍为静态演示数据
  components/              Background / LiquidRing / PillNav / Shell / Heatmap /
                           FileViewer / ProfileCenter / ImagePad / …
  views/                   CoursesView / ScheduleView / NotesView / MissionView /
                           QuestionBankView / BookmarksView / GithubView /
                           LoginView / CombinedViews / …

server/                     后端
  src/
    index.ts                入口：路由挂载、CORS、生产静态托管、优雅退出
    db.ts                   SQLite 连接 + 迁移（只追加，不回头改）
    lib/
      http.ts               统一响应/错误约定
      auth.ts               scrypt 哈希、会话、失败锁定、限流
      storage.ts            落盘、magic bytes 校验、路径安全
      activity.ts           活动流水 + 按天聚合
      deploy.ts             上线开关与守卫（公网/隧道部署的启动检查）
      inject.ts             油猴脚本产物组装（parse.js + userscript.js）
      xlsx.ts               零依赖 xlsx 解析（解 zip + 读表）
      gradesXlsx.ts         成绩表格的列识别
      timetableXlsx.ts      课表表格 → 课程 + 时间段（单双周/多时段/跨行去重）
      timetableImport.ts    课表类导入的共用落库（WakeUp / ICS / xlsx 三边共用）
      grades.ts / ics.ts / wakeup.ts / courseMatch.ts / importAuth.ts / importSnapshot.ts
    routes/                 auth / files / data / import / inject / github
  inject/                   school 页面上的解析规则 + 油猴脚本外壳 + VERSION
  tools/                    命令行工具（改密码、导入课表、脚本自检）
  test/                    测试（下面详列）
  data/                    运行时生成：vault.db + files/（**不进仓库**）
```

## 测试

```bash
pnpm --filter campus-vault-server test     # 接口测试 105 项（自动重置库 + 起服务）
```

不需要后端、随时可跑的纯逻辑测试：

| 文件 | 验什么 |
|---|---|
| `folder-tree.mjs` | 资料库目录树（嵌套、自然序、递归计数、脏路径） |
| `profile-stats.mjs` | 个人中心口径（连续记录、本周起点，含跨天/跨月边界） |
| `timetable-parse.mjs` | 课表 xlsx 解析（多时段、单双周、跨行去重、学期归一化） |
| `xlsx-parse.mjs` | 零依赖 xlsx 解析（实体解码、共享字符串、坏文件给人话） |
| `grades-parse.mjs` | 成绩表格解析（列识别、缺列、异常值） |
| `deploy-guards.mjs` | 上线守卫（密码/注册/静态托管/cookie Secure/health 泄露） |
| `reality-dates.mjs` | 月历与周次（月份边界、跨年） |
| `jw-parse.mjs` | 教务页面识别（用假页面跑油猴解析规则） |

自起隔离后端的：`timetable-api.mjs`、`grades-api.mjs`、`grades-xlsx-api.mjs`、`run.mjs`（跑 `api.test.mjs`）。
需要网站正在运行的端到端：`e2e.mjs`、`e2e-data.mjs`、`qbank-*.mjs`、`notes-*.mjs`、`ui-sweep.mjs` 等。

> 有些测试会读**本机教务系统导出的真文件**（成绩表 / 课表 xlsx）来和夹具对照。
> 文件不在就打印 `SKIP`（不算失败）；路径默认取当前用户的「下载」目录，
> 可用 `CV_GRADES_XLSX` / `CV_TIMETABLE_XLSX` 指定，或用 `CV_REAL=1` 打开那段对照。

## 后端设计要点

| 主题 | 做法 | 为什么 |
|---|---|---|
| 数据库 | Node 内置 `node:sqlite` | 零原生依赖，装包不会因编译失败 |
| 密码 | 内置 `crypto.scrypt` + 随机盐 | 内存硬哈希，抗 GPU 爆破；不引第三方库 |
| 会话 | `sessions` 表 + httpOnly cookie | 删行即失效，比 JWT 更适合"退出登录"和"改密踢设备" |
| 文件落盘 | UUID 命名，原名只存库 | 文件名含中文/空格/括号，直接当路径会路径穿越 |
| 类型校验 | 读文件头（magic bytes） | `Content-Type` 与扩展名都是客户端说了算 |
| 上传 | multer 自定义流式存储引擎 | 不用 `diskStorage`（用客户端文件名），不用 `memoryStorage`（大文件爆内存） |
| 下载 | 支持 Range | 否则 PDF 不能翻页预载、视频不能拖进度条 |
| 删除顺序 | **先删库行，再删磁盘文件** | 反过来崩在中间会留下"行在文件没了"的死记录 |
| 热力图 | 存事件流水，查询时聚合 | 存计数的话删数据后数字不回退，永久对不上 |
| GitHub | 后端代理 + token + 缓存 | token 下发前端等于公开；匿名只有 60 次/小时 |
| 排序 | `created_at DESC, rowid DESC` | 同秒创建的多条若只按时间排，刷新后顺序会变 |

## 安全边界

已实现：

- 密码 **scrypt 加盐哈希**，前端拿不到任何凭据
- 会话是 **httpOnly cookie**，`document.cookie` 读不到
- **失败锁定**（连续 5 次锁 15 分钟）+ 登录/注册**限流**
- 登录失败统一提示「账号或密码不正确」，**不泄漏账号是否存在**
- 所有数据接口按 `owner_id` 隔离，跨用户访问返回 404
- 上传走**扩展名白名单 + 文件头校验**，伪装文件被拒
- 书签只允许 `http`/`https`，挡掉 `javascript:` / `data:` 协议注入
- 参数化查询，SQL 注入字符串只当普通文本

仍需补（生产前）：

- HTTPS（现在是 http，cookie 没加 `Secure`）
- 会话续期策略、并发登录上限
- 每用户磁盘配额与孤儿文件回收
- 邮箱/手机验证与密码找回
- 备份与恢复流程

### 热力图 push 机制

| 档位 | 当天 push 次数 | 颜色 |
|---|---|---|
| 0 | 0 | `rgba(255,255,255,.05)` |
| 1 | 1–2 | `rgba(92,214,190,.30)` |
| 2 | 3–5 | `rgba(92,214,190,.50)` |
| 3 | 6–9 | `rgba(92,214,190,.72)` |
| 4 | 10+ | `rgba(92,214,190,.95)` |

数据在 `src/data/heatmap.ts`（存**次数**而不是颜色档位 —— 气泡要显示原始次数，
只存档位会丢信息）；组件是 `src/components/Heatmap.tsx`，日历页与个人中心共用同一份，
避免两处配色/粒度不一致。接后端时把 `buildHeatmap()` 换成 `GET /api/activity` 即可。

待确认事项见 `NOTES.md` 第五节。
