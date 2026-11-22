import { Card, Typography, Space } from 'antd';

const { Title, Text } = Typography;

export default function Dashboard() {
  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Title level={2}>项目管家 · Project Pulse</Title>
        <Card>
          <Text type="secondary">
            骨架已就绪。后续在这里展示：项目卡片列表、凉了提醒区、提交时间线、日报/周报。
          </Text>
        </Card>
      </Space>
    </div>
  );
}