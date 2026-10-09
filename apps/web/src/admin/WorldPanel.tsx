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
  Popconfirm,
  Radio,
  Select,
  Space,
  Steps,
  Switch,
  Table,
  Tag,
  Tooltip,
  type TableColumnsType,
} from 'antd';
import { DeleteOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import {
  DEFAULT_WORLD_RULES,
  GAME_TYPES,
  GAME_TYPE_LABELS,
  GENDERS,
  GENDER_LABELS,
  WORLD_CHARACTER_LIMITS,
  WORLD_TIME_SCALES,
  pickRandomName,
  type GameType,
  type WorldCharacterConfig,
  type WorldRules,
  type WorldPreviewResponse,
  type WorldView,
} from '@sims/shared';
import { ApiError, closeWorld, createWorld, deleteWorld, fetchSysConfig, fetchWorlds, previewWorld } from './api';
import { CurrentWorldCard, formatTime, type CharacterRow } from './CurrentWorldCard';
import { WorldParamsCollapse } from './WorldParamsCollapse';

/** 世界管理面板(M-L.5):当前世界卡/五步创建向导/历史归档;
 * 参数折叠区与当前世界卡拆至 WorldParamsCollapse/CurrentWorldCard */

interface WorldFormValues {
  mode?: 'builtin' | 'random';
  gameType?: GameType;
  seed?: string;
  params?: { size: 'small' | 'medium' | 'large'; density: 'sparse' | 'normal' | 'dense' };
  name: string;
  characters: CharacterRow[];
  rules: WorldRules;
}

export function WorldPanel() {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<WorldFormValues>();
  const [worlds, setWorlds] = useState<WorldView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // M-L.5 五步向导: 0 地图模式 → 1 世界与规则 → 2 居民 → 3 随机种子 → 4 确认
  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState<WorldPreviewResponse | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

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

  // 世界参数出厂默认回填 form store(挂载即填,折叠区不展开也能随创建提交)
  useEffect(() => {
    let cancelled = false;
    void fetchSysConfig()
      .then((view) => {
        if (!cancelled) form.setFieldValue(['rules', 'params'], { ...view.defaults });
      })
      .catch(() => {
        // 目录拉取失败不阻断向导:提交时 params 缺省=全默认
      });
    return () => {
      cancelled = true;
    };
  }, [form]);

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
    // 分步渲染下 Form.List 随步骤卸载会丢值,统一从 form store 兜底
    const rows =
      values.characters ?? ((form.getFieldValue('characters') as CharacterRow[] | undefined) ?? []);
    const characters: WorldCharacterConfig[] = rows.map((row) => ({
      name: row.name.trim(),
      gender: row.gender,
      ...(row.persona?.trim() ? { persona: row.persona.trim() } : {}),
    }));
    const mode = form.getFieldValue('mode') as 'builtin' | 'random';
    const worldgen =
      mode === 'random'
        ? {
            ...(form.getFieldValue('seed') ? { seed: String(form.getFieldValue('seed')) } : {}),
            gameType: (form.getFieldValue('gameType') ?? 'growth') as GameType,
            params: form.getFieldValue('params') as { size: 'small' | 'medium' | 'large'; density: 'sparse' | 'normal' | 'dense' },
          }
        : undefined;
    // 清空的输入框会产生 undefined 条目,剔除后再提交(缺省键=出厂默认)
    const rulesFromForm = values.rules ?? (form.getFieldValue('rules') as WorldRules | undefined);
    const rawParams = (rulesFromForm?.params ?? {}) as Record<string, number | undefined>;
    const params = Object.fromEntries(
      Object.entries(rawParams).filter((entry): entry is [string, number] =>
        typeof entry[1] === 'number' && Number.isFinite(entry[1]),
      ),
    );
    const rules: WorldRules = {
      ...(rulesFromForm ?? { ...DEFAULT_WORLD_RULES }),
      ...(Object.keys(params).length > 0 ? { params } : {}),
    };
    setBusy(true);
    try {
      const created = await createWorld({
        name: values.name.trim(),
        characters,
        rules,
        ...(worldgen !== undefined ? { worldgen } : {}),
      });
      message.success(`世界「${created.name}」已创建,${created.characters.length} 位居民已入驻`);
      form.resetFields();
      setStep(0);
      setPreview(null);
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
          <CurrentWorldCard
            active={active}
            busy={busy}
            onClose={() => void close(active.id)}
            onAdded={() => void load()}
          />
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
            mode: 'builtin',
            gameType: 'growth',
            params: { size: 'small', density: 'normal' },
            characters: [{ name: '', gender: 'unspecified' }],
            rules: { ...DEFAULT_WORLD_RULES },
          }}
          onFinish={(values) => void submit(values)}
        >
          <Steps
            size="small"
            current={step}
            onChange={setStep}
            items={[
              { title: '地图' },
              { title: '世界' },
              { title: '居民' },
              { title: '种子' },
              { title: '确认' },
            ]}
            style={{ marginBottom: 20 }}
          />

          {step === 0 && (
            <>
              <Form.Item name="mode" label="地图生成方式">
                <Radio.Group
                  options={[
                    { value: 'builtin', label: '固定地图(经典小镇)' },
                    { value: 'random', label: '随机生成(种子可复现)' },
                  ]}
                />
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(prev, cur) => prev.mode !== cur.mode}>
                {({ getFieldValue }) =>
                  getFieldValue('mode') === 'random' ? (
                    <>
                      <Form.Item name={['params', 'size']} label="地图尺寸">
                        <Radio.Group
                          options={[
                            { value: 'small', label: '小(64×48)' },
                            { value: 'medium', label: '中(80×60)' },
                            { value: 'large', label: '大(96×72)' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item name={['params', 'density']} label="场所密度">
                        <Radio.Group
                          options={[
                            { value: 'sparse', label: '稀疏' },
                            { value: 'normal', label: '标准' },
                            { value: 'dense', label: '稠密' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item
                        name="gameType"
                        label="世界模式"
                        extra="末日生存:墓地废墟破败区域+资源采集加密;成长小镇:经典布局。玩法机制一致,僵尸实体随后续里程碑开放。"
                      >
                        <Radio.Group
                          options={GAME_TYPES.map((value) => ({ value, label: GAME_TYPE_LABELS[value] }))}
                        />
                      </Form.Item>
                    </>
                  ) : (
                    <p style={{ margin: '0 0 8px', fontSize: 12, color: '#8c8c8c' }}>
                      使用固定经典小镇地图,与历史版本一致。
                    </p>
                  )
                }
              </Form.Item>
            </>
          )}

          {step === 1 && (
            <>
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
            </>
          )}

          {step === 2 && (
            <>
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
            </>
          )}

          {step === 1 && (
            <>
          <Card type="inner" title="世界规则" style={{ marginTop: 8, marginBottom: 16 }}>
            <Flex gap={24} wrap="wrap">
              <Form.Item
                name={['rules', 'allowDeath']}
                label={<Tooltip title="关闭后体力归 0 只会躺平不会死(世界规则关闭死亡)">允许死亡</Tooltip>}
                valuePropName="checked"
                style={{ marginBottom: 0 }}
              >
                <Switch size="small" disabled={busy} />
              </Form.Item>
              <Form.Item
                name={['rules', 'allowChat']}
                label={<Tooltip title="关闭后角色间聊天指令将被世界规则拒绝">允许角色聊天</Tooltip>}
                valuePropName="checked"
                style={{ marginBottom: 0 }}
              >
                <Switch size="small" disabled={busy} />
              </Form.Item>
              <Form.Item
                name={['rules', 'initialTimeScale']}
                label="初始倍率"
                style={{ marginBottom: 0 }}
              >
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
          <WorldParamsCollapse busy={busy} />
            </>
          )}

          {step === 3 && (
            <Form.Item noStyle shouldUpdate={(prev, cur) => prev.mode !== cur.mode || prev.seed !== cur.seed || prev.params !== cur.params}>
              {({ getFieldValue }) => {
                if (getFieldValue('mode') !== 'random') {
                  return (
                    <p style={{ margin: '0 0 8px', fontSize: 13, color: '#8c8c8c' }}>
                      固定地图无需种子,直接下一步确认创建。
                    </p>
                  );
                }
                return (
                  <>
                    <Form.Item
                      name="seed"
                      label="随机种子(数字,同种子生成完全相同的地图)"
                      rules={[{ pattern: /^[0-9]{1,10}$/, message: '种子须为 1~10 位数字' }]}
                      style={{ maxWidth: 360 }}
                      extra={preview ? `预览: ${preview.report.places.length} 个场所 | 尺寸 ${getFieldValue(['params', 'size'])} | 校验 ${preview.report.checks.connectivity && preview.report.checks.anchorsComplete ? '通过' : '未通过'} | 出生点示例 ${preview.spawnSamples.map(([x, y]) => `(${x},${y})`).join(' ')}` : '可留空由系统自动生成随机数'}
                    >
                      <Input
                        maxLength={10}
                        suffix={
                          <Button
                            size="small"
                            type="link"
                            onClick={() => {
                              form.setFieldValue('seed', String(Math.floor(Math.random() * 2 ** 31) + 1));
                              setPreview(null);
                            }}
                          >
                            随机
                          </Button>
                        }
                      />
                    </Form.Item>
                    <Button
                      loading={previewBusy}
                      onClick={() => {
                        setPreviewBusy(true);
                        const seedValue = form.getFieldValue('seed');
                        void previewWorld({
                          ...(seedValue ? { seed: String(seedValue) } : {}),
                          gameType: (getFieldValue('gameType') ?? 'growth') as GameType,
                          params: getFieldValue('params'),
                        })
                          .then((result) => {
                            setPreview(result);
                            if (seedValue) form.setFieldValue('seed', result.report.seed);
                          })
                          .catch((err: unknown) => message.error(err instanceof Error ? err.message : '预览失败'))
                          .finally(() => setPreviewBusy(false));
                      }}
                    >
                      生成预览
                    </Button>
                    {preview !== null && (
                      <Card size="small" style={{ marginTop: 12 }} title="生成报告(dry-run)">
                        <p style={{ margin: '0 0 4px', fontSize: 12 }}>
                          场所: {preview.report.places.map((place) => `${place.name}(${place.w}×${place.h})`).join('、')}
                        </p>
                        <p style={{ margin: 0, fontSize: 12, color: '#8c8c8c' }}>
                          校验: 连通 {String(preview.report.checks.connectivity)} / 锚点齐备{' '}
                          {String(preview.report.checks.anchorsComplete)};素材清单版本 {preview.report.manifestVersion}
                        </p>
                      </Card>
                    )}
                  </>
                );
              }}
            </Form.Item>
          )}

          {step === 4 && (
            <Form.Item noStyle shouldUpdate>
              {({ getFieldValue }) => {
                const mode = getFieldValue('mode');
                const rows = (getFieldValue('characters') as CharacterRow[]) ?? [];
                return (
                  <Card size="small" title="创建摘要">
                    <p style={{ margin: '0 0 4px', fontSize: 13 }}>
                      世界「{getFieldValue('name')}」 · {mode === 'random' ? '随机地图' : '固定地图'}
                      {mode === 'random' ? ` · 种子 ${getFieldValue('seed') || '(自动)'}` : ''}
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: '#8c8c8c' }}>
                      居民 {rows.length} 人:{rows.map((row) => row.name || '?').join('、') || '(待填)'}
                    </p>
                  </Card>
                );
              }}
            </Form.Item>
          )}

          <Flex gap={8} justify="flex-end" style={{ marginTop: 16 }}>
            <Button disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>
              上一步
            </Button>
            {step < 4 ? (
              <Button
                type="primary"
                onClick={async () => {
                  if (step === 1) await form.validateFields(['name']);
                  if (step === 2) await form.validateFields(['characters']);
                  if (step === 3) await form.validateFields(['seed']);
                  setStep(step + 1);
                }}
              >
                下一步
              </Button>
            ) : (
              <Button
                type="primary"
                loading={busy}
                onClick={() => {
                  // 分步"下一步"已逐段校验;此处显式取全量值直提
                  // (antd onFinish 在分步卸载字段下不可靠,不依赖原生 submit)
                  void submit(form.getFieldsValue(true) as WorldFormValues);
                }}
              >
                创建世界
              </Button>
            )}
          </Flex>
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
