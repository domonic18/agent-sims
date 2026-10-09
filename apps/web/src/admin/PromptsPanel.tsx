import { useEffect, useState } from 'react';
import { Alert, Card, Table, Tag, Typography } from 'antd';
import type { PromptView } from '@sims/shared';
import { fetchPrompts } from './api';

/** 外置提示词查看(只读): 启动时服务端已全量加载校验,此处直接列表+行展开看模板全文 */
export function PromptsPanel() {
  const [prompts, setPrompts] = useState<PromptView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPrompts()
      .then(setPrompts)
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'));
  }, []);

  if (error !== null) return <Alert type="error" showIcon message={error} />;

  return (
    <Card title="提示词模板(外置只读)" extra={prompts !== null ? `共 ${prompts.length} 条` : undefined}>
      {prompts === null ? (
        <p>加载中…</p>
      ) : (
        <Table<PromptView>
          rowKey="id"
          size="small"
          dataSource={prompts}
          pagination={false}
          expandable={{
            expandedRowRender: (record) => (
              <div>
                <div style={{ marginBottom: 8 }}>
                  {(record.variables.length > 0 ? record.variables : ['(无占位符)']).map((v) => (
                    <Tag key={v} style={{ fontFamily: 'monospace' }}>{`{{${v}}}`}</Tag>
                  ))}
                </div>
                <Typography.Paragraph
                  copyable
                  style={{ marginBottom: 0 }}
                >
                  <pre
                    style={{
                      margin: 0,
                      padding: 12,
                      background: '#f6f8fa',
                      borderRadius: 6,
                      fontSize: 12,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {record.content}
                  </pre>
                </Typography.Paragraph>
              </div>
            ),
            rowExpandable: () => true,
          }}
          columns={[
            { title: '标识', dataIndex: 'id', width: 200, render: (v: string) => <code>{v}</code> },
            { title: '标题', dataIndex: 'title', width: 170 },
            { title: '槽位', dataIndex: 'slot', width: 80, render: (v: string) => <Tag>{v}</Tag> },
            { title: '任务类型', dataIndex: 'taskType', width: 200, render: (v: string) => <code style={{ fontSize: 11 }}>{v}</code> },
            { title: '说明', dataIndex: 'description', ellipsis: true },
          ]}
        />
      )}
    </Card>
  );
}
