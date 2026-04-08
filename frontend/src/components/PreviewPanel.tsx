import { FullscreenOutlined, LayoutOutlined } from '@ant-design/icons'
import { Button, Card, List, Segmented, Tabs } from 'antd'
import type { TabsProps } from 'antd'
import type { ReactNode } from 'react'
import type { PreviewResult } from '../types'

interface PreviewPanelProps {
  previewList: PreviewResult[]
  previewType: 'first_draft' | 'final_ppt'
  previewMode: 'gallery' | 'single'
  selectedPage: number
  selectedPreview: PreviewResult | null
  draftCount: number
  finalCount: number
  onChangeType: (value: 'first_draft' | 'final_ppt') => void
  onChangeMode: (value: 'gallery' | 'single') => void
  onSelectPage: (page: number) => void
  onModify: () => void
  onExportDraft: () => void
  onExportFinal: () => void
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
  draftCount,
  finalCount,
  onChangeType,
  onChangeMode,
  onSelectPage,
  onModify,
  onExportDraft,
  onExportFinal,
  onOpenZoom,
  renderSvg,
}: PreviewPanelProps) {
  return (
    <Card className="panel-card preview-panel" bordered={false}>
      <div className="preview-panel__header">
        <div>
          {/* <p className="preview-panel__eyebrow">Preview Workspace</p> */}
          <h3 className="preview-panel__title">页面预览</h3>
        </div>
        <div className="preview-panel__stats">
          <span className="preview-panel__stat">初稿 {draftCount}</span>
          <span className="preview-panel__stat">终稿 {finalCount}</span>
        </div>
      </div>

      <div className="preview-panel__toolbar">
        <div className="preview-panel__toolbar-row preview-panel__toolbar-row--primary">
          <Tabs
            activeKey={previewType}
            items={previewTabItems}
            onChange={(key) => onChangeType(key as 'first_draft' | 'final_ppt')}
          />
          <div className="preview-panel__button-group">
            <Button onClick={onExportDraft} disabled={draftCount === 0}>
              导出初稿
            </Button>
            <Button onClick={onExportFinal} disabled={finalCount === 0}>
              导出终稿
            </Button>
          </div>
        </div>
        <div className="preview-panel__toolbar-row preview-panel__toolbar-row--secondary">
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
            自然语言修改
          </Button>
        </div>
      </div>

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
