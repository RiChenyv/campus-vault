import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import type { Db } from '../db.ts'
import { currentUser, getUser, type SessionUser } from '../lib/auth.ts'
import { buildUserscript, injectFingerprint, userscriptVersion } from '../lib/inject.ts'
import { badRequest, ok, unauthorized, wrap } from '../lib/http.ts'
import { undoLastImport } from '../lib/importSnapshot.ts'
import { makeFlexAuth, makeImportAuth, userOfToken } from '../lib/importAuth.ts'

/**
 * 导入相关的"辅助"接口：油猴脚本的产物、历史、撤销。
 *
 * 拆出来单独一个文件，是因为 routes/import.ts 已经很长了（三条导入路径
 * 各自带解析与写库），再加这些会看不清主线。
 *
 * 2026-10：书签脚本已整体移除（用户嫌麻烦，且那条路一直不稳），
 * 这里只剩油猴脚本的产物接口。
 */

/**
 * 后端自己的地址。脚本要从学校页面往这里发请求，必须是绝对地址。
 *
 * ⚠️ 上线后必须用 `PUBLIC_API_BASE` 覆盖（如 `https://vault.example.com/api`）：
 *   脚本是在**运行它的那台设备**上发请求的 —— 写死 127.0.0.1 的话，
 *   你在手机上装了这个脚本，它会去连"手机自己"的 5175，那里什么都没有。
 *   而且公网地址必须是 **https**：学校页面是 https，往 http 发请求会被浏览器
 *   按混合内容规则直接拦掉（GM_xmlhttpRequest 也一样拦）。
 */
const API_BASE = (
  process.env.PUBLIC_API_BASE ?? `http://127.0.0.1:${process.env.PORT ?? '5175'}/api`
).replace(/\/+$/, '')

export function injectRoutes(db: Db): Router {
  const r = Router()
  const auth = makeImportAuth(db)
  /* 前端也会调的接口用它（会话优先、导入令牌兜底）。见 lib/importAuth.ts 的注释。 */
  const authFlex = makeFlexAuth(db)

  /* ---------------------------- 油猴脚本 ----------------------------
     **故意不鉴权**：脚本里没有任何密钥（令牌由用户首次使用时手填），
     而 Tampermonkey 安装时是浏览器直接取这个地址、不带我们的会话 cookie。
     要求鉴权只会让"点一下安装"变成"还要先登录"，反而装不上。 */
  r.get('/userscript.user.js', (req, res) => {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.send(buildUserscript(API_BASE))
  })

  r.get(
    '/inject-info',
    auth,
    wrap(async (_req, res) => {
      ok(res, {
        api: API_BASE,
        userscriptUrl: `${API_BASE}/import/userscript.user.js`,
        userscriptVersion: userscriptVersion(),
        fingerprint: injectFingerprint(),
      })
    }),
  )

  /* ---------------------------- 令牌归属 ----------------------------
     油猴面板在导入前调它，显示"将导入到 XXX" ——
     令牌是浏览器级存储，换账号后不会自动变，用户必须看得见当前归属。
     刻意**不鉴权**：只凭令牌本身查询，调用方除了令牌什么也不知道。 */
  r.post('/whoami', (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : ''
    if (!token) throw badRequest('缺少令牌', 'NO_TOKEN')
    const u = userOfToken(db, token)
    if (!u) throw unauthorized('导入令牌无效', 'BAD_TOKEN')
    ok(res, u)
  })

  /* ---------------------------- 撤销 ----------------------------
     ⚠️ 鉴权用 authFlex，**不能**用 auth（= makeImportAuth）。
     makeImportAuth 刻意不看 `Authorization`（那是会话令牌的头），只认导入令牌和 cookie；
     而「撤销上一次导入」是**本机前端**的动作。用它的话：
       · 第二个标签页登录了别的账号 → 按 cookie 认人，**撤掉的是那个账号的导入**
       · cookie 失效／被拦，但会话令牌有效 → 直接 401，按钮看起来是坏的
     这和之前 /api/schedule、/api/import/log 的坑是同一个（见 importAuth.ts 的注释）。 */
  r.post(
    '/undo',
    authFlex,
    wrap(async (req, res) => {
      const me = getUser(req)
      const restored = undoLastImport(db, me.id)
      if (!restored) {
        // 明确告诉用户"没得撤"，而不是假装成功
        throw badRequest('没有可撤销的导入记录', 'NOTHING_TO_UNDO')
      }
      ok(res, restored)
    }),
  )

  return r
}
