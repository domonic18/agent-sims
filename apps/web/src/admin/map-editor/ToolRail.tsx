/**
 * 左侧工具栏(问题1重构):行业主流的窄竖排图标栏(Figma/Tiled 式),
 * 悬浮提示带热键;与画布键位(1-8)一致。
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
import { Tooltip } from 'antd';
import type { ReactElement } from 'react';
import { useEditor, type EditorTool } from './editorStore';

export const TOOLS: { value: EditorTool; label: string; icon: ReactElement }[] = [
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

export function ToolRail() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);

  return (
    <div
      style={{
        width: 44,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        padding: '6px 0',
        border: '1px solid #2b3157',
        borderRadius: 6,
        background: 'rgba(20,22,42,0.55)',
      }}
    >
      {TOOLS.map(({ value, label, icon }) => {
        const active = tool === value;
        return (
          <Tooltip key={value} title={`${label}(${TOOL_HOTKEYS[value]})`} placement="right">
            <button
              type="button"
              onClick={() => setTool(value)}
              aria-label={label}
              style={{
                width: 34,
                height: 34,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                cursor: 'pointer',
                borderRadius: 4,
                border: active ? '1px solid #ffcd75' : '1px solid transparent',
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
  );
}
