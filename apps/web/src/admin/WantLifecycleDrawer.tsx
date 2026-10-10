import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Descriptions, Drawer, Space, Spin, Tag, Timeline, Typography, type TimelineProps } from 'antd';
import { getActivityDefinition, type CognitionTraceEntryView, type WantLifecycleResponse } from '@sims/shared';
import { fetchWantLifecycle } from './api';

/** 判定层级标签(rule=数值压力/驱力 plan=日程执行 jev=微决策 triage=事件分级
 * select=want 仲裁 light/slow=轻/慢思考) */
const LAYER_META: Record<string, { label: string; color: string; title: string }> = {
  rule: { label: '规则', color: 'gold', title: '数值压力层:饥饿/困倦/缺钱等生理驱力产生的念头' },
  plan: { label: '日程', color: 'geekblue', title: '日程执行层:正在执行晨间计划里的某个意图' },
  jev: { label: '直觉', color: 'purple', title: '直觉层:不假思索的微决策' },
  triage: { label: '分级', color: 'cyan', title: '事件分级层:判断刚发生的事件要不要理会' },
  select: { label: '仲裁', color: 'orange', title: '仲裁层:给所有念头打分,选出这一拍要做的事' },
  light: { label: '轻思考', color: 'blue', title: '轻量 LLM:低成本快速想一下' },
  slow: { label: '慢思考', color: 'magenta', title: '重量 LLM:晨间规划等深度思考' },
};

export function layerTag(layer: unknown): ReactNode {
  const key = String(layer ?? '?');
  const meta = LAYER_META[key] ?? { label: key, color: 'default', title: key };
  return (
    <Tag color={meta.color} title={meta.title}>
      {meta.label}
    </Tag>
  );
}

export function conclusionTag(conclusion: unknown): ReactNode {
  const key = String(conclusion ?? '?');
  return key === 'react' ? (
    <Tag color="volcano" title="这一拍决定了新动作">行动</Tag>
  ) : (
    <Tag bordered={false} title="这一拍没有切换动作,维持现状">无新动作</Tag>
  );
}

const TRIGGER_META: Record<string, { label: string; title: string }> = {
  threshold: { label: '周期巡检', title: '每隔一段游戏时间自动醒来看一眼' },
  eventbus: { label: '事件触发', title: '被某个事件(对话/到点/环境变化)唤醒' },
};

export function triggerTag(trigger: unknown): ReactNode {
  const key = String(trigger ?? '?');
  const meta = TRIGGER_META[key];
  if (meta === undefined) return <Tag bordered={false}>{key}</Tag>;
  return (
    <Tag bordered={false} title={meta.title}>
      {meta.label}
    </Tag>
  );
}

/** 执行层 continue 原因中文映射(观测性:「为什么不做」一眼可见) */
const CONTINUE_REASON_META: Record<string, string> = {
  energy_gate: '体力闸',
  drive_channel_gone: '驱力通道消失',
  drive_satisfied: '驱力已满足',
  drive_stuck: '驱力受阻废弃',
  rescue_gone: '救援已消失',
  rescue_done: '救援已达成',
  target_missing: '目标不在',
  chat_generating: '对话生成中',
  summon_awaiting: '召唤待应答',
  chat_cooldown: '聊天冷却中',
  no_explore_target: '无探索目标',
  node_depleted: '节点已采空',
  craft_no_place: '无制作台',
  backpack_empty: '背包空',
  no_spot: '无处可去',
};

export function continueReasonTag(reason: unknown): ReactNode {
  const key = String(reason ?? '');
  if (key === '' || key === 'undefined') return null;
  return <Tag color="orange">{CONTINUE_REASON_META[key] ?? key}</Tag>;
}

const ORIGIN_META: Record<string, { label: string; color: string; title: string }> = {
  plan: { label: '规划', color: 'geekblue', title: '晨间慢思考规划的当日计划' },
  drive: { label: '驱力', color: 'gold', title: '生理/心理压力实时产生的念头(饿/困/缺钱)' },
  impulse: { label: '直觉', color: 'purple', title: '一瞬间的冲动念头,会随时间消退' },
  event: { label: '事件', color: 'cyan', title: '突发事件催生的念头(被人搭话/救援等)' },
};

