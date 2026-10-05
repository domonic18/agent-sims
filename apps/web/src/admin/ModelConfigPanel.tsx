import { useEffect, useState } from 'react';
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Descriptions,
  Flex,
  Input,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import {
  MODEL_PROTOCOL_BASE_URL_HINT,
  MODEL_PROTOCOL_LABELS,
  MODEL_PROVIDER_PRESETS,
  MODEL_SLOT_GROUPS,
  MODEL_SLOT_LABELS,
  MODEL_SLOT_PROTOCOLS,
  type ModelConfigInvokeResult,
  type ModelConfigTestResult,
  type ModelConfigUpdate,
  type ModelConfigView,
  type ModelProtocol,
  type ModelSlot,
} from '@sims/shared';
import { invokeModelConfig, testModelConfig, updateModelConfig } from './api';

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

function SlotCard({ view, onChanged }: SlotCardProps) {
  const { message } = AntdApp.useApp();
  const [editing, setEditing] = useState(false);
  const [protocol, setProtocol] = useState<ModelProtocol>(view.protocol);
  const [providerId, setProviderId] = useState('');
  const [baseUrl, setBaseUrl] = useState(view.baseUrl);
  const [model, setModel] = useState(view.model);
  const [apiKey, setApiKey] = useState('');
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

  return (
    <Card
      title={
        <Space size={8}>
          <span>{MODEL_SLOT_LABELS[view.slot]}</span>
          <Tag color={tag.color}>{tag.text}</Tag>
        </Space>
      }
      style={{ flex: '1 1 420px' }}
    >
      {editing ? (
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
          <Space>
            <Button type="primary" loading={saving} onClick={() => void handleSave()}>
              保存
            </Button>
            <Button onClick={() => setEditing(false)}>取消</Button>
          </Space>
        </Space>
      ) : (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Descriptions size="small" column={1} items={[
            { key: 'protocol', label: '接入协议', children: MODEL_PROTOCOL_LABELS[view.protocol] },
            { key: 'baseUrl', label: 'Base URL', children: <MonoValue value={view.baseUrl || '(未填写)'} /> },
            { key: 'model', label: '模型名', children: <MonoValue value={view.model || '(未填写)'} /> },
            { key: 'apiKey', label: 'API Key', children: <MonoValue value={view.apiKeyConfigured ? view.apiKeyMasked : '未配置'} /> },
            {
              key: 'lastTest',
              label: '上次测试',
              children: view.lastTestStatus
                ? `${view.lastTestStatus === 'success' ? '成功' : '失败'}${view.lastTestedAt ? ` · ${new Date(view.lastTestedAt).toLocaleString()}` : ''}`
                : '未测试',
            },
          ]}
          />
          <label style={{ display: 'block' }}>
            <Typography.Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
              试调用 Prompt{isEmbedding ? '(向量化输入)' : '(留空用默认)'}
            </Typography.Text>
            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="用一句话介绍你自己"
            />
          </label>
          <Space>
            <Button onClick={startEdit}>编辑</Button>
            <Button loading={testing} onClick={() => void handleTest()}>
              测试连通
            </Button>
            <Button type="primary" ghost loading={invoking} onClick={() => void handleInvoke()}>
              试调用
            </Button>
          </Space>
        </Space>
      )}

      {testResult && (
        <Alert
          style={{ marginTop: 12 }}
          type={testResult.ok ? 'success' : 'error'}
          showIcon
          message={`测试(${testResult.latencyMs}ms)`}
          description={testResult.detail}
        />
      )}
      {invokeResult && (
        <Alert
          style={{ marginTop: 12 }}
          type={invokeResult.ok ? 'success' : 'error'}
          showIcon
          message={`试调用(${invokeResult.latencyMs}ms)${invokeResult.usage ? ` · tokens ${invokeResult.usage.promptTokens}/${invokeResult.usage.completionTokens}` : ''}`}
          description={
            invokeResult.ok ? (
              <Typography.Paragraph
                code
                style={{ maxHeight: 140, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginBottom: 0 }}
              >
                {invokeResult.content ?? invokeResult.detail}
              </Typography.Paragraph>
            ) : (
              invokeResult.detail
            )
          }
        />
      )}
    </Card>
  );
}

interface ModelConfigPanelProps {
  configs: ModelConfigView[];
  onChanged: () => void;
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
