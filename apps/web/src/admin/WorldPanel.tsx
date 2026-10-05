import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Empty,
  Flex,
  Form,
  Input,
  List,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  type TableColumnsType,
} from 'antd';
import { DeleteOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import {
  DEFAULT_WORLD_RULES,
  GENDERS,
  GENDER_LABELS,
  WORLD_CHARACTER_LIMITS,
  WORLD_TIME_SCALES,
  pickRandomName,
  type Gender,
  type WorldCharacterConfig,
  type WorldRules,
  type WorldView,
} from '@sims/shared';
import { ApiError, closeWorld, createWorld, deleteWorld, fetchWorlds } from './api';

interface CharacterRow {
  name: string;
  gender: Gender;
  persona?: string;
}

interface WorldFormValues {
  name: string;
  characters: CharacterRow[];
  rules: WorldRules;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

function CurrentWorldCard({ active, busy, onClose }: { active: WorldView; busy: boolean; onClose: () => void }) {
  return (
    <Card
      title="当前世界"
      extra={
        <Popconfirm title="关闭并归档该世界?模拟将暂停" okText="关闭" onConfirm={onClose}>
          <Button size="small" disabled={busy}>
            关闭世界
          </Button>
        </Popconfirm>
      }
    >
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        <Space wrap>
          <strong>{active.name}</strong>
          <Tag color="success">运行中</Tag>
          <span style={{ fontSize: 12, color: '#8c8c8c' }}>创建于 {formatTime(active.createdAt)}</span>
        </Space>
        <List
          size="small"
          split={false}
          dataSource={active.characters}
          renderItem={(c) => (
            <List.Item style={{ padding: '2px 0' }}>
              <span>
                {c.name}
                <small style={{ color: '#8c8c8c' }}>
                  {' '}
                  · {GENDER_LABELS[c.gender]}
                  {c.persona ? ` · ${c.persona}` : ''}
                </small>
              </span>
            </List.Item>
          )}
        />
        <Flex gap={6} wrap="wrap">
          <Tag color={active.rules.allowDeath ? 'success' : 'default'}>
            死亡 {active.rules.allowDeath ? '开' : '关'}
          </Tag>
          <Tag color={active.rules.allowChat ? 'success' : 'default'}>
            聊天 {active.rules.allowChat ? '开' : '关'}
          </Tag>
          <Tag color="default">倍率 {active.rules.initialTimeScale}x</Tag>
        </Flex>
      </Space>
    </Card>
  );
}

export function WorldPanel() {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<WorldFormValues>();
  const [worlds, setWorlds] = useState<WorldView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setWorlds(await fetchWorlds());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载世界列表失败');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = worlds?.find((w) => w.status === 'active') ?? null;
  const history = worlds?.filter((w) => w.status === 'closed') ?? [];

  const randomizeRow = (index: number): void => {
    const rows = form.getFieldValue('characters') as CharacterRow[];
    const next = pickRandomName(rows[index]?.gender ?? 'unspecified');
    form.setFieldValue(['characters', index, 'name'], next);
  };

  const randomizeAll = (): void => {
    const rows = form.getFieldValue('characters') as CharacterRow[];
    const used = new Set<string>();
    const next = rows.map((row) => {
      const name = pickRandomName(row.gender, used);
      used.add(name);
      return { ...row, name };
    });
    form.setFieldValue('characters', next);
  };

  const submit = async (values: WorldFormValues): Promise<void> => {
    const characters: WorldCharacterConfig[] = values.characters.map((row) => ({
      name: row.name.trim(),
      gender: row.gender,
      ...(row.persona?.trim() ? { persona: row.persona.trim() } : {}),
    }));
    setBusy(true);
    try {
      const created = await createWorld({ name: values.name.trim(), characters, rules: values.rules });
      message.success(`世界「${created.name}」已创建,${created.characters.length} 位居民已入驻`);
      form.resetFields();
      void load();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : '创建失败');
    } finally {
      setBusy(false);
    }
  };

  const close = async (id: string): Promise<void> => {
    setBusy(true);
    try {
      await closeWorld(id);
      message.success('世界已关闭归档(模拟暂停)');
      void load();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : '关闭失败');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (world: WorldView): Promise<void> => {
    setBusy(true);
    try {
      await deleteWorld(world.id);
      message.success(`已删除「${world.name}」`);
      void load();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };

  const columns: TableColumnsType<WorldView> = [
    { title: '世界名', dataIndex: 'name' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: () => <Tag>已归档</Tag>,
    },
    { title: '居民', dataIndex: 'characters', width: 70, render: (c: WorldCharacterConfig[]) => `${c.length} 位` },
    {
      title: '时间',
      width: 320,
      render: (_, w) => (
        <span style={{ fontSize: 12, color: '#8c8c8c' }}>
          {formatTime(w.createdAt)}
          {w.closedAt ? ` → ${formatTime(w.closedAt)}` : ''}
        </span>
      ),
    },
    {
      title: '操作',
      width: 90,
      render: (_, w) => (
        <Popconfirm
          title={`删除世界「${w.name}」?`}
          description="其人物记录将一并清理,不可恢复。"
          okButtonProps={{ danger: true }}
          okText="删除"
          onConfirm={() => void remove(w)}
        >
          <Button danger size="small" disabled={busy}>
            删除记录
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <Flex vertical gap={16}>
      {error && <Alert type="error" showIcon message={error} />}

      <Card title="当前世界">
        {active === null ? (
          <Empty description="暂无活跃世界——用下方表单创建一个" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <CurrentWorldCard active={active} busy={busy} onClose={() => void close(active.id)} />
        )}
      </Card>

      <Card
        title="创建新世界"
        styles={{ body: { paddingTop: 12 } }}
        extra={
          <span style={{ fontSize: 12, color: '#8c8c8c' }}>
            创建会归档当前世界并重置小镇(人物/坐标/时钟全部重新开始)
          </span>
        }
      >
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{
            name: '小镇生活',
            characters: [{ name: '', gender: 'unspecified' }],
            rules: { ...DEFAULT_WORLD_RULES },
          }}
          onFinish={(values) => void submit(values)}
        >
          <Form.Item
            name="name"
            label="世界名"
            rules={[
              { required: true, message: '世界名不能为空' },
              { max: 40, message: '至多 40 字' },
            ]}
            style={{ maxWidth: 360 }}
          >
            <Input maxLength={40} />
          </Form.Item>

          <Flex align="center" justify="space-between" style={{ marginBottom: 8 }}>
            <span style={{ color: '#57606a', fontSize: 13 }}>居民</span>
            <Space>
              <Button size="small" icon={<ThunderboltOutlined />} disabled={busy} onClick={randomizeAll}>
                一键随机名字
              </Button>
              <Form.Item noStyle shouldUpdate>
                {({ getFieldValue }) => {
                  const count = ((getFieldValue('characters') as CharacterRow[] | undefined) ?? []).length;
                  return (
                    <Button
                      size="small"
                      icon={<PlusOutlined />}
                      disabled={busy || count >= WORLD_CHARACTER_LIMITS.max}
                      onClick={() =>
                        form.setFieldValue('characters', [
                          ...((form.getFieldValue('characters') as CharacterRow[]) ?? []),
                          { name: '', gender: 'unspecified' },
                        ])
                      }
                    >
                      添加居民
                    </Button>
                  );
                }}
              </Form.Item>
            </Space>
          </Flex>

          <Form.List
            name="characters"
            rules={[
              {
                validator: async (_, value: CharacterRow[] | undefined) => {
                  if (!value || value.length < WORLD_CHARACTER_LIMITS.min) {
                    return Promise.reject(new Error(`至少 ${WORLD_CHARACTER_LIMITS.min} 位居民`));
                  }
                  if (value.length > WORLD_CHARACTER_LIMITS.max) {
                    return Promise.reject(new Error(`至多 ${WORLD_CHARACTER_LIMITS.max} 位居民`));
                  }
                },
              },
            ]}
          >
            {(fields, { remove }, { errors }) => (
              <>
                {fields.map((field) => (
                  <Flex key={field.key} gap={8} align="center" style={{ marginBottom: 8 }}>
                    <Form.Item
                      name={[field.name, 'name']}
                      noStyle
                      rules={[
                        { required: true, whitespace: true, message: '名字不能为空' },
                        { max: 20, message: '至多 20 字' },
                      ]}
                    >
                      <Input placeholder="名字" maxLength={20} style={{ width: 160 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'gender']} noStyle>
                      <Select
                        style={{ width: 90 }}
                        options={GENDERS.map((g) => ({ value: g, label: GENDER_LABELS[g] }))}
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, 'persona']} noStyle>
                      <Input placeholder="人设(预留)" maxLength={100} style={{ flex: 1 }} />
                    </Form.Item>
                    <Button
                      size="small"
                      title="随机一个名字"
                      disabled={busy}
                      onClick={() => randomizeRow(field.name)}
                    >
                      随机
                    </Button>
                    <Button
                      size="small"
                      icon={<DeleteOutlined />}
                      title="移除该行"
                      disabled={busy || fields.length <= WORLD_CHARACTER_LIMITS.min}
                      onClick={() => remove(field.name)}
                    />
                  </Flex>
                ))}
                <Form.Item noStyle>
                  <Form.ErrorList errors={errors} />
                </Form.Item>
              </>
            )}
          </Form.List>

          <Card type="inner" title="世界规则" style={{ marginTop: 8, marginBottom: 16 }}>
            <Flex gap={24} wrap="wrap" align="center">
              <Form.Item name={['rules', 'allowDeath']} label="允许死亡" valuePropName="checked" noStyle>
                <Switch size="small" disabled={busy} />
              </Form.Item>
              <Form.Item name={['rules', 'allowChat']} label="允许角色聊天" valuePropName="checked" noStyle>
                <Switch size="small" disabled={busy} />
              </Form.Item>
              <Form.Item name={['rules', 'initialTimeScale']} label="初始倍率" noStyle>
                <Select
                  style={{ width: 90 }}
                  disabled={busy}
                  options={WORLD_TIME_SCALES.map((s) => ({ value: s, label: `${s}x` }))}
                />
              </Form.Item>
            </Flex>
            <p style={{ margin: '8px 0 0', fontSize: 12, color: '#8c8c8c' }}>
              规则随本世界创建定格:关闭死亡后体力归 0 只会躺平不会死;关闭聊天后角色聊天指令将被拒绝。
            </p>
          </Card>

          <Button type="primary" htmlType="submit" loading={busy}>
            创建世界
          </Button>
        </Form>
      </Card>

      <Card title={`历史世界(${history.length})`}>
        {history.length === 0 ? (
          <Empty description="暂无归档世界" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table<WorldView>
            size="small"
            rowKey="id"
            columns={columns}
            dataSource={history}
            pagination={false}
          />
        )}
      </Card>
    </Flex>
  );
}
