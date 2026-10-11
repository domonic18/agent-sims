/**
 * 工具面板(批B):工具切换+按工具的子选项(场所 kind 调色板/装饰组/资源种),
 * 附操作提示。全部状态走 editorStore,画布直接读取。
 */
import { Segmented, Typography } from 'antd';
import type { ResourceNode } from '@sims/shared';
import { useEditor, type EditorTool } from './editorStore';
import { KIND_ORDER, KIND_PRESETS, kindColor } from './kinds';

const TOOLS: { value: EditorTool; label: string }[] = [
  { value: 'select', label: '选择' },
  { value: 'place', label: '场所' },
  { value: 'path', label: '路径' },
  { value: 'fence', label: '围栏' },
  { value: 'resource', label: '资源' },
  { value: 'decor', label: '装饰' },
  { value: 'blocked', label: '堵塞' },
];

const DECOR_GROUPS = [
  { value: 'trees', label: '树' },
  { value: 'lamps', label: '灯' },
  { value: 'flowers', label: '花' },
  { value: 'bushes', label: '灌木' },
] as const;

const RESOURCE_KINDS: { value: ResourceNode['kind']; label: string }[] = [
  { value: 'berry_bush', label: '浆果丛' },
  { value: 'junk_pile', label: '拾荒堆' },
  { value: 'tree', label: '树' },
  { value: 'rock', label: '岩石' },
  { value: 'metal_pile', label: '金属堆' },
  { value: 'apple_tree', label: '苹果树' },
  { value: 'wheat_patch', label: '麦田' },
];

const HINTS: Record<EditorTool, string> = {
  select: '点选对象;再点一次已选场所可拖拽整体平移(家具随动),Delete 删除',
  place: '在画布拖画占地(或单击落默认尺寸);门洞与入口自动补在底边',
  path: '拖画铺装矩形(主街/广场)',
  fence: '拖画围栏矩形',
  resource: '单击放置资源节点(1×1 占格,采集目标)',
  decor: '单击放置点状装饰(1×1,纯视觉)',
  blocked: '拖画障碍矩形(池塘/喷泉等不可行走区)',
};

export function ToolPanel() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const placeKind = useEditor((s) => s.placeKind);
  const setPlaceKind = useEditor((s) => s.setPlaceKind);
  const decorGroup = useEditor((s) => s.decorGroup);
  const setDecorGroup = useEditor((s) => s.setDecorGroup);
  const resourceKind = useEditor((s) => s.resourceKind);
  const setResourceKind = useEditor((s) => s.setResourceKind);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Segmented block options={TOOLS} value={tool} onChange={(v) => setTool(v as EditorTool)} />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {HINTS[tool]}
      </Typography.Text>

      {tool === 'place' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
          {KIND_ORDER.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setPlaceKind(kind)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 6px',
                fontSize: 12,
                cursor: 'pointer',
                borderRadius: 4,
                border: placeKind === kind ? '1px solid #41a6f6' : '1px solid transparent',
                background: placeKind === kind ? '#1c2f4a' : 'transparent',
                color: 'inherit',
              }}
            >
              <i style={{ width: 10, height: 10, flexShrink: 0, background: kindColor(kind) }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {KIND_PRESETS[kind].label}
              </span>
            </button>
          ))}
        </div>
      )}
      {tool === 'decor' && (
        <Segmented
          block
          options={DECOR_GROUPS.map((g) => ({ label: g.label, value: g.value }))}
          value={decorGroup}
          onChange={(v) => setDecorGroup(v as (typeof DECOR_GROUPS)[number]['value'])}
        />
      )}
      {tool === 'resource' && (
        <Segmented
          block
          options={RESOURCE_KINDS.map((r) => ({ label: r.label, value: r.value }))}
          value={resourceKind}
          onChange={(v) => setResourceKind(v as ResourceNode['kind'])}
        />
      )}
    </div>
  );
}
