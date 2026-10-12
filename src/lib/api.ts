/**
 * 统一 API 客户端。
 *
 * 后端所有响应都是 `{ ok, data }` 或 `{ ok:false, error:{code,message} }`，
 * 所以这里集中处理一次，调用方拿到的永远是**数据本身**或者一个带中文提示的异常，
 * 不用在每个页面里重复判断状态码。
 *
 * ── 会话怎么带 ──
 * 同时用两条通道，后端优先认第一条：
 *
 *  ① `Authorization: Bearer <sid>`，令牌存在 **sessionStorage** 里
 *  ② httpOnly cookie（`credentials: 'include'`）
 *
 * 为什么要 ①：cookie 名固定、一个域只有一份，**同一浏览器开两个窗口
 * 登录两个账号时会互相覆盖** —— B 登录后 A 的窗口一刷新就变成 B 的账号。
 * 而 sessionStorage 是**每标签页独立**的，各窗口就能各用各的会话。
 *
 * ② 不能去掉：新开标签页时 sessionStorage 是空的，得靠 cookie 把当前会话
 * 继承过来（见 useAuth 里的 adopt 逻辑），否则每开一个标签页都要重新登录。
 */

export class ApiError extends Error {
  code: string
  status: number
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const BASE = '/api'

/** 本标签页的会话令牌。sessionStorage 每标签页独立，正是我们要的语义。 */
const SID_KEY = 'cv.sid'

export const readSessionId = (): string => {
  try {
    return sessionStorage.getItem(SID_KEY) ?? ''
  } catch {
    return ''
  }
}

export const writeSessionId = (sid: string | null | undefined) => {
  try {
    if (sid) sessionStorage.setItem(SID_KEY, sid)
    else sessionStorage.removeItem(SID_KEY)
  } catch {
    /* 隐私模式下写不进去，退回纯 cookie，功能不受影响 */
  }
}

interface ApiEnvelope<T> {
  ok: boolean
  data?: T
  error?: { code: string; message: string }
}

async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json'
  const sid = readSessionId()
  if (sid) headers.Authorization = `Bearer ${sid}`

  let res: Response
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: 'include',
      headers,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      ...init,
    })
  } catch {
    throw new ApiError(0, 'NETWORK', '连接不到服务器，请确认后端已启动')
  }

  const text = await res.text()
  let payload: ApiEnvelope<T> | null = null
  try {
    payload = text ? (JSON.parse(text) as ApiEnvelope<T>) : null
  } catch {
    /* 非 JSON 响应 */
  }

  if (!payload) {
    throw new ApiError(res.status, 'BAD_RESPONSE', `服务器返回了意外的内容（HTTP ${res.status}）`)
  }
  if (!payload.ok) {
    // 会话失效时立刻丢掉本标签页的令牌，避免一直拿废弃会话去撞 401
    if (payload.error?.code === 'NO_AUTH' || payload.error?.code === 'UNAUTHORIZED') {
      writeSessionId(null)
    }
    throw new ApiError(res.status, payload.error?.code ?? 'UNKNOWN', payload.error?.message ?? '请求失败')
  }
  return payload.data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  /** 上传 multipart；不要设 Content-Type，浏览器要自己加 boundary */
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
  /**
   * 带鉴权头拉二进制内容。
   *
   * 为什么不能直接用 `<img src="/api/files/xx/raw">`：
   * <img> 发不出自定义头，只能靠 cookie。而按标签页独立会话之后，
   * cookie 未必指向当前标签页的账号 —— 取自己的头像会 404，显示成空白。
   * 走这里拿 Blob，再转成 object URL 给 <img>，就带上正确的身份了。
   */
  blob: async (path: string): Promise<Blob> => {
    const headers: Record<string, string> = {}
    const sid = readSessionId()
    if (sid) headers.Authorization = `Bearer ${sid}`
    let res: Response
    try {
      res = await fetch(BASE + path, { headers, credentials: 'include' })
    } catch {
      throw new ApiError(0, 'NETWORK', '连接不到服务器，请确认后端已启动')
    }
    if (!res.ok) throw new ApiError(res.status, 'BLOB_FAILED', `读取文件失败（HTTP ${res.status}）`)
    return res.blob()
  },
}

/** 把异常转成可展示的中文文案 */
export const errText = (e: unknown): string =>
  e instanceof ApiError ? e.message : e instanceof Error ? e.message : '未知错误'
