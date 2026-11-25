import { useEffect, useState, useCallback } from 'react';
import { Card, Row, Col, Statistic, List, Tag, Button, Space, Typography, App, Empty } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import { reportApi, setToken, type DailyReport, type WeeklyReport } from '../api';

const { Title, Text } = Typography;

function localTzOffsetHours(): number {
  return -new Date().getTimezoneOffset() / 60;
}

export default function Reports() {
  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [weekly, setWeekly] = useState<WeeklyReport | null>(null);
  const { message } = App.useApp();
  const nav = useNavigate();

  const load = useCallback(async () => {
    const tz = localTzOffsetHours();
    try {
      const [d, w] = await Promise.all([reportApi.daily(tz), reportApi.weekly(tz)]);
      setDaily(d);
      setWeekly(w);
    } catch (e: any) {
      if (e.status === 401) {
        setToken(null);
        window.location.reload();
      } else {
        message.error(e.message ?? 'load reports failed');
      }
    }
  }, [message]);

  useEffect(() => {
    load();
  }, [load]);

  const weeklyPie = weekly
    ? {
        tooltip: { trigger: 'item' },
        series: [
          {
            type: 'pie',
            radius: ['40%', '70%'],
            data: weekly.byProject.map((p) => ({ name: p.name, value: p.commits })),
            label: { formatter: '{b}: {d}%' },
          },
        ],
      }
    : undefined;

  const dailyBar = weekly
    ? {
        tooltip: {},
        xAxis: { type: 'category', data: weekly.dailyCommits.map((d) => d.day.slice(5)) },
        yAxis: { type: 'value' },
        series: [{ type: 'bar', data: weekly.dailyCommits.map((d) => d.commits) }],
      }
    : undefined;

  const renderStaleList = (stale: { name: string; idleDays: number }[]) =>
    stale.length > 0 ? (
      <List
        size="small"
        dataSource={stale}
        renderItem={(s) => (
          <List.Item>
            <Tag color="orange">{s.name}</Tag>
            <Text type="secondary">{s.idleDays} 天未提交</Text>
          </List.Item>
        )}
      />
    ) : (
      <Empty description="没有凉了项目" />
    );

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => nav('/')}>返回</Button>
        <Title level={3} style={{ margin: 0 }}>日报 / 周报</Title>
        <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
      </Space>

      <Card
        title={weekly ? `周报 ${weekly.weekStart} ~ ${weekly.weekEnd}` : '周报'}
        style={{ marginBottom: 16 }}
      >
        <Row gutter={16}>
          <Col span={6}><Statistic title="本周提交" value={weekly?.totalCommits ?? 0} /></Col>
          <Col span={6}><Statistic title="活跃项目" value={weekly?.activeProjects ?? 0} /></Col>
          <Col span={6}>
            <Statistic
              title="凉了提醒"
              value={weekly?.staleCount ?? 0}
              valueStyle={{ color: weekly?.staleCount ? '#faad14' : undefined }}
            />
          </Col>
          <Col span={6}><Statistic title="今日提交" value={daily?.totalCommits ?? 0} /></Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="各项目投入占比（本周）" size="small">
            {weeklyPie && weekly!.byProject.length > 0 ? (
              <ReactECharts option={weeklyPie} style={{ height: 280 }} notMerge />
            ) : (
              <Empty description="本周无提交" />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title="每日提交数（本周）" size="small">
            {dailyBar ? (
              <ReactECharts option={dailyBar} style={{ height: 280 }} notMerge />
            ) : (
              <Empty description="暂无数据" />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title="各项目本周明细" size="small">
            {weekly && weekly.byProject.length > 0 ? (
              <List
                size="small"
                dataSource={weekly.byProject}
                renderItem={(p) => (
                  <List.Item>
                    <Text>{p.name}</Text>
                    <Text type="secondary">{p.commits} 次 / {p.activeDays} 天</Text>
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="本周无提交" />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title="凉了项目" size="small">
            {weekly ? renderStaleList(weekly.stale) : <Empty />}
          </Card>
        </Col>
      </Row>
    </div>
  );
}