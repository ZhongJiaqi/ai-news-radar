import assert from 'node:assert/strict'
import test from 'node:test'

import { generateText, getResolvedLLMConfig } from './index'

const ENV_KEYS = [
  'LLM_API_KEY',
  'LLM_BASE_URL',
  'LLM_MODEL',
  'LLM_MODEL_CHAIN',
  'LLM_DYNAMIC_CHAIN',
  'CLAUDE_SMALL_MODEL',
  'CLAUDE_LARGE_MODEL',
]

function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const previous: Record<string, string | undefined> = {}
  for (const key of ENV_KEYS) previous[key] = process.env[key]

  const restore = () => {
    for (const key of ENV_KEYS) {
      const v = previous[key]
      if (typeof v === 'string') process.env[key] = v
      else delete process.env[key]
    }
  }

  try {
    for (const key of ENV_KEYS) delete process.env[key]
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === 'string') process.env[k] = v
      else delete process.env[k]
    }

    const result = fn()
    if (result && typeof (result as any).then === 'function') {
      return (result as Promise<void>).finally(restore)
    }
    restore()
    return result
  } catch (err) {
    restore()
    throw err
  }
}

test('resolves Anthropic config and normalizes right.codes', () => {
  withEnv(
    {
      LLM_API_KEY: 'k',
      LLM_BASE_URL: 'https://right.codes/claude',
    },
    () => {
      const cfg = getResolvedLLMConfig('article')
      assert.equal(cfg.provider, 'anthropic')
      assert.equal(cfg.baseURL, 'https://www.right.codes/claude')
      assert.equal(cfg.model, 'claude-3-5-haiku-20241022')
    }
  )
})

test('resolves DashScope OpenAI-compatible defaults', () => {
  withEnv(
    {
      LLM_API_KEY: 'k',
      LLM_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    },
    () => {
      const articleCfg = getResolvedLLMConfig('article')
      assert.equal(articleCfg.provider, 'openai-compatible')
      assert.equal(articleCfg.model, 'qwen-plus')

      const digestCfg = getResolvedLLMConfig('digest')
      assert.equal(digestCfg.provider, 'openai-compatible')
      assert.equal(digestCfg.model, 'qwen-max')
    }
  )
})

test('defaults to Anthropic when no base URL set', () => {
  withEnv(
    {
      LLM_API_KEY: 'k',
    },
    () => {
      const cfg = getResolvedLLMConfig('digest')
      assert.equal(cfg.provider, 'anthropic')
      assert.equal(cfg.baseURL, 'https://api.anthropic.com')
      assert.equal(cfg.apiKey, 'k')
    }
  )
})

test('generateText uses OpenAI-compatible /chat/completions and returns trimmed text', async () => {
  await withEnv(
    {
      LLM_API_KEY: 'k',
      LLM_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
      LLM_MODEL: 'qwen-plus',
    },
    async () => {
      const originalFetch = globalThis.fetch
      const calls: Array<{ url: string; init: any }> = []

      globalThis.fetch = (async (url: any, init: any) => {
        calls.push({ url: String(url), init })
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: ' hello ' } }],
          }),
          text: async () => '',
        } as any
      }) as any

      try {
        const result = await generateText({
          task: 'digest',
          prompt: 'ping',
          maxTokens: 10,
        })

        assert.equal(result.text, 'hello')
        assert.equal(result.modelUsed, 'openai-compatible:qwen-plus')
        assert.equal(calls.length, 1)
        assert.equal(
          calls[0].url,
          'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
        )
        assert.equal(calls[0].init?.headers?.Authorization, 'Bearer k')
      } finally {
        globalThis.fetch = originalFetch
      }
    }
  )
})

// 2026-07-23 incident: kimi-k2.7-code timed out (180s) on the big digest
// prompt three times in a row while two faster models sat unused behind it
// in the chain — timeouts must swap to the next model, not bubble up.
test('timeout on one model falls through to the next model in the chain', async () => {
  await withEnv(
    {
      LLM_API_KEY: 'k',
      LLM_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      LLM_MODEL: 'qwen3.7-plus',
      LLM_MODEL_CHAIN: 'qwen3.7-plus,qwen3.6-plus',
    },
    async () => {
      const originalFetch = globalThis.fetch
      const modelsCalled: string[] = []

      globalThis.fetch = (async (_url: any, init: any) => {
        const body = JSON.parse(init.body)
        modelsCalled.push(body.model)
        if (body.model === 'qwen3.7-plus') {
          const err = new Error('The operation was aborted.')
          ;(err as Error & { name: string }).name = 'AbortError'
          throw err
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: 'ok from backup' } }] }),
          text: async () => '',
        } as any
      }) as any

      try {
        const result = await generateText({
          task: 'digest',
          prompt: 'ping',
          maxTokens: 10,
        })
        assert.equal(result.text, 'ok from backup')
        assert.equal(result.modelUsed, 'openai-compatible:qwen3.6-plus')
        assert.ok(modelsCalled.includes('qwen3.6-plus'), 'backup model must be tried')
      } finally {
        globalThis.fetch = originalFetch
      }
    }
  )
})

test('empty content from one model falls through to the next model in the chain', async () => {
  await withEnv(
    {
      LLM_API_KEY: 'k',
      LLM_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      LLM_MODEL: 'glm-5.2',
      LLM_MODEL_CHAIN: 'glm-5.2,qwen3.8-max',
      LLM_DYNAMIC_CHAIN: 'off',
    },
    async () => {
      const originalFetch = globalThis.fetch
      const modelsCalled: string[] = []

      globalThis.fetch = (async (_url: any, init: any) => {
        const body = JSON.parse(init.body)
        modelsCalled.push(body.model)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: body.model === 'glm-5.2' ? '' : 'ok from backup' } }],
          }),
          text: async () => '',
        } as any
      }) as any

      try {
        const result = await generateText({ task: 'digest', prompt: 'ping', maxTokens: 10 })
        assert.equal(result.text, 'ok from backup')
        assert.equal(result.modelUsed, 'openai-compatible:qwen3.8-max')
        assert.deepEqual(modelsCalled, ['glm-5.2', 'qwen3.8-max'])
      } finally {
        globalThis.fetch = originalFetch
      }
    }
  )
})

test('OpenAI-compatible 4xx errors do not retry', async () => {
  await withEnv(
    {
      LLM_API_KEY: 'k',
      LLM_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      LLM_MODEL: 'qwen-plus',
    },
    async () => {
      const originalFetch = globalThis.fetch
      let callCount = 0

      globalThis.fetch = (async () => {
        callCount++
        return {
          ok: false,
          status: 400,
          text: async () => 'bad request',
          json: async () => ({}),
        } as any
      }) as any

      try {
        await assert.rejects(
          () =>
            generateText({
              task: 'digest',
              prompt: 'ping',
              maxTokens: 10,
            }),
          /400/
        )
        assert.equal(callCount, 1)
      } finally {
        globalThis.fetch = originalFetch
      }
    }
  )
})
