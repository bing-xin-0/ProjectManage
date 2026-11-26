import { useEffect, useState } from 'react';
import { Card, Form, Input, Button, Space, Typography, App, Tag, Alert } from 'antd';
import { ArrowLeftOutlined, GithubOutlined, SaveOutlined, DisconnectOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { settingsApi, setToken, type GithubSettings } from '../api';

const { Title, Text } = Typography;

export default function Settings() {
  const nav = useNavigate();
  const { message, modal } = App.useApp();
  const [settings, setSettings] = useState<GithubSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    try {
      const s = await settingsApi.github();
      setSettings(s);
    } catch (e: any) {
      if (e.status === 401) {
        setToken(null);
        window.location.reload();
      } else {
        message.error(e.message ?? '加载设置失败');
      }
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveGithub = async (values: { token: string }) => {
    setSaving(true);
    try {
      const r = await settingsApi.saveGithub(values.token.trim());
      setSettings({ configured: r.configured, githubUsername: r.githubUsername ?? null });
      form.setFieldsValue({ token: '' });
      message.success('GitHub 令牌已保存');
    } catch (e: any) {
      message.error(e.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const clearGithub = () => {
    modal.confirm({
      title: '断开 GitHub 连接？',
      content: '将清除已保存的 GitHub 令牌，GitHub 项目将无法再自动同步。',
      okText: '断开',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await settingsApi.clearGithub();
        setSettings({ configured: false, githubUsername: null });
        message.success('已断开 GitHub 连接');
      },
    });
  };

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => nav('/')}>返回</Button>
        <Title level={3} style={{ margin: 0 }}>设置</Title>
      </Space>

      <Card
        title={
          <Space>
            <GithubOutlined />
            <span>GitHub 数据源</span>
            {settings?.configured && <Tag color="green">已连接 {settings.githubUsername}</Tag>}
            {settings && !settings.configured && <Tag>未连接</Tag>}
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="为什么要配置 GitHub 令牌？"
          description="配置后，你可以从 GitHub 仓库直接登记项目，系统会自动拉取提交历史用于统计、时间线与凉了提醒。令牌仅保存在本服务端数据库，用于调用 GitHub REST API（只读拉取提交元数据，不上传代码）。"
        />

        {settings?.configured ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Text>
              已绑定 GitHub 账号：<Text strong>{settings.githubUsername}</Text>
            </Text>
            <Text type="secondary">如需更换令牌，重新填写并保存即可；如需彻底断开，点击「断开连接」。</Text>
            <Form form={form} layout="vertical" onFinish={saveGithub} style={{ maxWidth: 480 }}>
              <Form.Item name="token" label="新的 GitHub Personal Access Token"
                rules={[{ required: true, message: '请输入新的 GitHub 令牌' }]}>
                <Input.Password placeholder="ghp_..." />
              </Form.Item>
              <Space>
                <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>
                  保存新令牌
                </Button>
                <Button danger icon={<DisconnectOutlined />} onClick={clearGithub}>
                  断开连接
                </Button>
              </Space>
            </Form>
          </Space>
        ) : (
          <Form form={form} layout="vertical" onFinish={saveGithub} style={{ maxWidth: 480 }}>
            <Form.Item
              name="token"
              label="GitHub Personal Access Token"
              rules={[{ required: true, message: '请输入 GitHub 令牌' }]}
              extra="在 GitHub → Settings → Developer settings → Personal access tokens 生成（需要 repo 读取权限）"
            >
              <Input.Password placeholder="ghp_..." />
            </Form.Item>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>
              保存并连接
            </Button>
          </Form>
        )}
      </Card>
    </div>
  );
}