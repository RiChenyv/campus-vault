/**
 * 把 `files.folder` 的路径串成**真正的目录树**。
 *
 * 为什么需要它：上传整个文件夹时，`folder` 存的是相对路径
 * （如 `PythonProject/03-判断语句/if类型的使用`）。原来的列表只按
 * **路径第一段**分组，更深层的子文件夹退化成一个路径标签 ——
 * 于是 `PythonProject` 展开后是一屏几百个文件，看不出层次，
 * 也没法一层层点进去（用户原话：希望子文件夹也能显示出来）。
 *
 * 纯函数，不依赖 React：方便直接测（见 server/test/folder-tree.mjs）。
 */

import type { VaultItem } from './vault'

export interface FolderNode {
  /** 这一层的名字（路径最后一段） */
  name: string
  /** 从根算起的完整相对路径，用作展开状态的 key */
  path: string
  /** 子文件夹（已排序） */
  folders: FolderNode[]
  /** **直属**这个目录的文件（已排序；不含子目录里的） */
  files: VaultItem[]
  /** 含所有子目录在内的文件数 —— 折叠时显示这个数，让人知道里面有多少东西 */
  total: number
}

/**
 * 名字排序：**自然序**。
 *
 * `numeric: true` 是必须的：否则 `10-系统级IO.md` 会排在
 * `02-信息的表示和处理.md` 前面（逐字符比较时 '1' < '2'）。
 * 用户的项目/章节命名大量是 `01-` `02-` … `10-` 这种。
 */
const collator = new Intl.Collator('zh', { numeric: true, sensitivity: 'base' })
export const byName = (a: string, b: string) => collator.compare(a, b)

/** 目录在前、文件在后，各自按名字排 —— 这就是"文件夹内有序" */
const sortDeep = (n: FolderNode): number => {
  n.folders.sort((a, b) => byName(a.name, b.name))
  n.files.sort((a, b) => byName(a.name, b.name))
  let total = n.files.length
  for (const c of n.folders) total += sortDeep(c)
  n.total = total
  return total
}

/**
 * @param items 同一范围（scope）的文件
 * @returns `loose` = 没有 folder 的散装文件；`folders` = 顶层目录（已排序）
 */
export function buildFolderTree(items: VaultItem[]): { loose: VaultItem[]; folders: FolderNode[] } {
  const byPath = new Map<string, FolderNode>()
  const roots: FolderNode[] = []
  const loose: VaultItem[] = []

  /** 按完整路径取（没有就建）节点；parent 为空表示顶层 */
  const ensure = (path: string, name: string, parent: FolderNode | null): FolderNode => {
    let n = byPath.get(path)
    if (!n) {
      n = { name, path, folders: [], files: [], total: 0 }
      byPath.set(path, n)
      if (parent) parent.folders.push(n)
      else roots.push(n)
    }
    return n
  }

  for (const it of items) {
    /* 路径里可能出现空段（`a//b`、结尾多一个 `/`）—— 过滤掉，
       否则会造出一个名字为空、永远展不开的假目录 */
    const parts = (it.folder ?? '')
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!parts.length) {
      loose.push(it)
      continue
    }

    let parent: FolderNode | null = null
    let path = ''
    for (const part of parts) {
      path = path ? `${path}/${part}` : part
      parent = ensure(path, part, parent)
    }
    /* parts 非空 ⇒ 循环至少跑一次 ⇒ parent 一定不是 null。
       TS 的收窄跨不过循环，这里断言（和项目里 parts[0]! 的用法一致）。 */
    parent!.files.push(it)
  }

  for (const r of roots) sortDeep(r)

  return {
    loose: loose.sort((a, b) => byName(a.name, b.name)),
    folders: roots.sort((a, b) => byName(a.name, b.name)),
  }
}
