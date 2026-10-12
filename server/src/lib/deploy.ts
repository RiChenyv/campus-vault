/**
 * 上线（公网部署）相关的开关与**守卫**。
 *
 * 这个项目本来是"本地个人应用"：默认只听 127.0.0.1、注册开放、
 * 管理员密码写在代码里。要把放到公网上，这几条都会变成事故，所以集中在这里：
 *
 *   · `assertDeploySafe()` —— **非本机监听时**检查两个致命项，不满足就拒绝启动
 *       ① 没设 `ADMIN_PASSWORD`
 *       ② 管理员密码还是那个写在代码/交接文档里的初始值
 *     为什么"拒绝启动"而不是"打印一句警告"：警告会滚过去，而这类问题的后果
 *     是别人拿到你的全部数据。宁可起不来，也不要带着公开密码跑在公网上。
 *
 *   · `registerAllowed()` —— 公网默认**关闭注册**（单人应用，开放注册等于
 *     让任何人来占你的磁盘）。要开得显式设 `ALLOW_REGISTER=1`。
 *
 *   · `cookieSecure()` —— HTTPS 下给会话 cookie 加 `Secure`。
 *
 * 全部环境变量（都在这里用到，部署文档里也列了一遍）：
 *   HOST              监听地址。默认 127.0.0.1；公网要 0.0.0.0
 *   PORT              端口，默认 5175
 *   DATA_DIR          数据目录，默认 server/data
 *   ADMIN_ACCOUNT     管理员账号名，默认 admin
 *   ADMIN_PASSWORD    管理员密码（**公网必设**）
 *   ALLOW_REGISTER    1/0，是否允许注册（默认：本机允许、公网关闭）
 *   COOKIE_SECURE     1 = 强制给 cookie 加 Secure（反代没透传协议时用）
 *   PUBLIC_API_BASE   油猴脚本要访问的后端地址，如 https://vault.example.com/api
 *   GITHUB_TOKEN      GitHub 接口用的令牌（可选）
 */

import type { Db } from '../db.ts'
import { verifyPassword } from './auth.ts'

/** 只听本机 = 本地开发/自用；其它值（0.0.0.0 / 域名 / ::）都算对外 */
export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

/**
 * 这个部署算不算"对外的"。
 *
 * ⚠️ 光看 HOST 不够：**用隧道（Cloudflare Tunnel / ngrok 等）时，
 * 后端是听 127.0.0.1 的** —— 隧道客户端在本机连它，公网访问者打不到这个端口，
 * 所以"只听本机"反而是更安全的做法。但那样一来，按 HOST 判断就会以为
 * "这是本地自用"，于是密码、注册这些检查全被跳过，而网站其实是公开的。
 *
 * 所以多给一个显式开关 `PUBLIC_DEPLOY=1`（用隧道时必须设）：
 * 设了它，就按"对外"来做全部检查。
 */
export function isPublicDeploy(host: string): boolean {
  const v = process.env.PUBLIC_DEPLOY
  if (v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false') return true
  return !isLoopbackHost(host)
}

/**
 * 内置的初始管理员密码。
 *
 * ⚠️ 它是**公开的**（写在代码里，也写在交接文档里），只允许在"只听本机"时使用。
 * 公网/隧道部署若还是这个密码，`assertDeploySafe` 会直接拒绝启动。
 */
export const BUILTIN_ADMIN_PASSWORD = 'Cv-Dev-Only-2026'

export const adminAccount = (): string => process.env.ADMIN_ACCOUNT ?? 'admin'
export const adminPassword = (): string => process.env.ADMIN_PASSWORD || BUILTIN_ADMIN_PASSWORD

/**
 * 是否允许注册。
 * 默认：本机允许（方便自己建第二个账号）、对外关闭。
 * 显式设 `ALLOW_REGISTER=1` 才对外开放；设 `=0` 连本机也关。
 */
export function registerAllowed(isLocal = !isPublicDeploy(process.env.HOST ?? '127.0.0.1')): boolean {
  const v = process.env.ALLOW_REGISTER
  if (v === undefined || v === '') return isLocal
  return v !== '0' && v.toLowerCase() !== 'false'
}

/** 这次请求是不是 HTTPS（反代透传 X-Forwarded-Proto 时 req.secure 也为真） */
export function cookieSecure(req: { secure?: boolean }): boolean {
  return Boolean(req.secure) || process.env.COOKIE_SECURE === '1'
}

export class DeployUnsafeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeployUnsafeError'
  }
}

/**
 * 非本机监听时的启动守卫。本机监听直接放行（不影响开发和测试）。
 *
 * @param host 实际监听地址（`process.env.HOST`）
 */
export function assertDeploySafe(db: Db, host: string): void {
  if (!isPublicDeploy(host)) return

  const problems: string[] = []

  /* 已经有管理员了：种子不会再跑，所以**只看它的密码是不是那个公开的初始值** ——
     这时 ADMIN_PASSWORD 设没设都不影响（设了也不会覆盖已存在的账号，
     一开始我把"没设 ADMIN_PASSWORD"也当成问题，结果"已经改过密码"的正常情况
     也被拒了，测试抓到了这个）。

     能查出明文吗？不能 —— scrypt 是单向的。但可以**试**一下：
     拿初始密码去验，验过了说明就是它。 */
  const row = db
    .prepare('SELECT password_hash FROM users WHERE account = ?')
    .get(adminAccount()) as { password_hash: string } | undefined

  if (row) {
    if (verifyPassword(BUILTIN_ADMIN_PASSWORD, row.password_hash)) {
      problems.push(
        `· 账号 ${adminAccount()} 的密码仍是公开的初始密码（Cv-Dev-Only-2026）。` +
          '先在本地改掉：用 HOST=127.0.0.1 起一次 → 登录后在个人中心改密码 → 再上公网。',
      )
    }
  } else if (!process.env.ADMIN_PASSWORD) {
    /* 空库：这次启动会创建种子管理员。没给密码就只能用写在代码里的初始值 ——
       等于把管理员权限公开。 */
    problems.push(
      '· 数据库里还没有管理员账号，而这次启动会创建它 —— 但没设 ADMIN_PASSWORD，' +
        '只能用**写在代码里的初始密码**（那个密码是公开的）。请先设一个自己的。',
    )
  }

  if (problems.length) {
    throw new DeployUnsafeError(
      '\n' +
        '════════════════════════════════════════════════════════\n' +
        `拒绝在对外可访问的状态下启动（HOST=${host}${process.env.PUBLIC_DEPLOY ? ' + PUBLIC_DEPLOY' : ''}）：安全设置没做到位\n` +
        '════════════════════════════════════════════════════════\n' +
        problems.join('\n') +
        '\n\n' +
        '修好之后再启动。只想本机用的话，把 HOST 去掉（默认就是 127.0.0.1）。\n' +
        '（这一步是刻意做成"起不来"而不是"警告一下"：带着公开密码跑在公网上，\n' +
        '  后果是别人拿到你的全部课程、成绩和个人信息。）\n',
    )
  }

  if (registerAllowed(false)) {
    console.warn(
      '[deploy] 注意：公网地址上**允许注册**（ALLOW_REGISTER 显式打开了）。\n' +
        '         单人应用建议设 ALLOW_REGISTER=0，否则任何人都能建账号占你磁盘。',
    )
  }
}
