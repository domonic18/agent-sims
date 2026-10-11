/**
 * 图层面板(批B):图层显隐(渲染层过滤)+对象树(场所清单点选,其余分组计数)。
 */
import { Checkbox, Typography } from 'antd';
import { useEditor, type LayerKey } from './editorStore';
import { placeKindOf } from './kinds';
import { kindColor } from './kinds';

const LAYERS: { key: Exclude<LayerKey, 'grid'>; label: string }[] = [
  { key: 'places', label: '场所' },
  { key: 'paths', label: '铺装' },
  { key: 'fences', label: '围栏' },
  { key: 'resources', label: '资源' },
  { key: 'decor', label: '装饰' },
  { key: 'blocked', label: '障碍' },
  { key: 'patches', label: '地表覆块' },
  { key: 'townCore', label: '镇核心' },
];

export function LayerPanel() {
  const doc = useEditor((s) => s.doc);
  const hidden = useEditor((s) => s.hidden);
  const toggleLayer = useEditor((s) => s.toggleLayer);
  const showGrid = useEditor((s) => s.showGrid);
  const toggleGrid = useEditor((s) => s.toggleGrid);
  const showLabels = useEditor((s) => s.showLabels);
  const toggleLabels = useEditor((s) => s.toggleLabels);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 12 }}>
      <div>
        <Typography.Text type="secondary">显示</Typography.Text>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, marginTop: 4 }}>
          {LAYERS.map((l) => (
            <Checkbox
              key={l.key}
              checked={!hidden[l.key]}
              onChange={() => toggleLayer(l.key)}
              style={{ marginInlineStart: 0, fontSize: 12 }}
            >
              {l.label}
            </Checkbox>
          ))}
          <Checkbox checked={showGrid} onChange={toggleGrid} style={{ marginInlineStart: 0, fontSize: 12 }}>
            网格
          </Checkbox>
          <Checkbox checked={showLabels} onChange={toggleLabels} style={{ marginInlineStart: 0, fontSize: 12 }}>
            名称
          </Checkbox>
        </div>
      </div>

      <div>
        <Typography.Text type="secondary">场所({doc.places.length})</Typography.Text>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 4 }}>
          {doc.places.map((p) => {
            const kind = placeKindOf(p.id);
            const active = selection?.kind === 'place' && selection.id === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => select({ kind: 'place', id: p.id })}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 6px',
                  fontSize: 12,
                  textAlign: 'left',
                  cursor: 'pointer',
                  borderRadius: 4,
                  border: 'none',
                  background: active ? '#1c2f4a' : 'transparent',
                  color: 'inherit',
                }}
              >
                <i style={{ width: 10, height: 10, flexShrink: 0, background: kind !== null ? kindColor(kind) : '#94b0c2' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                <span style={{ marginLeft: 'auto', color: '#94b0c2', flexShrink: 0 }}>
                  {p.w}×{p.h}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        铺装 {doc.paths.length} · 围栏 {(doc.fences ?? []).length} · 资源 {(doc.resources ?? []).length} · 障碍{' '}
        {doc.blockedRects.length}
      </Typography.Text>
    </div>
  );
}
