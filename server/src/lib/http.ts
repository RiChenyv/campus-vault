/**
 * 统一的响应与错误约定。
 *
 * 成功：{ ok: true,  data: ... }
 * 失败：{ ok: false, error: { code, message } }
 *
 * 为什么要统一：前端只要写**一个** fetch 包装就能处理所有接口的错误，
 * 不用在每个调用点判断 HTTP 状态码、也不用猜错误体的形状。
 */

import type { NextFunction, Request, Response } from 'express'

export class AppError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const badRequest = (msg: string, code = 'BAD_REQUEST') => new AppError(400, code, msg)
export const unauthorized = (msg = '请先登录', code = 'UNAUTHORIZED') => new AppError(401, code, msg)
export const forbidden = (msg = '无权访问', code = 'FORBIDDEN') => new AppError(403, code, msg)
export const notFound = (msg = '资源不存在', code = 'NOT_FOUND') => new AppError(404, code, msg)
export const tooLarge = (msg: string) => new AppError(413, 'TOO_LARGE', msg)

export const ok = <T>(res: Response, data: T) => res.json({ ok: true, data })

/**
 * 安全读取路径参数。
 *
 * Express 5 的类型里 `req.params[k]` 是 `string | string[] | undefined`
 * —— 因为通配路由可能匹配出数组。直接用会被 TS 挡下，
 * 而且真拿到 undefined 时拼进 SQL 会变成 `undefined` 字面量。
 */
export const param = (req: Request, name: string): string => {
  const v = (req.params as Record<string, string | string[] | undefined>)[name]
  if (Array.isArray(v)) return v[0] ?? ''
  return v ?? ''
}

/**
 * 包裹 async 路由处理器。
 * Express 5 已经会自动捕获被拒绝的 Promise，但显式包一层更直观，
 * 也免得将来降级到 Express 4 时静默吞掉错误。
 */
export const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }

/** 统一错误出口 —— 必须挂在所有路由之后 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  // 任何带 status + code 的错误都按业务错误返回。
  // 这样 storage 层的 UnsafeFileError 之类的领域错误不用耦合到这里。
  const anyErr = err as { status?: unknown; code?: unknown; message?: unknown }
  if (typeof anyErr?.status === 'number' && anyErr.status >= 400 && anyErr.status < 500 && typeof anyErr.code === 'string') {
    return res.status(anyErr.status).json({
      ok: false,
      error: { code: anyErr.code, message: String(anyErr.message ?? '请求有误') },
    })
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message } })
  }
  // multer 的体积超限错误
  const e = err as { code?: string; message?: string; status?: number; statusCode?: number; type?: string }
  // body-parser 的解析错误：请求体不是合法 JSON、超出体积等。
  // 这些是**客户端**错误，但 express 的默认错误对象不带 status 字段，
  // 只有 body-parser 私有的 statusCode/type —— 不识别就会落成 500，
  // 前端看到"服务器内部错误"，实际是自己发了个坏 JSON。
  if (e?.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: { code: 'BAD_JSON', message: '请求体不是合法 JSON' } })
  }
  if (e?.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: { code: 'TOO_LARGE', message: '请求体过大' } })
  }
  if (e?.code === 'LIMIT_FILE_SIZE') {
    return res
      .status(413)
      .json({ ok: false, error: { code: 'TOO_LARGE', message: '文件超过大小上限' } })
  }
  if (e?.code === 'LIMIT_FILE_COUNT' || e?.code === 'LIMIT_UNEXPECTED_FILE') {
    return res
      .status(400)
      .json({ ok: false, error: { code: 'BAD_UPLOAD', message: '上传的文件数量或字段不正确' } })
  }
  console.error('[error]', err)
  // 不要把内部错误细节返回给客户端
  res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: '服务器内部错误' } })
}

/** 未匹配任何路由 */
export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: '接口不存在' } })
}

/* ─────────────────────── 导入鉴权用的小工具 ─────────────────────── */

/**
 * 从请求里取**导入令牌**。
 *
 * ⚠️ 只看 `X-Import-Token`，**不看 `Authorization`**。
 * 这两种令牌必须走不同的头：
 *   · `Authorization: Bearer <会话id>` —— 浏览器标签页的登录态
 *   · `X-Import-Token: <导入令牌>`     —— 学校页面脚本的导入凭据
 * 一开始两者都用 Authorization，结果前端每个请求带的会话 id 被当成了导入令牌，
 * 去 import_tokens 表里查不到 → 导入相关接口全部 401。
 * 一个头承担两种身份，迟早打架。
 */
export function importTokenOf(req: Request): string | null {
  const x = (req.headers as Record<string, string | string[] | undefined>)['x-import-token']
  const raw = typeof x === 'string' ? x : Array.isArray(x) ? x[0] : undefined
  const t = raw?.trim()
  return t ? t : null
}

/**
 * 这次请求是不是从**站外**发起的（比如学校页面上的油猴脚本）。
 *
 * 用途：站外请求**不能认 cookie**。
 *
 * `GM_xmlhttpRequest` 是扩展级请求，不受 SameSite 限制 —— 它会自动带上
 * 127.0.0.1:5175 的会话 cookie。而导入接口原先是"先看 cookie 再看令牌"，
 * 于是令牌完全不起作用：在 Campus Vault 里登录哪个账号，导入就进哪个账号。
 * 用户以为自己用令牌指定了归属，其实归属由浏览器登录态决定 ——
 * 换账号后不用重填令牌也能导入，就是这么来的。
 */
export function isCrossSite(req: Request): boolean {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || !origin) return false
  return !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)
}
