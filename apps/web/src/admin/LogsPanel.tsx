import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Flex,
  Input,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  type TableProps,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type {
  AuditLogEntriesResponse,
  AuditLogEntryView,
  TechLogEntriesResponse,
  TechLogEntryView,
  WorldEventEntriesResponse,
  WorldEventEntryView,
} from '@sims/shared';
import { fetchAuditLogEntries, fetchTechLogEntries, fetchWorldEventEntries } from './api';

const PAGE_SIZE = 20;

const fmtTime = (iso: string): string =>
  new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

function JsonCell(props: { value: Record<string, unknown> | null }) {
  if (!props.value || Object.keys(props.value).length === 0) {
    return <Typography.Text type="secondary">-</Typography.Text>;
  }
  const text = JSON.stringify(props.value);
  return (
    <Typography.Text code ellipsis title={text} style={{ maxWidth: 420, fontSize: 12 }}>
      {text}
    </Typography.Text>
  );
}

const LEVEL_COLORS: Record<string, string> = { info: 'blue', warn: 'orange', error: 'red' };

function FilterBar(props: { children: React.ReactNode; onRefresh: () => void }) {
  return (
    <Space wrap style={{ marginBottom: 12 }}>
      {props.children}
      <Button icon={<ReloadOutlined />} onClick={props.onRefresh}>
        刷新
      </Button>
    </Space>
  );
}

function pagedTableProps<T>(
  data: { total: number; page: number; pageSize: number } | null,
  page: number,
  setPage: (next: number) => void,
): TableProps<T> {
  return {
    size: 'small',
    loading: data === null,
    locale: { emptyText: '无匹配记录' },
    pagination: {
      current: page,
      pageSize: data?.pageSize ?? PAGE_SIZE,
      total: data?.total ?? 0,
      showSizeChanger: false,
      showTotal: (total) => `共 ${total.toLocaleString('en-US')} 条`,
      onChange: setPage,
    },
  };
}

