import { Card, Typography } from 'antd'

export default function PreviewEmptyState() {
  return (
    <Card
      aria-label="预览空状态"
      className="preview-empty"
      variant="borderless"
    >
      <Typography.Text className="preview-empty__eyebrow">
        Fullscreen Viewer
      </Typography.Text>
      <Typography.Title level={4}>点击左侧缩略图查看页面预览</Typography.Title>
      <Typography.Paragraph>
        预览会以全屏方式打开，支持左右翻页查看初稿或终稿。
      </Typography.Paragraph>
    </Card>
  )
}
