import { useEffect, useMemo, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import { SectionTitle } from './Bits'
import { IconFolder, IconSearch } from './Icons'
import { errText } from '../lib/api'
import { kindLabel, kindRgb, type VaultItem } from '../lib/vault'
import { buildFolderTree, type FolderNode } from '../lib/folderTree'
import * as store from '../lib/vaultStore'
import { useCourses, DEFAULT_RGB, type Course } from '../lib/useCourses'

/**
 * 「课程资料库」—— 按**真实课程**分组展示**真实文件**。
 *
 * 这块原来读的是 `src/data/mock.ts` 里写死的 `FILES`，而且右侧查看器
 * 无论点哪个文件都显示同一份 `SAMPLE_MD`（它只看 kind，不读 file 内容）。
 * 所以那些文件删不掉、打不开、刷新又回来。
 *
 * 现在数据来自 files 表的 **note** 范围（不看题库 —— 那是另一件事），
 * 课程筛选来自 courses 表。
 */
/* 只读 **笔记** 范围。
   题库和笔记是两件事：题库放课件/试卷/错题，笔记放自己整理的资料。
   混在一起看会让人分不清"这个文件属于哪边"，删除时也容易删错。
   要看题库请去题库页。 */
const SCOPES = ['note'] as const

export default function CourseLibrary({
  onOpenCourse,
  reloadKey = 0,
}: {
  onOpenCourse?: (id: string) => void
  /**
   * 外部要求重新读取的标记（数值一变就重读）。
   *
   * 为什么需要：这个组件**只在挂载时读一次**，而它在笔记页上和上传区是兄弟 ——
   * 传完文件不通知它，用户往下看资料库还是空的，要手动刷新页面才出现。
   * 上传区每次成功后把父组件的计数 +1，这里就会重读。
   */
  reloadKey?: number
} = {}) {
  const { courses, loading: coursesLoading, error: coursesErr } = useCourses()
  const [items, setItems] = useState<VaultItem[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [delOpen, setDelOpen] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const lists = await Promise.all(SCOPES.map((s) => store.loadAll(s)))
        if (alive) setItems(lists.flat())
      } catch (e) {
        if (alive) setErr(errText(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [reloadKey])

  /** 按课程分组。courseId 为空的一律进「未归类」 */
  const grouped = useMemo(() => {
    const k = q.trim().toLowerCase()
    const hit = (it: VaultItem) =>
      !k || it.name.toLowerCase().includes(k) || (it.note ?? '').toLowerCase().includes(k)

    const visible = items.filter(hit)
    const map = new Map<string, VaultItem[]>()
    for (const it of visible) {
      const key = it.courseId || ''
      const list = map.get(key)
      if (list) list.push(it)
      else map.set(key, [it])
    }

    // 有课的排前面（按课程名），未归类排最后
    const withCourse = courses
      .filter((c) => map.has(c.id))
      .map((c) => ({ course: c, files: map.get(c.id)! }))
    const orphan = map.get('') ?? []
    return { withCourse, orphan, total: visible.length }
  }, [items, courses, q])

  const current = items.find((x) => x.id === picked) ?? null

  const del = (id: string) => {
    const snapshot = items
    setItems((p) => p.filter((x) => x.id !== id))
    setPicked((cur) => (cur === id ? null : cur))
    void store.remove(id).catch((e) => {
      setItems(snapshot)
      setErr(`删除失败：${errText(e)}`)
    })
  }

  const loadingAll = loading || coursesLoading
  const anyErr = err || coursesErr

  return (
    <div className="grid gap-5 @3xl:grid-cols-[320px_1fr]">
      {/* ---------- 左：按课程分组 ---------- */}
      <div className="min-w-0">
        <SectionTitle kicker="library" title="课程资料库" rgb="196 148 255" />

        <div className="mb-3 flex items-center gap-2 rounded-2xl bg-white/5 px-3 py-2">
          <IconSearch className="h-4 w-4 shrink-0 text-ink-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="按文件名或备注过滤…"
            className="w-full bg-transparent text-[12.5px] text-white outline-none placeholder:text-ink-faint"
            aria-label="过滤资料"
          />
        </div>

        {anyErr && (
          <div
            className="mb-3 rounded-xl px-3 py-2 text-[11.5px]"
            style={{ background: 'rgba(255,120,120,.16)', color: '#ffb3b3' }}
            role="alert"
          >
            {anyErr}
          </div>
        )}

        {loadingAll && <div className="py-8 text-center text-[12px] text-ink-faint">正在读取…</div>}

        {!loadingAll && !grouped.total && (
          <div className="mat-clear rounded-2xl px-4 py-8 text-center text-[12px] leading-relaxed text-white/55">
            {items.length ? '没有匹配的文件' : '资料库还是空的'}
            <br />
            {items.length ? '换个关键词试试' : '去题库或笔记上传文件'}
          </div>
        )}

        <div className="space-y-3">
          {grouped.withCourse.map(({ course, files }) => (
            <CourseGroup
              key={course.id}
              course={course}
              files={files}
              picked={picked}
              onPick={(id) => setPicked(id === picked ? null : id)}
              onDelete={del}
              onOpenCourse={onOpenCourse}
              filtering={!!q.trim()}
            />
          ))}

          {!!grouped.orphan.length && (
            <CourseGroup
              course={null}
              files={grouped.orphan}
              picked={picked}
              onPick={(id) => setPicked(id === picked ? null : id)}
              onDelete={del}
              filtering={!!q.trim()}
            />
          )}
        </div>
      </div>

      {/* ---------- 右：预览 ---------- */}
      <div className="min-w-0">
        <SectionTitle kicker="reader" title="阅读笔记" rgb="196 148 255" />
        {current ? (
          /* ⚠️ 高度不能写 calc(100vh - 260px)。
             这一页**本身在滚动**，而阅读区在"我写的笔记 + 笔记文件"下面很靠下的位置 ——
             从那里再往下延伸一整个视口高，就远远超出屏幕了（用户看到的正是这个）。
             改成：
              · height 用 min(72vh, 700px) —— 保证不超出视口，也给长文档留足地方
              · position: sticky —— 滚左边列表时右边仍停在视野里，不用来回滚
              · overflow: hidden —— 外层不滚，让里面 FileViewer 的
                overflow-auto 区域去滚（鼠标停在正文上时滚的是正文） */
          <div
            className="min-h-0"
            style={{
              position: 'sticky',
              top: 12,
              height: 'min(72vh, 700px)',
              overflow: 'hidden',
            }}
          >
            <LazyViewer item={current} />
          </div>
        ) : (
          <div className="mat-clear grid min-h-[320px] place-items-center rounded-3xl px-6 text-center">
            <div className="max-w-[40ch]">
              <div className="font-cn-title text-[14.5px] font-semibold text-white">未打开任何文件</div>
              <p className="mt-2 text-[12px] leading-relaxed text-white/60">
                点左边任意一条即可在这里查看 ——
                PDF / 图片 / Markdown / Word / 代码 / 文本都能站内打开。
              </p>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={delOpen}
        title="删除这个文件？"
        message="将同时删除它在磁盘上的副本。"
        detail="此操作不可撤销。"
        confirmText="删除"
        onConfirm={() => {
          if (picked) del(picked)
          setDelOpen(false)
        }}
        onCancel={() => setDelOpen(false)}
      />
    </div>
  )
}

/** 一个课程分组：标题 + 里面的文件 */
function CourseGroup({
  course,
  files,
  picked,
  onPick,
  onDelete,
  onOpenCourse,
  filtering,
}: {
  course: Course | null
  files: VaultItem[]
  picked: string | null
  onPick: (id: string) => void
  onDelete: (id: string) => void
  onOpenCourse?: (id: string) => void
  /** 正在按关键词过滤：目录要自动展开，否则匹配到的文件藏在折叠里像"没搜到" */
  filtering?: boolean
}) {
  const [open, setOpen] = useState(true)
  const rgb = course?.rgb || DEFAULT_RGB

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={`${open ? '收起' : '展开'}课程 ${course?.name ?? '未归类'}`}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-1.5 text-left transition hover:bg-white/6"
        >
          <span
            className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-[10px] text-white transition-transform"
            style={{ background: `rgb(${rgb} / .28)`, transform: open ? 'rotate(90deg)' : 'none' }}
            aria-hidden
          >
            ▸
          </span>
          <span className="min-w-0 truncate text-[12.5px] font-semibold text-white" title={course?.name}>
            {course?.name ?? '未归类'}
          </span>
          <span className="shrink-0 text-[10.5px] text-white/45">{files.length}</span>
        </button>
        {course?.manual && onOpenCourse && (
          <button
            onClick={() => onOpenCourse(course.id)}
            aria-label={`管理课程 ${course.name}`}
            className="shrink-0 rounded-lg px-2 py-1 text-[10.5px] text-white/45 transition hover:bg-white/10 hover:text-white"
          >
            管理
          </button>
        )}
      </div>

      {open && (
        <CourseBody files={files} picked={picked} onPick={onPick} onDelete={onDelete} filtering={filtering} />
      )}
    </div>
  )
}

/**
 * 课程下面的内容：**目录树**，默认折叠，一层层点开。
 *
 * 为什么是树而不是"按第一段分组的平铺"：
 * 上传整个文件夹时 `folder` 是相对路径，可能有好几层
 * （`PythonProject/03-判断语句/if类型的使用`）。原来只按第一段分组，
 * 深层子文件夹退化成一个路径标签 —— 展开 `PythonProject` 就是几百个文件
 * 平铺出来，看不出层次、也没法逐层点进去。
 *
 * ⚠️ **只渲染展开的节点**：实测某个用户 note 范围有 1504 个文件 / 260 个目录 /
 * 最深 11 层，全展开会让这一页直接卡死。所以默认折叠、按需展开；
 * 搜索时（`q` 非空）才自动全展开 —— 那时列表已经被过滤过了。
 */
function CourseBody({
  files,
  picked,
  onPick,
  onDelete,
  filtering = false,
}: {
  files: VaultItem[]
  picked: string | null
  onPick: (id: string) => void
  onDelete: (id: string) => void
  filtering?: boolean
}) {
  const { loose, folders } = useMemo(() => buildFolderTree(files), [files])
  const [openPaths, setOpenPaths] = useState<Set<string>>(() => new Set())

  const toggle = (path: string) =>
    setOpenPaths((s) => {
      const next = new Set(s)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  /** 一行文件。散装和目录内共用 */
  const row = (it: VaultItem) => {
    const active = picked === it.id
    const krgb = kindRgb[it.kind]
    return (
      <li key={it.id}>
        <div
          className="group flex items-center gap-2 rounded-xl px-2 py-1.5 transition"
          style={active ? { background: `rgb(${krgb} / .16)`, border: `1px solid rgb(${krgb} / .5)` } : undefined}
        >
          <button
            onClick={() => onPick(it.id)}
            aria-label={`打开 ${it.name}`}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <IconFolder className="h-3.5 w-3.5 shrink-0" style={{ color: `rgb(${krgb})` }} />
            <span className="min-w-0">
              <span className="block truncate text-[12px] text-white/90" title={it.name}>
                {it.name}
              </span>
              <span className="mt-0.5 block truncate text-[10px] text-white/38">
                {kindLabel[it.kind]} · {it.size}
                {it.note ? ` · ${it.note}` : ''}
              </span>
            </span>
          </button>
          <button
            onClick={() => onDelete(it.id)}
            aria-label={`删除文件 ${it.name}`}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[12px] leading-none text-white/30 transition hover:bg-white/10 hover:text-white"
            title="删除"
          >
            ✕
          </button>
        </div>
      </li>
    )
  }

  /** 递归渲染一个目录：先子目录、后直属文件（都已排好序） */
  const node = (n: FolderNode, depth: number) => {
    /* 缩进用**固定步长**，不随层级放大：最深见过 11 层，
       每层 20px 的话在 320px 宽的左栏里名字会被挤没 */
    const open = filtering || openPaths.has(n.path)
    const kids = n.folders.length
    return (
      <li key={n.path}>
        <button
          onClick={() => toggle(n.path)}
          aria-label={`${open ? '收起' : '展开'}资料文件夹 ${n.path}`}
          aria-expanded={open}
          className="flex w-full items-center gap-1.5 rounded-xl px-1.5 py-1 text-left transition hover:bg-white/6"
        >
          <span
            className="grid h-4 w-4 shrink-0 place-items-center rounded-md text-[9px] text-white transition-transform"
            style={{ background: 'rgb(143 178 255 / .26)', transform: open ? 'rotate(90deg)' : 'none' }}
            aria-hidden
          >
            ▸
          </span>
          <span
            className="min-w-0 flex-1 truncate text-[12px] font-medium text-white/85"
            /* 深层的名字单独看没有上下文，title 里给全路径 */
            title={n.path}
          >
            {n.name}
          </span>
          {kids > 0 && <span className="shrink-0 text-[9.5px] text-white/30">{kids} 目录</span>}
          <span className="shrink-0 text-[10px] text-white/40">{n.total}</span>
        </button>
        {open && (
          <ul className="ml-2 space-y-0.5 border-l border-white/10 pl-1.5" data-depth={depth + 1}>
            {n.folders.map((c) => node(c, depth + 1))}
            {n.files.map((it) => row(it))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <ul className="ml-3 space-y-1 border-l border-white/10 pl-2">
      {loose.map((it) => row(it))}
      {folders.map((n) => node(n, 0))}
    </ul>
  )
}

/** 上面那段旧的平铺渲染已经不需要了，保留这个空壳以免误改 */
/**
 * 懒加载查看器。
 * FileViewer 会拉 mammoth（~400KB）等依赖，装在首屏不合适 ——
 * 只有真的点开某个文件时才加载。
 */
function LazyViewer({ item }: { item: VaultItem }) {
  const [Viewer, setViewer] = useState<React.ComponentType<{ item: VaultItem }> | null>(null)
  useEffect(() => {
    void import('./FileViewer').then((m) => setViewer(() => m.default))
  }, [])
  if (!Viewer) return <div className="py-10 text-center text-[12px] text-ink-faint">正在加载查看器…</div>
  return <Viewer item={item} />
}
