// scripts/notify-lark-alert.ts — Standalone CLI wrapper for pushLarkAlert.
//
// Invoked from GitHub Actions `if: failure() || cancelled()` steps in
// crawl.yml / process.yml / digest.yml so each workflow can notify the
// user via the same red Lark card without duplicating card-building YAML.
//
// Reads alert content from environment variables (set by the yml step),
// so the only thing the yml ever runs is `npx tsx scripts/notify-lark-alert.ts`.

import { pushLarkAlert } from '../lib/notify/lark'

async function main(): Promise<void> {
  const webhookUrl = process.env.LARK_WEBHOOK_URL
  const type = process.env.ALERT_TYPE || 'Workflow 失败'
  const subtitle =
    process.env.ALERT_SUBTITLE || 'GitHub Actions 任务异常结束，请查看日志'
  const detailsRaw = process.env.ALERT_DETAILS || ''
  const runUrl = process.env.ALERT_RUN_URL

  const details = detailsRaw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  await pushLarkAlert(webhookUrl, { type, subtitle, details, runUrl })
}

main().catch((err) => {
  console.error('[notify-lark-alert] uncaught:', err)
  // Never block the workflow's post-failure cleanup; the alert is
  // best-effort and a swallowed error here just means no push went out.
  process.exitCode = 0
})
