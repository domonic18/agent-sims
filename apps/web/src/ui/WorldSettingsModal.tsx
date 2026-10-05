import { useEffect, useState } from 'react';
import {
  SYS_CONFIG_FIELDS,
  SYS_CONFIG_GROUP_LABELS,
  SYS_CONFIG_GROUPS,
  SYS_CONFIG_EFFECT_LABELS,
  WORLD_PRESETS,
  WORLD_TIME_SCALES,
  type WorldPreset,
} from '@sims/shared';
import { useWorldStore } from '../store/worldStore';
import { getWorldSettings, updateWorldSettings } from '../net/worldApi';
import './world-settings.css';

/**
 * 世界设置弹窗(SimCity 式):难度预设一键切换 + 世界规则开关 + 时间倍率 +
 * 世界参数分组调节。数据经 /api/world/settings 常开通道;参数草稿脏跟踪
 * 同 LabPage 模式——仅无本地改动时被 world.params/rules 事件热同步。
 */
export function WorldSettingsModal({ onClose }: { onClose: () => void }) {
  const storeParams = useWorldStore((state) => state.params);
  const storeRules = useWorldStore((state) => state.rules);
  const applyParams = useWorldStore((state) => state.applyParams);
  const applyRules = useWorldStore((state) => state.applyRules);
  const snapshot = useWorldStore((state) => state.snapshot);
  const [draft, setDraft] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 挂载即拉全量(仅依赖事件保鲜可能滞后于上次会话的修改),之后事件持续刷新 store
  useEffect(() => {
    let cancelled = false;
    getWorldSettings()
      .then((view) => {
        if (cancelled) return;
        applyParams(view.params);
        applyRules(view.rules);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '世界设置加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [applyParams, applyRules]);

  const dirty =
    draft !== null &&
    storeParams !== null &&
    SYS_CONFIG_FIELDS.some((field) => draft[field.key] !== storeParams[field.key]);

  // 无本地改动时随事件热同步草稿;有改动则保留用户编辑
  useEffect(() => {
    if (storeParams !== null && !dirty) setDraft({ ...storeParams });
  }, [storeParams, dirty]);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await action();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const applyPreset = (preset: WorldPreset): Promise<void> =>
    run(async () => {
      const view = await updateWorldSettings({
        rules: {
          allowDeath: preset.rules.allowDeath,
          allowChat: preset.rules.allowChat,
        },
        timeScale: preset.rules.initialTimeScale,
        params: preset.params,
        resetParams: true,
      });
      applyParams(view.params);
      applyRules(view.rules);
      setDraft({ ...view.params });
    });

  const updateRule = (patch: { allowDeath?: boolean; allowChat?: boolean }): Promise<void> =>
    run(async () => {
      const view = await updateWorldSettings({ rules: patch });
      applyRules(view.rules);
    });

  const changeScale = (scale: number): Promise<void> =>
    run(async () => {
      await updateWorldSettings({ timeScale: scale });
    });

  const saveParams = (): Promise<void> =>
    run(async () => {
      if (draft === null || storeParams === null) return;
      const updates: Record<string, number> = {};
      for (const field of SYS_CONFIG_FIELDS) {
        const value = draft[field.key];
        if (value !== undefined && value !== storeParams[field.key]) updates[field.key] = value;
      }
      if (Object.keys(updates).length === 0) return;
      const view = await updateWorldSettings({ params: updates });
      applyParams(view.params);
      setDraft({ ...view.params });
    });

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2>世界设置</h2>
          <button type="button" className="settings-close" title="关闭(ESC)" onClick={onClose}>
            ✕
          </button>
        </div>

        <section className="settings-section">
          <h3>难度预设</h3>
          <div className="preset-row">
            {WORLD_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="preset-btn"
                disabled={busy}
                title={preset.desc}
                onClick={() => void applyPreset(preset)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="settings-hint">预设一键应用规则+全部参数(先复位默认再套用)</p>
        </section>

        <section className="settings-section">
          <h3>基础</h3>
          <label className="settings-row" title="关闭后体力归零不死亡,转躺平">
            <input
              type="checkbox"
              checked={storeRules?.allowDeath ?? true}
              disabled={busy || storeRules === null}
              onChange={(e) => void updateRule({ allowDeath: e.target.checked })}
            />
            <span>允许死亡</span>
          </label>
          <label className="settings-row" title="关闭后角色间聊天被世界规则拒绝">
            <input
              type="checkbox"
              checked={storeRules?.allowChat ?? true}
              disabled={busy || storeRules === null}
              onChange={(e) => void updateRule({ allowChat: e.target.checked })}
            />
            <span>允许聊天</span>
          </label>
          <div className="settings-row">
            <span>时间倍率</span>
            <span className="scale-group">
              {WORLD_TIME_SCALES.map((scale) => (
                <button
                  key={scale}
                  type="button"
                  className={snapshot?.timeScale === scale ? 'active' : ''}
                  disabled={busy || snapshot === null}
                  onClick={() => void changeScale(scale)}
                >
                  {scale}x
                </button>
              ))}
            </span>
          </div>
        </section>

        <section className="settings-section">
          <h3>世界参数</h3>
          {draft === null ? (
            <p className="settings-hint">参数加载中…</p>
          ) : (
            <>
              {SYS_CONFIG_GROUPS.map((group) => (
                <div key={group} className="param-group">
                  <div className="param-group-title">{SYS_CONFIG_GROUP_LABELS[group]}</div>
                  {SYS_CONFIG_FIELDS.filter((field) => field.group === group).map((field) => (
                    <label
                      key={field.key}
                      className="param-row"
                      title={`${field.desc}(${SYS_CONFIG_EFFECT_LABELS[field.effect]})`}
                    >
                      <span>
                        {field.label}
                        {field.effect === 'spawn' && <em className="spawn-tag">新</em>}
                      </span>
                      <input
                        type="number"
                        value={draft[field.key] ?? ''}
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev === null
                              ? prev
                              : { ...prev, [field.key]: Number(e.target.value) },
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
              ))}
              <div className="settings-actions">
                <span className="settings-hint">标「新」参数对新角色生效</span>
                <button
                  type="button"
                  className="save-btn"
                  disabled={busy || !dirty}
                  onClick={() => void saveParams()}
                >
                  保存参数
                </button>
              </div>
            </>
          )}
        </section>

        {error !== null && <p className="settings-error">{error}</p>}
      </div>
    </div>
  );
}
