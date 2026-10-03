import { useEffect, useState } from 'react';
import {
  MODEL_SLOTS,
  MODEL_SLOT_LABELS,
  type ModelConfigTestResult,
  type ModelConfigUpdate,
  type ModelConfigView,
  type ModelSlot,
} from '@sims/shared';
import { testModelConfig, updateModelConfig } from './api';

interface SlotCardProps {
  view: ModelConfigView;
  onChanged: (view: ModelConfigView) => void;
}

function SlotCard({ view, onChanged }: SlotCardProps) {
  const [baseUrl, setBaseUrl] = useState(view.baseUrl);
  const [model, setModel] = useState(view.model);
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(view.enabled);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [testResult, setTestResult] = useState<ModelConfigTestResult | null>(null);

  useEffect(() => {
    setBaseUrl(view.baseUrl);
    setModel(view.model);
    setEnabled(view.enabled);
    setApiKey('');
  }, [view]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const payload: ModelConfigUpdate = { baseUrl, model, enabled };
      if (apiKey) payload.apiKey = apiKey;
      onChanged(await updateModelConfig(view.slot, payload));
      setMessage({ kind: 'ok', text: '已保存' });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : '保存失败' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
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
      <label>
        Base URL(含 /v1)
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.openai.com/v1"
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
      <div className="slot-actions">
        <button onClick={handleSave} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
        <button className="admin-secondary" onClick={handleTest} disabled={testing}>
          {testing ? '测试中…' : '测试连通'}
        </button>
      </div>
      {message && <p className={message.kind === 'ok' ? 'admin-ok' : 'admin-error'}>{message.text}</p>}
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
          view={views[slot]}
          onChanged={(view) => {
            setViews((prev) => ({ ...prev, [slot]: view }));
            onChanged();
          }}
        />
      ))}
    </div>
  );
}
