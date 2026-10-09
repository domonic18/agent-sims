import { useEffect, useState } from 'react';
import {
  SYS_CONFIG_FIELDS,
  SYS_CONFIG_GROUP_LABELS,
  SYS_CONFIG_GROUPS,
} from '@sims/shared';
import { fetchDebugParams, setDebugParams } from '../net/debugApi';

/** 世界参数热调面板(LabPage 左栏二):original=最近一次已知生效值,draft=表单草稿,
 * dirty 决定保存可用;加载失败/保存失败经 onError 透出(时钟控制块统一显示) */
export function ParamsPanel({ onError }: { onError: (message: string | null) => void }) {
  const [paramsOriginal, setParamsOriginal] = useState<Record<string, number> | null>(null);
  const [paramsDraft, setParamsDraft] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDebugParams()
      .then((params) => {
        if (!cancelled) {
          setParamsOriginal(params);
          setParamsDraft(params);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          onError(error instanceof Error ? error.message : '世界参数加载失败');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const paramsDirty =
    paramsOriginal !== null &&
    paramsDraft !== null &&
    SYS_CONFIG_FIELDS.some((field) => paramsDraft[field.key] !== paramsOriginal[field.key]);

  const saveParams = async (): Promise<void> => {
    if (paramsOriginal === null || paramsDraft === null) return;
    const updates: Record<string, number> = {};
    for (const field of SYS_CONFIG_FIELDS) {
      const value = paramsDraft[field.key];
      if (value !== undefined && value !== paramsOriginal[field.key]) updates[field.key] = value;
    }
    if (Object.keys(updates).length === 0) return;
    try {
      const params = await setDebugParams(updates);
      setParamsOriginal(params);
      setParamsDraft(params);
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="px-box lab-panel-px">
      <div className="px-inner lab-panel-inner">
        <h3>世界参数热调</h3>
        {paramsDraft === null ? (
          <p className="hint">参数加载中…</p>
        ) : (
          <>
            {SYS_CONFIG_GROUPS.map((group) => (
              <div key={group} className="param-group">
                <div className="param-group-title">{SYS_CONFIG_GROUP_LABELS[group]}</div>
                {SYS_CONFIG_FIELDS.filter((field) => field.group === group).map((field) => (
                  <label key={field.key} className="param-row" title={field.desc}>
                    <span>{field.label}</span>
                    <input
                      type="number"
                      value={paramsDraft[field.key] ?? ''}
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      onChange={(e) =>
                        setParamsDraft((prev) =>
                          prev === null ? prev : { ...prev, [field.key]: Number(e.target.value) },
                        )
                      }
                    />
                  </label>
                ))}
              </div>
            ))}
            <button
              type="button"
              className="px-btn"
              disabled={!paramsDirty}
              onClick={() => void saveParams()}
            >
              保存参数
            </button>
          </>
        )}
      </div>
    </div>
  );
}
