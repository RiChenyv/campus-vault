/**
 * 中心头像：有自定义图片就显示图片，否则回退到「我」字渐变头像。
 * 注意 src 用 data URL，没有网络请求，也不依赖后端。
 */
export default function AvatarFace({
  dataUrl,
  name,
  size = 132,
}: {
  dataUrl?: string | null
  /** 用于生成默认头像的首字母；为空时退回「我」字 */
  name?: string
  size?: number
}) {
  // 取用户名的首字符作为默认头像内容，比固定的「我」更有个人感
  const initial = (name ?? '').trim().slice(0, 1) || '我'
  return (
    <span
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-full ring-1 ring-white/25"
      style={{ width: size, height: size }}
    >
      {dataUrl ? (
        <>
          <img
            src={dataUrl}
            alt="我的头像"
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
          />
          {/* 玻璃感的边缘高光，让照片和整体材质统一 */}
          <span
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{
              background:
                'radial-gradient(circle at 34% 24%, rgba(255,255,255,.4), rgba(255,255,255,0) 52%), linear-gradient(180deg, rgba(255,255,255,.18), rgba(0,0,0,.22))',
            }}
          />
        </>
      ) : (
        <>
          <span
            className="absolute inset-0"
            style={{ background: 'linear-gradient(150deg, #6d7cff 0%, #9b6bff 48%, #47c7d8 100%)' }}
          />
          <span
            className="absolute inset-0 opacity-45"
            style={{
              background: 'radial-gradient(circle at 34% 26%, rgba(255,255,255,.85), rgba(255,255,255,0) 58%)',
            }}
          />
          <span
            className="absolute inset-0 opacity-70"
            style={{ backgroundImage: 'var(--noise)', mixBlendMode: 'overlay' }}
          />
          <span
            className="relative font-semibold leading-none text-white drop-shadow-[0_2px_10px_rgba(0,0,0,.35)]"
            style={{ fontSize: size * 0.35, fontFamily: "'Gabriola','Segoe Script',cursive" }}
          >
            {initial}
          </span>
        </>
      )}
    </span>
  )
}
