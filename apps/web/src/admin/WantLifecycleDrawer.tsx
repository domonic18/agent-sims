import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Descriptions, Drawer, Space, Spin, Tag, Timeline, Typography, type TimelineProps } from 'antd';
import type { CognitionTraceEntryView, WantLifecycleResponse } from '@sims/shared';
import { fetchWantLifecycle } from './api';

/** 判定层级标签(rule=数值压力/驱力 plan=日程执行 jev=微决策 triage=事件分级
 * select=want 仲裁 light/slow=轻/慢思考) */
const LAYER_META: Record<string, { label: string; color: string }> = {
  rule: { label: '规则', color: 'gold' },
  plan: { label: '日程', color: 'geekblue' },
  jev: { label: '直觉', color: 'purple' },
  triage: { label: '分级', color: 'cyan' },
  select: { label: '仲裁', color: 'orange' },
  light: { label: '轻思考', color: 'blue' },
  slow: { label: '慢思考', color: 'magenta' },
};

export function layerTag(layer: unknown): ReactNode {
  const key = String(layer ?? '?');
  const meta = LAYER_META[key] ?? { label: key, color: 'default' };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

export function conclusionTag(conclusion: unknown): ReactNode {
  const key = String(conclusion ?? '?');
  return key === 'react' ? (
    <Tag color="volcano">react</Tag>
  ) : (
    <Tag bordered={false}>{key}</Tag>
  );
}

const ORIGIN_META: Record<string, { label: string; color: string }> = {
  plan: { label: '规划', color: 'geekblue' },
  drive: { label: '驱力', color: 'gold' },
  impulse: { label: '直觉', color: 'purple' },
  event: { label: '事件', color: 'cyan' },
};

export function originTag(origin: unknown): ReactNode {
  const key = String(origin ?? '?');
  const meta = ORIGIN_META[key] ?? { label: key, color: 'default' };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

const WANT_STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: '想做', color: 'default' },
  doing: { label: '进行中', color: 'processing' },
  done: { label: '已完成', color: 'success' },
  abandoned: { label: '放弃', color: 'warning' },
};