function WorldEventsTab() {
  const [characterFilter, setCharacterFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<WorldEventEntriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchWorldEventEntries({
      characterId: characterFilter || undefined,
      type: typeFilter || undefined,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((resp) => {
        if (!cancelled) setData(resp);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [characterFilter, typeFilter, page, refreshKey]);

  const columns: NonNullable<TableProps<WorldEventEntryView>['columns']> = [
    { title: '时间', dataIndex: 'createdAt', width: 150, render: (v: string) => fmtTime(v) },
    { title: '类型', dataIndex: 'type', width: 200, render: (v: string) => <Tag>{v}</Tag> },
    { title: '角色', dataIndex: 'characterId', width: 130, render: (v: string | null) => v ?? '-' },
    { title: 'tick', dataIndex: 'tick', width: 80, align: 'right' },
    {
      title: 'payload',
      dataIndex: 'payload',
      render: (v: Record<string, unknown>) => <JsonCell value={v} />,
    },
  ];

  return (
    <Card size="small" title="世界事件日志(EventBus 落库,游戏内发生的所有世界事件)">
      <FilterBar onRefresh={() => { setPage(1); setRefreshKey((key) => key + 1); }}>
        <Input
          value={characterFilter}
          placeholder="按角色 ID 过滤"
          style={{ width: 200 }}
          allowClear
          onChange={(e) => {
            setCharacterFilter(e.target.value);
            setPage(1);
          }}
        />
        <Input
          value={typeFilter}
          placeholder="按事件类型过滤,如 social.chat"
          style={{ width: 240 }}
          allowClear
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
        />
      </FilterBar>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <Table<WorldEventEntryView> rowKey="id" columns={columns} dataSource={data?.entries ?? []} {...pagedTableProps<WorldEventEntryView>(data, page, setPage)} />
    </Card>
  );
}

function TechLogsTab() {
  const [levelFilter, setLevelFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TechLogEntriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchTechLogEntries({
      level: levelFilter || undefined,
      source: sourceFilter || undefined,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((resp) => {
        if (!cancelled) setData(resp);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [levelFilter, sourceFilter, page, refreshKey]);

  const columns: NonNullable<TableProps<TechLogEntryView>['columns']> = [
    { title: '时间', dataIndex: 'createdAt', width: 150, render: (v: string) => fmtTime(v) },
    {
      title: '级别',
      dataIndex: 'level',
      width: 80,
      render: (v: string) => <Tag color={LEVEL_COLORS[v] ?? 'default'}>{v}</Tag>,
    },
    { title: '来源', dataIndex: 'source', width: 100 },
    { title: '消息', dataIndex: 'message', ellipsis: true },
    {
      title: '详情',
      dataIndex: 'detail',
      width: 420,
      render: (v: Record<string, unknown> | null) => <JsonCell value={v} />,
    },
  ];

  return (
    <Card size="small" title="技术运行日志(LLM 调用/未捕获异常/慢 tick 等运行事件)">
      <FilterBar onRefresh={() => { setPage(1); setRefreshKey((key) => key + 1); }}>
        <Select
          value={levelFilter}
          onChange={(value) => {
            setLevelFilter(value);
            setPage(1);
          }}
          style={{ minWidth: 140 }}
          options={[
            { value: '', label: '全部级别' },
            { value: 'info', label: 'info' },
            { value: 'warn', label: 'warn' },
            { value: 'error', label: 'error' },
          ]}
        />
        <Input
          value={sourceFilter}
          placeholder="按来源过滤,如 llm/http/tick"
          style={{ width: 220 }}
          allowClear
          onChange={(e) => {
            setSourceFilter(e.target.value);
            setPage(1);
          }}
        />
      </FilterBar>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <Table<TechLogEntryView> rowKey="id" columns={columns} dataSource={data?.entries ?? []} {...pagedTableProps<TechLogEntryView>(data, page, setPage)} />
    </Card>
  );
}

function statusColor(code: number): string {
  if (code >= 500) return 'red';
  if (code >= 400) return 'orange';
  if (code >= 200) return 'green';
  return 'default';
}

function AuditLogsTab() {
  const [usernameFilter, setUsernameFilter] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditLogEntriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchAuditLogEntries({
      username: usernameFilter || undefined,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((resp) => {
        if (!cancelled) setData(resp);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [usernameFilter, page, refreshKey]);

  const columns: NonNullable<TableProps<AuditLogEntryView>['columns']> = [
    { title: '时间', dataIndex: 'createdAt', width: 150, render: (v: string) => fmtTime(v) },
    {
      title: '操作者',
      dataIndex: 'username',
      width: 140,
      render: (v: string | null) => v ?? <Typography.Text type="secondary">未认证</Typography.Text>,
    },
    { title: '方法', dataIndex: 'method', width: 80 },
    { title: '路径', dataIndex: 'path', ellipsis: true },
    {
      title: '状态码',
      dataIndex: 'statusCode',
      width: 90,
      render: (v: number) => <Tag color={statusColor(v)}>{v}</Tag>,
    },
  ];

  return (
    <Card size="small" title="操作审计(后台非 GET 请求留痕,含失败尝试)">
      <FilterBar onRefresh={() => { setPage(1); setRefreshKey((key) => key + 1); }}>
        <Input
          value={usernameFilter}
          placeholder="按操作者过滤"
          style={{ width: 200 }}
          allowClear
          onChange={(e) => {
            setUsernameFilter(e.target.value);
            setPage(1);
          }}
        />
      </FilterBar>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <Table<AuditLogEntryView> rowKey="id" columns={columns} dataSource={data?.entries ?? []} {...pagedTableProps<AuditLogEntryView>(data, page, setPage)} />
    </Card>
  );
}

/** M-G.1 三日志页:世界事件/技术运行/操作审计,共用分页协议 */
export function LogsPanel() {
  return (
    <Flex vertical gap={16}>
      <Tabs
        defaultActiveKey="world"
        items={[
          { key: 'world', label: '世界事件', children: <WorldEventsTab /> },
          { key: 'tech', label: '运行日志', children: <TechLogsTab /> },
          { key: 'audit', label: '操作审计', children: <AuditLogsTab /> },
        ]}
      />
    </Flex>
  );
}
