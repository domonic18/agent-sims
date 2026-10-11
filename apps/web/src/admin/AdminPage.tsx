import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Alert,
  App as AntdApp,
  Avatar,
  Button,
  ConfigProvider,
  Drawer,
  Dropdown,
  Form,
  Input,
  Layout,
  Menu,
  type MenuProps,
} from 'antd';
import {
  BarChartOutlined,
  ControlOutlined,
  EnvironmentOutlined,
  FileTextOutlined,
  GlobalOutlined,
  MenuOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  LogoutOutlined,
  NodeIndexOutlined,
  RobotOutlined,
  SettingOutlined,
  UserOutlined,
  ExperimentOutlined,
  ProfileOutlined,
} from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import 'dayjs/locale/zh-cn';
import type { ModelConfigView } from '@sims/shared';
import { ApiError, clearToken, fetchModelConfigs, getToken, login, setToken } from './api';
import { ADMIN_THEME } from './adminTheme';
import { fmtTokens, useAdminStatus } from './useAdminStatus';
import { ModelConfigPanel } from './ModelConfigPanel';
import { TokenUsagePanel } from './TokenUsagePanel';
import { AssetsPanel } from './AssetsPanel';
import { LogsPanel } from './LogsPanel';
import { AgentTracePanel } from './AgentTracePanel';
import { WorldPanel } from './WorldPanel';
import { MapLibraryPanel } from './MapLibraryPanel';
import { SysConfigPanel } from './SysConfigPanel';
import { RecipesPanel } from './RecipesPanel';
import { AnimPreviewPanel } from './AnimPreviewPanel';
import { SettingsPanel } from './SettingsPanel';
import { PromptsPanel } from './PromptsPanel';
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
    <div className="adm-login">
      <div className="px-box adm-login-card">
        <div className="px-inner adm-login-inner">
          <div className="adm-login-title px-title-shadow">AGENT·SIMS</div>
          <div className="adm-login-sub">控制台登录</div>
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
              进入控制台
            </Button>
          </Form>
        </div>
      </div>
    </div>
  );
}

type AdminTab =
  | 'world'
  | 'params'
  | 'recipes'
  | 'maps'
  | 'models'
  | 'usage'
  | 'assets'
  | 'anim'
  | 'traces'
  | 'logs'
  | 'prompts'
  | 'settings';

const NAV_ITEMS: MenuProps['items'] = [
  {
    type: 'group',
    label: '运营',
    children: [
      { key: 'world', icon: <GlobalOutlined />, label: '世界管理' },
      { key: 'models', icon: <RobotOutlined />, label: '模型配置' },
      { key: 'params', icon: <ControlOutlined />, label: '世界参数' },
      { key: 'recipes', icon: <ExperimentOutlined />, label: '世界配方' },
      { key: 'maps', icon: <EnvironmentOutlined />, label: '地图库' },
      { key: 'usage', icon: <BarChartOutlined />, label: 'Token 用量' },
      { key: 'assets', icon: <PictureOutlined />, label: '素材管理' },
      { key: 'anim', icon: <PlayCircleOutlined />, label: '动画演示器' },
      { key: 'traces', icon: <NodeIndexOutlined />, label: '决策追踪' },
      { key: 'logs', icon: <FileTextOutlined />, label: '运行日志' },
      { key: 'prompts', icon: <ProfileOutlined />, label: '提示词' },
    ],
  },
  {
    type: 'group',
    label: '系统',
    children: [{ key: 'settings', icon: <SettingOutlined />, label: '账户安全' }],
  },
];

function StatusStrip({ status }: { status: ReturnType<typeof useAdminStatus> }) {
  return (
    <div className="adm-status">
      <span className="adm-status-item">
        <i className={status.world ? 'adm-dot on' : 'adm-dot'} />
        {status.world ? `${status.world.name} · ${status.world.characters} 角色` : '无活跃世界'}
      </span>
      <span className="adm-sep" />
      <span className="adm-status-item adm-mono adm-status-tok">
        今日 {fmtTokens(status.tokensToday)} tok · {status.callsToday ?? '—'} 次
      </span>
    </div>
  );
}

/** 手机断点(<768px): matchMedia 直读首帧无闪烁,避免 Grid.useBreakpoint 首渲染空对象回退桌面态 */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = (e: MediaQueryListEvent): void => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

