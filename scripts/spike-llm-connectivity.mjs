// Spike① 四类模型连通性验证脚本(M1)
// 用法: pnpm spike:llm(读取根 .env 的 SPIKE_* 变量;未配置的槽位自动跳过)
// 说明: 仅用于 M1 验证账号与网络;M4 后模型配置统一走后台管理,本脚本不进生产链路

const TIMEOUT_MS = 30_000;

const SLOTS = [
  {
    key: 'slow',
    label: '慢思考 LLM',
    prefix: 'SPIKE_SLOW',
    kind: 'chat',
    sample: { messages: [{ role: 'user', content: '只回答:OK' }], max_tokens: 8 },
  },
  {
    key: 'light',
    label: '轻量 LLM',
    prefix: 'SPIKE_LIGHT',
    kind: 'chat',
    sample: { messages: [{ role: 'user', content: '只回答:OK' }], max_tokens: 8 },
  },
  {
    key: 'jev',
    label: 'Jev(systemone)',
    prefix: 'SPIKE_JEV',
    kind: 'chat',
    baseUrlDefault: 'https://api.codiv.ai/v1',
    modelDefault: 'openjev-0.1',
    sample: { messages: [{ role: 'user', content: '只回答:OK' }], max_tokens: 8 },
  },
  {
    key: 'embedding',
    label: 'Embedding',
    prefix: 'SPIKE_EMBEDDING',
    kind: 'embedding',
    sample: { input: '记忆固化打分测试' },
  },
];

function readSlot(slot) {
  const env = (name) => process.env[`${slot.prefix}_${name}`]?.trim() || '';
  const baseUrl = env('BASE_URL') || slot.baseUrlDefault || '';
  const model = env('MODEL') || slot.modelDefault || '';
  const apiKey = env('API_KEY');
  if (!baseUrl || !model || !apiKey) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ''), model, apiKey };
}

async function callSlot(slot, cfg) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = performance.now();
  try {
    const path = slot.kind === 'embedding' ? '/embeddings' : '/chat/completions';
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, ...slot.sample }),
      signal: controller.signal,
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, latencyMs, detail: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    }
    const data = JSON.parse(text);
    if (slot.kind === 'embedding') {
      const dims = data.data?.[0]?.embedding?.length;
      return { ok: typeof dims === 'number', latencyMs, detail: `向量维度=${dims ?? '未知'}` };
    }
    const reply = data.choices?.[0]?.message?.content?.trim() ?? '';
    return { ok: reply.length > 0, latencyMs, detail: `回复="${reply.slice(0, 80)}"` };
  } catch (err) {
    return { ok: false, latencyMs: Math.round(performance.now() - startedAt), detail: String(err) };
  } finally {
    clearTimeout(timer);
  }
}

let configured = 0;
let failed = 0;

for (const slot of SLOTS) {
  const cfg = readSlot(slot);
  if (!cfg) {
    console.log(`○ [${slot.label}] 跳过(未配置 ${slot.prefix}_BASE_URL / _MODEL / _API_KEY)`);
    continue;
  }
  configured += 1;
  process.stdout.write(`● [${slot.label}] ${cfg.model} @ ${cfg.baseUrl} ... `);
  const result = await callSlot(slot, cfg);
  if (result.ok) {
    console.log(`✓ ${result.latencyMs}ms ${result.detail}`);
  } else {
    failed += 1;
    console.log(`✗ ${result.latencyMs}ms ${result.detail}`);
  }
}

if (configured === 0) {
  console.log('\n未配置任何槽位。请在 .env 填写 SPIKE_* 变量(参考 .env.example)。');
  process.exit(1);
}
console.log(`\n结果: ${configured - failed}/${configured} 个已配置槽位连通`);
process.exit(failed > 0 ? 1 : 0);
