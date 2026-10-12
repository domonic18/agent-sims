/**
 * 属性面板(批B+问题1重构):按选区类型编辑对象字段,每次只呈现选中对象的
 * 字段(家具级点选有独立精简面板,不再整屋堆叠)。所有变更走 commit 且带
 * coalesce 键(逐键输入合并为一条 undo 命令);家具直接编辑自身节点。
 */
import { Alert, Button, Input, InputNumber, Select, Typography } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { ACTIVITY_IDS, type FurnitureDefinition, type PlaceDefinition } from '@sims/shared';
import { FURNITURE_KINDS, FURNITURE_LABELS, furnitureLabel } from '@sims/shared';
import { getAtPath, type Path } from './history';
import { selectionPath, useEditor } from './editorStore';
import type { HealthFinding } from './health';
import { placeKindOf } from './kinds';

/** 当前对象的体检告警(随 doc 实时重算,修复即消失) */
function ObjectAlert({ findings }: { findings: HealthFinding[] }) {
  if (findings.length === 0) return null;
  const hasError = findings.some((f) => f.level === 'error');
  return (
    <Alert
      type={hasError ? 'error' : 'warning'}
      showIcon
      style={{ fontSize: 12 }}
      message={findings.map((f) => f.message).join('；')}
    />
  );
}

const ROW = { display: 'flex', alignItems: 'center', gap: 6 } as const;
const CELL = { width: 68 } as const;

function NumField({
  label,
  value,
  min = 0,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={ROW}>
      <span style={{ fontSize: 12, color: '#94b0c2', width: 18 }}>{label}</span>
      <InputNumber
        size="small"
        min={min}
        value={value}
        style={CELL}
        onChange={(v) => {
          if (typeof v === 'number') onChange(v);
        }}
      />
    </label>
  );
}

function RectFields({
  rect,
  maxWidth,
  maxHeight,
  onChange,
}: {
  rect: { x: number; y: number; w: number; h: number };
  maxWidth: number;
  maxHeight: number;
  onChange: (patch: Partial<{ x: number; y: number; w: number; h: number }>) => void;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, auto)', gap: 4 }}>
      <NumField label="X" value={rect.x} onChange={(v) => onChange({ x: v })} />
      <NumField label="Y" value={rect.y} onChange={(v) => onChange({ y: v })} />
      <NumField
        label="W"
        value={rect.w}
        min={1}
        onChange={(v) => onChange({ w: Math.min(v, maxWidth) })}
      />
      <NumField
        label="H"
        value={rect.h}
        min={1}
        onChange={(v) => onChange({ h: Math.min(v, maxHeight) })}
      />
    </div>
  );
}

