import { useState } from 'react';
import { Card, Form, Input, Button, Tabs, App, Typography } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined } from '@ant-design/icons';
import { authApi, setToken } from '../api';

const { Title, Text } = Typography;

export default function Login({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const { message } = App.useApp();

  const submit = async (values: { username: string; password: string; email?: string }) => {
    setLoading(true);
    try {
      const result =
        mode === 'login'
          ? await authApi.login(values)
          : await authApi.register(values);
      setToken(result.token);
      message.success(mode === 'login' ? '登录成功' : '注册成功');
      onAuthed();
    } catch (e: any) {
      message.error(e.message ?? '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f0f2f5',
      }}
    >
      <Card style={{ width: 380 }}>
        <Title level={3} style={{ textAlign: 'center', marginBottom: 4 }}>
          项目管家 · Project Pulse
        </Title>
        <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 24 }}>
          多项目记忆助手
        </Text>
        <Tabs
          activeKey={mode}
          onChange={(k) => setMode(k as 'login' | 'register')}
          items={[
            { key: 'login', label: '登录' },
            { key: 'register', label: '注册' },
          ]}
        />
        <Form layout="vertical" onFinish={submit}>
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" size="large" />
          </Form.Item>
          {mode === 'register' && (
            <Form.Item name="email" rules={[{ type: 'email', message: '邮箱格式不正确' }]}>
              <Input prefix={<MailOutlined />} placeholder="邮箱（可选）" size="large" />
            </Form.Item>
          )}
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={loading}>
            {mode === 'login' ? '登录' : '注册'}
          </Button>
        </Form>
      </Card>
    </div>
  );
}