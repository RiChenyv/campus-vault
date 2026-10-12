/** 灵感配图：只缩不放，保持原始比例，最长边 1280px、WebP 质量 0.82 */

const MAX_EDGE = 1280
const QUALITY = 0.82

export interface AttachedImage {
  dataUrl: string
  name: string
  bytes: number
  /** 原始宽高比，用于占位时预留高度，避免图片加载时列表跳动 */
  ratio: number
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = src
  })

const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error('读取文件失败'))
    fr.readAsDataURL(file)
  })

export function bytesOfDataUrl(dataUrl: string) {
  const i = dataUrl.indexOf(',')
  return i < 0 ? 0 : Math.round((dataUrl.length - i) * 0.75)
}

/** 把 File / Blob 转成可直接渲染的 data URL */
export async function fileToImage(file: File | Blob): Promise<AttachedImage> {
  const type = file.type || ''
  const name = (file as File).name || '粘贴的图片'

  if (!type.startsWith('image/')) throw new Error('请选择图片文件（PNG / JPG / WebP / GIF）')
  if (type === 'image/svg+xml') throw new Error('暂不支持 SVG，请用 PNG / JPG / WebP')

  const src = await readFile(file as File)
  const img = await loadImage(src)
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (!w || !h) throw new Error('图片尺寸异常')

  // GIF 保留动画，不重编码
  if (type === 'image/gif') {
    return { dataUrl: src, name, bytes: bytesOfDataUrl(src), ratio: w / h }
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(w, h))
  const outW = Math.max(1, Math.round(w * scale))
  const outH = Math.max(1, Math.round(h * scale))

  // 小图直接复用原图，避免"重编码一次反而变大"
  if (scale === 1 && bytesOfDataUrl(src) < 240 * 1024) {
    return { dataUrl: src, name, bytes: bytesOfDataUrl(src), ratio: w / h }
  }

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持 canvas，无法处理图片')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h, 0, 0, outW, outH)

  let dataUrl = canvas.toDataURL('image/webp', QUALITY)
  if (!dataUrl || dataUrl === 'data:,') dataUrl = canvas.toDataURL('image/jpeg', QUALITY)

  return { dataUrl, name, bytes: bytesOfDataUrl(dataUrl), ratio: w / h }
}

/** 从粘贴板里挑出第一张图片 */
export function imageFromClipboard(dt: DataTransfer | null): File | null {
  if (!dt) return null
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile()
      if (f) return f
    }
  }
  return null
}