export function originTag(origin: unknown): ReactNode {
  const key = String(origin ?? '?');
  const meta = ORIGIN_META[key] ?? { label: key, color: 'default', title: key };
  return (
    <Tag color={meta.color} title={meta.title}>
      {meta.label}
    </Tag>
  );
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

/** gm 游戏分钟 → 「第3天 06:49」(一天 1440 游戏分,从第 1 天 00:00 起算) */
export const fmtGameMinutes = (gm: number): string => {
  const day = Math.floor(gm / 1440) + 1;
  const hh = String(Math.floor((gm % 1440) / 60)).padStart(2, '0');
  const mm = String(gm % 60).padStart(2, '0');
  return `第${day}天 ${hh}:${mm}`;
};

const activityName = (activityId: string): string =>
  getActivityDefinition(activityId)?.name ?? activityId;

const REJECT_META: Record<string, string> = {
  score: '评分不够高',
  seize: '分差不够,抢不赢在办的事',
  energy: '体力不足',
  incumbent_lost: '正在做的事已失效,让位',
};

function rejectLabel(reject: unknown): string {
  const key = String(reject ?? '');
  return REJECT_META[key] ?? key;
}

/** 技术 intent → 白话(want:w3-0 执行「学习」/ move_to → 前往 / start_activity → 开始) */
function translateIntent(intent: string, candidates: unknown): string {
  const wantMatch = intent.match(/^want:(.+)$/);
  if (wantMatch !== null && wantMatch[1] !== undefined) {
    const id = wantMatch[1];
    const row = findCandidate(candidates, id);
    const name = row !== null ? activityName(String(row.activityId ?? '')) : null;
    return name !== null ? `执行「${name}」(${id})` : `执行念头 ${id}`;
  }
  const moveMatch = intent.match(/^move_to (\S+),(\S+)$/);
  if (moveMatch !== null && moveMatch[1] !== undefined && moveMatch[2] !== undefined) {
    return `前往(${moveMatch[1]},${moveMatch[2]})`;
  }
  const startMatch = intent.match(/^start_activity (\S+)$/);
  if (startMatch !== null && startMatch[1] !== undefined) return `开始「${activityName(startMatch[1])}」`;
  if (intent.startsWith('chat_with')) return '找人聊天';
  return intent;
}

function findCandidate(candidates: unknown, id: string): Record<string, unknown> | null {
  if (!Array.isArray(candidates)) return null;
  const row = candidates.find((c) => String((c as Record<string, unknown>).id ?? '') === id);
  return row !== undefined ? (row as Record<string, unknown>) : null;
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
  const winner = props.candidates.find((c) => (c as Record<string, unknown>).reject === undefined) as
    | Record<string, unknown>
    | undefined;
  const winnerName =
    winner !== undefined ? activityName(String(winner.activityId ?? winner.id ?? '')) : null;
  return (
    <div style={{ marginTop: 4, fontSize: 12 }}>
      <div style={{ color: '#8b949e' }}>
        {`脑内候选共 ${props.candidates.length} 个念头,按「紧迫度×情境」打分,分高者当选`}
        {winnerName !== null && ` —— 这次选了「${winnerName}」`}
      </div>
      {props.candidates.map((c, i) => {
        const row = c as Record<string, unknown>;
        const isWinner = row.reject === undefined;
        const name = activityName(String(row.activityId ?? row.id ?? ''));
        return (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <Typography.Text strong={isWinner} style={{ fontSize: 12 }}>
              {`「${name}」`}
            </Typography.Text>
            <Typography.Text code style={{ fontSize: 12 }} copyable={false}>
              {String(row.id ?? '?')}
            </Typography.Text>
            {originTag(row.origin)}
            <span>{`紧迫度 ${Math.round(Number(row.urgency ?? 0) * 100)}%`}</span>
            <span>{`评分 ${Number(row.score ?? 0).toFixed(2)}`}</span>
            {isWinner ? (
              <Tag color="success">当选</Tag>
            ) : (
              <Tag bordered={false} color="default" title="落选原因">{`落选·${rejectLabel(row.reject)}`}</Tag>
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
  const rawIntent = decision.intent !== undefined ? String(decision.intent) : null;
  const bubble = decision.bubble !== undefined ? String(decision.bubble) : null;
  const intentText = rawIntent !== null ? translateIntent(rawIntent, decision.candidates) : null;
  return (
    <div>
      <Space wrap size={4}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }} title={`游戏分钟 ${entry.gameMinutes}`}>
          {fmtGameMinutes(entry.gameMinutes)}
        </Typography.Text>
        {layerTag(decision.layer)}
        {conclusionTag(decision.conclusion)}
        {triggerTag(entry.trigger)}
        {intentText !== null && (
          <Typography.Text code style={{ fontSize: 12 }} title={`原始指令 ${rawIntent ?? ''}`}>
            {intentText}
          </Typography.Text>
        )}
        {decision.reason !== undefined && continueReasonTag(decision.reason)}
        {decision.rejectReason !== undefined && (
          <Tag color="red" title="执行层拒绝了这个动作">{`拒绝·${rejectLabel(decision.rejectReason)}`}</Tag>
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
          {`追踪这个念头(${entry.wantId})`}
        </Typography.Link>
      )}
      <JsonBlock label="感知快照(perception)" value={entry.perception} />
      <JsonBlock label="记忆检索(retrieval)" value={entry.retrieval} />
      <JsonBlock label="模型调用(calls)" value={entry.calls} />
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
      title={`念头的一生 ${props.wantId ?? ''}`}
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
              这个念头已经结束了(完成/放弃或跨日清除),下面靠决策记录还原它的一生。
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
              <Descriptions.Item label="有效期至(过期自行消退)">
                {wantRecord.expiresAtMin === null ? '-' : fmtGameMinutes(Number(wantRecord.expiresAtMin))}
              </Descriptions.Item>
              <Descriptions.Item label="理由" span={2}>
                {String(wantRecord.why ?? '')}
              </Descriptions.Item>
            </Descriptions>
          )}

          <Typography.Title level={5} style={{ marginTop: 16 }}>
            {`相关决策记录(${data.traces.length})`}
          </Typography.Title>
          {data.traces.length === 0 ? (
            <Typography.Text type="secondary">没有相关决策记录(早于记录系统上线)</Typography.Text>
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
