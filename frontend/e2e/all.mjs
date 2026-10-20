import { spawnSync } from 'node:child_process'
for (const entry of ['e2e/run.mjs', 'e2e/round2.mjs']) {
  const result = spawnSync(process.execPath, [entry], {
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
