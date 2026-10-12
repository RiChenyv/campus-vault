import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { COURSES } from '../data/mock'
import { mdToHtml } from '../lib/markdown'
import ConfirmDialog from './ConfirmDialog'
import { useNotes, type Note } from '../lib/useNotes'
import { SectionTitle } from './Bits'

/**
 * 「我写的笔记」—— 在应用里直接写，不依赖上传文件。
 *
 * 为什么单独一块而不是混进文件列表：
 * 文件是"别人给的资料"，笔记是"我自己写的"。混在一起会让两种东西
 * 的增删逻辑互相打架（文件要上传，笔记要编辑）。
 * 所以文件列表保持原样，上面单开一块。
 */
export default function WrittenNotes() {
  const { notes, loading, busy, error, save, remove, clearAll } = useNotes()
  /** 清空确认弹窗 —— 不可逆操作要单独一个关卡 */
  const [clearOpen, setClearOpen] = useState(false)

  /** null = 没在编辑 */
  const [draft, setDraft] = useState<{ id?: number; title: string; body: string; courseId: string } | null>(null)
  /** 展开了哪一篇的预览 */
  const [open, setOpen] = useState<number | null>(null)

  const isEditing = draft !== null

  const startNew = () => setDraft({ title: '', body: '', courseId: '' })

  const startEdit = (n: Note) => {
    setDraft({ id: n.id, title: n.title, body: n.body, courseId: n.courseId })
    setOpen(null)
  }

  const submit = async () => {
    if (!draft) return
    const saved = await save(draft)
    if (saved) setDraft(null)
  }

  return (
    <section className="mb-5">
      <SectionTitle kicker="notes" title="我写的笔记" rgb="186 155 255" />

      {error && (
        <div
          className="mb-3 rounded-xl px-3 py-2 text-[11.5px]"
          style={{ background: 'rgba(255,120,120,.16)', color: '#ffb3b3' }}
          role="alert"
        >
          {error}
        </div>
      )}

      {!isEditing && (
        <div className="mb-3 flex items-center gap-2">
          <button
            onClick={startNew}
            aria-label="写一条笔记"
            className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl border border-dashed border-white/22 px-3 py-2.5 text-[12px] text-ink-dim transition hover:border-white/40 hover:bg-white/6 hover:text-white"
          >
            ✎ 写一条笔记
          </button>
          {/* 全部删除。和题库的"清空"一致：能逐条删，也能一次清干净。
              没有笔记时不显示 —— 空列表上摆个"清空"没有意义。 */}
          {!!notes.length && (
            <button
              onClick={() => setClearOpen(true)}
              aria-label="清空全部笔记"
              className="shrink-0 rounded-2xl px-3 py-2.5 text-[11.5px] text-rose-200/70 transition hover:bg-rose-400/10 hover:text-rose-100"
            >
              清空全部（{notes.length}）
            </button>
          )}
        </div>
      )}

      {isEditing && draft && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mat-clear mb-3 rounded-2xl p-3"
        >
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="标题"
            aria-label="笔记标题"
            maxLength={200}
            className="w-full rounded-xl px-3 py-2 text-[13px] font-semibold text-white outline-none placeholder:text-white/35"
            style={{ background: 'rgb(0 0 0 / .28)', border: '1px solid rgb(255 255 255 / .14)' }}
          />
          <select
            value={draft.courseId}
            onChange={(e) => setDraft({ ...draft, courseId: e.target.value })}
            aria-label="归属课程"
            className="mt-2 w-full rounded-xl px-2.5 py-1.5 text-[11.5px] text-white outline-none"
            style={{ background: 'rgb(0 0 0 / .28)', border: '1px solid rgb(255 255 255 / .14)' }}
          >
            <option value="">未归类</option>
            {COURSES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <textarea
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            placeholder={'正文，支持 Markdown 与 LaTeX 公式\n\n例如：\n## 要点\n- 补码 $e - 127$\n- 公式 $$V = (-1)^s \\times M \\times 2^E$$'}
            aria-label="笔记正文"
            rows={10}
            className="mt-2 w-full resize-y rounded-xl px-3 py-2 text-[12.5px] leading-relaxed text-white outline-none placeholder:text-white/30"
            style={{
              background: 'rgb(0 0 0 / .28)',
              border: '1px solid rgb(255 255 255 / .14)',
              fontFamily: "'SFMono-Regular',Consolas,monospace",
            }}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              disabled={busy || !draft.title.trim()}
              onClick={() => void submit()}
              aria-label="保存笔记"
              className="rounded-xl px-3.5 py-2 text-[12.5px] font-semibold text-white transition disabled:opacity-40"
              style={{
                background: 'linear-gradient(135deg, rgb(186 155 255 / .9), rgb(143 178 255 / .9))',
                boxShadow: '0 10px 26px -14px rgb(186 155 255 / .95)',
              }}
            >
              {draft.id != null ? '保存修改' : '保存'}
            </button>
            <button
              onClick={() => setDraft(null)}
              aria-label="取消编辑"
              className="rounded-xl px-3.5 py-2 text-[12.5px] font-semibold text-ink-dim"
              style={{ background: 'rgb(255 255 255 / .05)', border: '1px solid rgb(255 255 255 / .1)' }}
            >
              取消
            </button>
            <span className="ml-auto text-[10.5px] text-white/35">支持 Markdown / 公式</span>
          </div>
        </motion.div>
      )}

      {loading && <div className="py-6 text-center text-[12px] text-ink-faint">正在读取…</div>}

      {!loading && !notes.length && !isEditing && (
        <div className="mat-clear rounded-2xl px-4 py-8 text-center text-[12px] leading-relaxed text-white/55">
          还没有手写的笔记
          <br />
          上面点「写一条笔记」开始
        </div>
      )}

      <ul className="space-y-2">
        {notes.map((n) => {
          const course = COURSES.find((c) => c.id === n.courseId)
          const expanded = open === n.id
          return (
            <li key={n.id} className="mat-clear spec overflow-hidden rounded-2xl">
              <div className="flex items-center gap-2 px-3.5 py-3">
                <button
                  onClick={() => setOpen(expanded ? null : n.id)}
                  aria-label={`${expanded ? '收起' : '展开'}笔记 ${n.title}`}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-[13px] font-medium text-white">{n.title}</span>
                  <span className="mt-0.5 block text-[10.5px] text-white/45">
                    {course ? `${course.name} · ` : '未归类 · '}
                    {new Date(n.updatedAt).toLocaleDateString('zh-CN')}
                  </span>
                </button>
                <button
                  onClick={() => startEdit(n)}
                  aria-label={`编辑笔记 ${n.title}`}
                  className="shrink-0 rounded-lg px-2 py-1 text-[11.5px] text-white/55 transition hover:bg-white/10 hover:text-white"
                >
                  编辑
                </button>
                <button
                  onClick={() => void remove(n.id)}
                  aria-label={`删除笔记 ${n.title}`}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[13px] leading-none text-white/35 transition hover:bg-white/10 hover:text-white"
                  title="删除"
                >
                  ✕
                </button>
              </div>

              {expanded && (
                <div className="border-t border-white/8 px-3.5 py-3">
                  <NoteBody body={n.body} />
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <ConfirmDialog
        open={clearOpen}
        title="清空全部笔记？"
        message={`将删除你自己写的全部 ${notes.length} 篇笔记。`}
        detail="此操作不可撤销。上传的笔记文件不受影响。"
        confirmText={`删除全部 ${notes.length} 篇`}
        onConfirm={() => {
          setClearOpen(false)
          void clearAll()
        }}
        onCancel={() => setClearOpen(false)}
      />
    </section>
  )
}

/** 正文渲染。空正文给个占位，别渲染成一片空白 */
function NoteBody({ body }: { body: string }) {
  const html = useMemo(() => mdToHtml(body || ''), [body])
  if (!body.trim()) return <p className="text-[12px] text-white/40">（这篇还没有正文）</p>
  return <article className="md" dangerouslySetInnerHTML={{ __html: html }} />
}
