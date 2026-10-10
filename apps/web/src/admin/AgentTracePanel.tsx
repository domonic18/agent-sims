import { useEffect, useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Flex,
  Input,
  Pagination,
  Select,
  Space,
  Switch,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { CognitionTraceEntriesResponse, CharacterScheduleView } from '@sims/shared';
import { fetchCharacterList, fetchCharacterSchedule, fetchCognitionTraces } from './api';
import {
  WantLifecycleDrawer,
  buildTraceTimelineItems,
  originTag,
  wantStatusTag,
} from './WantLifecycleDrawer';

const TRACE_PAGE_SIZE = 30;

/** 上区·此刻决策: 角色 Select + want 池(5s 轮询,状态翻转/产欲来源一目了然);
 * 下区·决策时间线: 认知 trace 分页(layer/conclusion/wantId 过滤,可选 10s 轮询);
 * 点带 wantId 的项或 want 卡片开生命周期抽屉。 */
export function AgentTracePanel() {
  const [characters, setCharacters] = useState<Array<{ id: string; name: string; alive: boolean }>>([]);
  const [characterId, setCharacterId] = useState<string>('');
  const [schedule, setSchedule] = useState<CharacterScheduleView | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const [layerFilter, setLayerFilter] = useState('');
  const [conclusionFilter, setConclusionFilter] = useState('');
  const [wantIdFilter, setWantIdFilter] = useState('');
  const [page, setPage] = useState(1);
  const [traces, setTraces] = useState<CognitionTraceEntriesResponse | null>(null);
  const [tracesError, setTracesError] = useState<string | null>(null);
  const [autoPoll, setAutoPoll] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [drawerWantId, setDrawerWantId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCharacterList()
      .then((resp) => {
        if (!cancelled) setCharacters(resp.characters);
      })
      .catch((err: unknown) => {
        if (!cancelled) setScheduleError(err instanceof Error ? err.message : '角色清单加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // want 池 5s 轮询(随角色切换重置,瞬时失败保留上一帧)
  useEffect(() => {
    setSchedule(null);
    if (characterId === '') return;
    let alive = true;
    const load = (): void => {
      fetchCharacterSchedule(characterId)
        .then((view) => {
          if (alive) {
            setSchedule(view);
            setScheduleError(null);
          }
        })
        .catch((err: unknown) => {
          if (alive) setScheduleError(err instanceof Error ? err.message : '加载失败');
        });
    };
    load();
    const poll = setInterval(load, 5_000);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [characterId]);

  // 决策时间线加载(过滤/翻页/手动刷新共驱;取消竞态保留后到响应)
  useEffect(() => {
    let cancelled = false;
    setTracesError(null);
    fetchCognitionTraces({
      characterId: characterId || undefined,
      layer: layerFilter || undefined,
      conclusion: conclusionFilter || undefined,
      wantId: wantIdFilter || undefined,
      page,
      pageSize: TRACE_PAGE_SIZE,
    })
      .then((resp) => {
        if (!cancelled) setTraces(resp);
      })
      .catch((err: unknown) => {
        if (!cancelled) setTracesError(err instanceof Error ? err.message : '加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [characterId, layerFilter, conclusionFilter, wantIdFilter, page, refreshKey]);

  // 可选 10s 自动轮询(观察 Agent 实时决策流)
  useEffect(() => {
    if (!autoPoll) return;
    const poll = setInterval(() => setRefreshKey((key) => key + 1), 10_000);
    return () => clearInterval(poll);
  }, [autoPoll]);

  const nameOf = (id: string | null): string =>
    id === null ? '-' : (characters.find((c) => c.id === id)?.name ?? id);

  const openWant = (wantId: string): void => setDrawerWantId(wantId);

  const renderWantCard = (want: CharacterScheduleView['wants'][number]): ReactNode => (
    <Button
      key={want.id}
      type="text"
      size="small"
      style={{
        display: 'block',
        width: '100%',
        height: 'auto',
        padding: '6px 8px',
        textAlign: 'left',
        whiteSpace: 'normal',
      }}
      onClick={() => openWant(want.id)}
    >
      <Space wrap size={4}>
        {originTag(want.origin)}
        {wantStatusTag(want.status)}
        <Typography.Text strong style={{ fontSize: 13 }}>
          {want.label}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {`urg ${Math.round(want.urgency * 100)}%`}
        </Typography.Text>
        {want.targetCharacterId !== null && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {`→ ${nameOf(want.targetCharacterId)}`}
          </Typography.Text>
        )}
      </Space>
      <div style={{ fontSize: 12, color: '#57606a' }}>{want.why}</div>
      <div style={{ fontSize: 12, color: '#8b949e' }}>
        <Typography.Text code style={{ fontSize: 12 }}>
          {want.id}
        </Typography.Text>
        {want.expiresAtMin !== null ? ` · 半衰至 gm ${want.expiresAtMin}` : ''}
      </div>
    </Button>
  );

  const doingWants = schedule?.wants.filter((w) => w.status === 'doing') ?? [];
  const otherWants = schedule?.wants.filter((w) => w.status !== 'doing') ?? [];

  return (
    <Flex vertical gap={16}>
      <Card
        size="small"
        title="此刻决策(want 池)"
        extra={
          <Select
            showSearch
            optionFilterProp="label"
            value={characterId === '' ? null : characterId}
            placeholder="选择角色"
            style={{ minWidth: 180 }}
            options={characters.map((c) => ({
              value: c.id,
              label: c.alive ? c.name : `${c.name}(已倒下)`,
            }))}
            onChange={setCharacterId}
            allowClear
          />
        }
      >
        {scheduleError !== null && <Alert type="error" showIcon message={scheduleError} style={{ marginBottom: 8 }} />}
        {characterId === '' ? (
          <Typography.Text type="secondary">选择角色查看此刻 want 池(5 秒自动刷新)。</Typography.Text>
        ) : schedule === null ? (
          <Typography.Text type="secondary">加载中…</Typography.Text>
        ) : (
          <>
            {schedule.snapshot !== null && (
              <div style={{ marginBottom: 8 }}>
                <Space wrap size={4}>
                  <Tag>运行态</Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {`(${schedule.snapshot.x},${schedule.snapshot.y}) · coins ${schedule.snapshot.coins} · energy ${schedule.snapshot.energy}`}
                  </Typography.Text>
                  {schedule.snapshot.activity !== null ? (
                    <Tag color="processing">
                      {`${schedule.snapshot.activity.activityId} ${Math.round(schedule.snapshot.activity.elapsed)}′`}
                    </Tag>
                  ) : (
                    <Tag>空闲</Tag>
                  )}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {schedule.snapshot.backpack.length === 0
                      ? '背包:空'
                      : `背包:${schedule.snapshot.backpack.map((b) => `${b.name}×${b.count}`).join('、')}`}
                  </Typography.Text>
                </Space>
              </div>
            )}
            {schedule.day === null ? (
              <Typography.Text type="secondary">该角色暂无当日意图容器(等待晨间规划)。</Typography.Text>
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {`第 ${schedule.day} 天 · ${schedule.source === 'llm' ? '慢思考生成' : '个性化回落'} · 共 ${schedule.wants.length} 条 want(点击看生命周期)`}
              </Typography.Text>
            )}
            {doingWants.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <Tag color="processing">进行中</Tag>
                {doingWants.map(renderWantCard)}
              </div>
            )}
            {otherWants.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <Tag>在途/已结</Tag>
                {otherWants.map(renderWantCard)}
              </div>
            )}
          </>
        )}
      </Card>

      <Card
        size="small"
        title="决策时间线(认知 trace)"
        extra={
          <Space wrap size={8}>
            <span style={{ fontSize: 12, color: '#57606a' }}>10s 轮询</span>
            <Switch size="small" checked={autoPoll} onChange={setAutoPoll} />
          </Space>
        }
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            value={layerFilter}
            style={{ minWidth: 130 }}
            onChange={(value) => {
              setLayerFilter(value);
              setPage(1);
            }}
            options={[
              { value: '', label: '全部层级' },
              { value: 'rule', label: 'rule 数值/驱力' },
              { value: 'plan', label: 'plan 日程执行' },
              { value: 'jev', label: 'jev 直觉' },
              { value: 'triage', label: 'triage 事件分级' },
              { value: 'select', label: 'select want 仲裁' },
              { value: 'light', label: 'light 轻思考' },
              { value: 'slow', label: 'slow 慢思考' },
            ]}
          />
          <Select
            value={conclusionFilter}
            style={{ minWidth: 110 }}
            onChange={(value) => {
              setConclusionFilter(value);
              setPage(1);
            }}
            options={[
              { value: '', label: '全部判定' },
              { value: 'react', label: 'react 行动' },
              { value: 'continue', label: 'continue 继续' },
            ]}
          />
          <Input
            value={wantIdFilter}
            placeholder="按 want ID 过滤"
            style={{ width: 220 }}
            allowClear
            onChange={(e) => {
              setWantIdFilter(e.target.value);
              setPage(1);
            }}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => setRefreshKey((key) => key + 1)}
          >
            刷新
          </Button>
        </Space>
        {tracesError !== null && <Alert type="error" showIcon message={tracesError} style={{ marginBottom: 8 }} />}
        {traces === null ? (
          <Typography.Text type="secondary">加载中…</Typography.Text>
        ) : traces.entries.length === 0 ? (
          <Empty description="无匹配 trace(新世界跑起来后这里会有决策流)" />
        ) : (
          <>
            <Timeline items={buildTraceTimelineItems(traces.entries, openWant)} />
            <Pagination
              size="small"
              current={page}
              pageSize={traces.pageSize}
              total={traces.total}
              showSizeChanger={false}
              showTotal={(total) => `共 ${total.toLocaleString('en-US')} 条`}
              onChange={setPage}
            />
          </>
        )}
      </Card>

      <WantLifecycleDrawer
        characterId={characterId}
        wantId={drawerWantId}
        onClose={() => setDrawerWantId(null)}
      />
    </Flex>
  );
}
