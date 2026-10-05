import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Flex,
  Input,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Table,
  Typography,
  type TableProps,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
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
import type { TokenUsageCallView } from '@sims/shared';

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

const callColumns: NonNullable<TableProps<TokenUsageCallView>['columns']> = [
  { title: '时间', dataIndex: 'createdAt', width: 130, render: (v: string) => fmtTime(v) },
  { title: '角色', dataIndex: 'characterName', width: 110, render: (v: string | null) => v ?? '系统' },
  { title: '槽位', dataIndex: 'slot', width: 110, render: (v: string) => MODEL_SLOT_LABELS[v as ModelSlot] ?? v },
  { title: '任务', dataIndex: 'taskType' },
  { title: 'prompt', dataIndex: 'promptTokens', align: 'right', width: 90, render: fmt },
  { title: 'completion', dataIndex: 'completionTokens', align: 'right', width: 110, render: fmt },
];

function KpiCard(props: { label: string; value: string; sub: string }) {
  return (
    <Card size="small">
      <Statistic title={props.label} value={props.value} valueStyle={{ fontSize: 22 }} />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {props.sub}
      </Typography.Text>
    </Card>
  );
}

function TrendChart(props: { summary: TokenUsageSummary }) {
  const { trend, window: win } = props.summary;
  const hourly = win === 'today';
  const max = Math.max(...trend.map((point) => point.totalTokens), 1);
  const labelStep = Math.ceil(trend.length / 10);
  return (
    <Card size="small" title={`消耗趋势(${hourly ? '按小时' : '按天'} · tokens)`}>
      <Flex align="flex-end" gap={3} style={{ height: 130 }}>
        {trend.map((point) => (
          <div
            key={point.bucket}
            title={`${point.bucket} · ${fmt(point.totalTokens)} tokens · ${point.calls} 次调用`}
            style={{
              flex: 1,
              height: point.totalTokens > 0 ? `${Math.max((point.totalTokens / max) * 100, 3)}%` : 2,
              background: point.totalTokens > 0 ? '#6366f1' : '#f0f0f0',
              borderRadius: '2px 2px 0 0',
            }}
          />
        ))}
      </Flex>
      <Flex gap={3} style={{ marginTop: 6 }}>
        {trend.map((point, index) => (
          <span key={point.bucket} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: '#8c8c8c' }}>
            {index % labelStep === 0 ? (hourly ? `${point.bucket.slice(11, 13)}时` : point.bucket.slice(5)) : ''}
          </span>
        ))}
      </Flex>
    </Card>
  );
}

function DistList(props: {
  title: string;
  rows: Array<TokenUsageTotals & { label: string }>;
  total: number;
}) {
  const { rows, total } = props;
  return (
    <div style={{ flex: '1 1 280px' }}>
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
        {props.title}
      </Typography.Text>
      {rows.length === 0 && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          窗口内无调用
        </Typography.Text>
      )}
      {rows.map((row) => (
        <Flex align="center" gap={8} key={row.label} style={{ margin: '7px 0' }}>
          <Typography.Text ellipsis style={{ flexShrink: 0, width: 110, fontSize: 12 }} title={row.label}>
            {row.label}
          </Typography.Text>
          <Progress
            size="small"
            showInfo={false}
            percent={total > 0 ? Math.max((row.totalTokens / total) * 100, 1) : 0}
            style={{ flex: 1, margin: 0 }}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            {fmt(row.totalTokens)} · {row.calls}次 · {fmtPct(total > 0 ? row.totalTokens / total : 0)}
          </Typography.Text>
        </Flex>
      ))}
    </div>
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

  return (
    <Flex vertical gap={16}>
      <Space wrap>
        <Segmented<TokenUsageWindow>
          value={win}
          onChange={(value) => {
            setWin(value);
            setPage(1);
          }}
          options={TOKEN_USAGE_WINDOWS.map((option) => ({
            value: option,
            label: TOKEN_USAGE_WINDOW_LABELS[option],
          }))}
        />
        <Button icon={<ReloadOutlined />} onClick={() => setRefreshKey((key) => key + 1)}>
          刷新
        </Button>
      </Space>

      {summaryError && <Alert type="error" showIcon message={summaryError} />}
      {!summary && !summaryError && <Card loading style={{ minHeight: 120 }} />}

      {summary && (
        <>
          <Row gutter={[12, 12]}>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard
                label="总消耗 tokens"
                value={fmt(summary.kpi.totalTokens)}
                sub={`prompt ${fmt(summary.kpi.promptTokens)} / completion ${fmt(summary.kpi.completionTokens)}`}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard
                label="调用次数"
                value={fmt(summary.kpi.calls)}
                sub={`平均单次 ${summary.kpi.avgTokensPerCall} tokens`}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard
                label="completion 占比"
                value={fmtPct(summary.kpi.completionShare)}
                sub="生成密度:占比越高单次越「有产出」"
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard
                label="活跃角色"
                value={fmt(summary.kpi.activeCharacters)}
                sub={`窗口内产生消耗的角色数(${TOKEN_USAGE_WINDOW_LABELS[win]})`}
              />
            </Col>
          </Row>

          <TrendChart summary={summary} />

          <Card size="small" title="消耗分布(按 tokens 占比)">
            <Flex gap={24} wrap="wrap">
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
            </Flex>
          </Card>

          <Card size="small" title="单次消耗 Top5(发现 prompt 膨胀类异常)">
            <Table<TokenUsageCallView>
              size="small"
              rowKey="id"
              columns={callColumns}
              dataSource={summary.topCalls}
              pagination={false}
              locale={{ emptyText: '窗口内无调用' }}
            />
          </Card>
        </>
      )}

      <Card size="small" title="调用明细流水">
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            value={slotFilter}
            onChange={(value) => {
              setSlotFilter(value);
              setPage(1);
            }}
            style={{ minWidth: 140 }}
            options={[
              { value: '', label: '全部槽位' },
              ...MODEL_SLOTS.map((slot) => ({ value: slot, label: MODEL_SLOT_LABELS[slot] })),
            ]}
          />
          <Select
            value={characterFilter}
            onChange={(value) => {
              setCharacterFilter(value);
              setPage(1);
            }}
            style={{ minWidth: 160 }}
            options={[
              { value: '', label: '全部角色' },
              ...(summary?.byCharacter ?? [])
                .filter((row): row is (typeof row) & { characterId: string } => row.characterId !== null)
                .map((row) => ({ value: row.characterId, label: row.name ?? row.characterId })),
            ]}
          />
          <Input
            value={taskTypeFilter}
            placeholder="按任务类型过滤,如 admin_invoke"
            style={{ width: 240 }}
            allowClear
            onChange={(e) => {
              setTaskTypeFilter(e.target.value);
              setPage(1);
            }}
          />
        </Space>
        {entriesError && <Alert type="error" showIcon message={entriesError} style={{ marginBottom: 12 }} />}
        <Table<TokenUsageCallView>
          size="small"
          rowKey="id"
          columns={callColumns}
          dataSource={entries?.entries ?? []}
          loading={entries === null}
          locale={{ emptyText: '无匹配记录' }}
          pagination={{
            current: page,
            pageSize: entries?.pageSize ?? PAGE_SIZE,
            total: entries?.total ?? 0,
            showSizeChanger: false,
            showTotal: (total) => `共 ${fmt(total)} 条`,
            onChange: (next) => setPage(next),
          }}
        />
      </Card>
    </Flex>
  );
}
