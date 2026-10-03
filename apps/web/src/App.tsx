import { useEffect, useState } from 'react';

type Health = { ok: boolean };

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/health')
      .then((res) => res.json() as Promise<Health>)
      .then(setHealth)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <main style={{ fontFamily: 'monospace', padding: 24 }}>
      <h1>agent-sims</h1>
      {error !== null && <p style={{ color: 'crimson' }}>服务未连接: {error}</p>}
      {health === null && error === null && <p>连接中…</p>}
      {health !== null && <p>服务端 /health: {health.ok ? '正常' : '异常'}</p>}
    </main>
  );
}
