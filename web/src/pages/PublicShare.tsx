import { useEffect, useState } from 'react';
import { Card, Descriptions, Table, Tag, Typography, Space, App, Empty, Alert } from 'antd';
import { useParams } from 'react-router-dom';
import { publicApi, type PublicShare } from '../api';

const { Title, Text } = Typography;

export default function PublicShare() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [data, setData] = useState<PublicShare | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { message } = App.useApp();

  useEffect(() => {
    if (!shareToken) return;
    publicApi
      .get(shareToken)
      .then(setData)
      .catch((e: any) => setError(e.message ?? '加载失败'));
  }, [shareToken]);

  if (error) {
    return (
      <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
        <Alert type="warning" showIcon message="无法访问分享" description={error} />
      </div>
    );
  }

  if (!data) {
    return <div style={{ padding: 24 }}><Empty description="加载中…" /></div>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <Title level={3} style={{ marginBottom: 4 }}>{data.name}</Title>
          <Text type="secondary">by {data.owner} · 公开分享视图</Text>
        </div>

        <Alert
          type="info"
          showIcon
          message="这是只读公开视图"
          description={
            data.shareMessagePolicy === 'hidden'
              ? '提交 message 已脱敏隐藏，仅展示 hash 前 7 位、时间、分支与作者。'
              : '项目主人选择完整展示提交 message。'
          }
        />

        <Card>
          <Descriptions column={3} size="small">
            <Descriptions.Item label="状态"><Tag>{data.status}</Tag></Descriptions.Item>
            <Descriptions.Item label="共提交">{data.totalCommits}</Descriptions.Item>
            <Descriptions.Item label="最后活跃">
              {data.lastActiveAt ? new Date(data.lastActiveAt).toLocaleDateString() : '—'}
            </Descriptions.Item>
          </Descriptions>
        </Card>

        <Card title="最近提交">
          <Table
            size="small"
            rowKey="hash"
            dataSource={data.commits}
            pagination={false}
            columns={[
              { title: 'hash', dataIndex: 'hash', render: (h: string) => <Text code>{h}</Text> },
              {
                title: 'message',
                dataIndex: 'message',
                render: (m: string | null) => (m ? m : <Text type="secondary">已隐藏</Text>),
                ellipsis: true,
              },
              { title: '分支', dataIndex: 'branch', render: (b: string | null) => b ? <Tag>{b}</Tag> : '—' },
              { title: '作者', dataIndex: 'author', render: (a: string | null) => a ?? '—' },
              {
                title: '时间',
                dataIndex: 'committed_at',
                render: (t: string) => new Date(t).toLocaleString(),
              },
            ]}
          />
        </Card>
      </Space>
    </div>
  );
}