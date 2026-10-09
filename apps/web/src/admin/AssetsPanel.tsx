import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App as AntdApp,
  Badge,
  Button,
  Card,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Tree,
  type TreeDataNode,
} from 'antd';
import {
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type {
  AssetAdminView,
  AssetAiReviewItem,
  AssetCategoryView,
  AssetIssueView,
  AssetStatus,
} from '@sims/shared';
import {
  aiReviewAssets,
  bulkAssetStatus,
  createAssetCategory,
  createAssetIssue,
  deleteAssetCategory,
  fetchAssetCategories,
  fetchAssetImage,
  fetchAssetIssues,
  fetchAssets,
  publishAssets,
  renameAssetCategory,
  updateAsset,
  updateAssetIssue,
} from './api';
import { AssetAiReviewModal } from './AssetAiReviewModal';
import { AssetDetailDrawer, type AssetIssueState } from './AssetDetailDrawer';
import { GridPreview } from './AssetGridPreview';

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

/** 素材管理面板(M-L.2):左树(分类 CRUD)右表(筛选/批量/详情校验/发布);
 * 详情抽屉/AI 审核弹窗/占地预览拆至 AssetDetailDrawer/AssetAiReviewModal/AssetGridPreview */
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
  const [issueState, setIssueState] = useState<AssetIssueState>('idle');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiItems, setAiItems] = useState<AssetAiReviewItem[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [issues, setIssues] = useState<AssetIssueView[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [categoryModal, setCategoryModal] = useState<{
    parent: AssetCategoryView | null;
  } | null>(null);
  const [categoryForm] = Form.useForm();
  const [form] = Form.useForm();

  const refreshOpenIssues = useCallback(async () => {
    try {
      const list = await fetchAssetIssues({ status: 'open' });
      setIssues(list.items);
      setOpenCount(list.total);
    } catch {
      // 角标失败不打扰主流程(问题清单打开时会再报错提示)
    }
  }, []);

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

  useEffect(() => {
    void refreshOpenIssues();
  }, [refreshOpenIssues]);

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
    setIssueState('idle');
    try {
      setDetailImage(await fetchAssetImage(asset.id));
    } catch {
      setDetailImage(null);
    }
  };

  const reportDetailIssue = async () => {
    if (detail === null) return;
    setIssueState('sending');
    try {
      await createAssetIssue({
        scope: 'asset',
        refSlug: detail.slug,
        refId: detail.id,
        context: { key: detail.categorySlug, kind: 'asset', name: detail.name },
      });
      setIssueState('done');
      message.success('已上报到素材问题清单');
      void refreshOpenIssues();
    } catch (err) {
      setIssueState('error');
      message.error(err instanceof Error ? err.message : '上报失败');
    }
  };

  const runAiReview = async (ids: number[]) => {
    if (ids.length === 0) return;
    setAiOpen(true);
    setAiRunning(true);
    setAiItems(ids.map((id) => ({ id, slug: String(id), ok: false, error: '审核中…' })));
    try {
      const body = await aiReviewAssets(ids);
      setAiItems(body.items);
    } catch (err) {
      setAiItems(ids.map((id) => ({ id, slug: String(id), ok: false, error: err instanceof Error ? err.message : '审核失败' })));
    } finally {
      setAiRunning(false);
    }
  };

  const reportAiIssue = async (item: AssetAiReviewItem) => {
    const result = item.result;
    if (result === undefined) return;
    try {
      await createAssetIssue({
        scope: 'asset',
        refSlug: item.slug,
        refId: item.id,
        context: {
          key: items.find((a) => a.id === item.id)?.categorySlug ?? '',
          ai: 'vision',
          match: result.match,
          see: result.see,
          kindGuess: result.kindGuess,
          problems: result.problems,
          suggestion: result.suggestion,
        },
      });
      message.success(`${item.slug} 已上报到素材问题清单`);
      void refreshOpenIssues();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '上报失败');
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
      categoryId: detail.categoryId,
    });
  };

  const saveEdit = async () => {
    if (detail === null) return;
    const values = await form.validateFields();
    const tagList = (values.tags as string)
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag !== '');
    await updateAsset(detail.id, {
      name: values.name,
      gridW: values.gridW,
      gridH: values.gridH,
      anchor: values.anchor,
      tier: values.tier,
      tags: tagList,
      status: values.status,
      ...(values.categoryId !== detail.categoryId ? { categoryId: values.categoryId } : {}),
    });
    message.success('已保存');
    setEditing(false);
    await openDetail({ ...detail, ...values, tags: tagList });
    void load();
  };

  const resolveIssue = async (issue: AssetIssueView) => {
    try {
      await updateAssetIssue(issue.id, 'resolved');
      message.success('已标记处理完成');
      await refreshOpenIssues();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const locateIssueAsset = (issue: AssetIssueView) => {
    setKeyword(issue.refSlug);
    setStatus('');
    setPage(1);
    setShowIssues(false);
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
        title={showIssues ? '待处理素材问题' : `素材库(${total})`}
        style={{ flex: 1, minWidth: 0 }}
        extra={
          <Space>
            <Badge count={openCount} size="small" offset={[-4, 0]}>
              <Button
                size="small"
                icon={<WarningOutlined />}
                type={showIssues ? 'primary' : 'default'}
                onClick={() => setShowIssues((v) => !v)}
              >
                问题清单
              </Button>
            </Badge>
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
        {showIssues ? (
          <Table<AssetIssueView>
            rowKey="id"
            size="small"
            dataSource={issues}
            pagination={false}
            locale={{ emptyText: <Empty description="没有待处理的问题,游戏内「⚠ 报错」上报会汇聚到这里" /> }}
            columns={[
              {
                title: '作用域',
                width: 80,
                render: (_, record) => (
                  <Tag color={record.scope === 'asset' ? 'gold' : 'purple'}>
                    {record.scope === 'asset' ? '素材图' : '动画'}
                  </Tag>
                ),
              },
              {
                title: '对象',
                dataIndex: 'refSlug',
                width: 170,
                render: (slug: string) => <code style={{ fontSize: 12 }}>{slug}</code>,
              },
              {
                title: '上下文',
                width: 190,
                render: (_, record) => {
                  const ctx = record.context ?? {};
                  const parts = Object.entries(ctx)
                    .filter(([key]) => key !== 'key')
                    .map(([key, value]) => `${key}=${String(value)}`);
                  return <span style={{ fontSize: 12, color: '#57606a' }}>{parts.join(' · ') || '—'}</span>;
                },
              },
              { title: '备注', dataIndex: 'note', ellipsis: true },
              {
                title: '上报时间',
                width: 110,
                render: (_, record) => (
                  <span style={{ fontSize: 12 }}>{new Date(record.createdAt).toLocaleString()}</span>
                ),
              },
              {
                title: '操作',
                width: 170,
                render: (_, record) => (
                  <Space>
                    {record.scope === 'asset' && (
                      <Button size="small" onClick={() => locateIssueAsset(record)}>
                        定位素材
                      </Button>
                    )}
                    <Button size="small" type="primary" onClick={() => void resolveIssue(record)}>
                      标已处理
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        ) : (
          <>
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
          {selectedIds.length > 0 && (
            <Tooltip title="勾选素材交给视觉模型识别,校验图片与 slug/元数据是否相符(单批最多 10 件)">
              <Button
                size="small"
                icon={<RobotOutlined />}
                loading={aiRunning}
                onClick={() => {
                  const ids = selectedIds.slice(0, 10);
                  if (selectedIds.length > 10) message.info(`单批最多 10 件,已取前 10 件`);
                  void runAiReview(ids);
                }}
              >
                AI 审核({Math.min(selectedIds.length, 10)})
              </Button>
            </Tooltip>
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
              title: '预览(红框=占地)',
              width: 96,
              render: (_, record) =>
                thumbUrls[record.id] !== undefined ? (
                  <GridPreview asset={record} url={thumbUrls[record.id]!} scale={1.5} />
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
          </>
        )}
      </Card>

      <AssetDetailDrawer
        detail={detail}
        detailImage={detailImage}
        editing={editing}
        issueState={issueState}
        aiRunning={aiRunning}
        categories={categories}
        form={form}
        onClose={() => setDetail(null)}
        onStartEdit={startEdit}
        onCancelEdit={() => setEditing(false)}
        onSave={saveEdit}
        onReportIssue={reportDetailIssue}
        onRunAi={runAiReview}
      />
      <AssetAiReviewModal
        open={aiOpen}
        running={aiRunning}
        items={aiItems}
        thumbUrls={thumbUrls}
        onClose={() => setAiOpen(false)}
        onReport={reportAiIssue}
      />
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
