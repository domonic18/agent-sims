import { useEffect, useState } from 'react';
import {
  App as AntdApp,
  Button,
  Card,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  CRAFT_RECIPE_IDS,
  ITEM_IDS,
  JOB_CATEGORIES,
  getItem,
  type CraftRecipeId,
  type RecipeDef,
  type WorldRecipesView,
} from '@sims/shared';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { fetchWorldRecipes, updateWorldRecipes } from './api';

const STATION_LABEL: Record<'stove' | 'workbench', string> = {
  stove: '灶台',
  workbench: '木工台',
};

/** 材料或产物的 Form.List 行编辑:Item 目录下拉+数量 */
function IoList({ name, label }: { name: 'inputs' | 'outputs'; label: string }) {
  return (
    <Form.Item label={label} required style={{ marginBottom: 12 }}>
      <Form.List name={name} rules={[{ validator: async (_, value) => {
        if (!value || (value as unknown[]).length === 0) throw new Error('至少一项');
      } }]}>
        {(fields, { add, remove }, { errors }) => (
          <Flex vertical gap={8}>
            {fields.map((field) => (
              <Flex key={field.key} gap={8} align="baseline">
                <Form.Item
                  name={[field.name, 'itemId']}
                  noStyle
                  rules={[{ required: true, message: '选物品' }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={ITEM_IDS.map((id) => ({ value: id, label: getItem(id)?.name ?? id }))}
                    style={{ width: 160 }}
                  />
                </Form.Item>
                <Form.Item
                  name={[field.name, 'count']}
                  noStyle
                  rules={[{ required: true, message: '数量 1~99' }]}
                >
                  <InputNumber min={1} max={99} precision={0} style={{ width: 90 }} />
                </Form.Item>
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={fields.length <= 1}
                  onClick={() => remove(field.name)}
                />
              </Flex>
            ))}
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              disabled={fields.length >= 6}
              onClick={() => add({ itemId: ITEM_IDS[0], count: 1 })}
              style={{ width: 120 }}
            >
              添加
            </Button>
            <Form.ErrorList errors={errors} />
          </Flex>
        )}
      </Form.List>
    </Form.Item>
  );
}

/**
 * 每世界配方后台编辑页(2026-10-07 配置化):仅编辑既有 4 条(id 封闭联合),
 * 保存=全集 PUT(经 validateRecipes 校验,非法整包拒绝)→ 运行时热改+存档回写,
 * 游戏端 world.recipes 事件实时同步;进行中制作不追溯(凭开始时快照结算)。
 */
export function RecipesPanel() {
  const { message } = AntdApp.useApp();
  const [view, setView] = useState<WorldRecipesView | null>(null);
  const [editing, setEditing] = useState<CraftRecipeId | null>(null);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<RecipeDef>();

  useEffect(() => {
    let cancelled = false;
    fetchWorldRecipes()
      .then((data) => {
        if (!cancelled) setView(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) message.error(err instanceof Error ? err.message : '配方加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [message]);

  const openEdit = (id: CraftRecipeId): void => {
    if (view === null) return;
    setEditing(id);
    form.setFieldsValue({ ...view.recipes[id] });
  };

  const save = async (): Promise<void> => {
    if (view === null || editing === null) return;
    const patch = await form.validateFields();
    setBusy(true);
    try {
      const next: WorldRecipesView['recipes'] = {
        ...view.recipes,
        [editing]: { ...view.recipes[editing], ...patch, id: editing },
      };
      setView(await updateWorldRecipes(next));
      message.success(`配方「${patch.name}」已更新并实时生效`);
      setEditing(null);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flex vertical gap={16}>
      <Card title="世界配方">
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          编辑目标为当前活跃世界:保存后运行时立即生效(禁用即拒、时长即改),存档随世界记录
          持久化;已开始的制作按开始时快照结算,不追溯。仅支持编辑既有 4 条配方。
        </Typography.Paragraph>
        {view === null ? (
          <Typography.Text type="secondary">配方加载中…</Typography.Text>
        ) : (
          <Table
            rowKey="id"
            dataSource={CRAFT_RECIPE_IDS.map((id) => view.recipes[id])}
            pagination={false}
            size="middle"
            columns={[
              { title: '配方', dataIndex: 'name', width: 110 },
              {
                title: '站点',
                dataIndex: 'stationKind',
                width: 90,
                render: (kind: RecipeDef['stationKind']) => STATION_LABEL[kind],
              },
              {
                title: '材料',
                dataIndex: 'inputs',
                render: (inputs: RecipeDef['inputs']) =>
                  inputs
                    .map((io) => `${getItem(io.itemId)?.name ?? io.itemId}×${io.count}`)
                    .join(' + '),
              },
              {
                title: '产出',
                dataIndex: 'outputs',
                width: 110,
                render: (outputs: RecipeDef['outputs']) =>
                  outputs.map((io) => `${getItem(io.itemId)?.name ?? io.itemId}×${io.count}`).join(' '),
              },
              { title: '时长(分)', dataIndex: 'durationMinutes', width: 90 },
              {
                title: '类别',
                dataIndex: 'category',
                width: 80,
                render: (category: RecipeDef['category']) =>
                  category === undefined ? '-' : JOB_CATEGORIES[category].label,
              },
              {
                title: '状态',
                dataIndex: 'enabled',
                width: 80,
                render: (enabled: boolean | undefined) =>
                  enabled === false ? <Tag color="red">停用</Tag> : <Tag color="green">启用</Tag>,
              },
              {
                title: '操作',
                key: 'edit',
                width: 80,
                render: (_, recipe) => (
                  <Button
                    type="link"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => openEdit(recipe.id)}
                  >
                    编辑
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>
      <Modal
        title={editing === null ? '' : `编辑配方: ${view?.recipes[editing]?.name ?? editing}`}
        open={editing !== null}
        confirmLoading={busy}
        okText="保存"
        cancelText="取消"
        onOk={() => void save()}
        onCancel={() => setEditing(null)}
        destroyOnHidden
        width={520}
      >
        <Form form={form} layout="vertical">
          <Flex gap={12}>
            <Form.Item
              name="name"
              label="名称"
              rules={[{ required: true, min: 1, max: 20, message: '1~20 字' }]}
              style={{ flex: 1 }}
            >
              <Input maxLength={20} />
            </Form.Item>
            <Form.Item name="stationKind" label="站点" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'stove', label: '灶台' },
                  { value: 'workbench', label: '木工台' },
                ]}
                style={{ width: 110 }}
              />
            </Form.Item>
            <Form.Item
              name="durationMinutes"
              label="时长(分)"
              rules={[{ required: true, message: '1~600' }]}
            >
              <InputNumber min={1} max={600} precision={0} style={{ width: 100 }} />
            </Form.Item>
          </Flex>
          <Flex gap={12}>
            <Form.Item
              name="placeIds"
              label="可制作场所"
              rules={[{ required: true, message: '至少一个场所 id' }]}
              style={{ flex: 1 }}
            >
              <Select mode="tags" open={false} placeholder="回车添加场所 id" />
            </Form.Item>
            <Form.Item name="category" label="岗位类别">
              <Select
                allowClear
                placeholder="随活动定义"
                options={Object.entries(JOB_CATEGORIES).map(([value, def]) => ({
                  value,
                  label: `${def.label}(知识≥${def.requiredKnowledge})`,
                }))}
                style={{ width: 170 }}
              />
            </Form.Item>
            <Form.Item
              name="enabled"
              label="启用"
              valuePropName="checked"
              rules={[{ required: true }]}
            >
              <Switch />
            </Form.Item>
          </Flex>
          <IoList name="inputs" label="材料" />
          <IoList name="outputs" label="产物" />
        </Form>
      </Modal>
    </Flex>
  );
}
