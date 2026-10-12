/**
 * 会话列表面板(对齐 ai-invest AssistantSidebar):新对话入口+标题搜索+
 * 今天/昨天/更早分组,当前会话高亮,悬浮显删除。数据源 zustand threads
 * (抽屉打开与切换后刷新),运行时不经此列表。
 */
import { EditOutlined, SearchOutlined } from '@ant-design/icons';
import { App as AntdApp, Button, Input, Popconfirm } from 'antd';
import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { deleteMapAgentThread, fetchMapAgentThreads } from '../api';
import { useMapAgent } from './mapAgentStore';

const MUTED = '#6b7280';
const SECONDARY = '#94b0c2';

async function refreshThreads(): Promise<void> {
  try {
    const { items } = await fetchMapAgentThreads();
    useMapAgent.getState().setThreads(items);
  } catch {
    // 历史列表拉取失败不打断对话
  }
}

function groupLabel(updatedAt: string): string {
  const d = dayjs(updatedAt);
  const today = dayjs().startOf('day');
  if (d.isAfter(today)) return '今天';
  if (d.isAfter(today.subtract(1, 'day'))) return '昨天';
  return '更早';
}

const GROUP_ORDER = ['今天', '昨天', '更早'] as const;

function itemTime(updatedAt: string): string {
  const d = dayjs(updatedAt);
  const today = dayjs().startOf('day');
  if (d.isAfter(today)) return d.format('HH:mm');
  if (d.isAfter(today.subtract(1, 'day'))) return `昨天 ${d.format('HH:mm')}`;
  return d.format('MM-DD HH:mm');
}

export function ThreadList(): ReactElement {
  const { message } = AntdApp.useApp();
  const threadId = useMapAgent((s) => s.threadId);
  const threads = useMapAgent((s) => s.threads);
  const switchThread = useMapAgent((s) => s.switchThread);
  const [keyword, setKeyword] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  const groups = useMemo(() => {
    const kw = keyword.trim();
    const filtered = kw === '' ? threads : threads.filter((t) => (t.title || '新对话').toLowerCase().includes(kw.toLowerCase()));
    const map = new Map<string, typeof filtered>();
    for (const t of filtered) {
      const label = groupLabel(t.updatedAt);
      const list = map.get(label) ?? [];
      list.push(t);
      map.set(label, list);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ label: g, items: map.get(g)! }));
  }, [threads, keyword]);

  const remove = useCallback(async (id: string): Promise<void> => {
    setDeleting(id);
    try {
      await deleteMapAgentThread(id);
      if (useMapAgent.getState().threadId === id) switchThread(undefined);
      await refreshThreads();
      void message.success('已删除会话');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(null);
    }
  }, [message, switchThread]);

  // 首条消息会经 adapter.initialize 建新线程——threadId 出现而列表未含时
  // 自动刷新,保证当前会话始终可从列表点回
  useEffect(() => {
    if (threadId === undefined) return;
    if (threads.some((t) => t.threadId === threadId)) return;
    void refreshThreads();
  }, [threadId, threads]);

  return (
    <div
      style={{
        width: 216,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid #262b47',
        padding: '10px 8px 8px',
        gap: 8,
        minHeight: 0,
      }}
    >
      <Button
        type="primary"
        block
        icon={<EditOutlined />}
        onClick={() => {
          switchThread(undefined);
          void refreshThreads();
        }}
      >
        新对话
      </Button>
      <Input
        size="small"
        prefix={<SearchOutlined style={{ color: MUTED }} />}
        placeholder="搜索会话"
        allowClear
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
      />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'grid', gap: 10, alignContent: 'start' }}>
        {groups.map(({ label, items }) => (
          <div key={label}>
            <div style={{ fontSize: 11, color: MUTED, margin: '0 6px 4px' }}>{label}</div>
            <div style={{ display: 'grid', gap: 2 }}>
              {items.map((t) => {
                const active = t.threadId === threadId;
                return (
                  <div
                    key={t.threadId}
                    className="sims-agent-session"
                    role="button"
                    tabIndex={0}
                    onClick={() => switchThread(t.threadId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') switchThread(t.threadId);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '6px 8px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      background: active ? 'rgba(255,205,117,0.14)' : 'transparent',
                      color: active ? '#ffcd75' : SECONDARY,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.title || '新对话'}
                      </div>
                      <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>{itemTime(t.updatedAt)}</div>
                    </div>
                    <span className="sims-agent-session-del">
                      <Popconfirm
                        title="删除该会话?"
                        okText="删除"
                        cancelText="取消"
                        onConfirm={(e) => {
                          e?.stopPropagation();
                          void remove(t.threadId);
                        }}
                        onCancel={(e) => e?.stopPropagation()}
                      >
                        <Button
                          size="small"
                          type="text"
                          danger
                          loading={deleting === t.threadId}
                          onClick={(e) => e.stopPropagation()}
                          style={{ fontSize: 11, padding: '0 4px', height: 20 }}
                        >
                          删除
                        </Button>
                      </Popconfirm>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <div style={{ fontSize: 12, color: MUTED, textAlign: 'center', padding: '16px 0' }}>
            {keyword.trim() === '' ? '暂无历史会话' : '没有匹配的会话'}
          </div>
        )}
      </div>
    </div>
  );
}