export function wantStatusTag(status: unknown): ReactNode {
  const key = String(status ?? '?');
  const meta = WANT_STATUS_META[key] ?? { label: key, color: 'default' };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

function JsonBlock(props: { label: string; value: unknown }) {
  if (props.value === null || props.value === undefined) return null;
  const text = JSON.stringify(props.value, null, 2);
  if (text === '{}' || text === '[]') return null;
  return (
    <details style={{ marginTop: 4 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12, color: '#57606a' }}>{props.label}</summary>
      <pre
        style={{
          margin: '4px 0 0',
          padding: 8,
          fontSize: 12,
          lineHeight: 1.5,
          background: '#f6f8fa',
          borderRadius: 6,
          overflow: 'auto',
          maxHeight: 260,
        }}
      >
        {text}
      </pre>
    </details>
  );
}

/** 仲裁候选评分快照(select 层 wantSelect 胜负观测) */
function CandidateList(props: { candidates: unknown }) {
  if (!Array.isArray(props.candidates) || props.candidates.length === 0) return null;
  return (
    <div style={{ marginTop: 4, fontSize: 12 }}>
      {props.candidates.map((c, i) => {
        const row = c as Record<string, unknown>;
        const winner = row.reject === undefined;
        return (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
            <Typography.Text code style={{ fontSize: 12 }}>
              {String(row.id ?? '?')}
            </Typography.Text>
            {originTag(row.origin)}
            <span>urg {Number(row.urgency ?? 0).toFixed(2)}</span>
            <span>score {Number(row.score ?? 0).toFixed(3)}</span>
            {winner ? (
              <Tag color="success">胜出</Tag>
            ) : (
              <Tag bordered={false} color="default">{`落选:${String(row.reject)}`}</Tag>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 单条 trace 的正文(时间线 items 与 Drawer 共用) */
function traceChildren(entry: CognitionTraceEntryView, onOpenWant?: (wantId: string) => void) {
  const decision = entry.decision as Record<string, unknown>;
  const intent = decision.intent !== undefined ? String(decision.intent) : null;
  const bubble = decision.bubble !== undefined ? String(decision.bubble) : null;
  return (
    <div>
      <Space wrap size={4}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{`gm ${entry.gameMinutes}`}</Typography.Text>
        {layerTag(decision.layer)}
        {conclusionTag(decision.conclusion)}
        <Tag bordered={false}>{entry.trigger}</Tag>
        {intent !== null && (
          <Typography.Text code style={{ fontSize: 12 }}>
            {intent}
          </Typography.Text>
        )}
        {decision.rejectReason !== undefined && (
          <Tag color="red">{`拒绝:${String(decision.rejectReason)}`}</Tag>
        )}
      </Space>
      {bubble !== null && (
        <div style={{ fontSize: 12, marginTop: 2 }}>「{bubble}」</div>
      )}
      <CandidateList candidates={decision.candidates} />
      {entry.wantId !== null && onOpenWant !== undefined && (
        <Typography.Link
          style={{ fontSize: 12 }}
          onClick={() => entry.wantId !== null && onOpenWant(entry.wantId)}
        >
          {`追踪 want ${entry.wantId}`}
        </Typography.Link>
      )}
      <JsonBlock label="perception" value={entry.perception} />
      <JsonBlock label="retrieval" value={entry.retrieval} />
      <JsonBlock label="calls" value={entry.calls} />
    </div>
  );
}

const fmtTime = (iso: string): string =>
  new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/** 决策时间线 items(trace 倒序传入即最新在上;颜色随层级) */
export function buildTraceTimelineItems(
  entries: CognitionTraceEntryView[],
  onOpenWant?: (wantId: string) => void,
): TimelineProps['items'] {
  return entries.map((entry) => ({
    color: LAYER_META[String((entry.decision as Record<string, unknown>).layer ?? '')]?.color ?? 'gray',
    children: (
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: 8 }}>
          {fmtTime(entry.createdAt)}
        </Typography.Text>
        {traceChildren(entry, onOpenWant)}
      </div>
    ),
  }));
}

/** want 全生命周期抽屉:脑内快照 + 按 wantId 全部 trace + 角色同时段事件流 */
export function WantLifecycleDrawer(props: {
  characterId: string;
  wantId: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<WantLifecycleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    if (props.wantId === null) return;
    let cancelled = false;
    fetchWantLifecycle(props.characterId, props.wantId)
      .then((resp) => {
        if (!cancelled) setData(resp);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [props.characterId, props.wantId]);

  const want = data?.want ?? null;
  const wantRecord = want as Record<string, unknown> | null;

  return (
    <Drawer
      open={props.wantId !== null}
      title={`want 生命周期 ${props.wantId ?? ''}`}
      width={620}
      onClose={props.onClose}
      destroyOnClose
    >
      {error !== null && <Alert type="error" showIcon message={error} />}
      {data === null && error === null && <Spin />}
      {data !== null && (
        <>
          <Typography.Title level={5}>此刻快照</Typography.Title>
          {wantRecord === null ? (
            <Typography.Text type="secondary">
              该 want 已不在意图存储中(已结算/跨日清除),以下靠 trace 还原全程。
            </Typography.Text>
          ) : (
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="活动" span={2}>
                <Typography.Text code>{String(wantRecord.activityId)}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="来源">{originTag(wantRecord.origin)}</Descriptions.Item>
              <Descriptions.Item label="状态">{wantStatusTag(wantRecord.status)}</Descriptions.Item>
              <Descriptions.Item label="紧迫度">
                {Math.round(Number(wantRecord.urgency ?? 0) * 100)}%
              </Descriptions.Item>
              <Descriptions.Item label="半衰至">
                {wantRecord.expiresAtMin === null ? '-' : `gm ${String(wantRecord.expiresAtMin)}`}
              </Descriptions.Item>
              <Descriptions.Item label="理由" span={2}>
                {String(wantRecord.why ?? '')}
              </Descriptions.Item>
            </Descriptions>
          )}

          <Typography.Title level={5} style={{ marginTop: 16 }}>
            {`决策 trace(${data.traces.length})`}
          </Typography.Title>
          {data.traces.length === 0 ? (
            <Typography.Text type="secondary">无关联 trace(早于 want_id 落地)</Typography.Text>
          ) : (
            <Timeline items={buildTraceTimelineItems(data.traces)} />
          )}

          <Typography.Title level={5} style={{ marginTop: 16 }}>
            {`同时段事件(${data.events.length})`}
          </Typography.Title>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {data.events.map((event) => (
              <Space key={event.id} wrap size={4}>
                <Tag>{event.type}</Tag>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{`gm ${event.tick}`}</Typography.Text>
                <JsonBlock label="payload" value={event.payload} />
              </Space>
            ))}
          </div>
        </>
      )}
    </Drawer>
  );
}
