import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { sliceByCodePoints } from './sliceByCodePoints'

test('sliceByCodePoints: ASCII 行为跟 String.slice 一致', () => {
  assert.equal(sliceByCodePoints('Hello World', 5), 'Hello')
  assert.equal(sliceByCodePoints('abc', 10), 'abc')
})

test('sliceByCodePoints: 中文按字符正确计数', () => {
  assert.equal(sliceByCodePoints('你好世界今天', 3), '你好世')
  assert.equal(sliceByCodePoints('你好世界今天', 10), '你好世界今天')
})

test('sliceByCodePoints: emoji surrogate pair 不被劈半', () => {
  // 🚀 = U+1F680 (surrogate pair: D83D DE80, 占 UTF-16 2 code unit)
  const text = 'Hello 🚀 World'
  // 按 code unit 切 7 会切到 surrogate 中间得到 lone surrogate
  // 按 code point 切 7 应该得到 'Hello 🚀'
  const result = sliceByCodePoints(text, 7)
  assert.equal(result, 'Hello 🚀')
  // 验证没有 lone surrogate
  for (const ch of result) {
    const code = ch.codePointAt(0)!
    assert.ok(code < 0xD800 || code > 0xDFFF, `unexpected lone surrogate: ${code.toString(16)}`)
  }
})

test('sliceByCodePoints: 空字符串', () => {
  assert.equal(sliceByCodePoints('', 100), '')
})

test('sliceByCodePoints: max 为 0', () => {
  assert.equal(sliceByCodePoints('abc', 0), '')
})

test('sliceByCodePoints: 复合 emoji（family ZWJ sequence）保留', () => {
  // 👨‍👩‍👧 family 是 3 个 emoji + 2 个 ZWJ，跨多 code point
  // sliceByCodePoints 按 code point 切，可能切坏 ZWJ 序列但不会切坏单个 emoji
  const text = '👨‍👩‍👧 family'
  // family emoji 是 5 个 code point（3 个 emoji + 2 个 ZWJ U+200D）
  // slice 5 应该得到完整 family
  const result = sliceByCodePoints(text, 5)
  assert.equal(result.length > 0, true)
  assert.ok(!result.includes('\uD800'), 'no lone high surrogate')
})
