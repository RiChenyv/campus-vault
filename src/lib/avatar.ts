/**
 * 头像处理：本地图片 → canvas 居中裁剪 → 压缩为 data URL。
 *
 * 为什么必须压缩：
 *   1. 手机拍的图动辄 3~8MB，直接塞 localStorage 会超配额（通常 5MB）并抛错；
 *   2. 头像最大只显示到 184px（按 2x 屏算 368px），存原图纯属浪费。
 * 策略：非 GIF 一律压成 512×512 的 WebP（比 JPEG 更小且有透明通道），
 *       质量 0.9；GIF 保留原格式以免丢掉动图。
 */

/** 压缩后的边长（足够覆盖 2x 屏下的 184px 显示） */
const MAX_EDGE = 512
const QUALITY = 0.9

export interface StoredAvatar {
  /** data URL；为空表示用默认的「我」字头像 */
  dataUrl: string | null
  /** 原始文件名，用于界面上显示来源 */
  name?: string
  /** 压缩后大致体积（字节），用于提示 */
  bytes?: number
}

export const readAvatar = (): StoredAvatar => {
  try {
    return {
      dataUrl: localStorage.getItem('cv.avatar'),
      name: localStorage.getItem('cv.avatarName') ?? undefined,
    }
  } catch {
    return { dataUrl: null }
  }
}

export const writeAvatar = (a: StoredAvatar) => {
  if (a.dataUrl) {
    localStorage.setItem('cv.avatar', a.dataUrl)
    if (a.name) localStorage.setItem('cv.avatarName', a.name)
  } else {
    localStorage.removeItem('cv.avatar')
    localStorage.removeItem('cv.avatarName')
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('这个图片格式浏览器读不了'))
    }
    img.src = url
  })
}

/** 居中裁剪为正方形并缩放，再编码成 data URL */
export async function fileToAvatar(file: File): Promise<StoredAvatar> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择图片文件（PNG / JPG / WebP / GIF）')
  }
  if (file.type === 'image/svg+xml') {
    // SVG 在 canvas 上绘制有限制，且作为头像容易被用来注入脚本，这里直接拒绝
    throw new Error('暂不支持 SVG，请用 PNG 或 JPG')
  }

  const img = await loadImage(file)
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  const sx = (img.naturalWidth - side) / 2
  const sy = (img.naturalHeight - side) / 2
  const out = Math.min(MAX_EDGE, side)

  const canvas = document.createElement('canvas')
  canvas.width = out
  canvas.height = out
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持 canvas，无法处理图片')

  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out)

  const isGif = file.type === 'image/gif'
  const mime = isGif ? 'image/gif' : 'image/webp'
  let dataUrl = isGif ? '' : canvas.toDataURL(mime, QUALITY)
  if (!dataUrl || dataUrl === 'data:,') {
    // 少数浏览器不支持 WebP 编码，退回 PNG
    dataUrl = canvas.toDataURL('image/png')
  }
  if (isGif) {
    // GIF 不重编码，直接把原文件读成 data URL
    dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result))
      fr.onerror = () => reject(new Error('读取文件失败'))
      fr.readAsDataURL(file)
    })
  }

  return {
    dataUrl,
    name: file.name,
    bytes: Math.round((dataUrl.length - dataUrl.indexOf(',')) * 0.75),
  }
}

export const formatBytes = (n?: number) => {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
