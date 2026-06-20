// 从播客 transcript 提取前 1-3 分钟 intro（≈ 1500 字硬上限）。
//
// follow-builders 的 transcript 格式（Supadata 输出）：
//   Speaker N | MM:SS - MM:SS\n<body>\n\nSpeaker M | MM:SS - MM:SS\n...
//
// 算法（v2 修复 首块就超 3 分钟时走兜底丢主体的 bug）：
// 1. 按 "Speaker N | MM:SS - MM:SS\n" 模式 split
// 2. 遍历 (meta, body) pair：
//    - 至少收一个 block 再判断超时（避免首块 4 分钟时走兜底）
//    - 否则解析结束时间戳，超 180 秒就 break
//    - 收集后如果 >= 1500 字也 break
// 3. 若按模式 split 后结果太少（< 3 段），算非预期格式 → 兜底 slice(0, 1500)
// 4. 若收集为空（理论上不会，但防御性写），兜底 slice(0, 1500)
export function extractIntro(transcript: string): string {
  if (!transcript) return ''

  // split 模式：捕获 meta 行
  const segments = transcript.split(/(Speaker \d+ \| \d+:\d+ - \d+:\d+\n)/)
  // segments = ['', meta1, body1, meta2, body2, ...]
  // 至少应该有 ['', meta1, body1] = 3 段

  if (segments.length < 3) {
    // 非预期格式，兜底
    return transcript.slice(0, 1500).trim()
  }

  let collected = ''
  let blocksCollected = 0

  for (let i = 1; i < segments.length; i += 2) {
    const meta = segments[i]
    const body = segments[i + 1] || ''

    // 至少收一个 block 再考虑超时停（v2 修复 #7）
    if (blocksCollected >= 1) {
      const endMatch = meta.match(/(\d+):(\d+) - (\d+):(\d+)/)
      if (endMatch) {
        const endSec = parseInt(endMatch[3], 10) * 60 + parseInt(endMatch[4], 10)
        if (endSec > 180) break
      }
    }

    collected += meta + body + '\n'
    blocksCollected++

    if (collected.length >= 1500) break
  }

  const result = collected.trim()
  return result || transcript.slice(0, 1500).trim()
}
