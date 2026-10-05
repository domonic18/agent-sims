import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  Flex,
  Form,
  Input,
  InputNumber,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import {
  SYS_CONFIG_EFFECT_LABELS,
  SYS_CONFIG_GROUP_LABELS,
  SYS_CONFIG_GROUPS,
  type SysConfigEffect,
  type SysConfigField,
  type SysConfigView,
} from '@sims/shared';
import { changePassword, fetchSysConfig, resetSysConfig, updateSysConfig } from './api';

const EFFECT_TAG_COLORS: Record<SysConfigEffect, string> = {
  live: 'success',
  spawn: 'processing',
  world: 'warning',
};

interface AccountSecurityValues {
  oldPassword: string;
  newPassword: string;
  confirm: string;
}

function AccountSecurityCard(props: { username: string }) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<AccountSecurityValues>();
  const [busy, setBusy] = useState(false);

  const onFinish = async (values: AccountSecurityValues): Promise<void> => {
    setBusy(true);
    try {
      await changePassword({ oldPassword: values.oldPassword, newPassword: values.newPassword });
      message.success('密码已更新,当前登录态不受影响');
      form.resetFields();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '修改失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="账户安全">
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        当前账户 <b>{props.username || 'admin'}</b> · 修改后下次登录使用新密码
      </Typography.Paragraph>
      <Form<AccountSecurityValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        style={{ maxWidth: 360 }}
        onFinish={(values) => void onFinish(values)}
      >
        <Form.Item
          name="oldPassword"
          label="原密码"
          rules={[{ required: true, message: '请输入原密码' }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="新密码(8~64 位)"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 8, message: '至少 8 位' },
            { max: 64, message: '至多 64 位' },
          ]}
        >
          <Input.Password autoComplete="new-password" placeholder="至少 8 位" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="确认新密码"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: '请再次输入新密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                return Promise.reject(new Error('两次输入的新密码不一致'));
              },
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={busy}>
          修改密码
        </Button>
      </Form>
    </Card>
  );
}

const formatValue = (field: SysConfigField, value: number): string =>
  field.type === 'float' ? String(value) : String(Math.round(value));

function SystemParamsCard() {
  const { modal } = AntdApp.useApp();
  const [view, setView] = useState<SysConfigView | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const applyView = useCallback((data: SysConfigView) => {
    setView(data);
    setDraft(
      Object.fromEntries(data.fields.map((field) => [field.key, formatValue(field, data.effective[field.key] ?? data.defaults[field.key] ?? 0)])),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchSysConfig()
      .then((data) => {
        if (!cancelled) applyView(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [applyView]);

  const save = async (): Promise<void> => {
    if (view === null) return;
    const updates: Record<string, number> = {};
    for (const field of view.fields) {
      const raw = draft[field.key]?.trim() ?? '';
      const value = field.type === 'int' ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
      if (!Number.isFinite(value)) {
        setError(`「${field.label}」不是合法数字`);
        return;
      }
      updates[field.key] = value;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      applyView(await updateSysConfig(updates));
      setNotice('参数已保存并热更新生效');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const restoreDefaults = (): void => {
    modal.confirm({
      title: '恢复全部系统参数为出厂默认值?',
      content: '覆盖记录将被清空,所有字段回到内置默认值。',
      okText: '恢复默认',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
          applyView(await resetSysConfig());
          setNotice('已恢复默认值(覆盖记录已清空)');
        } catch (err) {
          setError(err instanceof Error ? err.message : '恢复失败');
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const dirty =
    view !== null &&
    view.fields.some(
      (field) => (draft[field.key]?.trim() ?? '') !== formatValue(field, view.effective[field.key] ?? 0),
    );

  return (
    <Card title="系统参数">
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        运行时数值热调(保存即生效);仅含服务端参数——移速/背包容积/时间倍率档位等双端同源常量与时序基建不开放
      </Typography.Paragraph>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      {notice && <Alert type="success" showIcon message={notice} style={{ marginBottom: 12 }} />}
      {!view && !error && (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin />
        </div>
      )}
      {view && (
        <>
          {SYS_CONFIG_GROUPS.map((group) => (
            <div key={group} style={{ marginBottom: 4 }}>
              <Typography.Text strong style={{ display: 'block', marginBottom: 10 }}>
                {SYS_CONFIG_GROUP_LABELS[group]}
              </Typography.Text>
              <Row gutter={[16, 0]}>
                {view.fields
                  .filter((field) => field.group === group)
                  .map((field) => (
                    <Col xs={24} sm={12} lg={8} key={field.key}>
                      <Form.Item
                        label={
                          <Space size={6} wrap>
                            <span>{field.label}</span>
                            <Tag color={EFFECT_TAG_COLORS[field.effect]} style={{ marginInlineEnd: 0 }}>
                              {SYS_CONFIG_EFFECT_LABELS[field.effect]}
                            </Tag>
                            {view.overrides[field.key] !== undefined && (
                              <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                                已自定义
                              </Tag>
                            )}
                          </Space>
                        }
                        extra={`${field.desc} · 范围 ${field.min}~${field.max}`}
                        style={{ marginBottom: 16 }}
                      >
                        <InputNumber
                          value={draft[field.key] ?? ''}
                          onChange={(value) =>
                            setDraft((prev) => ({ ...prev, [field.key]: value == null ? '' : String(value) }))
                          }
                          style={{ width: '100%' }}
                          controls={false}
                        />
                      </Form.Item>
                    </Col>
                  ))}
              </Row>
            </div>
          ))}
          <Space style={{ marginTop: 8 }}>
            <Button type="primary" loading={busy} disabled={!dirty} onClick={() => void save()}>
              保存并生效
            </Button>
            <Button disabled={busy} onClick={restoreDefaults}>
              恢复默认
            </Button>
            <Button disabled={busy || !dirty} onClick={() => applyView(view)}>
              放弃改动
            </Button>
          </Space>
        </>
      )}
    </Card>
  );
}

export function SettingsPanel(props: { username: string }) {
  return (
    <Flex vertical gap={16}>
      <AccountSecurityCard username={props.username} />
      <SystemParamsCard />
    </Flex>
  );
}
