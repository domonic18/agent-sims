/**
 * 工具面板(批B):工具切换+按工具的子选项(场所 kind 调色板/装饰组/资源种),
 * 附操作提示。全部状态走 editorStore,画布直接读取。工具用图标网格呈现
 * (悬浮提示带数字热键),抓手平移供纯查看。
 */
import {
  BgColorsOutlined,
  BorderOuterOutlined,
  DragOutlined,
  GoldOutlined,
  HomeOutlined,
  NodeIndexOutlined,
  SelectOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { Segmented, Tooltip, Typography } from 'antd';
import type { ReactElement } from 'react';
import type { ResourceNode } from '@sims/shared';
import { useEditor, type EditorTool } from './editorStore';
import { KIND_ORDER, KIND_PRESETS, kindColor } from './kinds';

const TOOLS: { value: EditorTool; label: string; icon: ReactElement }[] = [
  { value: 'select', label: '选择', icon: <SelectOutlined /> },
  { value: 'pan', label: '抓手', icon: <DragOutlined /> },
  { value: 'place', label: '场所', icon: <HomeOutlined /> },
  { value: 'path', label: '路径', icon: <NodeIndexOutlined /> },
  { value: 'fence', label: '围栏', icon: <BorderOuterOutlined /> },
  { value: 'resource', label: '资源', icon: <GoldOutlined /> },
  { value: 'decor', label: '装饰', icon: <BgColorsOutlined /> },
  { value: 'blocked', label: '堵塞', icon: <StopOutlined /> },
];

/** 数字热键(与 MapEditorPanel 全局 keydown 一致) */
export const TOOL_HOTKEYS: Readonly<Record<EditorTool, string>> = {
  select: '1',
  pan: '2',
  place: '3',
  path: '4',
  fence: '5',
  resource: '6',
  decor: '7',
  blocked: '8',
};

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
  const setTool = useEditor((s) => s.setTool);
  const placeKind = useEditor((s) => s.placeKind);
  const setPlaceKind = useEditor((s) => s.setPlaceKind);
  const decorGroup = useEditor((s) => s.decorGroup);
  const setDecorGroup = useEditor((s) => s.setDecorGroup);
  const resourceKind = useEditor((s) => s.resourceKind);
  const setResourceKind = useEditor((s) => s.setResourceKind);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
        {TOOLS.map(({ value, label, icon }) => {
          const active = tool === value;
          return (
            <Tooltip key={value} title={`${label}(${TOOL_HOTKEYS[value]})`}>
              <button
                type="button"
                onClick={() => setTool(value)}
                aria-label={label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '6px 0',
                  fontSize: 15,
                  cursor: 'pointer',
                  borderRadius: 4,
                  border: active ? '1px solid #ffcd75' : '1px solid #2b3157',
                  background: active ? 'rgba(255,205,117,0.14)' : 'transparent',
                  color: active ? '#ffcd75' : '#94b0c2',
                }}
              >
                {icon}
              </button>
            </Tooltip>
          );
        })}
      </div>
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
