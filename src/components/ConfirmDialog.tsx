import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

/**
 * 危险操作的确认弹窗。
 *
 * 为什么不复用页面上那种「点删除 → 变成确认/取消」的行内两步确认：
 * 那种适合单条操作，就地反馈、不打断视线；
 * 但**批量清空是不可逆的重操作**，需要一个明确的、带数量说明的关卡，
 * 让用户看清"将要删掉多少条"再决定。
 *
 * 几个细节：
 *  · Esc 关闭 —— 键盘用户不必去够鼠标
 *  · 遮罩点击关闭 —— 但**只在点遮罩本身时**，点内容区不关（否则一拖就误关）
 *  · 危险按钮在右、取消在左；Enter 默认走**取消**，避免一路回车删干净
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  detail,
  confirmText = '确认删除',
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: string
  /** 补充说明，比如"其中 3 条带图片，会一并删除" */
  detail?: string
  confirmText?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-black/70 p-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onCancel}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-clear spec w-[min(440px,92vw)] rounded-3xl p-6"
          >
            {/* 警示图标 */}
            <span
              className="grid h-11 w-11 place-items-center rounded-2xl"
              style={{ background: 'rgba(255,120,120,.16)', border: '1px solid rgba(255,120,120,.4)' }}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="rgb(255,150,150)" strokeWidth="1.8" strokeLinecap="round">
                <path d="M12 8.4v5.2M12 17.1h.01" />
                <path d="M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
              </svg>
            </span>

            <h3 className="font-cn-title mt-4 text-[16.5px] font-semibold text-white">{title}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-white/78">{message}</p>
            {detail && <p className="mt-1.5 text-[11.5px] leading-relaxed text-white/55">{detail}</p>}

            <div className="mt-5 flex items-center gap-2">
              {/* 取消放在前面并自动聚焦：回车默认是"不删"，避免手滑一路确认 */}
              <button
                autoFocus
                onClick={onCancel}
                className="flex-1 rounded-full bg-white/10 px-4 py-2.5 text-[13px] text-white/85 transition hover:bg-white/18 hover:text-white"
                aria-label="取消"
              >
                取消
              </button>
              <button
                onClick={onConfirm}
                className="flex-1 rounded-full px-4 py-2.5 text-[13px] font-medium transition hover:brightness-110"
                style={{
                  background: 'rgba(255,110,110,.24)',
                  color: 'rgb(255,178,178)',
                  border: '1px solid rgba(255,110,110,.5)',
                }}
                aria-label={confirmText}
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
