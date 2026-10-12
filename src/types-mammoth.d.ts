/**
 * mammoth 的浏览器构建没有类型声明。
 *
 * 为什么用 mammoth.browser.js 而不是 `import mammoth from 'mammoth'`：
 * 后者走 lib/index.js（Node 版），依赖 fs / path 这些浏览器里没有的东西，
 * Vite 打包时会报一堆 unresolved。浏览器构建是官方预打包好的，直接能用。
 */
declare module 'mammoth/mammoth.browser.js' {
  export function convertToHtml(
    input: { arrayBuffer: ArrayBuffer },
    options?: Record<string, unknown>,
  ): Promise<{ value: string; messages: { type: string; message: string }[] }>
  const _default: { convertToHtml: typeof convertToHtml }
  export default _default
}