function PlaceForm({
  place,
  index,
  findings,
}: {
  place: PlaceDefinition;
  index: number;
  findings: HealthFinding[];
}) {
  const doc = useEditor((s) => s.doc);
  const commit = useEditor((s) => s.commit);
  const select = useEditor((s) => s.select);
  const coalesce = (field: string): string => `place:${place.id}:${field}`;
  const myFindings = findings.filter((f) => f.placeIds?.[0] === place.id && f.furnitureIndex === undefined);

  const update = (patch: Partial<PlaceDefinition>, label: string, key?: string): void => {
    const before = doc.places[index];
    if (before === undefined) return;
    commit({
      kind: 'update',
      label,
      path: ['places', index],
      before,
      after: { ...before, ...patch },
      ...(key !== undefined ? { coalesce: key } : {}),
    });
  };
  const removePlace = (): void => {
    const before = doc.places[index];
    if (before === undefined) return;
    commit({ kind: 'remove', label: `删「${before.name}」`, path: ['places', index], before, after: null });
    select(null);
  };

  const furniture = place.furniture ?? [];
  const addBed = (): void => {
    const before = doc.places[index];
    if (before === undefined) return;
    commit({
      kind: 'add',
      label: '加床铺',
      path: ['places', index, 'furniture', furniture.length],
      before: null,
      after: {
        kind: 'bed',
        x: before.x + 1,
        y: before.y + 1,
        w: 1,
        h: 1,
        activityId: 'rest',
        use: { x: before.x + 1, y: before.y + 2 },
      },
    });
    select({ kind: 'furniture', placeId: before.id, index: furniture.length });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
      <div style={ROW}>
        <span style={{ color: '#94b0c2' }}>{placeKindOf(place.id) ?? '场所'}</span>
        <span style={{ color: '#566c86' }}>{place.id}</span>
      </div>
      <ObjectAlert findings={myFindings} />
      <div style={ROW}>
        <span style={{ fontSize: 12, color: '#94b0c2', width: 30 }}>名称</span>
        <Input
          size="small"
          value={place.name}
          onChange={(e) => update({ name: e.target.value }, '改名称', coalesce('name'))}
        />
      </div>
      <RectFields
        rect={place}
        maxWidth={doc.width}
        maxHeight={doc.height}
        
        onChange={(patch) => update(patch, '改占地', coalesce(`rect:${Object.keys(patch)[0]}`))}
      />
      <div>
        <Typography.Text type="secondary">入口(占地外可行走格)</Typography.Text>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, auto)', gap: 4, marginTop: 2 }}>
          <NumField
            label="X"
            value={place.entrance.x}
            
            onChange={(v) => update({ entrance: { ...place.entrance, x: v } }, '改入口', coalesce('enx'))}
          />
          <NumField
            label="Y"
            value={place.entrance.y}
            
            onChange={(v) => update({ entrance: { ...place.entrance, y: v } }, '改入口', coalesce('eny'))}
          />
        </div>
      </div>
      <div>
        <Typography.Text type="secondary">门洞(占地边缘,可选)</Typography.Text>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 2 }}>
          {place.door !== undefined ? (
            <>
              <NumField
                label="X"
                value={place.door.x}
                
                onChange={(v) => update({ door: { ...place.door!, x: v } }, '改门洞', coalesce('drx'))}
              />
              <NumField
                label="Y"
                value={place.door.y}
                
                onChange={(v) => update({ door: { ...place.door!, y: v } }, '改门洞', coalesce('dry'))}
              />
              <Button size="small" type="text" onClick={() => update({ door: undefined }, '删门洞')}>
                移除
              </Button>
            </>
          ) : (
            <Button
              size="small"
              onClick={() => update({ door: { x: place.x + Math.floor((place.w - 1) / 2), y: place.y + place.h - 1 } }, '补门洞')}
            >
              底边补门洞
            </Button>
          )}
        </div>
      </div>
      <div>
        <div style={{ ...ROW, justifyContent: 'space-between' }}>
          <Typography.Text type="secondary">家具({furniture.length})</Typography.Text>
          <Button size="small" onClick={addBed}>
            加床铺起步
          </Button>
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          屋内物品请在画布单独点选/拖拽,选中后在此精简编辑
        </Typography.Text>
      </div>
      <Button danger size="small" icon={<DeleteOutlined />} onClick={removePlace}>
        删除场所
      </Button>
    </div>
  );
}

