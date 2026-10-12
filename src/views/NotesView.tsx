import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { COURSES, FILES } from '../data/mock'
import { SAMPLE_CODE, SAMPLE_DOCX, SAMPLE_MD } from '../data/samples'
import { highlight, mdToHtml } from '../lib/markdown'
import { SectionTitle } from '../components/Bits'
import NoteFiles from '../components/NoteFiles'
import WrittenNotes from '../components/WrittenNotes'
import CourseLibrary from '../components/CourseLibrary'
import { IconFolder, IconSearch } from '../components/Icons'
import type { VaultFile } from '../types'

type CourseFilter = 'all' | string

/* --------------------------- 阅读器：按类型分派 --------------------------- */
function Reader({ file, rgb }: { file: VaultFile; rgb: string }) {
  const html = useMemo(
    () => (file.kind === 'markdown' ? mdToHtml(SAMPLE_MD) : ''),
    [file.name, file.kind],
  )
  const code = useMemo(
    () => (file.kind === 'code' ? highlight(SAMPLE_CODE, 'cpp') : ''),
    [file.name, file.kind],
  )

  return (
    <div className="deco flex min-h-full flex-col rounded-3xl">
      {/* 文档头 */}
      <div className="flex items-start gap-3 border-b border-white/8 px-5 py-4">
        <span
          className="shrink-0 rounded-xl px-2.5 py-1.5 text-[10.5px] font-medium uppercase"
          style={{ background: `rgb(${rgb} / .16)`, color: `rgb(${rgb})` }}
        >
          {file.kind}
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-[15.5px] font-semibold text-white">{file.name}</h4>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-faint">
            <span>{file.size}</span>
            <span>更新于 {file.updated}</span>
            <span
              className="rounded-full px-2 py-0.5"
              style={{ background: `rgb(${rgb} / .14)`, color: `rgb(${rgb})` }}
            >
              {file.tag}
            </span>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 px-5 py-4">
        {file.kind === 'markdown' && (
          <article className="md" dangerouslySetInnerHTML={{ __html: html }} />
        )}

        {file.kind === 'code' && (
          <div className="code" data-lang="cpp">
            <div className="code-head">
              <span className="code-dot" />
              <span>cpp · 只读高亮</span>
            </div>
            <pre dangerouslySetInnerHTML={{ __html: code }} />
          </div>
        )}

        {file.kind === 'docx' && (
          <div className="mx-auto max-w-[64ch]">
            <h3 className="text-[19px] font-semibold text-white">{SAMPLE_DOCX.title}</h3>
            <p className="mt-1.5 text-[11.5px] text-ink-faint">{SAMPLE_DOCX.meta}</p>
            <div className="mt-4 space-y-4">
              {SAMPLE_DOCX.sections.map((s) => (
                <section key={s.h}>
                  <h4 className="text-[14px] font-semibold text-white">{s.h}</h4>
                  <p className="mt-1.5 text-[13.5px] leading-[1.85] text-[#d3d7ee]">{s.p}</p>
                </section>
              ))}
            </div>
            <div
              className="mt-5 rounded-2xl px-4 py-3 text-[11.5px] leading-relaxed"
              style={{
                background: `rgb(${rgb} / .1)`,
                border: `1px solid rgb(${rgb} / .28)`,
                color: '#c6cbe8',
              }}
            >
              这是 <b>.docx</b> 的预览形态示意。真实实现会由后端用 mammoth 转成 HTML，
              图片转 base64 内联；复杂排版（合并单元格、批注、艺术字）会有走形，
              定位是「能看内容」而不是「还原排版」。.doc 老格式建议走「用系统默认程序打开」。
            </div>
          </div>
        )}

        {file.kind === 'pdf' && (
          <div className="grid h-full min-h-[380px] place-items-center rounded-2xl border border-dashed border-white/12 bg-black/25">
            <div className="text-center">
              <div className="text-[13.5px] text-ink-dim">PDF 内嵌预览区</div>
              <div className="mt-2 max-w-[46ch] text-[11.5px] leading-relaxed text-ink-faint">
                真实实现会用 &lt;iframe src="/api/files/xxx"&gt; 直接交给浏览器内置 PDF 阅读器，
                不需要额外依赖。这里只占位。
              </div>
            </div>
          </div>
        )}

        {(file.kind === 'image' || file.kind === 'slides' || file.kind === 'archive') && (
          <div className="grid h-full min-h-[300px] place-items-center rounded-2xl border border-dashed border-white/12 bg-black/25 text-[13px] text-ink-faint">
            {file.kind === 'slides' ? 'PPTX 预览（后端接入后可选装 LibreOffice 转 PDF/图片）' : '预览占位'}
          </div>
        )}
      </div>
    </div>
  )
}

/* --------------------------- 主视图 --------------------------- */
export default function NotesView() {
  const [filter, setFilter] = useState<CourseFilter>('all')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<{ file: VaultFile; courseId: string }>({
    file: FILES.c1[0],
    courseId: 'c1',
  })

  const rows = useMemo(() => {
    const ids = filter === 'all' ? COURSES.map((c) => c.id) : [filter]
    return ids.flatMap((id) =>
      (FILES[id] ?? []).map((f) => ({ file: f, courseId: id })),
    )
  }, [filter])

  const shown = rows.filter(
    (r) =>
      !q.trim() ||
      r.file.name.toLowerCase().includes(q.trim().toLowerCase()) ||
      r.file.tag.includes(q.trim()),
  )

  const activeCourse = COURSES.find((c) => c.id === picked.courseId)
  const rgb = activeCourse?.rgb ?? '143 178 255'

  /* 上传区每成功一次就 +1，资料库据此重读 */
  const [libKey, setLibKey] = useState(0)

  return (
    <div>
      {/* 手写的笔记：直接在这里写，不依赖外部文件 */}
      <WrittenNotes />

      {/* 上传的笔记文件：和题库同一套上传能力（换了个 scope）。
          上传成功后把 libKey +1 —— 下面的资料库是独立组件、只在挂载时读一次，
          不通知它的话传完文件往下看还是空的（得手动刷新页面）。 */}
      <SectionTitle kicker="files" title="笔记文件" rgb="196 148 255" />
      <NoteFiles onChanged={() => setLibKey((k) => k + 1)} />

      {/* 课程资料库：按**真实课程**分组展示**真实文件**。
          原来这块读的是 mock.ts 里写死的 FILES，而且右侧无论点哪个文件
          都显示同一份 SAMPLE_MD —— 删不掉、打不开、刷新又回来。
          文件按 folder 路径铺成**目录树**，可以一层层点进子文件夹。 */}
      <CourseLibrary reloadKey={libKey} />
    </div>
  )
}
