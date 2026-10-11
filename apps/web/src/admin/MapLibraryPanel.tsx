import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Drawer,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Segmented,
  Space,
  Table,
  Tag,
  Tooltip,
  type TableColumnsType,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import {
  GAME_TYPES,
  GAME_TYPE_LABELS,
  MAP_STATUS_LABELS,
  TOWN_MAP,
  WORLDGEN_SIZES,
  WORLDGEN_SIZE_GRIDS,
  type GameType,
  type MapDetailResponse,
  type MapStatus,
  type MapSummaryItem,
  type TileMapDefinition,
  type WorldgenSize,
} from '@sims/shared';
import {
  ApiError,
  archiveMap,
  deleteMap,
  fetchMap,
  fetchMaps,
  generateMap,
  publishMap,
} from './api';
import { formatTime } from './CurrentWorldCard';
import { MapPreviewCanvas } from './MapPreviewCanvas';
import { MapEditorPanel, type MapEditorLaunch } from './map-editor/MapEditorPanel';

const STATUS_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已发布' },
  { value: 'archived', label: '已归档' },
] as const;

const STATUS_TAG_COLOR: Record<MapStatus, string> = {
  draft: 'default',
  published: 'gold',
  archived: 'purple',
};

interface CreateFormValues {
  name: string;
  description?: string;
  source: 'blank' | 'builtin' | 'random';
  seed?: number;
  gameType: GameType;
  size: WorldgenSize;
}

/** 空白起步图:24x18 草坪+一个门洞小屋(保证 createWorld 语义校验可通过的最小可玩图) */
function blankDefinition(): TileMapDefinition {
  return {
    width: 24,
    height: 18,
    blockedRects: [],
    paths: [{ x: 11, y: 6, w: 2, h: 10 }],
    places: [
      {
        id: 'home-1',
        name: '小屋',
        x: 8,
        y: 2,
        w: 8,
        h: 6,
        entrance: { x: 11, y: 8 },
        door: { x: 11, y: 7 },
        furniture: [{ kind: 'bed', x: 9, y: 3, w: 2, h: 3, activityId: 'rest', use: { x: 9, y: 6 } }],
      },
    ],
  };
}

