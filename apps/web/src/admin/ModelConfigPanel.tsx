import { Fragment, useEffect, useState } from 'react';
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Descriptions,
  Drawer,
  Flex,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  MODEL_PROTOCOL_BASE_URL_HINT,
  MODEL_PROTOCOL_LABELS,
  MODEL_PROVIDER_PRESETS,
  MODEL_SLOT_GROUPS,
  MODEL_SLOT_LABELS,
  MODEL_SLOT_MAX_TOKENS,
  MODEL_SLOT_PROTOCOLS,
  type ModelConfigInvokeResult,
  type ModelConfigTestResult,
  type ModelConfigUpdate,
  type ModelConfigView,
  type ModelProtocol,
  type ModelSlot,
  type UiMetaView,
} from '@sims/shared';
import { getUiMeta } from '../net/worldApi';
import { invokeModelConfig, testModelConfig, updateModelConfig, updateUiSettings } from './api';

interface SlotCardProps {
  view: ModelConfigView;
  onChanged: (view: ModelConfigView) => void;
}

function statusTag(view: ModelConfigView): { text: string; color: 'success' | 'default' | 'error' } {
  if (!view.enabled) return { text: '未启用', color: 'default' };
  if (view.lastTestStatus === 'failed') return { text: '测试失败', color: 'error' };
  return { text: '已启用', color: 'success' };
}

function MonoValue({ value }: { value: string }) {
  return (
    <Typography.Text code style={{ fontSize: 12 }} ellipsis={{ tooltip: value }}>
      {value}
    </Typography.Text>
  );
}

