/**
 * AI 改图侧边栏:双栏布局(左=会话列表 ai-invest 同款,右=对话区)。
 * 线程态在 mapAgentStore,切换即触发 adapter.load 拉历史(执行计划随
 * 详情水合,live 推进走 updates 通道)。
 */
import { useEffect } from 'react';
import { Drawer, Typography } from 'antd';
import { fetchMapAgentThreads } from '../api';
import { useMapAgent } from './mapAgentStore';
import { MapAgentRuntimeProvider } from './MapAgentRuntimeProvider';
import { MapAgentThread } from './MapAgentThread';
import { ThreadList } from './ThreadList';
import './map-agent.css';

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
      width={720}
      destroyOnClose
      title={
        <Typography.Text style={{ fontSize: 14 }}>
          AI 改图助手
          <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
            修改实时进画布,可撤销;点「保存」才会入库
          </Typography.Text>
        </Typography.Text>
      }
      styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column', minHeight: 0 } }}
    >
      <MapAgentRuntimeProvider>
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <ThreadList />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <MapAgentThread />
          </div>
        </div>
      </MapAgentRuntimeProvider>
    </Drawer>
  );
}