function AdminShell() {
  const [authed, setAuthed] = useState(() => getToken() !== null);
  const [username, setUsername] = useState('');
  const [tab, setTab] = useState<AdminTab>('world');
  const [configs, setConfigs] = useState<ModelConfigView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const status = useAdminStatus(authed);
  // hooks 必须全部先于 if (!authed) 早退调用,否则登录翻转 authed 后 hook 数量变化直接崩溃
  const isMobile = useIsMobile();
  const [navOpen, setNavOpen] = useState(false);

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

  const PANELS: Record<AdminTab, { title: string; desc: string; render: () => ReactNode }> = {
    world: { title: '世界管理', desc: '世界生命周期与居民编制', render: () => <WorldPanel /> },
    models: {
      title: '模型配置',
      desc: '四槽位模型接入与连通性',
      render: () => (
        <>
          {loadError && <Alert type="error" showIcon message={loadError} style={{ marginBottom: 16 }} />}
          {!configs ? (
            <div className="adm-loading">加载中…</div>
          ) : (
            <ModelConfigPanel configs={configs} onChanged={() => void load()} />
          )}
        </>
      ),
    },
    params: { title: '世界参数', desc: '全局数值与系统配置', render: () => <SysConfigPanel /> },
    recipes: { title: '世界配方', desc: '采集·制作·出售链路配方', render: () => <RecipesPanel /> },
    maps: { title: '地图库', desc: '自定义地图管理·体检发布', render: () => <MapLibraryPanel /> },
    usage: { title: 'Token 用量', desc: '模型消耗统计与调用流水', render: () => <TokenUsagePanel /> },
    assets: { title: '素材管理', desc: '素材库分类·审核与发布', render: () => <AssetsPanel /> },
    anim: { title: '动画演示器', desc: '角色动画帧预览', render: () => <AnimPreviewPanel /> },
    traces: { title: '决策追踪', desc: 'Agent 决策链与 want 生命周期', render: () => <AgentTracePanel /> },
    logs: { title: '运行日志', desc: '技术与审计日志检索', render: () => <LogsPanel /> },
    prompts: { title: '提示词', desc: '当前生效的提示词模板', render: () => <PromptsPanel /> },
    settings: { title: '账户安全', desc: '登录密码管理', render: () => <SettingsPanel username={username} /> },
  };

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

  const panel = PANELS[tab];

  const selectTab = (key: string): void => {
    setTab(key as AdminTab);
    setNavOpen(false);
  };

  const navContent = (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="px-box adm-logo">
        <div className="px-inner adm-logo-inner">
          <span className="adm-logo-title px-title-shadow">AGENT·SIMS</span>
          <span className="adm-logo-sub">控制台</span>
        </div>
      </div>
      <Menu
        mode="inline"
        items={NAV_ITEMS}
        selectedKeys={[tab]}
        onClick={({ key }) => selectTab(key)}
        style={{ flex: 1, borderInlineEnd: 'none' }}
      />
      <div className="adm-sider-user">
        <span className="adm-sider-user-name">{username || '已登录'}</span>
        <Dropdown
          menu={{ items: [{ key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: logout }] }}
          trigger={['click']}
        >
          <Avatar size="small" icon={<UserOutlined />} style={{ cursor: 'pointer', flexShrink: 0 }} />
        </Dropdown>
      </div>
    </div>
  );

  return (
    <Layout className="adm-shell" style={{ minHeight: '100vh' }}>
      {!isMobile && (
        <Layout.Sider width={200} style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}>
          {navContent}
        </Layout.Sider>
      )}
      <Layout>
        <Layout.Header className="adm-head">
          {isMobile && (
            <Button
              type="text"
              className="adm-nav-btn"
              icon={<MenuOutlined />}
              aria-label="打开导航菜单"
              onClick={() => setNavOpen(true)}
            />
          )}
          <span className="adm-head-title">{panel.title}</span>
          <span className="adm-head-desc">{panel.desc}</span>
          <span className="adm-head-spacer" />
          <StatusStrip status={status} />
        </Layout.Header>
        <Layout.Content className="adm-content">
          <div style={{ maxWidth: 1280, margin: '0 auto' }}>{panel.render()}</div>
        </Layout.Content>
      </Layout>
      {isMobile && (
        <Drawer
          placement="left"
          width={272}
          open={navOpen}
          onClose={() => setNavOpen(false)}
          closeIcon={null}
          styles={{ body: { padding: 0 } }}
          className="adm-nav-drawer"
        >
          {navContent}
        </Drawer>
      )}
    </Layout>
  );
}

/** ConfigProvider/AntdApp 挂在本页内部(非 main.tsx):antd 及其 CSS-in-JS 只进 admin chunk */
export default function AdminPage() {
  return (
    <ConfigProvider locale={zhCN} theme={ADMIN_THEME}>
      <AntdApp>
        <AdminShell />
      </AntdApp>
    </ConfigProvider>
  );
}
