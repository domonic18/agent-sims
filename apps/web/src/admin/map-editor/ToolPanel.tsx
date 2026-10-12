/**
 * 工具选项面板(问题1重构后):工具格已迁至 ToolRail,这里只承载当前工具
 * 的上下文选项(场所 kind 调色板/装饰组/资源种)+操作提示。
 */
import { Typography } from 'antd';
import type { ResourceNode } from '@sims/shared';
import { useEditor, type EditorTool } from './editorStore';
import { KIND_ORDER, KIND_PRESETS, kindColor } from './kinds';
import { TOOL_HOTKEYS, TOOLS } from './ToolRail';

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
  select: '点选对象;拖拽移动场所整体(家具随动)或屋内单件家具(使用格随动),Delete 删除',
  pan: '拖拽平移画布纯查看(滚轮缩放;任意工具下中键/按住空格同样可拖)',
  place: '在画布拖画占地(或单击落默认尺寸);门洞与入口自动补在底边',
  path: '拖画铺装矩形(主街/广场)',
  fence: '拖画围栏矩形',
  resource: '单击放置资源节点(1×1 占格,采集目标)',
  decor: '单击放置点状装饰(1×1,纯视觉)',
  blocked: '拖画障碍矩形(池塘/喷泉等不可行走区)',
};

export function ToolPanel() {
  const tool = useEditor((s) => s.tool);
  const placeKind = useEditor((s) => s.placeKind);
  const setPlaceKind = useEditor((s) => s.setPlaceKind);
  const decorGroup = useEditor((s) => s.decorGroup);
  const setDecorGroup = useEditor((s) => s.setDecorGroup);
  const resourceKind = useEditor((s) => s.resourceKind);
  const setResourceKind = useEditor((s) => s.setResourceKind);
  const toolLabel = TOOLS.find((t) => t.value === tool)?.label ?? '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Typography.Text strong style={{ fontSize: 12 }}>
          {toolLabel}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          热键 {TOOL_HOTKEYS[tool]}
        </Typography.Text>
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {HINTS[tool]}
      </Typography.Text>

      {tool === 'place' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
          {DECOR_GROUPS.map((g) => (
            <button
              key={g.value}
              type="button"
              onClick={() => setDecorGroup(g.value)}
              style={{
                padding: '4px 6px',
                fontSize: 12,
                cursor: 'pointer',
                borderRadius: 4,
                border: decorGroup === g.value ? '1px solid #41a6f6' : '1px solid transparent',
                background: decorGroup === g.value ? '#1c2f4a' : 'transparent',
                color: 'inherit',
              }}
            >
              {g.label}
            </button>
          ))}
        </div>
      )}
      {tool === 'resource' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {RESOURCE_KINDS.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setResourceKind(r.value)}
              style={{
                padding: '4px 6px',
                fontSize: 12,
                textAlign: 'left',
                cursor: 'pointer',
                borderRadius: 4,
                border: resourceKind === r.value ? '1px solid #41a6f6' : '1px solid transparent',
                background: resourceKind === r.value ? '#1c2f4a' : 'transparent',
                color: 'inherit',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
