import { useState } from 'react';
import { App as AntdApp, Button, Card, Flex, Form, Input, Typography } from 'antd';
import { changePassword } from './api';

interface AccountSecurityValues {
  oldPassword: string;
  newPassword: string;
  confirm: string;
}

/** 账户安全(原「系统设置」):系统参数已世界化,本页仅保留改密 */
export function SettingsPanel(props: { username: string }) {
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
    <Flex vertical gap={16}>
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
    </Flex>
  );
}
