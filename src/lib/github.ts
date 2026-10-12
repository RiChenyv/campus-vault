/**
 * GitHub 数据获取 —— **走后端代理**。
 *
 * 原来这里直连 api.github.com（它允许跨域），原型阶段够用，但有三个硬伤：
 *  ① 匿名调用只有 **60 次/小时/IP**，刷新几次就限流；
 *  ② 想提高配额就得放 token —— 而 token 一旦下发到浏览器，
 *     任何能开 DevTools 的人都能拿走；
 *  ③ 每次都真的打 GitHub，没有共享缓存。
 *
 * 现在改成 `/api/github/:user`：token 只在服务端，
 * 服务端还有 5 分钟缓存，配额提到 5000 次/小时。
 *
 * 下面的类型与展示辅助函数保持不变，所以 GithubView 不用改。
 */

import { api } from './api'

export interface GhRepo {
  id: number
  name: string
  full_name: string
  html_url: string
  description: string | null
  language: string | null
  stargazers_count: number
  forks_count: number
  topics?: string[]
  pushed_at: string
  updated_at: string
  fork: boolean
  archived: boolean
  homepage: string | null
  size: number
}

export interface GhUser {
  login: string
  name: string | null
  avatar_url: string
  html_url: string
  bio: string | null
  company: string | null
  location: string | null
  blog: string | null
  public_repos: number
  followers: number
  following: number
  created_at: string
}

export interface GhData {
  user: GhUser
  repos: GhRepo[]
  /** 拉取时刻，用于展示"更新于" */
  at: number
  /** 是否命中服务端缓存 */
  cached?: boolean
  rateLimited?: boolean
}

/**
 * 从任意输入里抽出 GitHub 用户名。
 * 用户可能填 "octocat"、"github.com/octocat"、
 * "https://github.com/octocat" 甚至带尾斜杠或 /repos 后缀。
 */
export function parseGithubUser(raw: string): { login: string; error?: string } {
  const s = raw.trim()
  if (!s) return { login: '', error: '请填写 GitHub 用户名或主页地址' }
  const cleaned = s
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/^github\.com\//i, '')
    .replace(/\/+$/, '')
    .split(/[/?#]/)[0]
    .trim()
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(cleaned)) {
    return { login: '', error: '用户名格式不对（只能包含字母、数字和单个连字符）' }
  }
  return { login: cleaned }
}

/** 服务端返回的精简形状 */
interface ProxyRepo {
  id: number
  name: string
  fullName: string
  url: string
  description: string | null
  language: string | null
  stars: number
  forks: number
  topics: string[]
  updatedAt: string
  archived: boolean
}

interface ProxyUser {
  login: string
  name: string | null
  avatar: string
  bio: string | null
  url: string
  publicRepos: number
  followers: number
  following: number
}

/**
 * 从后端代理取数据。
 * 服务端已经按 updated 排过序、过滤掉 fork，这里只做形状适配 ——
 * 保持返回结构不变，视图那一层完全不用动。
 */
export async function fetchGithub(login: string, _signal?: AbortSignal): Promise<GhData> {
  const d = await api.get<{ user: ProxyUser; repos: ProxyRepo[]; cached: boolean }>(
    `/github/${encodeURIComponent(login)}`,
  )
  const user: GhUser = {
    login: d.user.login,
    name: d.user.name,
    avatar_url: d.user.avatar,
    html_url: d.user.url,
    bio: d.user.bio,
    company: null,
    location: null,
    blog: null,
    public_repos: d.user.publicRepos,
    followers: d.user.followers,
    following: d.user.following,
    created_at: '',
  }
  const repos: GhRepo[] = d.repos.map((r) => ({
    id: r.id,
    name: r.name,
    full_name: r.fullName,
    html_url: r.url,
    description: r.description,
    language: r.language,
    stargazers_count: r.stars,
    forks_count: r.forks,
    topics: r.topics,
    pushed_at: r.updatedAt,
    updated_at: r.updatedAt,
    fork: false,
    archived: r.archived,
    homepage: null,
    size: 0,
  }))
  return { user, repos, at: Date.now(), cached: d.cached }
}

/** 相对时间：几天前 / 几小时前 */
export function sinceLabel(iso: string) {
  const t = +new Date(iso)
  if (!t) return ''
  const diff = Date.now() - t
  const day = 86400000
  if (diff < 3600000) return `${Math.max(1, Math.round(diff / 60000))} 分钟前`
  if (diff < day) return `${Math.round(diff / 3600000)} 小时前`
  if (diff < day * 30) return `${Math.round(diff / day)} 天前`
  if (diff < day * 365) return `${Math.round(diff / (day * 30))} 个月前`
  return `${Math.round(diff / (day * 365))} 年前`
}

/** 语言 → 颜色（覆盖常见几种，其它走默认灰） */
const LANG_RGB: Record<string, string> = {
  Python: '92 214 190',
  JavaScript: '255 214 107',
  TypeScript: '111 156 255',
  HTML: '255 143 107',
  CSS: '143 178 255',
  Java: '255 143 143',
  C: '160 170 200',
  'C++': '255 143 177',
  'C#': '142 224 106',
  Go: '111 214 255',
  Rust: '255 168 120',
  Shell: '142 224 106',
  Vue: '126 224 160',
  Jupyter: '255 179 107',
  'Jupyter Notebook': '255 179 107',
}

export const langRgb = (lang: string | null) => (lang && LANG_RGB[lang]) || '160 170 200'