/** 地图库面板(MS-1):自定义地图列表/预览/状态机/删除;编辑器入口批B 接入 */
export function MapLibraryPanel() {
  const { message } = AntdApp.useApp();
  const [items, setItems] = useState<MapSummaryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | MapStatus>('all');
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm<CreateFormValues>();
  const [preview, setPreview] = useState<MapDetailResponse | null>(null);
  const [editing, setEditing] = useState<MapEditorLaunch | null>(null);
  const source = Form.useWatch('source', createForm) ?? 'builtin';

  const load = useCallback(async () => {
    try {
      const body = await fetchMaps();
      setItems(body.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载地图列表失败');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = (items ?? []).filter((m) => filter === 'all' || m.status === filter);

  const openPreview = async (id: string): Promise<void> => {
    try {
      setPreview(await fetchMap(id));
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载地图失败');
    }
  };

  const transition = async (action: 'publish' | 'archive', item: MapSummaryItem): Promise<void> => {
    setBusy(true);
    try {
      await (action === 'publish' ? publishMap(item.id) : archiveMap(item.id));
      message.success(action === 'publish' ? `「${item.name}」已发布,创建世界时可选` : `「${item.name}」已归档`);
      void load();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: MapSummaryItem): Promise<void> => {
    setBusy(true);
    try {
      await deleteMap(item.id);
      message.success(`已删除「${item.name}」(存量世界使用创建时快照,不受影响)`);
      void load();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };

  const openEditor = async (item: MapSummaryItem): Promise<void> => {
    try {
      const detail = await fetchMap(item.id);
      setEditing({
        mapId: detail.id,
        name: detail.name,
        ...(detail.description ? { description: detail.description } : {}),
        definition: detail.definition,
      });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载地图失败');
    }
  };

  /** 三来源统一进编辑器(不落库):空白/内置/随机生成;保存时才走创建 API */
  const submitCreate = async (values: CreateFormValues): Promise<void> => {
    setBusy(true);
    try {
      let definition: TileMapDefinition;
      if (values.source === 'random') {
        const generated = await generateMap({
          ...(values.seed !== undefined ? { seed: values.seed } : {}),
          gameType: values.gameType,
          size: values.size,
        });
        definition = generated.map;
        message.info(`已按种子 ${generated.seed} 生成布局`);
      } else {
        definition = values.source === 'builtin' ? structuredClone(TOWN_MAP) : blankDefinition();
      }
      setCreateOpen(false);
      createForm.resetFields();
      setEditing({
        mapId: null,
        name: values.name.trim(),
        ...(values.description?.trim() ? { description: values.description.trim() } : {}),
        definition,
      });
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : '生成失败');
    } finally {
      setBusy(false);
    }
  };

  const columns: TableColumnsType<MapSummaryItem> = [
    {
      title: '地图',
      dataIndex: 'name',
      render: (name: string, item) => (
        <Flex vertical>
          <span>{name}</span>
          {item.description && (
            <span style={{ fontSize: 12, color: 'var(--px-dim)' }}>{item.description}</span>
          )}
        </Flex>
      ),
    },
    {
      title: '尺寸',
      width: 90,
      render: (_, item) =>
        item.stats ? `${item.stats.width}×${item.stats.height}` : item.sizePreset,
    },
    { title: '场所', width: 70, render: (_, item) => `${item.stats?.placeCount ?? 0} 个` },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (status: MapStatus) => (
        <Tag color={STATUS_TAG_COLOR[status]}>{MAP_STATUS_LABELS[status]}</Tag>
      ),
    },
    {
      title: '更新',
      width: 150,
      render: (_, item) => (
        <span style={{ fontSize: 12, color: 'var(--px-dim)' }}>{formatTime(item.updatedAt)}</span>
      ),
    },
    {
      title: '操作',
      width: 300,
      render: (_, item) => (
        <Space size={4}>
          <Button size="small" icon={<EyeOutlined />} onClick={() => void openPreview(item.id)}>
            预览
          </Button>
          <Tooltip title="在编辑器中打开(保存走草稿门禁)">
            <Button
              size="small"
              icon={<EditOutlined />}
              disabled={busy}
              onClick={() => void openEditor(item)}
            >
              编辑
            </Button>
          </Tooltip>
          {item.status === 'draft' && (
            <Tooltip title="体检通过才可发布;发布后创建世界可选">
              <Button
                size="small"
                type="primary"
                ghost
                icon={<RocketOutlined />}
                disabled={busy}
                onClick={() => void transition('publish', item)}
              >
                发布
              </Button>
            </Tooltip>
          )}
          {item.status === 'published' && (
            <Button size="small" disabled={busy} onClick={() => void transition('archive', item)}>
              归档
            </Button>
          )}
          <Popconfirm
            title={`删除地图「${item.name}」?`}
            description="已创建的世界使用创建时快照,不受影响。"
            okButtonProps={{ danger: true }}
            okText="删除"
            onConfirm={() => void remove(item)}
          >
            <Button danger size="small" icon={<DeleteOutlined />} disabled={busy} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (editing !== null) {
    return (
      <MapEditorPanel
        launch={editing}
        onBack={() => {
          setEditing(null);
          void load();
        }}
      />
    );
  }

  return (
    <Flex vertical gap={16}>
      {error && <Alert type="error" showIcon message={error} />}
      <Card
        title="地图库"
        extra={
          <Space>
            <Segmented
              options={STATUS_FILTERS as unknown as string[]}
              value={filter}
              onChange={(value) => setFilter(value as 'all' | MapStatus)}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateOpen(true)}
            >
              新建地图
            </Button>
          </Space>
        }
      >
        {items === null ? (
          <div style={{ padding: 24, color: 'var(--px-dim)' }}>加载中…</div>
        ) : visible.length === 0 ? (
          <Empty description="暂无地图——新建一张或从内置图起步" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table<MapSummaryItem>
            size="small"
            rowKey="id"
            columns={columns}
            dataSource={visible}
            pagination={false}
            scroll={{ x: 'max-content' }}
          />
        )}
      </Card>

      <Modal
        title="新建地图"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void createForm.validateFields().then(() => void submitCreate(createForm.getFieldsValue(true)))}
        confirmLoading={busy}
        okText="起步并编辑"
      >
        <Form
          form={createForm}
          layout="vertical"
          requiredMark={false}
          initialValues={{ source: 'builtin', gameType: 'growth', size: 'small' }}
        >
          <Form.Item
            name="name"
            label="地图名"
            rules={[
              { required: true, message: '地图名不能为空' },
              { max: 40, message: '至多 40 字' },
            ]}
          >
            <Input maxLength={40} placeholder="如: 河谷小镇" />
          </Form.Item>
          <Form.Item name="description" label="描述" style={{ marginBottom: 12 }}>
            <Input maxLength={200} placeholder="一句话描述布局意图(可选)" />
          </Form.Item>
          <Form.Item name="source" label="起步来源">
            <Radio.Group
              options={[
                { value: 'builtin', label: '复制内置经典小镇(推荐起步)' },
                { value: 'blank', label: '空白地图(自建)' },
                { value: 'random', label: '随机生成(种子可复现)' },
              ]}
            />
          </Form.Item>
          {source === 'random' && (
            <Flex gap={16} wrap="wrap">
              <Form.Item name="seed" label="种子(留空随机)" style={{ marginBottom: 12, minWidth: 160 }}>
                <InputNumber min={0} max={9999999999} precision={0} style={{ width: '100%' }} placeholder="如 20261011" />
              </Form.Item>
              <Form.Item name="gameType" label="世界类型" style={{ marginBottom: 12 }}>
                <Radio.Group
                  options={GAME_TYPES.map((g) => ({ value: g, label: GAME_TYPE_LABELS[g] }))}
                />
              </Form.Item>
              <Form.Item name="size" label="尺寸档" style={{ marginBottom: 12 }}>
                <Radio.Group
                  options={WORLDGEN_SIZES.map((s) => ({
                    value: s,
                    label: `${s === 'small' ? '小' : s === 'medium' ? '中' : '大'} ${WORLDGEN_SIZE_GRIDS[s].width}×${WORLDGEN_SIZE_GRIDS[s].height}`,
                  }))}
                />
              </Form.Item>
            </Flex>
          )}
        </Form>
      </Modal>

      <Drawer
        title={preview !== null ? `预览 · ${preview.name}` : '预览'}
        width={720}
        open={preview !== null}
        onClose={() => setPreview(null)}
        destroyOnHidden
      >
        {preview !== null && (
          <Flex vertical gap={12}>
            <MapPreviewCanvas definition={preview.definition} grid />
            <p style={{ margin: 0, fontSize: 12, color: 'var(--px-dim)' }}>
              {preview.stats?.width}×{preview.stats?.height} · {preview.stats?.placeCount} 个场所 ·
              语义色块渲染(游戏内为像素贴图)
            </p>
          </Flex>
        )}
      </Drawer>
    </Flex>
  );
}