/** 测试/试调用结果区: 终端风固定高度(等宽+ink 底),替代原双 Alert */
function SlotResultArea({
  testResult,
  invokeResult,
}: {
  testResult: ModelConfigTestResult | null;
  invokeResult: ModelConfigInvokeResult | null;
}) {
  if (testResult === null && invokeResult === null) return null;
  return (
    <div
      style={{
        marginTop: 12,
        background: 'var(--px-ink)',
        border: '1px solid var(--px-navy)',
        padding: '8px 10px',
        maxHeight: 180,
        overflow: 'auto',
        fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
        fontSize: 12,
        lineHeight: 1.7,
      }}
    >
      {testResult !== null && (
        <div style={{ color: testResult.ok ? 'var(--px-lime)' : 'var(--px-orange)' }}>
          [测试] {testResult.ok ? '成功' : '失败'} · {testResult.latencyMs}ms
          {testResult.detail ? ` · ${testResult.detail}` : ''}
        </div>
      )}
      {invokeResult !== null && (
        <>
          <div style={{ color: invokeResult.ok ? 'var(--px-lime)' : 'var(--px-orange)' }}>
            [试调用] {invokeResult.ok ? '成功' : '失败'} · {invokeResult.latencyMs}ms
            {invokeResult.usage
              ? ` · tokens ${invokeResult.usage.promptTokens}/${invokeResult.usage.completionTokens}`
              : ''}
          </div>
          {(invokeResult.ok ? invokeResult.content ?? invokeResult.detail : invokeResult.detail) && (
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--px-gray)' }}>
              {invokeResult.ok ? invokeResult.content ?? invokeResult.detail : invokeResult.detail}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SlotCard({ view, onChanged }: SlotCardProps) {
  const { message } = AntdApp.useApp();
  const [editing, setEditing] = useState(false);
  const [protocol, setProtocol] = useState<ModelProtocol>(view.protocol);
  const [providerId, setProviderId] = useState('');
  const [baseUrl, setBaseUrl] = useState(view.baseUrl);
  const [model, setModel] = useState(view.model);
  const [apiKey, setApiKey] = useState('');
  const [maxTokens, setMaxTokens] = useState<number | null>(view.maxTokens);
  const [enabled, setEnabled] = useState(view.enabled);
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [invoking, setInvoking] = useState(false);
  const [testResult, setTestResult] = useState<ModelConfigTestResult | null>(null);
  const [invokeResult, setInvokeResult] = useState<ModelConfigInvokeResult | null>(null);

  const allowedProtocols = MODEL_SLOT_PROTOCOLS[view.slot];

  const startEdit = (): void => {
    setProtocol((prev) => (allowedProtocols.includes(prev) ? prev : allowedProtocols[0]!));
    setProviderId('');
    setBaseUrl(view.baseUrl);
    setModel(view.model);
    setMaxTokens(view.maxTokens);
    setEnabled(view.enabled);
    setApiKey('');
    setEditing(true);
  };

  /** 选供应商预设即按当前协议自动填 Base URL(可再手改,ai-invest 同款交互) */
  const handleProviderChange = (id: string): void => {
    setProviderId(id);
    const preset = MODEL_PROVIDER_PRESETS.find((p) => p.id === id);
    const presetUrl = preset?.baseUrlByProtocol[protocol];
    if (presetUrl) setBaseUrl(presetUrl);
  };

  const handleProtocolChange = (next: ModelProtocol): void => {
    setProtocol(next);
    const preset = MODEL_PROVIDER_PRESETS.find((p) => p.id === providerId);
    const presetUrl = preset?.baseUrlByProtocol[next];
    if (preset) setBaseUrl(presetUrl ?? '');
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      const payload: ModelConfigUpdate = { baseUrl, model, enabled };
      if (allowedProtocols.length > 1) payload.protocol = protocol;
      if (apiKey) payload.apiKey = apiKey;
      if (supportsMaxTokens) payload.maxTokens = maxTokens;
      onChanged(await updateModelConfig(view.slot, payload));
      setEditing(false);
      message.success(`${MODEL_SLOT_LABELS[view.slot]}配置已保存`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testModelConfig(view.slot);
      setTestResult(result);
      onChanged({ ...view, lastTestStatus: result.ok ? 'success' : 'failed', lastTestError: result.ok ? null : result.detail });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '测试失败');
    } finally {
      setTesting(false);
    }
  };

  /** 试调用:走 ModelRouter 真实调用链(协议适配+token 记账) */
  const handleInvoke = async (): Promise<void> => {
    setInvoking(true);
    setInvokeResult(null);
    try {
      setInvokeResult(await invokeModelConfig(view.slot, prompt || undefined));
    } catch (err) {
      message.error(err instanceof Error ? err.message : '试调用失败');
    } finally {
      setInvoking(false);
    }
  };

  const tag = statusTag(view);
  const isEmbedding = view.slot === 'embedding';
  const supportsMaxTokens = view.slot in MODEL_SLOT_MAX_TOKENS;
  const defaultMaxTokens = MODEL_SLOT_MAX_TOKENS[view.slot];

  return (
    <Card
      id={`slot-card-${view.slot}`}
      title={
        <Space size={8}>
          <span>{MODEL_SLOT_LABELS[view.slot]}</span>
          <Tag color={tag.color}>{tag.text}</Tag>
        </Space>
      }
      extra={
        <Button size="small" onClick={startEdit}>
          编辑
        </Button>
      }
      style={{ flex: '1 1 420px', scrollMarginTop: 12 }}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Descriptions
          size="small"
          column={{ xs: 1, sm: 2 }}
          items={[
            { key: 'protocol', label: '接入协议', children: MODEL_PROTOCOL_LABELS[view.protocol] },
            { key: 'model', label: '模型名', children: <MonoValue value={view.model || '(未填写)'} /> },
            { key: 'baseUrl', label: 'Base URL', span: 2, children: <MonoValue value={view.baseUrl || '(未填写)'} /> },
            ...(supportsMaxTokens
              ? [
                  {
                    key: 'maxTokens',
                    label: '最大输出 tokens',
                    children: view.maxTokens ?? `内置默认 ${defaultMaxTokens}`,
                  },
                ]
              : []),
            {
              key: 'apiKey',
              label: 'API Key',
              children: <MonoValue value={view.apiKeyConfigured ? view.apiKeyMasked : '未配置'} />,
            },
            {
              key: 'lastTest',
              label: '上次测试',
              span: supportsMaxTokens ? 2 : 1,
              children: view.lastTestStatus
                ? `${view.lastTestStatus === 'success' ? '成功' : '失败'}${view.lastTestedAt ? ` · ${new Date(view.lastTestedAt).toLocaleString()}` : ''}`
                : '未测试',
            },
          ]}
        />
        <Flex gap={8} wrap="wrap">
          <Input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={isEmbedding ? '试调用输入(向量化)' : '试调用 Prompt(留空用默认)'}
            style={{ flex: 1, minWidth: 140 }}
          />
          <Button loading={testing} onClick={() => void handleTest()}>
            测试连通
          </Button>
          <Button type="primary" ghost loading={invoking} onClick={() => void handleInvoke()}>
            试调用
          </Button>
        </Flex>
      </Space>

      <SlotResultArea testResult={testResult} invokeResult={invokeResult} />

      <Drawer
        title={`编辑 · ${MODEL_SLOT_LABELS[view.slot]}`}
        width="min(420px, calc(100vw - 24px))"
        open={editing}
        onClose={() => setEditing(false)}
        footer={
          <Flex justify="flex-end" gap={8}>
            <Button onClick={() => setEditing(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void handleSave()}>
              保存
            </Button>
          </Flex>
        }
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {allowedProtocols.length > 1 && (
            <label style={{ display: 'block' }}>
              <Typography.Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
                接入协议
              </Typography.Text>
              <Select
                value={protocol}
                onChange={handleProtocolChange}
                style={{ width: '100%' }}
                options={allowedProtocols.map((p) => ({ value: p, label: MODEL_PROTOCOL_LABELS[p] }))}
              />
            </label>
          )}
          <label style={{ display: 'block' }}>
            <Typography.Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
              供应商预设
            </Typography.Text>
            <Select
              value={providerId}
              onChange={handleProviderChange}
              style={{ width: '100%' }}
              options={[
                { value: '', label: '自定义(手动填 Base URL)' },
                ...MODEL_PROVIDER_PRESETS.map((p) => ({ value: p.id, label: p.label })),
              ]}
            />
          </label>
          <label style={{ display: 'block' }}>
            <Typography.Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
              Base URL
            </Typography.Text>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={MODEL_PROTOCOL_BASE_URL_HINT[protocol]}
            />
          </label>
          <label style={{ display: 'block' }}>
            <Typography.Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
              模型名
            </Typography.Text>
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o-mini" />
          </label>
          {supportsMaxTokens && (
            <label style={{ display: 'block' }}>
              <Typography.Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
                最大输出 tokens(留空用内置默认)
              </Typography.Text>
              <InputNumber
                value={maxTokens}
                onChange={(v) => setMaxTokens(typeof v === 'number' ? v : null)}
                min={1}
                max={1_000_000}
                precision={0}
                style={{ width: '100%' }}
                placeholder={`内置默认 ${defaultMaxTokens}(思考型模型建议留足余量)`}
              />
            </label>
          )}
          <label style={{ display: 'block' }}>
            <Typography.Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
              API Key{view.apiKeyConfigured ? `(已配置 ${view.apiKeyMasked},留空保留)` : '(未配置)'}
            </Typography.Text>
            <Input.Password
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={view.apiKeyConfigured ? '••••••••' : 'sk-...'}
              autoComplete="off"
            />
          </label>
          <Space size={8}>
            <Switch size="small" checked={enabled} onChange={setEnabled} disabled={saving} />
            <Typography.Text style={{ fontSize: 13 }}>启用该槽位</Typography.Text>
          </Space>
        </Space>
      </Drawer>
    </Card>
  );
}

interface ModelConfigPanelProps {
  configs: ModelConfigView[];
  onChanged: () => void;
}

/** 总览条槽位芯片: 状态点(灰未启/红测败/绿正常)+模型名缩略,点击滚动定位到卡片 */
function SlotChip({ view }: { view: ModelConfigView }) {
  const tag = statusTag(view);
  const dotColor =
    tag.color === 'success' ? 'var(--px-lime)' : tag.color === 'error' ? 'var(--px-orange)' : 'var(--px-slate)';
  return (
    <Tooltip title={`${MODEL_SLOT_LABELS[view.slot]} · ${tag.text}`}>
      <button
        type="button"
        className="adm-slot-chip"
        onClick={() =>
          document.getElementById(`slot-card-${view.slot}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      >
        <i style={{ width: 8, height: 8, background: dotColor, flexShrink: 0 }} />
        <span style={{ color: 'var(--px-white)' }}>{MODEL_SLOT_LABELS[view.slot]}</span>
        <span
          style={{
            maxWidth: 120,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--px-gray)',
          }}
        >
          {view.model || '未配置'}
        </span>
      </button>
    </Tooltip>
  );
}

/** 游戏页左下角模型徽标开关(app_settings ui.showModels,公开 GET 读/此处 PUT 写) */
function UiBadgeSwitch() {
  const { message } = AntdApp.useApp();
  const [uiMeta, setUiMeta] = useState<UiMetaView | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getUiMeta()
      .then((meta) => {
        if (!cancelled) setUiMeta(meta);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (next: boolean): Promise<void> => {
    setSaving(true);
    try {
      setUiMeta(await updateUiSettings(next));
      message.success(next ? '已开启游戏页模型徽标' : '已关闭游戏页模型徽标');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Space size={8}>
      <Switch size="small" checked={uiMeta?.showModels === true} loading={saving} onChange={(v) => void toggle(v)} />
      <Tooltip title="在游戏页左下角向游客展示当前 LLM / SystemOne 模型名">
        <Typography.Text type="secondary" style={{ fontSize: 12, cursor: 'help' }}>
          游戏页模型徽标
        </Typography.Text>
      </Tooltip>
    </Space>
  );
}

export function ModelConfigPanel({ configs, onChanged }: ModelConfigPanelProps) {
  const [views, setViews] = useState<Record<ModelSlot, ModelConfigView>>(
    () => Object.fromEntries(configs.map((view) => [view.slot, view])) as Record<ModelSlot, ModelConfigView>,
  );

  useEffect(() => {
    setViews(
      Object.fromEntries(configs.map((view) => [view.slot, view])) as Record<ModelSlot, ModelConfigView>,
    );
  }, [configs]);

  return (
    <Flex vertical gap={24}>
      <Card size="small">
        <Flex align="center" gap={8} wrap="wrap">
          {MODEL_SLOT_GROUPS.map((group) => (
            <Fragment key={group.id}>
              <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
                {group.label}
              </Typography.Text>
              {group.slots.map((slot) => (
                <SlotChip key={slot} view={views[slot]!} />
              ))}
            </Fragment>
          ))}
          <div style={{ flex: 1 }} />
          <UiBadgeSwitch />
        </Flex>
      </Card>
      {MODEL_SLOT_GROUPS.map((group) => (
        <Card
          key={group.id}
          title={
            <Space size={10} align="baseline">
              <span>{group.label}</span>
              <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                {group.desc}
              </Typography.Text>
            </Space>
          }
        >
          <Flex gap={16} wrap="wrap">
            {group.slots.map((slot) => (
              <SlotCard
                key={slot}
                view={views[slot]!}
                onChanged={(view) => {
                  setViews((prev) => ({ ...prev, [slot]: view }));
                  onChanged();
                }}
              />
            ))}
          </Flex>
        </Card>
      ))}
      <Alert
        type="info"
        showIcon={false}
        message={
          <span style={{ fontSize: 12 }}>
            各槽位独立启用:未配置或未启用的槽位,对应调用将直接报错(不会自动回落其他槽位)。
            「测试连通」校验配置可达性;「试调用」走真实调用链并计入 Token 用量。
            未来新增模型类型(如语音合成/识别)将以新槽位挂入对应分组。
          </span>
        }
      />
    </Flex>
  );
}
