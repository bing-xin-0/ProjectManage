import { useEffect, useState, useCallback } from 'react';
import {
  Card, Button, Space, Tag, Typography, Empty, App, Input, Select, Popconfirm, Row, Col, Table, Descriptions,
} from 'antd';
import { ArrowLeftOutlined, CopyOutlined, StarFilled, StarOutlined, ShareAltOutlined, ReloadOutlined, GithubOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import {
  projectApi, commitApi, githubApi, setToken,
  type Project, type CommitItem, type TimelineData, type ProjectStats,
} from '../api';

const { Title, Text } = Typography;
const { TextArea } = Input;

const STATUS_LABEL: Record<string, string> = {
  active: '活跃',
  paused: '暂停',
  completed: '完成',
  archived: '归档',
};

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const nav = useNavigate();
  const { message } = App.useApp();

  const [project, setProject] = useState<Project | null>(null);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [commits, setCommits] = useState<CommitItem[]>([]);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, tl, st, cm] = await Promise.all([
        projectApi.get(projectId),
        commitApi.timeline(projectId),
        commitApi.stats(projectId),
        commitApi.list(projectId, 1, 50),
      ]);
      setProject(p);
      setTimeline(tl);
      setStats(st);
      setCommits(cm.items);
      setNoteDraft(p.note ?? '');
    } catch (e: any) {
      if (e.status === 401) {
        setToken(null);
        window.location.reload();
      } else {
        message.error(e.message ?? '加载失败');
      }
    }
  }, [projectId, message]);

  useEffect(() => {
    load();
  }, [load]);

  const updateProject = async (patch: Partial<Project>) => {
    try {
      const updated = await projectApi.update(projectId, patch);
      setProject(updated);
      message.success('已更新');
    } catch (e: any) {
      message.error(e.message ?? '更新失败');
    }
  };

  const saveNote = async () => {
    setSavingNote(true);
    try {
      await updateProject({ note: noteDraft });
    } finally {
      setSavingNote(false);
    }
  };

  const syncGithub = async () => {
    if (!project) return;
    setSyncing(true);
    try {
      const r = await githubApi.syncProject(project.id);
      message.success(`同步完成：新增 ${r.added} 条提交，共 ${r.total} 条`);
      load();
    } catch (e: any) {
      message.error(e.message ?? '同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const copyShareLink = async () => {
    if (!project?.share_token) return;
    const link = `${window.location.origin}/share/${project.share_token}`;
    try {
      await navigator.clipboard.writeText(link);
      message.success('分享链接已复制');
    } catch {
      message.info(link);
    }
  };

  if (!project) {
    return <div style={{ padding: 24 }}><Empty description="加载中…" /></div>;
  }

  const chartOption = timeline
    ? {
        tooltip: { trigger: 'item' },
        legend: { data: timeline.branches.map((b) => b.branch) },
        xAxis: { type: 'time', name: '时间' },
        yAxis: { type: 'value', name: '提交序号', show: false },
        series: timeline.branches.map((b, i) => ({
          name: b.branch,
          type: 'scatter',
          data: b.points.map((pt, idx) => [pt.time, idx + 1]),
          symbolSize: 8,
        })),
        grid: { left: 40, right: 20, top: 40, bottom: 40 },
      }
    : undefined;

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => nav('/')}>返回</Button>
        <Title level={3} style={{ margin: 0 }}>{project.name}</Title>
        {project.source === 'github' && <Tag color="geekblue" icon={<GithubOutlined />}>GitHub</Tag>}
        <Tag>{STATUS_LABEL[project.status]}</Tag>
        {project.starred === 1 && <StarFilled style={{ color: '#faad14' }} />}
        {project.visibility === 'public' && <Tag color="blue">公开</Tag>}
      </Space>

      <Row gutter={[16, 16]}>
        <Col span={24}>
          <Card>
            <Descriptions column={4} size="small">
              <Descriptions.Item label="共提交">{project.commit_count}</Descriptions.Item>
              <Descriptions.Item label="本周">{project.week_commits}</Descriptions.Item>
              <Descriptions.Item label="最后活跃">
                {project.last_active_at ? `${project.idle_days} 天前` : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="分支">{stats?.branches.length ?? 0}</Descriptions.Item>
            </Descriptions>
            <Space style={{ marginTop: 12 }} wrap>
              <Select
                value={project.status}
                style={{ width: 120 }}
                onChange={(v) => updateProject({ status: v })}
                options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
              />
              <Button
                icon={project.starred === 1 ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
                onClick={() => updateProject({ starred: project.starred ? 0 : 1 })}
              >
                收藏
              </Button>
              {project.source === 'github' && (
                <Button icon={<GithubOutlined />} loading={syncing} onClick={syncGithub}>
                  同步到 GitHub
                </Button>
              )}
              {project.visibility === 'private' ? (
                <Popconfirm
                  title="设为公开？"
                  description="将生成只读分享链接，访客可看提交元数据（message 默认脱敏）。"
                  onConfirm={() => updateProject({ visibility: 'public' })}
                >
                  <Button icon={<ShareAltOutlined />}>设为公开</Button>
                </Popconfirm>
              ) : (
                <>
                  <Button icon={<CopyOutlined />} onClick={copyShareLink}>复制分享链接</Button>
                  <Popconfirm
                    title="设回私有？"
                    description="分享链接将立即失效。"
                    onConfirm={() => updateProject({ visibility: 'private' })}
                  >
                    <Button>设回私有</Button>
                  </Popconfirm>
                  <Button
                    onClick={async () => {
                      const r = await projectApi.rotateShareToken(project.id);
                      message.success('已生成新分享链接');
                      load();
                    }}
                  >
                    轮换链接
                  </Button>
                </>
              )}
            </Space>
          </Card>
        </Col>

        <Col span={24}>
          <Card title="📝 上次进度 / 下一步" size="small">
            <TextArea
              rows={3}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="记录：上次做到哪、下一步从哪开始…"
            />
            <Button type="primary" size="small" style={{ marginTop: 8 }} loading={savingNote} onClick={saveNote}>
              保存笔记
            </Button>
          </Card>
        </Col>

        <Col span={24}>
          <Card title="⏱ 提交时间线" size="small">
            {chartOption ? (
              <ReactECharts option={chartOption} style={{ height: 300 }} notMerge />
            ) : (
              <Empty description="暂无提交" />
            )}
          </Card>
        </Col>

        <Col span={24}>
          <Card title="最近提交" size="small">
            <Table
              size="small"
              rowKey="hash"
              dataSource={commits}
              pagination={false}
              columns={[
                { title: 'hash', dataIndex: 'hash', render: (h: string) => <Text code>{h.slice(0, 7)}</Text> },
                { title: 'message', dataIndex: 'message', ellipsis: true },
                { title: '分支', dataIndex: 'branch', render: (b: string | null) => b ? <Tag>{b}</Tag> : '—' },
                {
                  title: '时间',
                  dataIndex: 'committed_at',
                  render: (t: string) => new Date(t).toLocaleString(),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}