import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import {
  Button, Card, Form, Input, List, Space, Tag, Typography, App, Modal, Spin,
} from 'antd';
import { invoke } from '@tauri-apps/api/core';
import {
  authApi, projectApi, getConfig, setConfig, getLocalProjects, setLocalProjects,
  type ServerConfig, type LocalProject, type GitCollectResult, type Project,
} from './api';

const { Title, Text } = Typography;

function Main() {
  const { message } = App.useApp();
  const [cfg, setCfg] = useState<ServerConfig | null>(getConfig());
  const [localProjects, setLocal] = useState<LocalProject[]>(getLocalProjects());
  const [serverProjects, setServer] = useState<Record<number, Project>>({});
  const [configOpen, setConfigOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [collecting, setCollecting] = useState(false);

  // 服务端配置表单
  const [form] = Form.useForm();

  useEffect(() => {
    if (cfg) refreshServer();
  }, [cfg]);

  async function refreshServer() {
    if (!cfg) return;
    try {
      const list = await projectApi.list(cfg);
      const map: Record<number, Project> = {};
      for (const p of list) map[p.id] = p;
      setServer(map);
    } catch (e: any) {
      message.error(e.message ?? '加载服务端项目失败');
    }
  }

  async function handleSaveConfig(values: { baseUrl: string; username: string; password: string }) {
    setLoading(true);
    try {
      const baseUrl = values.baseUrl.replace(/\/$/, '');
      const login = await authApi.login(
        { baseUrl, token: '', username: values.username, machineId: '' },
        { username: values.username, password: values.password },
      );
      const next: ServerConfig = {
        baseUrl,
        token: login.token,
        username: values.username,
        machineId: getLocalProjects().length ? (getConfig()?.machineId ?? '') : '',
      };
      if (!next.machineId) next.machineId = 'm-' + Date.now().toString(36);
      setConfig(next);
      setCfg(next);
      setConfigOpen(false);
      message.success('已连接服务器');
    } catch (e: any) {
      message.error(e.message ?? '连接失败');
    } finally {
      setLoading(false);
    }
  }

  async function pickAndCollect(): Promise<{ dir: string; result: GitCollectResult } | null> {
    const dir = await invoke<string | null>('select_dir');
    if (!dir) return null;
    setCollecting(true);
    try {
      const result = await invoke<GitCollectResult>('git_collect', { dir });
      return { dir, result };
    } catch (e) {
      message.error(String(e));
      return null;
    } finally {
      setCollecting(false);
    }
  }

  async function handleAdd(values: { name: string }) {
    if (!cfg) {
      message.warning('请先连接服务器');
      return;
    }
    const picked = await pickAndCollect();
    if (!picked) return;
    const { dir, result } = picked;
    if (!result.is_git) {
      message.error(result.error ?? '不是 git 仓库');
      return;
    }
    // 登记到服务端（幂等：同名返回既有）
    const proj = await projectApi.create(cfg, {
      name: values.name,
      repo_remote: result.repo_remote ?? undefined,
    });
    // 同步提交（携带本机绑定）
    await projectApi.sync(cfg, proj.id, {
      machineId: cfg.machineId,
      localPath: dir,
      commits: result.commits,
    });
    // 记入本地
    const lp: LocalProject = {
      localPath: dir,
      name: values.name,
      serverProjectId: proj.id,
      lastSyncHash: result.commits[0]?.hash ?? null,
    };
    const next = [...getLocalProjects(), lp];
    setLocalProjects(next);
    setLocal(next);
    setAddOpen(false);
    message.success(`已登记并同步 ${proj.name}（${result.commits.length} 条提交）`);
    refreshServer();
  }

  async function handleSyncOne(lp: LocalProject) {
    if (!cfg || !lp.serverProjectId) return;
    setLoading(true);
    try {
      const result = await invoke<GitCollectResult>('git_collect', { dir: lp.localPath, sinceHash: lp.lastSyncHash });
      if (!result.is_git) {
        message.error('目录已不是 git 仓库');
        return;
      }
      await projectApi.sync(cfg, lp.serverProjectId, {
        machineId: cfg.machineId,
        localPath: lp.localPath,
        commits: result.commits,
      });
      const updated = getLocalProjects().map((x) =>
        x.localPath === lp.localPath
          ? { ...x, lastSyncHash: result.commits[0]?.hash ?? x.lastSyncHash }
          : x,
      );
      setLocalProjects(updated);
      setLocal(updated);
      message.success(`已同步 ${lp.name}（+${result.commits.length} 条）`);
      refreshServer();
    } catch (e: any) {
      message.error(e.message ?? '同步失败');
    } finally {
      setLoading(false);
    }
  }

  const logout = () => {
    setConfig(null);
    setCfg(null);
    setServer({});
  };

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <Space style={{ marginBottom: 16, justifyContent: 'space-between', width: '100%' }}>
        <Title level={3} style={{ margin: 0 }}>项目管家 · 桌面端</Title>
        <Space>
          {cfg ? (
            <>
              <Tag color="green">{cfg.username} @ {cfg.baseUrl}</Tag>
              <Button size="small" onClick={() => { form.setFieldsValue({ baseUrl: cfg.baseUrl, username: cfg.username }); setConfigOpen(true); }}>设置</Button>
              <Button size="small" onClick={logout}>退出</Button>
            </>
          ) : (
            <Button size="small" type="primary" onClick={() => setConfigOpen(true)}>连接服务器</Button>
          )}
        </Space>
      </Space>

      <Card title="本地项目" extra={<Button type="primary" size="small" disabled={!cfg} onClick={() => setAddOpen(true)}>添加项目</Button>}>
        <Spin spinning={loading}>
          <List
            dataSource={localProjects}
            locale={{ emptyText: '还没有登记项目，点击「添加项目」选择一个 git 仓库目录' }}
            renderItem={(lp) => {
              const sp = lp.serverProjectId ? serverProjects[lp.serverProjectId] : undefined;
              return (
                <List.Item
                  actions={[
                    <Button key="sync" size="small" disabled={!cfg} onClick={() => handleSyncOne(lp)}>同步</Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={<Space>{lp.name}{sp && <Tag color="green">{sp.status}</Tag>}</Space>}
                    description={
                      <Space direction="vertical" size={0}>
                        <Text type="secondary">{lp.localPath}</Text>
                        {sp && <Text type="secondary">服务端：{sp.commit_count} 提交 · 本周 {sp.week_commits}</Text>}
                      </Space>
                    }
                  />
                </List.Item>
              );
            }}
          />
        </Spin>
      </Card>

      <Modal
        title={cfg ? '服务器设置' : '连接服务器'}
        open={configOpen}
        onCancel={() => setConfigOpen(false)}
        footer={null}
      >
        <Form form={form} layout="vertical" onFinish={handleSaveConfig} initialValues={{ baseUrl: 'http://localhost:3000' }}>
          <Form.Item name="baseUrl" label="服务器地址" rules={[{ required: true }]}>
            <Input placeholder="http://localhost:3000" />
          </Form.Item>
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>登录并保存</Button>
        </Form>
      </Modal>

      <Modal title="添加项目" open={addOpen} onCancel={() => setAddOpen(false)} footer={null}>
        <Form layout="vertical" onFinish={handleAdd}>
          <Form.Item name="name" label="项目名称" rules={[{ required: true }]} extra="选择目录后会提示是否为 git 仓库并采集提交记录">
            <Input placeholder="例如：project-pulse" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={collecting}>选择目录并登记</Button>
        </Form>
      </Modal>
    </div>
  );
}

function DeskApp() {
  return <Main />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      <AntApp>
        <DeskApp />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);