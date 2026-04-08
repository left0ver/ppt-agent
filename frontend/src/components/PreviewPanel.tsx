import { FullscreenOutlined, LayoutOutlined } from '@ant-design/icons'
import { Button, Card, Flex, List, Segmented, Space, Tabs } from 'antd'
import type { TabsProps } from 'antd'
import type { ReactNode } from 'react'
import type { PreviewResult } from '../types'

interface PreviewPanelProps {
  previewList: PreviewResult[]
  previewType: 'first_draft' | 'final_ppt'
  previewMode: 'gallery' | 'single'
  selectedPage: number
  selectedPreview: PreviewResult | null
  onChangeType: (value: 'first_draft' | 'final_ppt') => void
  onChangeMode: (value: 'gallery' | 'single') => void
  onSelectPage: (page: number) => void
  onModify: () => void
  onOpenZoom: () => void
  renderSvg: (item: PreviewResult | null) => ReactNode
}

const previewTabItems: TabsProps['items'] = [
  { key: 'first_draft', label: '初稿', children: null },
  { key: 'final_ppt', label: '终稿', children: null },
]

export default function PreviewPanel({
  previewList,
  previewType,
  previewMode,
  selectedPage,
  selectedPreview,
  onChangeType,
  onChangeMode,
  onSelectPage,
  onModify,
  onOpenZoom,
  renderSvg,
}: PreviewPanelProps) {
  return (
    <Card className="panel-card preview-panel" bordered={false}>
      <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
        <Tabs
          activeKey={previewType}
          items={previewTabItems}
          onChange={(key) => onChangeType(key as 'first_draft' | 'final_ppt')}
        />
        <Space>
          <Segmented
            value={previewMode}
            onChange={(value) => onChangeMode(value as 'gallery' | 'single')}
            options={[
              { label: '缩略图视图', value: 'gallery' },
              { label: '单页视图', value: 'single' },
            ]}
          />
          <Button
            icon={<LayoutOutlined />}
            onClick={onModify}
            disabled={previewList.length === 0}
          >
            修改
          </Button>
        </Space>
      </Flex>

      {previewMode === 'gallery' ? (
        <List
          className="preview-list"
          grid={{ gutter: 12, column: 2 }}
          dataSource={previewList}
          locale={{ emptyText: '暂无页面' }}
          renderItem={(item) => (
            <List.Item>
              <Card
                hoverable
                size="small"
                onClick={() => {
                  onSelectPage(item.page)
                  onOpenZoom()
                }}
                title={`第 ${item.page} 页`}
                extra={<FullscreenOutlined />}
              >
                <div
                  className="thumbnail-canvas"
                  dangerouslySetInnerHTML={{ __html: item.svg_content ?? '' }}
                />
              </Card>
            </List.Item>
          )}
        />
      ) : (
        <>
          <List
            className="page-selector"
            size="small"
            dataSource={previewList}
            locale={{ emptyText: '暂无页面' }}
            renderItem={(item) => (
              <List.Item
                onClick={() => onSelectPage(item.page)}
                className={selectedPage === item.page ? 'page-selector-active' : ''}
              >
                第 {item.page} 页
              </List.Item>
            )}
          />
          <div className="preview-stage preview-stage-clickable" onClick={onOpenZoom}>
            {renderSvg(selectedPreview)}
          </div>
        </>
      )}
    </Card>
  )
}
