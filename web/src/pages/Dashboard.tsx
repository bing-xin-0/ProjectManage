import { useEffect, useState, useCallback } from 'react';
import { Card, Col, Row, Tag, Button, Space, Typography, Empty, App, Modal, Form, Input, Dropdown, Badge, Statistic } from 'antd';
import { PlusOutlined, StarFilled, StarOutlined, DeleteOutlined, EyeOutlined, WarningOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { projectApi, setToken, type Project, type DashboardData } from '../api';

const { Title, Text } = Typography;

const STATUS_COLOR: Record<string, string> = {
  active: 'green',
  paused: 'orange',
  completed: 'blue',
  archived: 'default',
};
const STATUS_LABEL: Record<string, string> = {
  active: '活跃',
  paused: '暂停',
  completed: '完成',
  archived: '归档',
};

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const { message, modal } = App.useApp();
  const nav = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await projectApi.dashboard();
      setData(d);
    } catch (e: any) {
      if (e.status === 401) {
        setToken(null);
        window.location.reload();
      } else {
        message.error(e.message ?? '加载失败');
      }
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    load();
  }, [load]);

  const createProject = async (values: { name: string; repo_remote?: string; description?: string }) => {
    try {
      await projectApi.create(values);
      message.success('项目已添加');
      setAddOpen(false);
      load();
    } catch (e: any) {
      message.error(e.message ?? '添加失败');
    }
  };

  const toggleStar = async (p: Project) => {
    await projectApi.update(p.id, { starred: p.starred ? 0 : 1 });
    load();
  };

  const removeProject = (p: Project) => {
    modal.confirm({
      title: `删除项目「${p.name}」？`,
      content: '将删除该项目及其提交历史（软删）。此操作不可撤销。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await projectApi.remove(p.id);
        message.success('已删除');
        load();
      },
    });
  };

  const logout = () => {
    setToken(null);
    window.location.reload();
  };

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={2} style={{ margin: 0 }}>
            项目管家 · Project Pulse
          </Title>
        </Col>
        <Col>
          <Space>
            <Button onClick={() => nav('/reports')}>日报 / 周报</Button>
            <Button onClick={logout}>退出</Button>
          </Space>
        </Col>
      </Row>

      {data && (
        <>
          {/* 凉了提醒区 */}
          {data.stale.length > 0 && (
            <Card
              style={{ marginBottom: 16, borderColor: '#faad14' }}
              title={
                <Space>
                  <WarningOutlined style={{ color: '#faad14' }} />
                  <span>凉了提醒（{data.stale.length}）</span>
                </Space>
              }
            >
              <Space wrap>
                {data.stale.map((p) => (
                  <Tag key={p.id} color="orange" style={{ padding: '4px 12px', cursor: 'pointer' }} onClick={() => nav(`/project/${p.id}`)}>
                    {p.name} · {p.idle_days} 天未提交
                  </Tag>
                ))}
              </Space>
            </Card>
          )}

          {/* 统计概览 */}
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={6}>
              <Card>
                <Statistic title="项目总数" value={data.totals.projectCount} />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic title="活跃项目" value={data.totals.activeCount} />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic title="本周提交" value={data.totals.weekCommits} />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic title="凉了提醒" value={data.totals.staleCount} valueStyle={{ color: data.totals.staleCount ? '#faad14' : undefined }} />
              </Card>
            </Col>
          </Row>

          {/* 项目卡片 */}
          <Row gutter={[16, 16]}>
            {data.projects.map((p) => (
              <Col xs={24} sm={12} lg={8} key={p.id}>
                <Card
                  hoverable
                  onClick={() => nav(`/project/${p.id}`)}
                  actions={[
                    <span key="star" onClick={(e) => { e.stopPropagation(); toggleStar(p); }}>
                      {p.starred ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
                    </span>,
                    <span key="open" onClick={(e) => { e.stopPropagation(); nav(`/project/${p.id}`); }}>
                      <EyeOutlined /> 详情
                    </span>,
                    <span key="del" onClick={(e) => { e.stopPropagation(); removeProject(p); }}>
                      <DeleteOutlined />
                    </span>,
                  ]}
                >
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <Space>
                      <Tag color={STATUS_COLOR[p.status]}>{STATUS_LABEL[p.status]}</Tag>
                      {p.starred === 1 && <StarFilled style={{ color: '#faad14' }} />}
                      {p.is_stale && <Badge count="凉了" color="#faad14" />}
                    </Space>
                    <Text strong style={{ fontSize: 16 }}>{p.name}</Text>
                    {p.repo_remote && (
                      <Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                        {p.repo_remote}
                      </Text>
                    )}
                    <Space size={8}>
                      <Text type="secondary">共 {p.commit_count} 提交</Text>
                      <Text type="secondary">本周 {p.week_commits}</Text>
                    </Space>
                    <Text type="secondary">
                      {p.last_active_at ? `最后活跃 ${p.idle_days} 天前` : '尚无提交'}
                    </Text>
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>

          {data.projects.length === 0 && (
            <Empty description="还没有项目，点击右上角「添加项目」开始登记你的第一个 git 仓库" style={{ marginTop: 60 }} />
          )}
        </>
      )}

      {/* 添加项目 */}
      <Button
        type="primary"
        shape="circle"
        size="large"
        icon={<PlusOutlined />}
        style={{ position: 'fixed', right: 32, bottom: 32, width: 56, height: 56 }}
        onClick={() => setAddOpen(true)}
      />

      <Modal title="添加项目" open={addOpen} onCancel={() => setAddOpen(false)} footer={null}>
        <Form layout="vertical" onFinish={createProject} style={{ marginTop: 8 }}>
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
            <Input placeholder="例如：project-pulse" />
          </Form.Item>
          <Form.Item name="repo_remote" label="git 远程地址（可选）">
            <Input placeholder="例如：github.com/xx/yy.git" />
          </Form.Item>
          <Form.Item name="description" label="描述（可选）">
            <Input.TextArea rows={2} placeholder="一句话说明这个项目" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            保存
          </Button>
        </Form>
      </Modal>
    </div>
  );
}