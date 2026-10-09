import { Button, Modal, Table, Tag } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import type { AssetAiReviewItem } from '@sims/shared';

/** 素材 AI 审核结果弹窗(批量工具栏与详情抽屉「AI 识别」两个入口共用;
 * 状态(aiOpen/aiRunning/aiItems)与上报 handler 由 AssetsPanel 持有,经 props 下传 */
export function AssetAiReviewModal({
  open,
  running,
  items,
  thumbUrls,
  onClose,
  onReport,
}: {
  open: boolean;
  running: boolean;
  items: AssetAiReviewItem[];
  thumbUrls: Record<number, string>;
  onClose: () => void;
  onReport: (item: AssetAiReviewItem) => Promise<void>;
}) {
  return (
    <Modal
      title="AI 审核结果"
      open={open}
      onCancel={() => onClose()}
      footer={[
        <Button key="close" type="primary" onClick={() => onClose()}>
          关闭
        </Button>,
      ]}
      width={760}
    >
      <p style={{ color: '#888', fontSize: 12, marginTop: 4 }}>
        结论由视觉模型(vision 槽)生成,仅供参考;「上报」会把结论写入素材问题清单。
      </p>
      <Table<AssetAiReviewItem>
        rowKey="id"
        size="small"
        loading={running}
        dataSource={items}
        pagination={false}
        columns={[
          {
            title: '图',
            width: 64,
            render: (_, item) =>
              thumbUrls[item.id] !== undefined ? (
                <img src={thumbUrls[item.id]} alt="" style={{ imageRendering: 'pixelated', width: 48 }} />
              ) : (
                '—'
              ),
          },
          { title: 'slug', dataIndex: 'slug', width: 160, ellipsis: true },
          {
            title: '结论',
            width: 84,
            render: (_, item) => {
              if (!item.ok) return <Tag>失败</Tag>;
              const match = item.result?.match ?? 'unsure';
              return match === 'yes' ? (
                <Tag color="green">匹配</Tag>
              ) : match === 'no' ? (
                <Tag color="red">不匹配</Tag>
              ) : (
                <Tag color="orange">不确定</Tag>
              );
            },
          },
          {
            title: '模型判断',
            render: (_, item) => {
              if (!item.ok) return <span style={{ color: '#c00' }}>{item.error}</span>;
              const r = item.result;
              if (r === undefined) return '—';
              return (
                <div style={{ fontSize: 12 }}>
                  <div>图里是: {r.see || '—'}</div>
                  {r.kindGuess !== null && <div>kind 猜测: {r.kindGuess}</div>}
                  {r.problems.length > 0 && <div>问题: {r.problems.join(';')}</div>}
                  {r.suggestion !== null && <div>建议: {r.suggestion}</div>}
                </div>
              );
            },
          },
          {
            title: '操作',
            width: 84,
            render: (_, item) =>
              item.ok && item.result !== undefined && item.result.match !== 'yes' ? (
                <Button size="small" icon={<WarningOutlined />} onClick={() => void onReport(item)}>
                  上报
                </Button>
              ) : null,
          },
        ]}
      />
    </Modal>
  );
}
