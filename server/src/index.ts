/**
 * Campus Vault 后端入口。
 *
 * 设计要点：
 *  · 与前端同仓、同语言（Node + TypeScript），类型定义可直接复用。
 *  · 数据库用 Node 24 内置的 node:sqlite，密码哈希用内置 crypto 的 scrypt ——
 *    **零原生依赖**，装包不会因为需要编译而失败。
 *  · Vite 已经把 /api 代理到本服务的端口，起起来就能联调。
 *
 * 启动：pnpm --filter campus-vault-server dev
 */

import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import express from 'express'
import { openDb } from './db.ts'
import { errorHandler, notFoundHandler, ok, wrap } from './lib/http.ts'
import { purgeExpiredSessions } from './lib/auth.ts'
import { assertDeploySafe, isLoopbackHost } from './lib/deploy.ts'
import { authRoutes, ensureSeed } from './routes/auth.ts'
import { fileRoutes } from './routes/files.ts'
import { activityRoutes, bookmarkRoutes, ideaRoutes, todoRoutes, calendarRoutes, notesRoutes, courseRoutes, gradeRoutes } from './routes/data.ts'
import { githubRoutes } from './routes/github.ts'
import { importRoutes } from './routes/import.ts'
import { injectRoutes } from './routes/inject.ts'

const PORT = Number(process.env.PORT ?? 5175)
const HOST = process.env.HOST ?? '127.0.0.1'
const DATA_DIR = resolve(process.env.DATA_DIR ?? 'data')
/* 前端构建产物目录（`pnpm build` 生成）。存在就由后端直接托管，
   这样公网部署只要跑这一个进程 —— 不必再配 nginx 反代。 */
const WEB_DIR = resolve(process.env.WEB_DIR ?? '../dist')
const SERVE_WEB = process.env.SERVE_WEB !== '0'

mkdirSync(DATA_DIR, { recursive: true })
mkdirSync(resolve(DATA_DIR, 'files'), { recursive: true })

const db = openDb(resolve(DATA_DIR, 'vault.db'))
/* 上线守卫：非本机监听时，管理员密码没换过就**拒绝启动**。
   见 lib/deploy.ts —— 刻意做成"起不来"，而不是打印一句会被滚过去的警告。 */
assertDeploySafe(db, HOST)
ensureSeed(db)
purgeExpiredSessions(db)
// 每小时清一次过期会话，别让表无限长
setInterval(() => purgeExpiredSessions(db), 60 * 60 * 1000).unref()

const app = express()
app.disable('x-powered-by')
// 只信任本机反代（Vite dev server）。trust proxy 开太大
// 会让 X-Forwarded-For 可以被伪造，限流和审计就失真了。
app.set('trust proxy', 'loopback')

// 请求体上限。文件上传走 multipart，不经过这里，所以可以设得比较小。
app.use(express.json({ limit: '2mb' }))

// 开发期把 Vite 的源放行；生产是同源，不需要 CORS。
// 这里不用 credentials + 通配源 —— 浏览器会直接拒绝那种组合。
app.use((req, res, next) => {
  const origin = req.headers.origin
  // 两类来源：
  //  · 本机前端（127.0.0.1 / localhost 任意端口）—— 带 cookie，用凭据模式
  //  · 学校网站（*.cuc.edu.cn）—— 油猴脚本用 GM_xmlhttpRequest 发导入请求，
  //    跨站请求不带 cookie，所以它必须靠 X-Import-Token 认证，
  //    因此这里**不能**开 Allow-Credentials（开了也白开，反而扩大攻击面）
  const isLocal = origin && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)
  const isSchool = origin && /^https:\/\/([a-z0-9-]+\.)*cuc\.edu\.cn$/i.test(origin)
  if (isLocal) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Import-Token')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  } else if (isSchool) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Import-Token')
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
    /* 「私有网络访问」（PNA）：公网页面 fetch 127.0.0.1 属于 public → loopback，
       Chrome 会额外要一个许可。这个头是它的"放行信号"。
       油猴脚本用 GM_xmlhttpRequest（扩展级请求）不受影响；
       页面级的 fetch（书签脚本那种）会撞上 —— 书签脚本 2026-10 已删除，
       这个头留着不碍事，将来若再加页面级请求还用得上。 */
    res.setHeader('Access-Control-Allow-Private-Network', 'true')
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  next()
})

/* --------------------------------- 路由 --------------------------------- */

