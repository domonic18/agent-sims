import { useEffect, useState } from 'react';
import {
  MODEL_PROVIDER_PRESETS,
  MODEL_PROTOCOL_BASE_URL_HINT,
  MODEL_PROTOCOL_LABELS,
  MODEL_SLOT_LABELS,
  MODEL_SLOTS,
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

function SlotCard({ view, onChanged }: SlotCardProps) {
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
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [testResult, setTestResult] = useState<ModelConfigTestResult | null>(null);
  const [invokeResult, setInvokeResult] = useState<ModelConfigInvokeResult | null>(null);

  const allowedProtocols = MODEL_SLOT_PROTOCOLS[view.slot];

  useEffect(() => {
    setProtocol((prev) =>
      allowedProtocols.includes(prev) ? prev : allowedProtocols[0]!,
    );
    setProviderId('');
    setBaseUrl(view.baseUrl);
    setModel(view.model);
    setEnabled(view.enabled);
    setApiKey('');
  }, [view, allowedProtocols]);

  const isEmbedding = view.slot === 'embedding';

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
    setMessage(null);
    try {
      const payload: ModelConfigUpdate = { baseUrl, model, enabled };
      if (allowedProtocols.length > 1) payload.protocol = protocol;
      if (apiKey) payload.apiKey = apiKey;
      onChanged(await updateModelConfig(view.slot, payload));
      setMessage({ kind: 'ok', text: '已保存' });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : '保存失败' });
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
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : '测试失败' });
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
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : '试调用失败' });
    } finally {
      setInvoking(false);
    }
  };

  return (
    <section className="slot-card">
      <div className="slot-card-header">
        <h2>{MODEL_SLOT_LABELS[view.slot]}</h2>
        <label className="slot-enabled">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          启用
        </label>
      </div>
      {allowedProtocols.length > 1 && (
        <label>
          接入协议
          <select value={protocol} onChange={(e) => handleProtocolChange(e.target.value as ModelProtocol)}>
            {allowedProtocols.map((p) => (
              <option key={p} value={p}>
                {MODEL_PROTOCOL_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        供应商预设
        <select value={providerId} onChange={(e) => handleProviderChange(e.target.value)}>
          <option value="">自定义(手动填 Base URL)</option>
          {MODEL_PROVIDER_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Base URL
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={MODEL_PROTOCOL_BASE_URL_HINT[protocol]}
        />
      </label>
      <label>
        模型名
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o-mini" />
      </label>
      <label>
        API Key{view.apiKeyConfigured ? `(已配置 ${view.apiKeyMasked},留空保留)` : '(未配置)'}
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={view.apiKeyConfigured ? '••••••••' : 'sk-...'}
          autoComplete="off"
        />
      </label>
      <label>
        试调用 Prompt{isEmbedding ? '(向量化输入)' : '(留空用默认)'}
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="用一句话介绍你自己"
        />
      </label>
      <div className="slot-actions">
        <button onClick={() => void handleSave()} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
        <button className="admin-secondary" onClick={() => void handleTest()} disabled={testing}>
          {testing ? '测试中…' : '测试连通'}
        </button>
        <button className="admin-secondary" onClick={() => void handleInvoke()} disabled={invoking}>
          {invoking ? '调用中…' : '试调用'}
        </button>
      </div>
      {testResult && (
        <p className={testResult.ok ? 'admin-ok' : 'admin-error'}>
          测试({testResult.latencyMs}ms): {testResult.detail}
        </p>
      )}
      {!testResult && view.lastTestStatus && (
        <p className="admin-muted">
          上次测试: {view.lastTestStatus === 'success' ? '✓ 成功' : '✗ 失败'}
          {view.lastTestedAt ? ` · ${new Date(view.lastTestedAt).toLocaleString()}` : ''}
          {view.lastTestStatus === 'failed' && view.lastTestError ? ` · ${view.lastTestError}` : ''}
        </p>
      )}
      {invokeResult && (
        <div className={`slot-invoke ${invokeResult.ok ? 'admin-ok' : 'admin-error'}`}>
          <p>
            试调用({invokeResult.latencyMs}ms){invokeResult.usage ? ` · tokens ${invokeResult.usage.promptTokens}/${invokeResult.usage.completionTokens}` : ''}
          </p>
          {invokeResult.ok ? (
            <pre className="slot-invoke-content">{invokeResult.content ?? invokeResult.detail}</pre>
          ) : (
            <p>{invokeResult.detail}</p>
          )}
        </div>
      )}
      {message && <p className={message.kind === 'ok' ? 'admin-ok' : 'admin-error'}>{message.text}</p>}
    </section>
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
    <div className="slot-grid">
      {MODEL_SLOTS.map((slot) => (
        <SlotCard
          key={slot}
          view={views[slot]!}
          onChanged={(view) => {
            setViews((prev) => ({ ...prev, [slot]: view }));
            onChanged();
          }}
        />
      ))}
    </div>
  );
}