/** 家具独立面板(问题1):只呈现选中单件家具的字段,内嵌本件家具的体检告警 */
function FurnitureForm({
  place,
  furn,
  placeIndex,
  furnIndex,
  findings,
}: {
  place: PlaceDefinition;
  furn: FurnitureDefinition;
  placeIndex: number;
  furnIndex: number;
  findings: HealthFinding[];
}) {
  const doc = useEditor((s) => s.doc);
  const commit = useEditor((s) => s.commit);
  const select = useEditor((s) => s.select);
  const path: Path = ['places', placeIndex, 'furniture', furnIndex];
  const coalesce = (f: string): string => `furn:${place.id}:${furnIndex}:${f}`;
  const update = (patch: Partial<FurnitureDefinition>, label: string, key?: string): void => {
    commit({
      kind: 'update',
      label,
      path,
      before: furn,
      after: { ...furn, ...patch },
      ...(key !== undefined ? { coalesce: key } : {}),
    });
  };
  const label = furnitureLabel(furn.kind);
  const usePt = furn.use ?? { x: furn.x, y: furn.y + furn.h };
  const myFindings = findings.filter((f) => f.placeIds?.[0] === place.id && f.furnitureIndex === furnIndex);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
      <div style={ROW}>
        <span style={{ color: '#94b0c2' }}>家具 · {label}</span>
        <span style={{ color: '#566c86' }}>{place.name}</span>
      </div>
      <ObjectAlert findings={myFindings} />
      <div style={ROW}>
        <span style={{ fontSize: 12, color: '#94b0c2', width: 30 }}>种类</span>
        <Select
          size="small"
          value={furn.kind}
          style={{ width: 130 }}
          options={FURNITURE_KINDS.map((k) => ({ value: k, label: FURNITURE_LABELS[k] ?? k }))}
          onChange={(v) => update({ kind: v }, '改家具种类', coalesce('kind'))}
        />
      </div>
      <RectFields
        rect={furn}
        maxWidth={doc.width}
        maxHeight={doc.height}
        onChange={(patch) => update(patch, '改家具占地', coalesce(`rect:${Object.keys(patch)[0]}`))}
      />
      <div>
        <Typography.Text type="secondary">活动(使用家具触发的行为)</Typography.Text>
        <div style={{ marginTop: 2 }}>
          <Select
            size="small"
            value={furn.activityId}
            style={{ width: '100%' }}
            placeholder="未关联活动"
            allowClear
            options={ACTIVITY_IDS.map((a) => ({ value: a, label: a }))}
            onChange={(v) => update({ activityId: v }, '改活动', coalesce('act'))}
          />
        </div>
      </div>
      <div>
        <Typography.Text type="secondary">使用格(邻接占地的可行走格)</Typography.Text>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, auto)', gap: 4, marginTop: 2 }}>
          <NumField
            label="X"
            value={usePt.x}
            onChange={(v) => update({ use: { x: v, y: usePt.y } }, '改使用格', coalesce('ux'))}
          />
          <NumField
            label="Y"
            value={usePt.y}
            onChange={(v) => update({ use: { x: usePt.x, y: v } }, '改使用格', coalesce('uy'))}
          />
        </div>
      </div>
      <Button
        danger
        size="small"
        icon={<DeleteOutlined />}
        onClick={() => {
          commit({ kind: 'remove', label: `删${label}`, path, before: furn, after: null });
          select({ kind: 'place', id: place.id });
        }}
      >
        删除家具
      </Button>
    </div>
  );
}