app.get('/api/health', (req, res) => {
  /* ⚠️ `dataDir` 是绝对路径、`counts` 会暴露数据量 —— 那是排查用的信息，
     只给本机。公网上（请求来自别处）只回一句"活着"，别把服务器结构告诉别人。
     本机工具（各个测试）仍然拿得到 dataDir，它们靠它确认自己连的是测试库。 */
  const fromLoopback = isLoopbackHost(String(req.ip ?? '').replace(/^::ffff:/, ''))
  if (!fromLoopback) {
    res.json({ ok: true, data: { service: 'campus-vault-server', version: '0.1.0' } })
    return
  }
  const users = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
  const files = (db.prepare('SELECT COUNT(*) AS n FROM files').get() as { n: number }).n
  res.json({
    ok: true,
    data: {
      service: 'campus-vault-server',
      version: '0.1.0',
      uptimeSec: Math.round(process.uptime()),
      dataDir: DATA_DIR,
      githubToken: Boolean(process.env.GITHUB_TOKEN),
      counts: { users, files },
    },
  })
})

app.use('/api/auth', authRoutes(db))
app.use('/api/files', fileRoutes(db, DATA_DIR))
app.use('/api/ideas', ideaRoutes(db, DATA_DIR))
app.use('/api/todos', todoRoutes(db, DATA_DIR))
app.use('/api/bookmarks', bookmarkRoutes(db))
  app.use('/api/events', calendarRoutes(db))
  app.use('/api/notes', notesRoutes(db))
  app.use('/api/courses', courseRoutes(db))
// 成绩单：导入进来之后由界面增删改（学分 / 绩点可手改）
app.use('/api/grades', gradeRoutes(db))
app.use('/api/activity', activityRoutes(db))
app.use('/api/github', githubRoutes(db))
// 在校信息导入：/api/import、/api/courses、/api/schedule、/api/import/log
app.use('/api', importRoutes(db))
// 油猴脚本产物、导入历史与撤销
app.use('/api/import', injectRoutes(db))

/* ------------------------- 前端静态文件（可选） -------------------------
   公网部署时让**这一个进程**同时提供网页和接口：
     · 前端用的是相对路径 `/api`（src/lib/api.ts），同源就没有跨域、
       也不用改任何前端代码；
     · 于是不必再学 nginx —— 反向隧道（Cloudflare Tunnel 等）直接指到 5175 就行。

   ⚠️ 两个顺序问题（都踩过）：
     ① 必须注册在**所有 /api 路由之后**，否则会把接口请求当成静态文件找；
     ② 必须注册在 **notFoundHandler 之前** —— 排在 404 处理器后面的话，
        请求先被 404 拦掉，静态文件永远轮不到（表现：首页直接 404）。
   SPA 回退要跳过 `/api`，否则打错的接口会返回一份 HTML，
   前端 JSON.parse 报一个看不懂的错。 */
if (SERVE_WEB && existsSync(resolve(WEB_DIR, 'index.html'))) {
  app.use(express.static(WEB_DIR, { index: false }))
  /* ⚠️ 用 `{ root }` + 相对文件名，**不要**直接传绝对路径：
     Windows 上 `res.sendFile('D:\\...\\index.html')` 会被 send 判成 404
     （它把绝对路径当成"相对 root 的路径"处理）。踩过一次，写在这里。 */
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile('index.html', { root: WEB_DIR }))
  console.log(`[server] 前端静态文件 ${WEB_DIR}`)
} else if (SERVE_WEB) {
  console.log(`[server] 没找到前端产物（${WEB_DIR}/index.html），只提供接口`)
  console.log('         要一起提供网页：先在项目根目录跑 pnpm build')
}

app.use(notFoundHandler)
app.use(errorHandler)

const server = app.listen(PORT, HOST, () => {
  console.log(`[server] http://${HOST}:${PORT}`)
  console.log(`[server] 数据目录 ${DATA_DIR}`)
  if (!existsSync(resolve(DATA_DIR, 'vault.db'))) console.warn('[server] 警告：数据库文件未找到')
  if (!process.env.GITHUB_TOKEN) {
    console.log('[server] 未配置 GITHUB_TOKEN，GitHub 接口按匿名 60 次/小时限流')
  }
  if (!isLoopbackHost(HOST)) {
    console.log('[deploy] 正在对外监听。请确认：HTTPS 已就绪、注册已关、备份已做')
  }
})

/* 优雅退出：SQLite 需要正常关闭，否则 WAL 文件可能残留 */
const shutdown = (sig: string) => {
  console.log(`\n[server] 收到 ${sig}，正在关闭…`)
  server.close(() => {
    try {
      db.close()
    } catch {
      /* ignore */
    }
    process.exit(0)
  })
  // 兜底：5 秒还没关完就强退，避免卡住
  setTimeout(() => process.exit(0), 5000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
