import {
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Tooltip,
  type FormInstance,
} from 'antd';
import { RobotOutlined, WarningOutlined } from '@ant-design/icons';
import type { AssetAdminView, AssetCategoryView } from '@sims/shared';
import { SpriteInspector } from './SpriteInspector';
import { GridPreview } from './AssetGridPreview';

export type AssetIssueState = 'idle' | 'sending' | 'done' | 'error';

/** 素材详情抽屉:占地预览+雪碧图检视+元数据编辑/只读+上报/AI 识别;
 * detail 等编辑态与全部 handler 由 AssetsPanel 持有,经 props 下传 */
export function AssetDetailDrawer({
  detail,
  detailImage,
  editing,
  issueState,
  aiRunning,
  categories,
  form,
  onClose,
  onStartEdit,
  onCancelEdit,
  onSave,
  onReportIssue,
  onRunAi,
}: {
  detail: AssetAdminView | null;
  detailImage: string | null;
  editing: boolean;
  issueState: AssetIssueState;
  aiRunning: boolean;
  categories: AssetCategoryView[] | null;
  form: FormInstance;
  onClose: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => Promise<void>;
  onReportIssue: () => Promise<void>;
  onRunAi: (ids: number[]) => Promise<void>;
}) {
  return (
    <Drawer
      title={detail === null ? '' : `${detail.name}(${detail.slug})`}
      width={480}
      open={detail !== null}
      onClose={onClose}
      destroyOnClose
    >
      {detail !== null && (
        <>
          {detailImage !== null ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
                <GridPreview asset={detail} url={detailImage} scale={3} />
              </div>
              <div style={{ fontSize: 12, color: '#8b949e', textAlign: 'center' }}>
                红框 = 占地 {detail.gridW}×{detail.gridH} 格(16px/格)
              </div>
              <SpriteInspector
                url={detailImage}
                width={detail.width}
                height={detail.height}
                anim={detail.anim}
              />
            </>
          ) : (
            <p style={{ color: '#999' }}>图片加载中…</p>
          )}
          {editing ? (
            <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
              <Form.Item name="name" label="名称" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Space size="middle">
                <Form.Item name="gridW" label="占地宽(格)">
                  <InputNumber min={1} max={20} />
                </Form.Item>
                <Form.Item name="gridH" label="占地高(格)">
                  <InputNumber min={1} max={20} />
                </Form.Item>
                <Form.Item name="tier" label="等级">
                  <InputNumber min={1} max={10} />
                </Form.Item>
              </Space>
              <Form.Item name="anchor" label="锚点">
                <Select
                  options={[
                    { value: 'bottom-center', label: '底边中心' },
                    { value: 'top-left', label: '左上角(tile)' },
                    { value: 'char-082', label: '角色(0.5,0.82)' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="tags" label="标签(逗号分隔)">
                <Input placeholder="如: 卧室, 木色" />
              </Form.Item>
              <Form.Item name="status" label="状态">
                <Select
                  options={[
                    { value: 'draft', label: '待校验' },
                    { value: 'active', label: '已启用(进入发布)' },
                    { value: 'retired', label: '已下架' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="categoryId" label="分类迁移(改 kind,决定进哪个 worldgen 池)">
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={(categories ?? [])
                    .filter((cat) => cat.level === 2)
                    .map((cat) => {
                      const parent = (categories ?? []).find((p) => p.id === cat.parentId);
                      return { value: cat.id, label: `${parent?.name ?? '?'}/${cat.name}` };
                    })}
                />
              </Form.Item>
              <Space>
                <Button type="primary" onClick={() => void onSave()}>
                  保存
                </Button>
                <Button onClick={onCancelEdit}>取消</Button>
              </Space>
            </Form>
          ) : (
            <>
              <Descriptions
                size="small"
                column={2}
                style={{ marginTop: 16 }}
                items={[
                  { key: 'domain', label: '域', children: detail.domain },
                  { key: 'cat', label: '分类', children: detail.categorySlug },
                  { key: 'grid', label: '占地', children: `${detail.gridW}×${detail.gridH} 格` },
                  { key: 'tier', label: '等级', children: detail.tier },
                  { key: 'anchor', label: '锚点', children: detail.anchor },
                  { key: 'tags', label: '标签', children: detail.tags.join(' / ') || '—' },
                  { key: 'source', label: '来源', children: detail.source, span: 2 },
                ]}
              />
              <Space style={{ marginTop: 12 }} wrap>
                <Button type="primary" onClick={onStartEdit}>
                  编辑元数据
                </Button>
                <Button
                  icon={<WarningOutlined />}
                  disabled={issueState === 'sending'}
                  onClick={() => void onReportIssue()}
                >
                  {issueState === 'done'
                    ? '✓ 已上报'
                    : issueState === 'error'
                      ? '✕ 失败,重试'
                      : '⚠ 标记问题'}
                </Button>
                <Tooltip title="视觉模型识别这张图,校验 slug/元数据是否相符">
                  <Button
                    icon={<RobotOutlined />}
                    loading={aiRunning}
                    onClick={() => void onRunAi([detail.id])}
                  >
                    AI 识别
                  </Button>
                </Tooltip>
              </Space>
            </>
          )}
        </>
      )}
    </Drawer>
  );
}
