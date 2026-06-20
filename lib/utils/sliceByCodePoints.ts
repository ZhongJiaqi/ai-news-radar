// UTF-safe 字符串切割，避免 String.slice 按 UTF-16 code unit 切
// 导致 emoji surrogate pair 被劈半得到 lone surrogate。
//
// Array.from(text) 按 Unicode code point 迭代，安全。
//
// 注意：复合 emoji（family ZWJ sequence）跨多 code point，
// 切割可能截掉 ZWJ 部分得到不完整的表现形式，但不会产生 lone surrogate。
// 对当前场景（X tweet text 前 100 字符当 title）这种 trade-off 可接受。
export function sliceByCodePoints(text: string, max: number): string {
  if (max <= 0) return ''
  const arr = Array.from(text)
  return arr.slice(0, max).join('')
}
