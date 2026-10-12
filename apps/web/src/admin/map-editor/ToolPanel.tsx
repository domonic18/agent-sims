/**
 * 工具选项面板(问题1重构后):工具格已迁至 ToolRail,这里只承载当前工具
 * 的上下文选项(场所 kind 调色板/装饰组/资源种)+操作提示。
 * 资源/装饰选项带真实贴图缩略图(效果视图同源素材,缺图降级语义色点),
 * 所见即所放,不用拖上画布才知道内容。
 */
import { useEffect, useRef, useState } from 'react';
import { Typography } from 'antd';
import type { ResourceNode } from '@sims/shared';
import { ensureSprites, getSpriteImage, NODE_SPRITES } from '../mapRenderReal';
import { TILE_SLUG } from '../../game/assets';
import { useEditor, type EditorTool } from './editorStore';
import { KIND_ORDER, KIND_PRESETS, kindColor } from './kinds';
import { TOOL_HOTKEYS, TOOLS } from './ToolRail';

const DECOR_GROUPS: { value: 'trees' | 'lamps' | 'flowers' | 'bushes'; label: string; slug: string; color: string }[] = [
  { value: 'trees', label: '树', slug: 'tree-a', color: '#38b764' },
  { value: 'lamps', label: '灯', slug: 'lamp', color: '#ffcd75' },
  { value: 'flowers', label: '花', slug: TILE_SLUG.flowerA, color: '#ef7d57' },
  { value: 'bushes', label: '灌木', slug: TILE_SLUG.bush, color: '#a7f070' },
];

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

/** 贴图缩略图:manifest 装载后画真实 sprite,失败降级语义色点(与画布同色) */
function SpriteThumb({ slug, color, size = 26 }: { slug: string; color: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    // 无论 loaded 归属哪次调用,只要缓存里有图就重绘(并发调用/StrictMode 下
    // loaded=false 可能只是别的调用方已把图装进缓存)
    void ensureSprites([slug]).then(() => {
      if (alive && getSpriteImage(slug) !== null) setVersion((v) => v + 1);
    });
    return () => {
      alive = false;
    };
  }, [slug]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = false;
    const img = getSpriteImage(slug);
    if (img !== null) {
      const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    } else {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [slug, color, size, version]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, flexShrink: 0, imageRendering: 'pixelated' }}
    />
  );
}

const OPTION_STYLE = (active: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 6px',
  fontSize: 12,
  cursor: 'pointer',
  textAlign: 'left',
  borderRadius: 4,
  border: active ? '1px solid #41a6f6' : '1px solid transparent',
  background: active ? '#1c2f4a' : 'transparent',
  color: 'inherit',
});

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
              style={OPTION_STYLE(placeKind === kind)}
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
              style={OPTION_STYLE(decorGroup === g.value)}
            >
              <SpriteThumb slug={g.slug} color={g.color} />
              <span>{g.label}</span>
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
              style={OPTION_STYLE(resourceKind === r.value)}
            >
              <SpriteThumb slug={NODE_SPRITES[r.value] ?? 'plant'} color={r.value === 'berry_bush' ? '#b13e53' : '#ef7d57'} />
              <span>{r.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
