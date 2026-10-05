import { useEffect, useState } from 'react';
import {
  MODEL_SLOT_LABELS,
  MODEL_SLOTS,
  TOKEN_USAGE_WINDOW_LABELS,
  TOKEN_USAGE_WINDOWS,
  type ModelSlot,
  type TokenUsageEntriesResponse,
  type TokenUsageSummary,
  type TokenUsageTotals,
  type TokenUsageWindow,
} from '@sims/shared';
import { fetchTokenUsageEntries, fetchTokenUsageSummary } from './api';

const PAGE_SIZE = 20;

const fmt = (n: number): string => n.toLocaleString('en-US');

const fmtPct = (share: number): string => `${Math.round(share * 1000) / 10}%`;

const fmtTime = (iso: string): string =>
  new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

function KpiCard(props: { label: string; value: string; sub: string }) {
  return (
    <div className="usage-kpi">
      <small>{props.label}</small>
      <b>{props.value}</b>
      <small>{props.sub}</small>
    </div>
  );
}

function TrendChart(props: { summary: TokenUsageSummary }) {
  const { trend, window: win } = props.summary;
  const hourly = win === 'today';
  const max = Math.max(...trend.map((point) => point.totalTokens), 1);
  const labelStep = Math.ceil(trend.length / 10);
  return (
    <div className="usage-section">
      <h2>消耗趋势({hourly ? '按小时' : '按天'} · tokens)</h2>
      <div className="usage-trend">
        {trend.map((point) => (
          <div
            key={point.bucket}
            className={point.totalTokens > 0 ? 'usage-trend-bar' : 'usage-trend-bar empty'}
            style={{ height: point.totalTokens > 0 ? `${Math.max((point.totalTokens / max) * 100, 3)}%` : '2px' }}
            title={`${point.bucket} · ${fmt(point.totalTokens)} tokens · ${point.calls} 次调用`}
          />
        ))}
      </div>
      <div className="usage-trend-labels">
        {trend.map((point, index) => (
          <span key={point.bucket}>
            {index % labelStep === 0 ? (hourly ? `${point.bucket.slice(11, 13)}时` : point.bucket.slice(5)) : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

function DistList(props: {
  title: string;
  rows: Array<TokenUsageTotals & { label: string }>;
  total: number;
}) {
  const { rows, total } = props;
  return (
    <div>
      <h3>{props.title}</h3>
      {rows.length === 0 && <p className="admin-muted">窗口内无调用</p>}
      {rows.map((row) => (
        <div className="usage-dist-row" key={row.label}>
          <span className="usage-dist-name" title={row.label}>
            {row.label}
          </span>
          <span className="usage-dist-bar">
            <span
              className="usage-dist-fill"
              style={{ width: total > 0 ? `${Math.max((row.totalTokens / total) * 100, 1)}%` : '0%' }}
            />
          </span>
          <span className="usage-dist-num">
            {fmt(row.totalTokens)} · {row.calls}次 · {fmtPct(total > 0 ? row.totalTokens / total : 0)}
          </span>
        </div>
      ))}
    </div>
  );
}

function CallTable(props: { rows: TokenUsageSummary['topCalls'] }) {
  return (
    <table className="usage-table">
      <thead>
        <tr>
          <th>时间</th>
          <th>角色</th>
          <th>槽位</th>
          <th>任务</th>
          <th className="num">prompt</th>
          <th className="num">completion</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((row) => (
          <tr key={row.id}>
            <td>{fmtTime(row.createdAt)}</td>
            <td>{row.characterName ?? '系统'}</td>
            <td>{MODEL_SLOT_LABELS[row.slot]}</td>
            <td>{row.taskType}</td>
            <td className="num">{fmt(row.promptTokens)}</td>
            <td className="num">{fmt(row.completionTokens)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TokenUsagePanel() {
  const [win, setWin] = useState<TokenUsageWindow>('7d');
  const [summary, setSummary] = useState<TokenUsageSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [slotFilter, setSlotFilter] = useState('');
  const [characterFilter, setCharacterFilter] = useState('');
  const [taskTypeFilter, setTaskTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState<TokenUsageEntriesResponse | null>(null);
  const [entriesError, setEntriesError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSummaryError(null);
    fetchTokenUsageSummary(win)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setSummaryError(err instanceof Error ? err.message : '加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [win, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    setEntriesError(null);
    fetchTokenUsageEntries({
      window: win,
      slot: slotFilter || undefined,
      characterId: characterFilter || undefined,
      taskType: taskTypeFilter || undefined,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setEntriesError(err instanceof Error ? err.message : '加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [win, slotFilter, characterFilter, taskTypeFilter, page, refreshKey]);

  const totalPages =
    entries === null ? 1 : Math.max(Math.ceil(entries.total / entries.pageSize), 1);

  return (
    <div className="usage-panel">
      <div className="usage-toolbar">
        {TOKEN_USAGE_WINDOWS.map((option) => (
          <button
            key={option}
            type="button"
            className={option === win ? 'admin-tab active' : 'admin-tab'}
            onClick={() => {
              setWin(option);
              setPage(1);
            }}
          >
            {TOKEN_USAGE_WINDOW_LABELS[option]}
          </button>
        ))}
        <button type="button" className="admin-secondary" onClick={() => setRefreshKey((key) => key + 1)}>
          刷新
        </button>
      </div>

      {summaryError && <p className="admin-error">{summaryError}</p>}
      {!summary && !summaryError && <p className="admin-muted">加载中…</p>}

      {summary && (
        <>
          <div className="usage-kpis">
            <KpiCard
              label="总消耗 tokens"
              value={fmt(summary.kpi.totalTokens)}
              sub={`prompt ${fmt(summary.kpi.promptTokens)} / completion ${fmt(summary.kpi.completionTokens)}`}
            />
            <KpiCard
              label="调用次数"
              value={fmt(summary.kpi.calls)}
              sub={`平均单次 ${summary.kpi.avgTokensPerCall} tokens`}
            />
            <KpiCard
              label="completion 占比"
              value={fmtPct(summary.kpi.completionShare)}
              sub="生成密度:占比越高单次越「有产出」"
            />
            <KpiCard
              label="活跃角色"
              value={fmt(summary.kpi.activeCharacters)}
              sub={`窗口内产生消耗的角色数(${TOKEN_USAGE_WINDOW_LABELS[win]})`}
            />
          </div>

          <TrendChart summary={summary} />

          <div className="usage-section">
            <h2>消耗分布(按 tokens 占比)</h2>
            <div className="usage-dist">
              <DistList
                title="按槽位"
                total={summary.kpi.totalTokens}
                rows={summary.bySlot.map((row) => ({
                  ...row,
                  label: `${MODEL_SLOT_LABELS[row.slot as ModelSlot] ?? row.slot}`,
                }))}
              />
              <DistList
                title="按任务类型"
                total={summary.kpi.totalTokens}
                rows={summary.byTaskType.map((row) => ({ ...row, label: row.taskType }))}
              />
              <DistList
                title="按角色"
                total={summary.kpi.totalTokens}
                rows={summary.byCharacter.map((row) => ({
                  ...row,
                  label: row.name ?? '系统/无角色',
                }))}
              />
            </div>
          </div>

          <div className="usage-section">
            <h2>单次消耗 Top5(发现 prompt 膨胀类异常)</h2>
            {summary.topCalls.length === 0 ? (
              <p className="admin-muted">窗口内无调用</p>
            ) : (
              <CallTable rows={summary.topCalls} />
            )}
          </div>
        </>
      )}

      <div className="usage-section">
        <h2>调用明细流水</h2>
        <div className="usage-filters">
          <select
            value={slotFilter}
            onChange={(e) => {
              setSlotFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部槽位</option>
            {MODEL_SLOTS.map((slot) => (
              <option key={slot} value={slot}>
                {MODEL_SLOT_LABELS[slot]}
              </option>
            ))}
          </select>
          <select
            value={characterFilter}
            onChange={(e) => {
              setCharacterFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部角色</option>
            {(summary?.byCharacter ?? [])
              .filter((row): row is (typeof row) & { characterId: string } => row.characterId !== null)
              .map((row) => (
                <option key={row.characterId} value={row.characterId}>
                  {row.name ?? row.characterId}
                </option>
              ))}
          </select>
          <input
            value={taskTypeFilter}
            placeholder="按任务类型过滤,如 admin_invoke"
            onChange={(e) => {
              setTaskTypeFilter(e.target.value);
              setPage(1);
            }}
          />
        </div>
        {entriesError && <p className="admin-error">{entriesError}</p>}
        {entries && entries.entries.length === 0 && <p className="admin-muted">无匹配记录</p>}
        {entries && entries.entries.length > 0 && <CallTable rows={entries.entries} />}
        {entries && entries.total > 0 && (
          <div className="usage-pager">
            <button
              type="button"
              className="admin-secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              上一页
            </button>
            <span>
              第 {page}/{totalPages} 页 · 共 {fmt(entries.total)} 条
            </span>
            <button
              type="button"
              className="admin-secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