export function PropertiesPanel({ findings = [] }: { findings?: HealthFinding[] }) {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const commit = useEditor((s) => s.commit);
  const select = useEditor((s) => s.select);

  if (selection === null) {
    return <Typography.Text type="secondary">点选画布或图层面板中的对象后在此编辑</Typography.Text>;
  }
  const path = selectionPath(doc, selection);
  if (path === null) {
    return <Typography.Text type="secondary">对象已被删除</Typography.Text>;
  }
  const obj = getAtPath(doc, path);
  if (obj === undefined || obj === null) {
    return <Typography.Text type="secondary">对象已被删除</Typography.Text>;
  }

  if (selection.kind === 'place') {
    const index = path[1] as number;
    return <PlaceForm place={obj as PlaceDefinition} index={index} findings={findings} />;
  }

  if (selection.kind === 'furniture') {
    const placeIndex = path[1] as number;
    const place = doc.places[placeIndex];
    if (place === undefined) {
      return <Typography.Text type="secondary">对象已被删除</Typography.Text>;
    }
    return (
      <FurnitureForm
        place={place}
        furn={obj as FurnitureDefinition}
        placeIndex={placeIndex}
        furnIndex={path[3] as number}
        findings={findings}
      />
    );
  }

  if (selection.kind === 'path' || selection.kind === 'fence' || selection.kind === 'blocked') {
    const target = selection.kind === 'path' ? 'paths' : selection.kind === 'fence' ? 'fences' : 'blockedRects';
    const label = selection.kind === 'path' ? '铺装' : selection.kind === 'fence' ? '围栏' : '障碍';
    const index = path[1] as number;
    const rect = obj as { x: number; y: number; w: number; h: number };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
        <Typography.Text type="secondary">{label} #{index}</Typography.Text>
        <RectFields
          rect={rect}
          maxWidth={doc.width}
          maxHeight={doc.height}
          onChange={(patch) =>
            commit({
              kind: 'update',
              label: `改${label}`,
              path: [target, index],
              before: rect,
              after: { ...rect, ...patch },
              coalesce: `${target}:${index}:${Object.keys(patch)[0]}`,
            })
          }
        />
        <Button
          danger
          size="small"
          icon={<DeleteOutlined />}
          onClick={() => {
            commit({ kind: 'remove', label: `删${label}`, path: [target, index], before: rect, after: null });
            select(null);
          }}
        >
          删除{label}
        </Button>
      </div>
    );
  }

  if (selection.kind === 'resource') {
    const index = path[1] as number;
    const res = obj as { kind: string; x: number; y: number };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
        <Typography.Text type="secondary">资源节点 #{index}</Typography.Text>
        <div style={ROW}>
          <span style={{ fontSize: 12, color: '#94b0c2', width: 30 }}>种类</span>
          <Input size="small" value={res.kind} disabled />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, auto)', gap: 4 }}>
          <NumField
            label="X"
            value={res.x}
            onChange={(v) =>
              commit({
                kind: 'update',
                label: '改资源位置',
                path: ['resources', index],
                before: res,
                after: { ...res, x: v },
                coalesce: `res:${index}:x`,
              })
            }
          />
          <NumField
            label="Y"
            value={res.y}
            onChange={(v) =>
              commit({
                kind: 'update',
                label: '改资源位置',
                path: ['resources', index],
                before: res,
                after: { ...res, y: v },
                coalesce: `res:${index}:y`,
              })
            }
          />
        </div>
        <Button
          danger
          size="small"
          icon={<DeleteOutlined />}
          onClick={() => {
            commit({ kind: 'remove', label: '删资源', path: ['resources', index], before: res, after: null });
            select(null);
          }}
        >
          删除资源
        </Button>
      </div>
    );
  }

  // decor 点
  const index = path[2] as number;
  const point = obj as [number, number];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
      <Typography.Text type="secondary">装饰({selection.kind === 'decor' ? selection.group : ''}) #{index}</Typography.Text>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, auto)', gap: 4 }}>
        <NumField
          label="X"
          value={point[0]}
          onChange={(v) =>
            commit({
              kind: 'update',
              label: '改装饰位置',
              path: ['decor', selection.kind === 'decor' ? selection.group : 'trees', index],
              before: point,
              after: [v, point[1]],
              coalesce: `dec:${index}:x`,
            })
          }
        />
        <NumField
          label="Y"
          value={point[1]}
          onChange={(v) =>
            commit({
              kind: 'update',
              label: '改装饰位置',
              path: ['decor', selection.kind === 'decor' ? selection.group : 'trees', index],
              before: point,
              after: [point[0], v],
              coalesce: `dec:${index}:y`,
            })
          }
        />
      </div>
      <Button
        danger
        size="small"
        icon={<DeleteOutlined />}
        onClick={() => {
          commit({
            kind: 'remove',
            label: '删装饰',
            path: ['decor', selection.kind === 'decor' ? selection.group : 'trees', index],
            before: point,
            after: null,
          });
          select(null);
        }}
      >
        删除装饰
      </Button>
    </div>
  );
}
