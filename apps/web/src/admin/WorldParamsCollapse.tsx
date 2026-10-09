import { Collapse, Col, Form, InputNumber, Row, Tooltip, Typography } from 'antd';
import { SYS_CONFIG_FIELDS, SYS_CONFIG_GROUP_LABELS, SYS_CONFIG_GROUPS } from '@sims/shared';

/** 世界参数折叠区(默认收起):17 项随本世界创建定格,defaults 由挂载时回填 form store */
export function WorldParamsCollapse({ busy }: { busy: boolean }) {
  return (
    <Collapse
      ghost
      style={{ marginTop: 8 }}
      items={[
        {
          key: 'params',
          label: '世界参数(展开调整;默认值已是最优,改动随本世界存档)',
          children: (
            <>
              {SYS_CONFIG_GROUPS.map((group) => (
                <div key={group} style={{ marginBottom: 12 }}>
                  <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                    {SYS_CONFIG_GROUP_LABELS[group]}
                  </Typography.Text>
                  <Row gutter={[16, 0]}>
                    {SYS_CONFIG_FIELDS.filter((field) => field.group === group).map((field) => (
                      <Col xs={24} sm={12} lg={8} key={field.key}>
                        <Form.Item
                          name={['rules', 'params', field.key]}
                          label={<Tooltip title={field.desc}>{field.label}</Tooltip>}
                          style={{ marginBottom: 8 }}
                        >
                          <InputNumber
                            min={field.min}
                            max={field.max}
                            step={field.step}
                            style={{ width: '100%' }}
                            disabled={busy}
                          />
                        </Form.Item>
                      </Col>
                    ))}
                  </Row>
                </div>
              ))}
              <p style={{ margin: 0, fontSize: 12, color: '#8c8c8c' }}>
                参数随本世界创建定格并随 config 存档;运行中修改请到 /lab 调试台控制面板。
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
