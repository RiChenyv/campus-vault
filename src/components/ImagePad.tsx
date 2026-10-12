import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { IconClose } from './Icons'

/** 玻璃叉号按钮：编辑态与卡片上共用同一套样式 */
export function GlassX({
  onClick,
  label,
  size = 26,
  title,
}: {
  onClick: () => void
  label: string
  size?: number
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={title ?? label}
      className="grid shrink-0 place-items-center rounded-full border border-white/22 bg-[#0b0d18]/70 text-white/85 backdrop-blur-sm transition hover:border-white/40 hover:bg-[#0b0d18]/90 hover:text-white"
      style={{ width: size, height: size }}
    >
      <IconClose style={{ width: size * 0.5, height: size * 0.5 }} />
    </button>
  )
}

/**
 * 图片附件（编辑态）。
 * 按原始宽高比预留高度，避免图片解码时列表跳动。
 */
export function AttachedImageBox({
  dataUrl,
  ratio,
  name,
  bytes,
  onRemove,
}: {
  dataUrl: string
  ratio: number
  name?: string
  bytes?: number
  onRemove: () => void
}) {
  const [lightbox, setLightbox] = useState(false)
  const kb = bytes ? (bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`) : ''

  return (
    <div className="relative mt-3">
      <div
        className="overflow-hidden rounded-2xl border border-white/15 bg-black/25"
        style={{ aspectRatio: String(ratio) }}
      >
        <img
          src={dataUrl}
          alt={name ? `附件：${name}` : '灵感配图'}
          className="h-full w-full cursor-zoom-in object-cover"
          onClick={() => setLightbox(true)}
          draggable={false}
        />
      </div>

      <div className="absolute right-2 top-2">
        <GlassX onClick={onRemove} label="移除图片" title="移除图片" />
      </div>

      {(name || kb) && (
        <div className="mt-1.5 truncate text-[10.5px] text-white/55">
          {name}
          {kb ? ` · ${kb}` : ''}
        </div>
      )}

      <AnimatePresence>
        {lightbox && (
          <motion.div
            className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightbox(false)}
            role="dialog"
            aria-modal="true"
            aria-label="查看大图"
          >
            <img
              src={dataUrl}
              alt={name ?? '灵感配图'}
              className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="absolute right-6 top-6">
              <GlassX onClick={() => setLightbox(false)} label="关闭大图" size={34} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** 图片附件（阅读态，卡片内） */
export function CardImage({
  dataUrl,
  ratio,
  onOpen,
}: {
  dataUrl: string
  ratio: number
  onOpen: () => void
}) {
  return (
    <button
      onClick={onOpen}
      className="mt-3 block w-full overflow-hidden rounded-2xl border border-white/15 transition hover:border-white/30"
      style={{ aspectRatio: String(ratio) }}
      aria-label="查看大图"
    >
      <img src={dataUrl} alt="灵感配图" className="h-full w-full object-cover" draggable={false} />
    </button>
  )
}
