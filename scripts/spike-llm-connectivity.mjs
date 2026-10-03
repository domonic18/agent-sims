// Spike① 四类模型连通性验证脚本(M1)
// 用法: 先启动 dev 双端(pnpm dev),后台 /admin 填好四槽位配置,再跑 pnpm spike:llm
// 说明: 经后台 API 登录后逐槽位触发连通测试;模型配置统一来自后台(model_configs 表),
//       本脚本不读任何模型 Key。仅 M1 使用,M4 后台完善后由成本面板/测试按钮取代。

const BASE = process.env.SPIKE_API_BASE ?? 'http://localhost:3100';
const USERNAME = process.env.SPIKE_ADMIN_USERNAME ?? 'admin';
const PASSWORD = process.env.SPIKE_ADMIN_PASSWORD ?? process.env.ADMIN_INITIAL_PASSWORD;
const TIMEOUT_MS = 30_000;

async function main() {
  const health = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!health.ok) throw new Error(`/health 返回 HTTP ${health.status}`);

  if (!PASSWORD) {
    console.error('未提供后台口令: 请设置 SPIKE_ADMIN_PASSWORD(或 .env 的 ADMIN_INITIAL_PASSWORD)');
    process.exit(1);
  }

  const loginRes = await fetch(`${BASE}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!loginRes.ok) {
    console.error(`后台登录失败: HTTP ${loginRes.status} ${await loginRes.text()}`);
    process.exit(1);
  }
  const { token } = await loginRes.json();
  const auth = { authorization: `Bearer ${token}` };

  const listRes = await fetch(`${BASE}/api/admin/model-configs`, { headers: auth });
  const configs = await listRes.json();
  const labels = Object.fromEntries(configs.map((c) => [c.slot, c.model || c.baseUrl || '(未配置)']));

  let failed = 0;
  let unconfigured = 0;
  for (const config of configs) {
    const label = labels[config.slot];
    if (!config.apiKeyConfigured || !config.baseUrl || !config.model) {
      unconfigured += 1;
      console.log(`○ [${config.slot}] 跳过(后台未配置完整,当前: ${label})`);
      continue;
    }
    process.stdout.write(`● [${config.slot}] ${config.model} @ ${config.baseUrl} ... `);
    const startedAt = performance.now();
    const res = await fetch(`${BASE}/api/admin/model-configs/${config.slot}/test`, {
      method: 'POST',
      headers: auth,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const result = await res.json();
    const latency = Math.round(performance.now() - startedAt);
    if (result.ok) {
      console.log(`✓ ${latency}ms ${result.detail}`);
    } else {
      failed += 1;
      console.log(`✗ ${latency}ms ${result.detail}`);
    }
  }

  console.log(
    `\n结果: ${configs.length - failed - unconfigured}/${configs.length} 个槽位连通` +
      (unconfigured ? `,${unconfigured} 个未配置(请到 web /admin 填写)` : ''),
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`Spike① 执行失败: ${err}`);
  process.exit(1);
});
