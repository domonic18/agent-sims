/**
 * AI 改图侧边栏(批C):Drawer 内装配 runtime Provider + 会话工具条
 * (新对话/历史切换/删除)+ Thread 视图。线程态在 mapAgentStore,
 * 切换即触发 adapter.load 拉历史。
 */
import { useCallback, useEffect } from 'react';
import { App as AntdApp, Button, Drawer, Popconfirm, Select, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { deleteMapAgentThread, fetchMapAgentThreads } from '../api';
import { useMapAgent } from './mapAgentStore';
import { MapAgentRuntimeProvider } from './MapAgentRuntimeProvider';
import { MapAgentThread } from './MapAgentThread';

function ThreadToolbar() {
  const { message } = AntdApp.useApp();
  const threadId = useMapAgent((s) => s.threadId);
  const threads = useMapAgent((s) => s.threads);
  const switchThread = useMapAgent((s) => s.switchThread);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const { items } = await fetchMapAgentThreads();
      useMapAgent.getState().setThreads(items);
    } catch {
      // 历史列表拉取失败不打断对话
    }
  }, []);

  const remove = useCallback(async (): Promise<void> => {
    if (threadId === undefined) return;
    try {
      await deleteMapAgentThread(threadId);
      switchThread(undefined);
      await refresh();
      void message.success('已删除会话');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    }
  }, [threadId, message, refresh, switchThread]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px 8px' }}>
      <Button
        size="small"
        icon={<PlusOutlined />}
        onClick={() => {
          switchThread(undefined);
          void refresh();
        }}
      >
        新对话
      </Button>
      <Select
        size="small"
        showSearch
        value={threadId ?? null}
        placeholder="历史会话"
        style={{ flex: 1, minWidth: 0 }}
        optionFilterProp="label"
        options={threads.map((t) => ({ value: t.threadId, label: t.title || '新对话' }))}
        onChange={(id: string) => switchThread(id)}
        onOpenChange={(open) => {
          if (open) void refresh();
        }}
      />
      <Popconfirm title="删除当前会话?" okText="删除" cancelText="取消" onConfirm={() => void remove()}>
        <Button size="small" danger disabled={threadId === undefined}>
          删除
        </Button>
      </Popconfirm>
    </div>
  );
}

export function MapAgentSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const setThreads = useMapAgent((s) => s.setThreads);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchMapAgentThreads()
      .then(({ items }) => {
        if (!cancelled) setThreads(items);
      })
      .catch(() => {
        // 抽屉打开时历史拉取失败静默,发送与新建不受影响
      });
    return () => {
      cancelled = true;
    };
  }, [open, setThreads]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={440}
      destroyOnClose
      title={
        <Typography.Text style={{ fontSize: 14 }}>
          AI 改图助手
          <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
            修改实时进画布,可撤销;点「保存」才会入库
          </Typography.Text>
        </Typography.Text>
      }
      styles={{ body: { padding: '12px 0 0', display: 'flex', flexDirection: 'column', minHeight: 0 } }}
    >
      <MapAgentRuntimeProvider>
        <ThreadToolbar />
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <MapAgentThread />
        </div>
      </MapAgentRuntimeProvider>
    </Drawer>
  );
}
