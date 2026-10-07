import { useEffect, useMemo, useState } from 'react';
import {
  App as AntdApp,
  Button,
  Card,
  Collapse,
  Flex,
  InputNumber,
  Popconfirm,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  SYS_CONFIG_EFFECT_LABELS,
  SYS_CONFIG_FIELDS,
  SYS_CONFIG_GROUP_LABELS,
  SYS_CONFIG_GROUPS,
  type SysConfigView,
} from '@sims/shared';
import { fetchSysConfig, resetSysConfig, updateSysConfig } from './api';

/**
 * 世界参数后台编辑页:目录元数据(SYS_CONFIG_FIELDS)驱动分组表单,
 * 编辑目标=当前活跃世界(与游戏内设置菜单共用 applySettingParams 管道,
 * live 参数即时生效,spawn 参数对新角色生效);重置=复位出厂默认。
 */
export function SysConfigPanel() {
  const { message } = AntdApp.useApp();
  const [view, setView] = useState<SysConfigView | null>(null);
  const [draft, setDraft] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSysConfig()
      .then((data) => {
        if (cancelled) return;
        setView(data);
        setDraft({ ...data.effective });
      })
      .catch((err: unknown) => {
        if (!cancelled) message.error(err instanceof Error ? err.message : '参数加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = useMemo(() => {
    if (draft === null || view === null) return false;
    return SYS_CONFIG_FIELDS.some((field) => draft[field.key] !== view.effective[field.key]);
  }, [draft, view]);

  const adopt = (data: SysConfigView): void => {
    setView(data);
    setDraft({ ...data.effective });
  };

  const save = async (): Promise<void> => {
    if (draft === null || view === null) return;
    const updates: Record<string, number> = {};
    for (const field of SYS_CONFIG_FIELDS) {
      const value = draft[field.key];
      if (value !== undefined && value !== view.effective[field.key]) updates[field.key] = value;
    }
    if (Object.keys(updates).length === 0) return;
    setBusy(true);
    try {
      adopt(await updateSysConfig(updates));
      message.success(`已更新 ${Object.keys(updates).length} 项参数`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const reset = async (): Promise<void> => {
    setBusy(true);
    try {
      adopt(await resetSysConfig());
      message.success('已复位出厂默认');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '重置失败');
    } finally {
      setBusy(false);
    }
  };

  const change = (key: string, value: number | null): void => {
    setDraft((prev) => (prev === null ? prev : { ...prev, [key]: value ?? 0 }));
  };

  return (
    <Flex vertical gap={16}>
      <Card
        title="世界参数"
        extra={
          <Flex gap={8}>
            <Popconfirm
              title="复位全部参数为出厂默认?"
              description="当前活跃世界的参数覆盖将被清除"
              okText="复位"
              cancelText="取消"
              onConfirm={() => void reset()}
            >
              <Button danger disabled={busy || view === null}>
                重置默认
              </Button>
            </Popconfirm>
            <Button type="primary" disabled={busy || !dirty} onClick={() => void save()}>
              保存修改
            </Button>
          </Flex>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          编辑目标为当前活跃世界:「立即生效」参数保存后实时生效,标「新」参数对新出生角色生效;
          存档随世界记录持久化,重启不丢。与游戏内「世界设置」菜单共用同一通道。
        </Typography.Paragraph>
        {view === null || draft === null ? (
          <Typography.Text type="secondary">参数加载中…</Typography.Text>
        ) : (
          <Collapse
            defaultActiveKey={[...SYS_CONFIG_GROUPS]}
            items={SYS_CONFIG_GROUPS.map((group) => ({
              key: group,
              label: SYS_CONFIG_GROUP_LABELS[group],
              children: (
                <Flex vertical gap={12}>
                  {SYS_CONFIG_FIELDS.filter((field) => field.group === group).map((field) => (
                    <Flex key={field.key} align="center" gap={12}>
                      <Tooltip title={field.desc}>
                        <Typography.Text style={{ width: 130, flexShrink: 0 }}>
                          {field.label}
                          {field.effect === 'spawn' && (
                            <Tag style={{ marginLeft: 6 }} color="orange">
                              {SYS_CONFIG_EFFECT_LABELS[field.effect]}
                            </Tag>
                          )}
                        </Typography.Text>
                      </Tooltip>
                      <InputNumber
                        min={field.min}
                        max={field.max}
                        step={field.step ?? 1}
                        precision={field.type === 'int' ? 0 : undefined}
                        value={draft[field.key]}
                        status={draft[field.key] !== view.effective[field.key] ? 'warning' : undefined}
                        onChange={(value) => change(field.key, value)}
                        style={{ width: 140 }}
                      />
                      <Typography.Text type="secondary" style={{ flex: 1 }} ellipsis>
                        {field.desc}(范围 {field.min}~{field.max}
                        {field.key === 'NODE_MAX_CHARGES_JUNK' ? ',-1=无限' : ''})
                      </Typography.Text>
                    </Flex>
                  ))}
                </Flex>
              ),
            }))}
          />
        )}
      </Card>
    </Flex>
  );
}
