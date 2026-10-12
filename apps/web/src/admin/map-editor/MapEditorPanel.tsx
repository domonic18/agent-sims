/**
 * 编辑器外壳(批B):工具栏(返回/名称/撤销重做/网格标签/保存/发布/AI 助手占位)
 * + 左工具面板 + 中央画布 + 右侧 属性/图层/体检 Tabs。保存走批A maps API;
 * 发布门禁=checkLayout 零硬错误。Cmd/Ctrl+S 保存,Delete 删选中,Esc 取消选中。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as AntdApp, Badge, Button, Divider, Input, Segmented, Tabs, Tooltip, Typography } from 'antd';
import {
  ArrowLeftOutlined,
  BlockOutlined,
  AppstoreOutlined,
  ExperimentOutlined,
  PictureOutlined,
  RedoOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  TagOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import type { TileMapDefinition } from '@sims/shared';
import { createMap, publishMap, updateMap } from '../api';
import { useLayout } from '../layoutStore';
import { MapAgentSidebar } from '../map-agent/MapAgentSidebar';
import { EditorCanvas } from './EditorCanvas';
import { ToolPanel } from './ToolPanel';
import { ToolRail } from './ToolRail';
import { PropertiesPanel } from './PropertiesPanel';
import { LayerPanel } from './LayerPanel';
import { HealthPanel } from './HealthPanel';
import { checkLayout } from './health';
import { getAtPath } from './history';
import { selectionPath, useEditor, type EditorTool } from './editorStore';

export interface MapEditorLaunch {
  mapId: string | null;
  name: string;
  /** 随保存一并回传(PUT 为整体写入,缺省会被服务端清空) */
  description?: string;
  definition: TileMapDefinition;
}

const DELETE_LABELS = {
  place: '场所',
  furniture: '家具',
  path: '铺装',
  fence: '围栏',
  resource: '资源',
  blocked: '障碍',
  decor: '装饰',
} as const;

/** 数字热键 → 工具(与 ToolPanel.TOOL_HOTKEYS 提示一致) */
const HOTKEY_TOOLS: Record<string, EditorTool> = {
  '1': 'select',
  '2': 'pan',
  '3': 'place',
  '4': 'path',
  '5': 'fence',
  '6': 'resource',
  '7': 'decor',
  '8': 'blocked',
};

