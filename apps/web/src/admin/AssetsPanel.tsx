import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App as AntdApp,
  Button,
  Card,
  Descriptions,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tree,
  Tooltip,
  type TreeDataNode,
} from 'antd';
import {
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import type { AssetAdminView, AssetCategoryView, AssetStatus } from '@sims/shared';
import {
  bulkAssetStatus,
  createAssetCategory,
  deleteAssetCategory,
  fetchAssetCategories,
  fetchAssetImage,
  fetchAssets,
  publishAssets,
  renameAssetCategory,
  updateAsset,
} from './api';
import { SpriteInspector } from './SpriteInspector';

const STATUS_LABELS: Record<AssetStatus, { text: string; color: string }> = {
  draft: { text: '待校验', color: 'orange' },
  active: { text: '已启用', color: 'green' },
  retired: { text: '已下架', color: 'default' },
};

const LEVEL_NAMES = ['域', '主题', '类别'];

interface CategoryTreeNode extends TreeDataNode {
  key: number;
  category: AssetCategoryView;
}

/** 素材管理面板(M-L.2):左树(分类 CRUD)右表(筛选/批量/详情校验/发布) */
export function AssetsPanel() {
  const { message, modal } = AntdApp.useApp();
  const [categories, setCategories] = useState<AssetCategoryView[] | null>(null);
  const [items, setItems] = useState<AssetAdminView[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [categoryId, setCategoryId] = useState<number | undefined>(undefined);
  const [status, setStatus] = useState<AssetStatus | ''>('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [detail, setDetail] = useState<AssetAdminView | null>(null);
  const [detailImage, setDetailImage] = useState<string | null>(null);
  const [thumbUrls, setThumbUrls] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState(false);
  const [categoryModal, setCategoryModal] = useState<{
    parent: AssetCategoryView | null;
  } | null>(null);
  const [categoryForm] = Form.useForm();
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cats, list] = await Promise.all([
        fetchAssetCategories(),
        fetchAssets({ categoryId, status: status || undefined, q: keyword, page, pageSize: 50 }),
      ]);
      setCategories(cats);
      setItems(list.items);
      setTotal(list.total);
      const missing = list.items.filter((item) => thumbUrls[item.id] === undefined);
      if (missing.length > 0) {
        const urls = await Promise.all(missing.map((item) => fetchAssetImage(item.id)));
        setThumbUrls((prev) => {
          const next = { ...prev };
          missing.forEach((item, index) => {
            next[item.id] = urls[index]!;
          });
          return next;
        });
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [categoryId, status, keyword, page, message, thumbUrls]);

  useEffect(() => {
    void load();
    // thumbUrls 为会话级缓存,刻意不进依赖(缓存 miss 由 fetchAssetImage 兜底)
  }, [categoryId, status, keyword, page]);

  const treeData = useMemo<CategoryTreeNode[]>(() => {
    const build = (parentId: number | null): CategoryTreeNode[] =>
      (categories ?? [])
        .filter((cat) => cat.parentId === parentId)
        .map((cat) => ({
          key: cat.id,
          category: cat,
          title: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span>
                {cat.name}
                {cat.assetCount > 0 && (
                  <span style={{ color: '#999', fontSize: 12 }}> ({cat.assetCount})</span>
                )}
              </span>
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    ...(cat.level < 2
                      ? [
                          {
                            key: 'add-child',
                            icon: <EditOutlined />,
                            label: '新增子分类',
                            onClick: () => openCategoryModal(cat),
                          },
                        ]
                      : []),
                    {
                      key: 'rename',
                      icon: <EditOutlined />,
                      label: '重命名',
                      onClick: () => openRenameModal(cat),
                    },
                    { type: 'divider' as const },
                    {
                      key: 'delete',
                      icon: <DeleteOutlined />,
                      danger: true,
                      label: '删除',
                      onClick: () => confirmDeleteCategory(cat),
                    },
                  ],
                }}
              >
                <Button
                  type="text"
                  size="small"
                  icon={<span style={{ fontSize: 10, color: '#999' }}>⋯</span>}
                  style={{ padding: '0 2px', height: 18 }}
                  onClick={(e) => e.stopPropagation()}
                />
              </Dropdown>
            </span>
          ),
          children: build(cat.id),
        }));
    return build(null);
  }, [categories]);

  const openCategoryModal = (parent?: AssetCategoryView): void => {
    setCategoryModal({ parent: parent ?? null });
    categoryForm.resetFields();
  };

  const submitCategory = async (): Promise<void> => {
    if (categoryModal === null) return;
    const values = await categoryForm.validateFields();
    await createAssetCategory(values.name, values.slug, categoryModal.parent?.id ?? null);
    message.success('分类已创建');
    setCategoryModal(null);
    void load();
  };

  const openRenameModal = (cat: AssetCategoryView) => {
    let value = cat.name;
    modal.confirm({
      title: `重命名${LEVEL_NAMES[cat.level]}「${cat.name}」`,
      content: (
        <Input
          defaultValue={cat.name}
          onChange={(e) => {
            value = e.target.value;
          }}
        />
      ),
      okText: '保存',
      cancelText: '取消',
      onOk: async () => {
        await renameAssetCategory(cat.id, value);
        message.success('已重命名');
        void load();
      },
    });
  };

  const confirmDeleteCategory = (cat: AssetCategoryView) => {
    modal.confirm({
      title: `删除${LEVEL_NAMES[cat.level]}「${cat.name}」?`,
      content: '仅可删除空分类(无子分类且无素材)。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteAssetCategory(cat.id);
          message.success('已删除');
          if (categoryId === cat.id) setCategoryId(undefined);
          void load();
        } catch (err) {
          message.error(err instanceof Error ? err.message : '删除失败');
        }
      },
    });
  };

  const openDetail = async (asset: AssetAdminView) => {
    setDetail(asset);
    setEditing(false);
    setDetailImage(null);
    try {
      setDetailImage(await fetchAssetImage(asset.id));
    } catch {
      setDetailImage(null);
    }
  };

  const startEdit = () => {
    if (detail === null) return;
    setEditing(true);
    form.setFieldsValue({
      name: detail.name,
      gridW: detail.gridW,
      gridH: detail.gridH,
      anchor: detail.anchor,
      tier: detail.tier,
      tags: detail.tags.join(', '),
      status: detail.status,
    });
  };

  const saveEdit = async () => {
    if (detail === null) return;
    const values = await form.validateFields();
    await updateAsset(detail.id, {
      name: values.name,
      gridW: values.gridW,
      gridH: values.gridH,
      anchor: values.anchor,
      tier: values.tier,
      tags: (values.tags as string)
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag !== ''),
      status: values.status,
    });
    message.success('已保存');
    setEditing(false);
    await openDetail({ ...detail, ...values, tags: values.tags });
    void load();
  };

  const bulkStatus = async (target: AssetStatus) => {
    if (selectedIds.length === 0) return;
    const result = await bulkAssetStatus(selectedIds, target);
    message.success(`已更新 ${result.updated} 件`);
    setSelectedIds([]);
    void load();
  };

  const publish = async () => {
    try {
      const result = await publishAssets();
      message.success(`已发布 ${result.assetCount} 件 (version=${result.version})`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '发布失败');
    }
  };

  const statusTag = (asset: AssetAdminView): React.ReactNode => {
    const meta = STATUS_LABELS[asset.status];
    return <Tag color={meta.color}>{meta.text}</Tag>;
  };

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <Card
        size="small"
        title="分类"
        style={{ width: 240, flexShrink: 0 }}
        extra={
          <Tooltip title="新增顶层域">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openCategoryModal()} />
          </Tooltip>
        }
      >
        {categories === null ? (
          <p style={{ color: '#999' }}>加载中…</p>
        ) : (
          <Tree
            blockNode
            defaultExpandAll
            selectedKeys={categoryId !== undefined ? [categoryId] : []}
            treeData={treeData}
            onSelect={(keys) => {
              const key = keys[0];
              setCategoryId(typeof key === 'number' ? key : undefined);
              setPage(1);
            }}
          />
        )}
      </Card>

      <Card
        size="small"
        title={`素材库(${total})`}
        style={{ flex: 1, minWidth: 0 }}
        extra={
          <Space>
            <Button
              size="small"
              icon={<SearchOutlined />}
              onClick={() => {
                setPage(1);
                void load();
              }}
            >
              查询
            </Button>
            <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()} />
            <Popconfirm title="将 active 素材重建发布到游戏产物,继续?" onConfirm={() => void publish()}>
              <Button size="small" type="primary" icon={<CloudUploadOutlined />}>
                发布到游戏
              </Button>
            </Popconfirm>
          </Space>
        }
      >
        <Space style={{ marginBottom: 12 }} wrap>
          <Select<AssetStatus | ''>
            style={{ width: 120 }}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={[
              { value: '', label: '全部状态' },
              { value: 'draft', label: '待校验' },
              { value: 'active', label: '已启用' },
              { value: 'retired', label: '已下架' },
            ]}
          />
          <Input
            style={{ width: 200 }}
            placeholder="名称/slug 搜索"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={() => {
              setPage(1);
              void load();
            }}
            allowClear
          />
          {selectedIds.length > 0 && (
            <Popconfirm title={`启用选中 ${selectedIds.length} 件?`} onConfirm={() => void bulkStatus('active')}>
              <Button size="small" type="primary">
                批量启用({selectedIds.length})
              </Button>
            </Popconfirm>
          )}
          {selectedIds.length > 0 && (
            <Button size="small" onClick={() => void bulkStatus('retired')}>
              批量下架
            </Button>
          )}
        </Space>
        <Table<AssetAdminView>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={items}
          rowSelection={{
            selectedRowKeys: selectedIds,
            onChange: (keys) => setSelectedIds(keys as number[]),
          }}
          pagination={{
            current: page,
            pageSize: 50,
            total,
            showSizeChanger: false,
            onChange: setPage,
          }}
          onRow={(record) => ({ onClick: () => void openDetail(record), style: { cursor: 'pointer' } })}
          columns={[
            {
              title: '预览',
              width: 64,
              render: (_, record) =>
                thumbUrls[record.id] !== undefined ? (
                  <img
                    src={thumbUrls[record.id]}
                    alt={record.slug}
                    style={{
                      maxWidth: 48,
                      maxHeight: 48,
                      imageRendering: 'pixelated',
                      background:
                        'repeating-conic-gradient(#eee 0% 25%, #fafafa 0% 50%) 0 0 / 8px 8px',
                    }}
                  />
                ) : (
                  <span style={{ color: '#ccc', fontSize: 12 }}>…</span>
                ),
            },
            { title: '名称', dataIndex: 'name', width: 120 },
            {
              title: 'slug',
              dataIndex: 'slug',
              width: 130,
              render: (slug: string) => (
                <code style={{ fontSize: 12 }}>{slug}</code>
              ),
            },
            { title: '分类', dataIndex: 'categorySlug', width: 90 },
            {
              title: '尺寸',
              width: 90,
              render: (_, record) => (
                <span style={{ fontSize: 12 }}>
                  {record.width}×{record.height}
                </span>
              ),
            },
            {
              title: '占地',
              width: 60,
              render: (_, record) => (
                <span style={{ fontSize: 12 }}>
                  {record.gridW}×{record.gridH}
                </span>
              ),
            },
            { title: '等级', dataIndex: 'tier', width: 55 },
            { title: '状态', width: 80, render: statusTag },
          ]}
          locale={{ emptyText: <Empty description="该分类下暂无素材" /> }}
        />
      </Card>

      <Drawer
        title={detail === null ? '' : `${detail.name}(${detail.slug})`}
        width={480}
        open={detail !== null}
        onClose={() => setDetail(null)}
        destroyOnClose
      >
        {detail !== null && (
          <>
            {detailImage !== null ? (
              <SpriteInspector
                url={detailImage}
                width={detail.width}
                height={detail.height}
                anim={detail.anim}
              />
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
                <Space>
                  <Button type="primary" onClick={() => void saveEdit()}>
                    保存
                  </Button>
                  <Button onClick={() => setEditing(false)}>取消</Button>
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
                <Button type="primary" style={{ marginTop: 12 }} onClick={startEdit}>
                  编辑元数据
                </Button>
              </>
            )}
          </>
        )}
      </Drawer>
      <Modal
        title={`新增${categoryModal?.parent ? `${LEVEL_NAMES[categoryModal.parent.level]}的子` : '顶层'}分类`}
        open={categoryModal !== null}
        onCancel={() => setCategoryModal(null)}
        onOk={() => void submitCategory()}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        {categoryModal?.parent !== undefined && categoryModal?.parent !== null && (
          <p style={{ fontSize: 12, color: '#57606a' }}>
            父分类: {categoryModal.parent.name}(slug 创建后不可改)
          </p>
        )}
        <Form form={categoryForm} layout="vertical">
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '名称不能为空' }, { max: 30 }]}
          >
            <Input placeholder="如: 卧室 / 床" />
          </Form.Item>
          <Form.Item
            name="slug"
            label="slug(小写字母/数字/连字符,创建后不可改)"
            rules={[
              { required: true, message: 'slug 不能为空' },
              { pattern: /^[a-z][a-z0-9-]*$/, message: '仅小写字母/数字/连字符' },
            ]}
          >
            <Input placeholder="如: bedroom / bed" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
