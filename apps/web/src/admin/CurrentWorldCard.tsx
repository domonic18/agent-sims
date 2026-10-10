import { useState } from 'react';
import {
  App as AntdApp,
  Button,
  Card,
  Flex,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tag,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import {
  GENDERS,
  GENDER_LABELS,
  WORLD_CHARACTER_LIMITS,
  pickRandomName,
  type Gender,
  type WorldView,
} from '@sims/shared';
import { ApiError, addWorldCharacter } from './api';

export interface CharacterRow {
  name: string;
  gender: Gender;
  persona?: string;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

export function CurrentWorldCard({
  active,
  busy,
  onClose,
  onAdded,
}: {
  active: WorldView;
  busy: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { message } = AntdApp.useApp();
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addForm] = Form.useForm<CharacterRow & { gender: Gender }>();

  const submitAdd = async (): Promise<void> => {
    const values = await addForm.validateFields();
    setAddBusy(true);
    try {
      const spawned = await addWorldCharacter({
        name: values.name.trim(),
        gender: values.gender,
        ...(values.persona?.trim() ? { persona: values.persona.trim() } : {}),
      });
      message.success(`「${spawned.name}」已入驻小镇 (${spawned.x},${spawned.y})`);
      setAddOpen(false);
      addForm.resetFields();
      onAdded();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : '添加失败');
    } finally {
      setAddBusy(false);
    }
  };

  return (
    <Card
      title="当前世界"
      extra={
        <Space>
          <Button
            size="small"
            icon={<PlusOutlined />}
            disabled={busy || active.characters.length >= WORLD_CHARACTER_LIMITS.max}
            onClick={() => setAddOpen(true)}
          >
            添加居民
          </Button>
          <Popconfirm title="关闭并归档该世界?模拟将暂停" okText="关闭" onConfirm={onClose}>
            <Button size="small" disabled={busy}>
              关闭世界
            </Button>
          </Popconfirm>
        </Space>
      }
    >
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        <Space wrap>
          <strong>{active.name}</strong>
          <Tag color="success">运行中</Tag>
          <span style={{ fontSize: 12, color: '#8c8c8c' }}>创建于 {formatTime(active.createdAt)}</span>
        </Space>
        <List
          size="small"
          split={false}
          dataSource={active.characters}
          renderItem={(c) => (
            <List.Item style={{ padding: '2px 0' }}>
              <span>
                {c.name}
                <small style={{ color: '#8c8c8c' }}>
                  {' '}
                  · {GENDER_LABELS[c.gender]}
                  {c.persona ? ` · ${c.persona}` : ''}
                </small>
              </span>
            </List.Item>
          )}
        />
        <Flex gap={6} wrap="wrap">
          <Tag color={active.rules.allowDeath ? 'success' : 'default'}>
            死亡 {active.rules.allowDeath ? '开' : '关'}
          </Tag>
          <Tag color={active.rules.allowChat ? 'success' : 'default'}>
            聊天 {active.rules.allowChat ? '开' : '关'}
          </Tag>
          <Tag color="default">倍率 {active.rules.initialTimeScale}x</Tag>
          <Tag color={active.rules.maxGameDays > 0 ? 'warning' : 'default'}>
            上限 {active.rules.maxGameDays > 0 ? `${active.rules.maxGameDays} 日` : '不限'}
          </Tag>
        </Flex>
      </Space>
      <Modal
        title="添加居民"
        open={addOpen}
        okText="入驻"
        onCancel={() => setAddOpen(false)}
        confirmLoading={addBusy}
        onOk={() => void submitAdd()}
      >
        <Form form={addForm} layout="vertical" requiredMark={false}>
          <Form.Item
            name="name"
            label="名字"
            rules={[
              { required: true, whitespace: true, message: '名字不能为空' },
              { max: 20, message: '至多 20 字' },
            ]}
          >
            <Input
              maxLength={20}
              placeholder="居民名"
              suffix={
                <Button
                  size="small"
                  type="link"
                  onClick={() => addForm.setFieldValue('name', pickRandomName('unspecified'))}
                >
                  随机
                </Button>
              }
            />
          </Form.Item>
          <Form.Item name="gender" label="性别" initialValue="unspecified">
            <Select options={GENDERS.map((g) => ({ value: g, label: GENDER_LABELS[g] }))} />
          </Form.Item>
          <Form.Item name="persona" label="人设(预留)" >
            <Input maxLength={100} placeholder="一句话人设,预留字段" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
