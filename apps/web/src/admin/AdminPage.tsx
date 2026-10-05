import { useCallback, useEffect, useState } from 'react';
import {
  App as AntdApp,
  Avatar,
  Button,
  Card,
  ConfigProvider,
  Dropdown,
  Form,
  Input,
  Layout,
  Menu,
  type MenuProps,
} from 'antd';
import {
  BarChartOutlined,
  GlobalOutlined,
  LogoutOutlined,
  RobotOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import 'dayjs/locale/zh-cn';
import type { ModelConfigView } from '@sims/shared';
import { ApiError, clearToken, fetchModelConfigs, getToken, login, setToken } from './api';
import { ModelConfigPanel } from './ModelConfigPanel';
import { TokenUsagePanel } from './TokenUsagePanel';
import { WorldPanel } from './WorldPanel';
import { SettingsPanel } from './SettingsPanel';
import './admin.css';

function LoginForm({ onSuccess }: { onSuccess: (username: string) => void }) {
  const { message } = AntdApp.useApp();
  const [submitting, setSubmitting] = useState(false);

  const onFinish = async (values: { username: string; password: string }) => {
    setSubmitting(true);
    try {
      const result = await login({ username: values.username, password: values.password });
      setToken(result.token);
      onSuccess(values.username);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f5f5f5',
      }}
    >
      <Card title="agent-sims 后台" style={{ width: 360 }}>
        <Form
          layout="vertical"
          requiredMark={false}
          initialValues={{ username: 'admin' }}
          onFinish={(values) => void onFinish(values)}
        >
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password autoComplete="current-password" autoFocus />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  );
}

type AdminTab = 'world' | 'models' | 'usage' | 'settings';

const NAV_ITEMS: MenuProps['items'] = [
  {
    type: 'group',
    label: '运营',
    children: [
      { key: 'world', icon: <GlobalOutlined />, label: '世界管理' },
      { key: 'models', icon: <RobotOutlined />, label: '模型配置' },
      { key: 'usage', icon: <BarChartOutlined />, label: 'Token 用量' },
    ],
  },
  {
    type: 'group',
    label: '系统',
    children: [{ key: 'settings', icon: <SettingOutlined />, label: '系统设置' }],
  },
];

function AdminShell() {
  const [authed, setAuthed] = useState(() => getToken() !== null);
  const [username, setUsername] = useState('');
  const [tab, setTab] = useState<AdminTab>('world');
  const [configs, setConfigs] = useState<ModelConfigView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setConfigs(await fetchModelConfigs());
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthed(false);
        return;
      }
      setLoadError(err instanceof Error ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    // 挂载即探测 token 有效性(401 统一回登录页),模型 tab 激活时再刷新
    if (authed) void load();
  }, [authed, load]);

  useEffect(() => {
    if (authed && tab === 'models') void load();
  }, [authed, tab, load]);

  if (!authed) {
    return (
      <LoginForm
        onSuccess={(name) => {
          setUsername(name);
          setAuthed(true);
        }}
      />
    );
  }

  const logout = () => {
    clearToken();
    setConfigs(null);
    setAuthed(false);
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider
        width={220}
        theme="light"
        style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}
      >
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              padding: '18px 16px',
              fontSize: 15,
              fontWeight: 600,
              borderBottom: '1px solid #f0f0f0',
            }}
          >
            agent-sims 后台
          </div>
          <Menu
            mode="inline"
            items={NAV_ITEMS}
            selectedKeys={[tab]}
            onClick={({ key }) => setTab(key as AdminTab)}
            style={{ flex: 1, borderInlineEnd: 'none' }}
          />
          <div
            style={{
              padding: '12px 16px',
              borderTop: '1px solid #f0f0f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span
              style={{ fontSize: 12, color: '#57606a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {username || '已登录'}
            </span>
            <Dropdown
              menu={{ items: [{ key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: logout }] }}
              trigger={['click']}
            >
              <Avatar size="small" icon={<UserOutlined />} style={{ cursor: 'pointer', flexShrink: 0 }} />
            </Dropdown>
          </div>
        </div>
      </Layout.Sider>
      <Layout.Content style={{ padding: 24 }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          {tab === 'world' ? (
            <WorldPanel />
          ) : tab === 'usage' ? (
            <TokenUsagePanel />
          ) : tab === 'settings' ? (
            <SettingsPanel username={username} />
          ) : (
            <>
              {loadError && <p className="admin-error">{loadError}</p>}
              {!configs ? (
                <p>加载中…</p>
              ) : (
                <ModelConfigPanel configs={configs} onChanged={() => void load()} />
              )}
            </>
          )}
        </div>
      </Layout.Content>
    </Layout>
  );
}

/** ConfigProvider/AntdApp 挂在本页内部(非 main.tsx):antd 及其 CSS-in-JS 只进 admin chunk */
export default function AdminPage() {
  return (
    <ConfigProvider locale={zhCN}>
      <AntdApp>
        <AdminShell />
      </AntdApp>
    </ConfigProvider>
  );
}