export function MapEditorPanel({ launch, onBack }: { launch: MapEditorLaunch; onBack: () => void }) {
  const { message, modal } = AntdApp.useApp();
  const name = useEditor((s) => s.name);
  const dirty = useEditor((s) => s.dirty);
  const doc = useEditor((s) => s.doc);
  const undoCount = useEditor((s) => s.history.undo.length);
  const redoCount = useEditor((s) => s.history.redo.length);
  const showGrid = useEditor((s) => s.showGrid);
  const showLabels = useEditor((s) => s.showLabels);
  const viewMode = useEditor((s) => s.viewMode);
  const [agentOpen, setAgentOpen] = useState(false);
  const [sideTab, setSideTab] = useState<'props' | 'layers' | 'health'>('props');
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    useEditor.getState().loadMap(launch);
  }, [launch]);

  // 全屏工作台:挂载申请铺满 admin 内容区,卸载归还普通版式
  useEffect(() => {
    useLayout.getState().setFullBleed(true);
    return () => useLayout.getState().setFullBleed(false);
  }, []);

  const health = useMemo(() => checkLayout(doc), [doc]);
  const errorCount = health.findings.filter((f) => f.level === 'error').length;

  const save = useCallback(async (): Promise<string | null> => {
    const s = useEditor.getState();
    const description = launch.description;
    try {
      if (s.mapId === null) {
        const created = await createMap({ name: s.name, ...(description ? { description } : {}), definition: s.doc });
        useEditor.getState().markSaved(created.id);
        void message.success(`已创建地图「${created.name}」`);
        return created.id;
      }
      await updateMap(s.mapId, { name: s.name, ...(description ? { description } : {}), definition: s.doc });
      useEditor.getState().markSaved(s.mapId);
      void message.success('已保存');
      return s.mapId;
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
      return null;
    }
  }, [launch.description, message]);

  const publish = useCallback(async (): Promise<void> => {
    const s = useEditor.getState();
    if (errorCount > 0) {
      message.error(`体检有 ${errorCount} 个硬错误,修复后才能发布`);
      return;
    }
    let id = s.mapId;
    if (id === null || s.dirty) {
      const saved = await save();
      if (saved === null) return;
      id = saved;
    }
    try {
      await publishMap(id);
      void message.success('已发布,创建世界时可选这张图');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '发布失败');
    }
  }, [errorCount, message, save]);

  const deleteSelection = useCallback((): void => {
    const s = useEditor.getState();
    if (s.selection === null) return;
    const path = selectionPath(s.doc, s.selection);
    if (path === null) return;
    const before = getAtPath(s.doc, path);
    if (before === undefined || before === null) return;
    const nameOf =
      s.selection.kind === 'place' && typeof before === 'object' && 'name' in before
        ? `「${(before as { name: string }).name}」`
        : '';
    s.commit({
      kind: 'remove',
      label: `删${DELETE_LABELS[s.selection.kind]}${nameOf}`,
      path,
      before,
      after: null,
    });
    s.select(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target;
      const typing =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) useEditor.getState().redo();
        else useEditor.getState().undo();
        return;
      }
      if (typing) return;
      const hotkeyTool = HOTKEY_TOOLS[e.key];
      if (hotkeyTool !== undefined) {
        useEditor.getState().setTool(hotkeyTool);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === 'Escape') {
        useEditor.getState().select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, deleteSelection]);

  const tryBack = (): void => {
    if (!useEditor.getState().dirty) {
      onBack();
      return;
    }
    modal.confirm({
      title: '有未保存的修改',
      content: '返回地图管理将丢弃这些改动,确定返回?',
      okText: '丢弃并返回',
      cancelText: '继续编辑',
      onOk: onBack,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', minHeight: 480, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <Button size="small" icon={<ArrowLeftOutlined />} onClick={tryBack}>
          返回
        </Button>
        <Input
          size="small"
          value={name}
          onChange={(e) => useEditor.getState().setName(e.target.value)}
          style={{ width: 180 }}
        />
        {dirty && (
          <Tooltip title="有未保存修改(Cmd/Ctrl+S 保存)">
            <i style={{ width: 8, height: 8, borderRadius: 4, background: '#ffcd75' }} />
          </Tooltip>
        )}
        <Divider type="vertical" />
        <Tooltip title="撤销(Cmd/Ctrl+Z)">
          <Button
            size="small"
            type="text"
            icon={<UndoOutlined />}
            disabled={undoCount === 0}
            onClick={() => useEditor.getState().undo()}
          />
        </Tooltip>
        <Tooltip title="重做(Shift+Cmd/Ctrl+Z)">
          <Button
            size="small"
            type="text"
            icon={<RedoOutlined />}
            disabled={redoCount === 0}
            onClick={() => useEditor.getState().redo()}
          />
        </Tooltip>
        <Divider type="vertical" />
        <Tooltip title={showGrid ? '隐藏网格' : '显示网格'}>
          <Button
            size="small"
            type={showGrid ? 'primary' : 'text'}
            ghost={showGrid}
            icon={<AppstoreOutlined />}
            onClick={() => useEditor.getState().toggleGrid()}
          />
        </Tooltip>
        <Tooltip title={showLabels ? '隐藏名称标签' : '显示名称标签'}>
          <Button
            size="small"
            type={showLabels ? 'primary' : 'text'}
            ghost={showLabels}
            icon={<TagOutlined />}
            onClick={() => useEditor.getState().toggleLabels()}
          />
        </Tooltip>
        <Segmented
          size="small"
          value={viewMode}
          onChange={(v) => useEditor.getState().setViewMode(v as 'semantic' | 'real')}
          options={[
            { label: '语义视图', value: 'semantic', icon: <BlockOutlined /> },
            { label: '效果视图', value: 'real', icon: <PictureOutlined /> },
          ]}
        />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Tooltip title="与 AI 对话生成/修改地图,改动实时进画布且可撤销">
            <Button size="small" icon={<ExperimentOutlined />} onClick={() => setAgentOpen(true)}>
              AI 助手
            </Button>
          </Tooltip>
          <Button size="small" icon={<SafetyCertificateOutlined />} onClick={() => void publish()}>
            发布
          </Button>
          <Button size="small" type="primary" icon={<SaveOutlined />} onClick={() => void save()}>
            保存
          </Button>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0, gap: 8 }}>
        <ToolRail />
        <div
          style={{
            width: 190,
            flexShrink: 0,
            padding: 10,
            border: '1px solid #2b3157',
            borderRadius: 6,
            overflow: 'auto',
          }}
        >
          <ToolPanel />
        </div>
        <div style={{ flex: 1, minWidth: 0, border: '1px solid #2b3157', borderRadius: 6, overflow: 'hidden' }}>
          <EditorCanvas />
        </div>
        <div
          style={{
            width: 320,
            flexShrink: 0,
            padding: 10,
            border: '1px solid #2b3157',
            borderRadius: 6,
            overflow: 'auto',
          }}
        >
          <Tabs
            size="small"
            activeKey={sideTab}
            onChange={(k) => setSideTab(k as 'props' | 'layers' | 'health')}
            items={[
              { key: 'props', label: '属性', children: <PropertiesPanel findings={health.findings} /> },
              { key: 'layers', label: '图层', children: <LayerPanel /> },
              {
                key: 'health',
                label: (
                  <Badge count={errorCount} size="small" offset={[4, 0]}>
                    体检
                  </Badge>
                ),
                children: <HealthPanel result={health} onLocate={() => setSideTab('props')} />,
              },
            ]}
          />
        </div>
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 11, marginTop: 4 }}>
        工具热键 1-8;效果视图按游戏贴图渲染实际外观;滚轮缩放(右下角 +/−/适应 按钮)、抓手/空格/中键拖拽平移;Cmd/Ctrl+S 保存、Cmd/Ctrl+Z 撤销(Shift 重做)、Delete 删除选中、Esc 取消选中
      </Typography.Text>
      <MapAgentSidebar open={agentOpen} onClose={() => setAgentOpen(false)} />
    </div>
  );
}
