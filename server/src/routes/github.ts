import { Router } from 'express'
import type { Db } from '../db.ts'
import { getUser, requireAuth, rateLimit } from '../lib/auth.ts'
import { AppError, badRequest, ok, wrap } from '../lib/http.ts'

/**
 * GitHub 代理。
 *
 * 为什么必须走后端而不是前端直连：
 *  ① 匿名调用只有 **60 次/小时/IP**，一刷新几个仓库列表就见底了。
 *     带上 token 后是 5000 次/小时。
 *  ② token **绝不能下发到前端** —— 一旦到了浏览器，
 *     任何能打开 DevTools 的人都能拿到它。
 *  ③ 后端可以做缓存，同一个用户短时间内重复访问不再打 GitHub。
 */

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { at: number; data: unknown }>()

/** 从各种写法里抠出登录名：octocat / github.com/octocat / https://github.com/octocat/repo */
export function parseGithubUser(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  let m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]{1,39})(?:[/?#].*)?$/i.exec(s)
  if (m) return m[1]!
  m = /^@?([A-Za-z0-9-]{1,39})$/.exec(s)
  if (m) return m[1]!
  return null
}

interface GhUser {
  login: string
  name: string | null
  avatar_url: string
  bio: string | null
  html_url: string
  public_repos: number
  followers: number
  following: number
}

interface GhRepo {
  id: number
  name: string
  full_name: string
  html_url: string
  description: string | null
  language: string | null
  stargazers_count: number
  forks_count: number
  topics?: string[]
  updated_at: string
  fork: boolean
  archived: boolean
}

async function ghFetch(url: string, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'campus-vault',
    ...(init.headers as Record<string, string> | undefined),
  }
  const token = process.env.GITHUB_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(url, { ...init, headers })
  if (res.status === 404) throw new AppError(404, 'GH_NOT_FOUND', 'GitHub 用户不存在')
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get('x-ratelimit-remaining')
    const reset = res.headers.get('x-ratelimit-reset')
    const when = reset ? new Date(Number(reset) * 1000).toLocaleTimeString('zh-CN') : '稍后'
    throw new AppError(
      429,
      'GH_RATE_LIMIT',
      token
        ? 'GitHub 接口调用次数已用尽，请稍后再试'
        : `GitHub 匿名接口每小时只有 60 次（当前剩余 ${remaining ?? 0}），请在服务器配置 GITHUB_TOKEN 后重试（约 ${when} 重置）`,
    )
  }
  if (!res.ok) throw new AppError(502, 'GH_ERROR', `GitHub 返回 ${res.status}`)
  return res
}

export function githubRoutes(db: Db): Router {
  const r = Router()
  r.use(requireAuth(db))

  r.get(
    '/:user',
    wrap(async (req, res) => {
      const me = getUser(req)
      rateLimit(`gh:${me.id}`, 60, 10 * 60 * 1000)

      const login = parseGithubUser(String(req.params.user))
      if (!login) throw badRequest('GitHub 用户名格式不正确')

      const hit = cache.get(login)
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        ok(res, { ...(hit.data as object), cached: true })
        return
      }

      const [uRes, rRes] = await Promise.all([
        ghFetch(`https://api.github.com/users/${encodeURIComponent(login)}`),
        ghFetch(`https://api.github.com/users/${encodeURIComponent(login)}/repos?per_page=100&sort=updated`),
      ])
      const u = (await uRes.json()) as GhUser
      const repos = (await rRes.json()) as GhRepo[]

      const data = {
        user: {
          login: u.login,
          name: u.name,
          avatar: u.avatar_url,
          bio: u.bio,
          url: u.html_url,
          publicRepos: u.public_repos,
          followers: u.followers,
          following: u.following,
        },
        repos: repos
          .filter((x) => !x.fork)
          .map((x) => ({
            id: x.id,
            name: x.name,
            fullName: x.full_name,
            url: x.html_url,
            description: x.description,
            language: x.language,
            stars: x.stargazers_count,
            forks: x.forks_count,
            topics: x.topics ?? [],
            updatedAt: x.updated_at,
            archived: x.archived,
          })),
        cached: false,
      }

      cache.set(login, { at: Date.now(), data })
      ok(res, data)
    }),
  )

  return r
}
