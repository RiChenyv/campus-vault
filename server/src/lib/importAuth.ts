/**
 * 导入接口的鉴权中间件。
 *
 * ── 为什么不能沿用「先看 cookie 再看令牌」──
 * 油猴脚本用的是 `GM_xmlhttpRequest`，那是**扩展级请求，不受 SameSite 限制**：
 * 它会自动带上 127.0.0.1:5175 的会话 cookie。
 * 于是原来的顺序导致令牌形同虚设 ——
 * 在 Campus Vault 里登录哪个账号，导入就进哪个账号，
 * 换账号后不用重填令牌也能导入（用户实际遇到的就是这个）。
 *
 * ── 现在的规则 ──
 *   1. **带了令牌 → 只认令牌**，明确失败也好过悄悄导进别的账号
 *   2. 站外来源（Origin 不是 localhost）→ **一律要求令牌**，不认 cookie
 *   3. 本机前端（同源，无令牌）→ 才用会话 cookie
 *
 * 这样"导入到哪个账号"由令牌唯一决定，和浏览器当前登录谁无关。
 */

import type { NextFunction, Request, Response } from 'express'
import type { Db } from '../db.ts'
import { currentUser, requireAuth, type SessionUser } from './auth.ts'
import { importTokenOf, isCrossSite, unauthorized } from './http.ts'

export function makeImportAuth(db: Db) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = importTokenOf(req)
    const crossSite = isCrossSite(req)

    /* 1) 带了令牌：只认令牌。
       即使同时带着 cookie 也**不看** —— 否则"换账号就换归属"的坑会重现。 */
    if (token) {
      const row = db
        .prepare(
          `SELECT u.id, u.account, u.is_admin FROM import_tokens t
             JOIN users u ON u.id = t.user_id
            WHERE t.token = ?`,
        )
        .get(token) as { id: number; account: string; is_admin: number } | undefined
      if (!row) return next(unauthorized('导入令牌无效（可能已被作废，请在导入中心重新生成）', 'BAD_TOKEN'))
      db.prepare('UPDATE import_tokens SET last_used_at = ? WHERE token = ?').run(Date.now(), token)
      ;(req as Request & { user: SessionUser }).user = {
        id: row.id,
        account: row.account,
        isAdmin: row.is_admin === 1,
      }
      return next()
    }

    /* 2) 站外来源且没带令牌：拒绝。
       这里**不能**退回 cookie —— 那正是问题本身。 */
    if (crossSite) {
      return next(unauthorized('来自站外的导入必须提供导入令牌', 'TOKEN_REQUIRED'))
    }

    /* 3) 本机前端：用会话 cookie */
    const viaCookie = currentUser(db, req)
    if (viaCookie) {
      ;(req as Request & { user: SessionUser }).user = viaCookie
      return next()
    }
    next(unauthorized('请先登录，或提供导入令牌', 'NO_AUTH'))
  }
}

/**
 * 会话优先、导入令牌兜底 —— 给**前端也会调**的只读接口用
 * （`/api/schedule`、`/api/import/log`）。
 *
 * 为什么不直接用 `makeImportAuth`：它刻意**不看 `Authorization`**
 * （那是会话令牌的头），只认导入令牌和 cookie。
 * 而"按标签页独立"的会话令牌恰恰走 `Authorization` —— 于是：
 *
 *   · 第二个标签页登录了别的账号 → 这些接口按 cookie 认人，
 *     **返回另一个账号的课表 / 导入历史**（数据串了，还不报错）
 *   · cookie 一旦失效（或根本没 cookie）→ 直接 401，页面空白
 *
 * 这个 bug 是 UI 巡检抓出来的（课程详情页两次 `401 /api/schedule`）。
 *
 * 顺序有讲究：**能认成会话就用会话**（决定读谁的数据要跟着当前标签页），
 * 认不出来才回落到导入令牌（脚本也能读这些只读接口）。
 */
export function makeFlexAuth(db: Db) {
  const importAuth = makeImportAuth(db)
  return (req: Request, res: Response, next: NextFunction) => {
    if (currentUser(db, req)) return requireAuth(db)(req, res, next)
    return importAuth(req, res, next)
  }
}

/** 按令牌查它属于哪个账号 —— 给面板显示"将导入到 XXX"用 */
export function userOfToken(db: Db, token: string) {
  const row = db
    .prepare(
      `SELECT u.id, u.account, u.is_admin, p.username
         FROM import_tokens t
         JOIN users u ON u.id = t.user_id
         LEFT JOIN profiles p ON p.user_id = u.id
        WHERE t.token = ?`,
    )
    .get(token) as { id: number; account: string; is_admin: number; username: string | null } | undefined
  if (!row) return null
  return { id: row.id, account: row.account, isAdmin: row.is_admin === 1, username: row.username ?? '' }
}
