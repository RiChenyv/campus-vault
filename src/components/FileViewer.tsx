import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { highlight, mdToHtml } from '../lib/markdown'
import { download, kindLabel, kindRgb, type VaultItem } from '../lib/vault'
import { IconDownload, IconFile, IconImage } from './Icons'

/**
 * 真实文件查看器。
 *
 * 分派规则（**真的按文件类型渲染，不是占位**）：
 *   image    → <img>，直接用 blob URL
 *   pdf      → <iframe> 交给浏览器内置 PDF 阅读器（零依赖）
 *   markdown → mdToHtml 渲染
 *   code     → highlight 高亮
 *   text/sheet → <pre> 等宽展示
 *   其余（docx / pptx / zip / 音视频…）→ 文件信息卡 + 下载
 *
 * docx / pptx 之所以不做站内渲染：解析 OOXML 需要 mammoth / LibreOffice，
 * 纯前端硬做会走形严重。这里如实说明而不是拿假内容糊弄。
 */
export default function FileViewer({ item }: { item: VaultItem }) {
  const rgb = kindRgb[item.kind]

  /* 文本类内容需要正文：列表接口不带正文（否则一个库几十个文件全塞进
     列表响应里太重），所以**打开时才拉**。
     之前的 bug：这里判 `item.text != null` 才渲染，而 item.text 从未被赋值 ——
     markdown 和代码文件打开后一片空白。 */
  const isTextLike =
    item.kind === 'markdown' || item.kind === 'code' || item.kind === 'text' || item.kind === 'sheet'

  const [fetched, setFetched] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [textErr, setTextErr] = useState<string | null>(null)

  /** 图片/PDF 的 object URL。见下方 hook 的说明。 */
  const binaryUrl = useObjectUrl(item.url, item.kind === 'image' || item.kind === 'pdf')

  /* ---------------- Word（.docx） ----------------
     .docx 本质是个 zip，里面是 OOXML。纯前端手解会走得形严重，
     所以用 mammoth 转成 HTML。

     两个刻意的取舍：
      · **动态 import** —— mammoth 的浏览器构建有 ~400KB，
        只有真的打开 docx 时才加载，不拖累首页。
      · **只支持 .docx** —— .doc 是老的 OLE 复合文档格式，mammoth 不支持。
        那种仍然走"下载后用本地 Word 打开"，并在界面上如实说明。 */
  const isDocx = item.kind === 'docx' && /\.docx$/i.test(item.name)
  const [docxHtml, setDocxHtml] = useState<string | null>(null)
  const [docxBusy, setDocxBusy] = useState(false)
  const [docxErr, setDocxErr] = useState<string | null>(null)

  useEffect(() => {
    if (!isDocx || !item.url) return
    const url = item.url
    let alive = true
    setDocxBusy(true)
    setDocxHtml(null)
    setDocxErr(null)
    ;(async () => {
      try {
        // 走 api.blob 而不是裸 fetch —— 必须带鉴权头，理由见文件底部注释
        const blob = await api.blob(url.replace(/^\/api/, ''))
        const arrayBuffer = await blob.arrayBuffer()
        const mammoth = await import('mammoth/mammoth.browser.js')
        const convert = (mammoth.default ?? mammoth).convertToHtml
        const res = await convert({ arrayBuffer })
        if (alive) setDocxHtml(res.value)
      } catch (e) {
        if (alive) setDocxErr(e instanceof Error ? e.message : '转换失败')
      } finally {
        if (alive) setDocxBusy(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [isDocx, item.url, item.id])

  useEffect(() => {
    // 已经有正文（比如本地预览）就不用再拉
    if (!isTextLike || item.text != null || !item.url) return
    let alive = true
    setLoading(true)
    setTextErr(null)
    setFetched(null)
    // 用 api.blob（带 Authorization 头），不能用裸 fetch —— 原因见文件底部注释
    api
      .blob(item.url.replace(/^\/api/, ''))
      .then((b) => b.text())
      .then((txt) => {
        if (alive) setFetched(txt)
      })
      .catch((e: unknown) => {
        if (alive) setTextErr(e instanceof Error ? e.message : '读取失败')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [isTextLike, item.text, item.url, item.id])

  /** 实际用于渲染的正文 */
  const text = item.text ?? fetched

  const html = useMemo(
    () => (item.kind === 'markdown' && text != null ? mdToHtml(text) : ''),
    [item.kind, text],
  )
  const code = useMemo(
    () => (item.kind === 'code' && text != null ? highlight(text, item.lang ?? 'txt') : ''),
    [item.kind, text, item.lang],
  )

  return (
    /* ⚠️ 必须是 h-full（确定高度），不能是 min-h-full。
       min-height 允许元素**随内容无限长高** —— 内容一长整个查看器就被撑高，
       里面 `flex-1 overflow-auto` 的内容区于是永远不需要滚动，
       正文被撑出面板裁掉：用户既看不到完整内容，也滚不动。
       h-full + 内层 min-h-0 才能让内容区拿到**有界**高度、真正出现滚动。 */
    <div className="deco flex h-full min-h-0 flex-col overflow-hidden rounded-3xl">
      {/* 文档头 */}
      <div className="flex shrink-0 items-start gap-3 border-b border-white/8 px-5 py-4">
        <span
          className="shrink-0 rounded-xl px-2.5 py-1.5 text-[10.5px] font-medium"
          style={{ background: `rgb(${rgb} / .16)`, color: `rgb(${rgb})` }}
        >
          {kindLabel[item.kind]}
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-[15px] font-semibold text-white" title={item.name}>
            {item.name}
          </h4>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-faint">
            <span>{item.size}</span>
            <span>上传于 {item.at}</span>
            {item.lang && <span className="uppercase">{item.lang}</span>}
            {!item.viewable && <span className="text-[#ffc07a]">该类型暂不支持站内预览</span>}
          </div>
        </div>
        <button
          onClick={() => download(item)}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/14 bg-white/7 px-3 py-1.5 text-[11.5px] text-ink-dim transition hover:border-white/30 hover:bg-white/14 hover:text-white"
          aria-label={`下载 ${item.name}`}
        >
          <IconDownload className="h-3.5 w-3.5" />
          下载 / 另存为
        </button>
      </div>

      {/* 内容区 */}
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {item.kind === 'image' && binaryUrl && (
          <div className="grid place-items-center">
            <img
              src={binaryUrl}
              alt={item.name}
              className="max-h-[70vh] max-w-full rounded-2xl border border-white/10 object-contain"
              draggable={false}
            />
          </div>
        )}

        {item.kind === 'pdf' && binaryUrl && (
          /* 浏览器自带 PDF 阅读器 —— 不需要 pdf.js 之类的依赖 */
          <iframe
            src={binaryUrl}
            title={item.name}
            className="h-[72vh] w-full rounded-2xl border border-white/10 bg-white/5"
          />
        )}

        {isTextLike && loading && (
          <div className="grid min-h-[200px] place-items-center text-[12.5px] text-ink-faint">
            正在读取文件内容…
          </div>
        )}

        {isTextLike && textErr && (
          <div
            className="rounded-2xl px-4 py-3 text-[12.5px]"
            style={{ background: 'rgb(255 120 120 / .14)', color: '#ffb3b3' }}
            role="alert"
          >
            读取文件内容失败：{textErr}
          </div>
        )}

        {item.kind === 'markdown' && text != null && (
          <article className="md" dangerouslySetInnerHTML={{ __html: html }} />
        )}

        {item.kind === 'code' && text != null && (
          <div className="code" data-lang={item.lang ?? 'txt'}>
            <div className="code-head">
              <span className="code-dot" />
              <span>{(item.lang ?? 'txt') + ' · 只读高亮'}</span>
            </div>
            <pre dangerouslySetInnerHTML={{ __html: code }} />
          </div>
        )}

        {(item.kind === 'text' || item.kind === 'sheet') && text != null && (
          <pre
            className="whitespace-pre-wrap break-words rounded-2xl bg-black/25 p-4 text-[12.5px] leading-[1.75] text-[#d6dbef]"
            style={{ fontFamily: "'SFMono-Regular',Consolas,'Liberation Mono',monospace" }}
          >
            {text}
          </pre>
        )}

        {/* Word：mammoth 转出来的 HTML。
            直接塞进 .md 那套排版里复用样式，省得两套标题/列表样式不一致。 */}
        {isDocx && docxBusy && (
          <div className="grid min-h-[240px] place-items-center text-[12.5px] text-ink-faint">
            正在解析 Word 文档…
          </div>
        )}

        {isDocx && docxErr && (
          <div
            className="rounded-2xl px-4 py-3 text-[12.5px]"
            style={{ background: 'rgb(255 120 120 / .14)', color: '#ffb3b3' }}
            role="alert"
          >
            解析 Word 文档失败：{docxErr}
          </div>
        )}

        {isDocx && docxHtml != null && (
          <article className="md docx-body" dangerouslySetInnerHTML={{ __html: docxHtml }} />
        )}

        {/* 不支持站内渲染的类型：给出诚实说明 + 下载入口 */}
        {!item.viewable && (
          <div className="grid h-full min-h-[340px] place-items-center">
            <div className="max-w-[52ch] text-center">
              <span
                className="mx-auto grid h-14 w-14 place-items-center rounded-2xl"
                style={{ background: `rgb(${rgb} / .16)`, border: `1px solid rgb(${rgb} / .32)` }}
              >
                {item.kind === 'image' ? (
                  <IconImage className="h-6 w-6" style={{ color: `rgb(${rgb})` }} />
                ) : (
                  <IconFile className="h-6 w-6" style={{ color: `rgb(${rgb})` }} />
                )}
              </span>
              <div className="mt-4 text-[14px] font-medium text-white">
                {kindLabel[item.kind]} 暂不支持站内预览
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-faint">
                {item.kind === 'docx' || item.kind === 'slides' || item.kind === 'sheet'
                  ? item.kind === 'docx'
                    ? '这是老版 .doc 格式（不是 .docx），浏览器端解不了。请下载后用本地 Word 打开 —— 存成 .docx 再传就能站内看了。'
                    : '解析 PPT / Excel 需要额外的转换器，目前还没接。可以先下载到本地打开。'
                  : item.kind === 'archive'
                    ? '压缩包需要服务端解包后逐条列出，属于后端能力。'
                    : item.kind === 'audio' || item.kind === 'video'
                      ? '音视频可以直接播放，但需要等文件上传到服务端拿到可流式访问的地址。'
                      : '可以先下载到本地用系统默认程序打开。'}
              </p>
              <button
                onClick={() => download(item)}
                className="mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-medium transition hover:brightness-110"
                style={{
                  background: `rgb(${rgb} / .2)`,
                  color: `rgb(${rgb})`,
                  border: `1px solid rgb(${rgb} / .42)`,
                }}
              >
                <IconDownload className="h-4 w-4" />
                下载到本地
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 带鉴权地把文件拉成 object URL，供 <img> / <iframe> 使用。
 *
 * 为什么不能直接用 `/api/files/<id>/raw`：
 * <img> 和 <iframe> 都**发不出 Authorization 头**，只能依赖 cookie。
 * 而按标签页独立会话之后，cookie 未必是当前标签页的账号 ——
 * 于是"取自己的文件"变成"用别人的身份取自己的文件"，
 * 服务端按归属校验返回 404，表现成图裂了、PDF 一片空白。
 *
 * 代价是多一次请求，换来的是身份一定正确。
 */
function useObjectUrl(path: string | undefined, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || !path) {
      setUrl(null)
      return
    }
    let alive = true
    let objectUrl: string | null = null
    api
      .blob(path.replace(/^\/api/, ''))
      .then((blob) => {
        if (!alive) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (alive) setUrl(null)
      })
    return () => {
      alive = false
      // 不 revoke 会一直占着内存，翻几个大文件就积起来了
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path, enabled])

  return url
}
