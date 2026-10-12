import type { Bookmark } from '../types'

/**
 * 宝藏网址（书签）。
 * 分类只影响徽标配色，不做筛选逻辑 —— 先攒起来才是重点。
 */
export const BOOKMARKS: Bookmark[] = [
  {
    id: 'b1',
    title: 'MDN Web Docs',
    url: 'https://developer.mozilla.org/zh-CN/',
    desc: '前端 API 的权威参考，遇到拿不准的属性先查这里',
    kind: '文档',
    rgb: '111 156 255',
    at: '今天 09:12',
  },
  {
    id: 'b2',
    title: 'Visualgo 算法可视化',
    url: 'https://visualgo.net/zh',
    desc: '把排序 / 图 / 树跑成动画，讲 Dijkstra 的时候特别好用',
    kind: '工具',
    rgb: '92 214 190',
    at: '昨天 21:40',
  },
  {
    id: 'b3',
    title: 'CS 自学指南',
    url: 'https://csdiy.wiki/',
    desc: '课程与学习路线的索引，用来补课内没讲透的部分',
    kind: '学习',
    rgb: '196 148 255',
    at: '10-28 14:05',
  },
  {
    id: 'b4',
    title: 'Papers With Code',
    url: 'https://paperswithcode.com/',
    desc: '论文 + 开源实现对照，找基线实现很快',
    kind: '研究',
    rgb: '255 143 177',
    at: '10-26 19:30',
  },
  {
    id: 'b5',
    title: 'Excalidraw 手绘白板',
    url: 'https://excalidraw.com/',
    desc: '画架构图 / 流程图，风格松散适合草稿阶段',
    kind: '工具',
    rgb: '255 179 107',
    at: '10-24 11:08',
  },
  {
    id: 'b6',
    title: '菜鸟教程 · SQL',
    url: 'https://www.runoob.com/sql/sql-tutorial.html',
    desc: '语法速查，写实验报告里的建表语句时够用',
    kind: '文档',
    rgb: '142 224 106',
    at: '10-21 16:22',
  },
]

/** 可选分类与配色（新增/编辑时用） */
export const BOOKMARK_KINDS: { kind: string; rgb: string }[] = [
  { kind: '文档', rgb: '111 156 255' },
  { kind: '工具', rgb: '92 214 190' },
  { kind: '学习', rgb: '196 148 255' },
  { kind: '研究', rgb: '255 143 177' },
  { kind: '娱乐', rgb: '255 179 107' },
  { kind: '待读', rgb: '142 224 106' },
]

/**
 * 规范化用户输入的网址。
 * 用户通常直接粘 "example.com" 或 "www.example.com"，
 * 不补协议的话 href 会被当成相对路径、跳到本站内的 404。
 */
export function normalizeUrl(raw: string): { url: string; error?: string } {
  const s = raw.trim()
  if (!s) return { url: '', error: '网址不能为空' }
  const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`
  try {
    const u = new URL(withProto)
    if (!u.hostname.includes('.')) return { url: '', error: '网址看起来不完整，例如 example.com' }
    if (!/^https?:$/.test(u.protocol)) return { url: '', error: '只支持 http / https 链接' }
    return { url: u.toString() }
  } catch {
    return { url: '', error: '网址格式不对，例如 https://example.com' }
  }
}

/** 取主机名用于展示（去掉 www.） */
export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** 站点图标：只做展示用的小图，加载失败会退回首字母（见视图里的 onError） */
export const faviconOf = (url: string) => {
  try {
    const u = new URL(url)
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`
  } catch {
    return ''
  }
}
