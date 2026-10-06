export interface LogEntry {
  id: number;
  time: string;
  tick: number | null;
  summary: string;
  ok: boolean;
  message: string;
}

/** /lab 回执终端(UI-1 C5 像素化,最新在上):逐条意图的回执与时间/tick 标注 */
export function LogPanel({ log }: { log: LogEntry[] }) {
  return (
    <section className="px-box lab-log">
      <div className="px-inner lab-log-inner">
        <h3>回执终端(最新在上)</h3>
        {log.length === 0 ? (
          <p className="hint">尚无操作记录——从上方操作台下发意图</p>
        ) : (
          <ul>
            {log.map((entry) => (
              <li key={entry.id} className={entry.ok ? 'ok' : 'err'}>
                <span className="meta">
                  {entry.time} · tick {entry.tick ?? '—'}
                </span>
                <code>{entry.summary}</code>
                <span className="message">
                  {entry.ok ? '✓' : '✗'} {entry.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
