import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Input, InputNumber, Segmented, Space, Tag, Typography } from 'antd'
import type { SessionMessage } from '../types'

const { Paragraph, Text, Title } = Typography

type PptInfoPayload = {
  target_audience: string
  user_role: string
  num_pages: number
  theme: string
  layout_style: 'top_bottom' | 'grid'
}

interface InterruptEnvelope {
  kind: string
  title: string
  payload: unknown
}

interface InterruptCardProps {
  message: SessionMessage
  pending: boolean
  loading: boolean
  onSubmit: (messageId: string, payload: unknown) => void
}

const defaultPptInfo: PptInfoPayload = {
  target_audience: '',
  user_role: '',
  num_pages: 10,
  theme: '',
  layout_style: 'top_bottom',
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function getInterruptEnvelope(message: SessionMessage): InterruptEnvelope {
  const payload = asObject(message.payload)
  const nestedPayload = payload && 'payload' in payload ? payload.payload : payload

  return {
    kind: typeof payload?.type === 'string' ? payload.type : '',
    title:
      typeof payload?.title === 'string' && payload.title.trim()
        ? payload.title
        : message.content?.trim() || '待处理操作',
    payload: nestedPayload,
  }
}

function coercePptInfo(payload: unknown): PptInfoPayload {
  const fields = asObject(payload)
  return {
    target_audience:
      typeof fields?.target_audience === 'string' ? fields.target_audience : defaultPptInfo.target_audience,
    user_role: typeof fields?.user_role === 'string' ? fields.user_role : defaultPptInfo.user_role,
    num_pages:
      typeof fields?.num_pages === 'number' ? fields.num_pages : defaultPptInfo.num_pages,
    theme: typeof fields?.theme === 'string' ? fields.theme : defaultPptInfo.theme,
    layout_style:
      fields?.layout_style === 'grid' || fields?.layout_style === 'top_bottom'
        ? fields.layout_style
        : defaultPptInfo.layout_style,
  }
}

function getAcceptedLabel(payload: unknown): string | null {
  const values = asObject(payload)?.file_type
  if (!Array.isArray(values) || values.length === 0) {
    return null
  }

  const label = values
    .map((value) => String(value).replace(/^\./, '').toUpperCase())
    .join(' / ')
  return label || null
}

export default function InterruptCard({
  message,
  pending,
  loading,
  onSubmit,
}: InterruptCardProps) {
  const interrupt = useMemo(() => getInterruptEnvelope(message), [message])
  const [pptInfo, setPptInfo] = useState<PptInfoPayload>(() => coercePptInfo(interrupt.payload))
  const [contentFiles, setContentFiles] = useState<File[]>([])
  const [contentUrls, setContentUrls] = useState([''])
  const [templateFile, setTemplateFile] = useState<File | null>(null)
  const [textValue, setTextValue] = useState('')

  useEffect(() => {
    setPptInfo(coercePptInfo(interrupt.payload))
    setContentFiles([])
    setContentUrls([''])
    setTemplateFile(null)
    setTextValue('')
  }, [interrupt.kind, interrupt.payload, message.id])

  const acceptedLabel = getAcceptedLabel(interrupt.payload)
  const statusLabel = pending ? '待处理' : '已处理'
  const statusColor = pending ? 'gold' : 'default'

  if (interrupt.kind === 'confirmation' || interrupt.kind === 'confirm') {
    return (
      <Card className="interrupt-card" bordered={false}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Tag color={statusColor}>{statusLabel}</Tag>
          <Title level={5}>{interrupt.title}</Title>
          <Paragraph type="secondary">确认后将继续执行当前流程，取消后会结束这一步。</Paragraph>
          <Space>
            <Button type="primary" disabled={!pending} loading={loading} onClick={() => onSubmit(message.id, { confirmed: true })}>
              确认
            </Button>
            <Button disabled={!pending || loading} onClick={() => onSubmit(message.id, { confirmed: false })}>
              取消
            </Button>
          </Space>
        </Space>
      </Card>
    )
  }

  if (interrupt.kind === 'edit' || interrupt.kind === 'ppt_info') {
    return (
      <Card className="interrupt-card" bordered={false}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div className="interrupt-card__header">
            <Tag color={statusColor}>{statusLabel}</Tag>
            <Title level={5}>{interrupt.title}</Title>
          </div>
          <div className="interrupt-card__form-grid">
            <label className="interrupt-card__field">
              <span>目标受众</span>
              <Input
                value={pptInfo.target_audience}
                disabled={!pending}
                placeholder="导师和同学"
                onChange={(event) =>
                  setPptInfo((current) => ({ ...current, target_audience: event.target.value }))
                }
              />
            </label>
            <label className="interrupt-card__field">
              <span>用户角色</span>
              <Input
                value={pptInfo.user_role}
                disabled={!pending}
                placeholder="学生 / 产品经理 / 讲师"
                onChange={(event) =>
                  setPptInfo((current) => ({ ...current, user_role: event.target.value }))
                }
              />
            </label>
            <label className="interrupt-card__field">
              <span>页数</span>
              <InputNumber
                min={1}
                max={30}
                value={pptInfo.num_pages}
                disabled={!pending}
                style={{ width: '100%' }}
                onChange={(value) =>
                  setPptInfo((current) => ({
                    ...current,
                    num_pages: typeof value === 'number' ? value : current.num_pages,
                  }))
                }
              />
            </label>
            <div className="interrupt-card__field">
              <span>布局</span>
              <Segmented
                block
                value={pptInfo.layout_style}
                disabled={!pending}
                options={[
                  { label: '上下结构', value: 'top_bottom' },
                  { label: '网格布局', value: 'grid' },
                ]}
                onChange={(value) =>
                  setPptInfo((current) => ({
                    ...current,
                    layout_style: value === 'grid' ? 'grid' : 'top_bottom',
                  }))
                }
              />
            </div>
            <label className="interrupt-card__field interrupt-card__field--full">
              <span>主题</span>
              <Input
                value={pptInfo.theme}
                disabled={!pending}
                placeholder="DeepSeek 论文汇报"
                onChange={(event) =>
                  setPptInfo((current) => ({ ...current, theme: event.target.value }))
                }
              />
            </label>
          </div>
          <Button type="primary" disabled={!pending} loading={loading} onClick={() => onSubmit(message.id, pptInfo)}>
            提交基础信息
          </Button>
        </Space>
      </Card>
    )
  }

  if (interrupt.kind === 'upload_ppt_content_files') {
    return (
      <Card className="interrupt-card" bordered={false}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div className="interrupt-card__header">
            <Tag color={statusColor}>{statusLabel}</Tag>
            <Title level={5}>{interrupt.title}</Title>
          </div>
          <Paragraph type="secondary">
            可上传资料文件，也可以补充网站链接。{acceptedLabel ? `支持格式：${acceptedLabel}` : '都不提供时将直接跳过。'}
          </Paragraph>
          <label className="interrupt-card__upload">
            <span>选择资料文件</span>
            <input
              type="file"
              multiple
              disabled={!pending}
              onChange={(event) => setContentFiles(Array.from(event.target.files ?? []))}
            />
          </label>
          {contentFiles.length > 0 ? (
            <Text type="secondary">已选择 {contentFiles.length} 个文件</Text>
          ) : null}
          <div className="interrupt-card__stack">
            {contentUrls.map((value, index) => (
              <Input
                key={`${message.id}-url-${index}`}
                value={value}
                disabled={!pending}
                placeholder="https://example.com/article"
                onChange={(event) => {
                  setContentUrls((current) => {
                    const next = [...current]
                    next[index] = event.target.value
                    return next
                  })
                }}
              />
            ))}
            <Button disabled={!pending || loading} onClick={() => setContentUrls((current) => [...current, ''])}>
              增加 URL
            </Button>
          </div>
          <Space>
            <Button disabled={!pending || loading} onClick={() => onSubmit(message.id, { files: [], urls: [] })}>
              跳过资料
            </Button>
            <Button
              type="primary"
              disabled={!pending}
              loading={loading}
              onClick={() =>
                onSubmit(message.id, {
                  files: contentFiles,
                  urls: contentUrls.map((item) => item.trim()).filter(Boolean),
                })
              }
            >
              提交资料来源
            </Button>
          </Space>
        </Space>
      </Card>
    )
  }

  if (interrupt.kind === 'upload_ppt_template') {
    return (
      <Card className="interrupt-card" bordered={false}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div className="interrupt-card__header">
            <Tag color={statusColor}>{statusLabel}</Tag>
            <Title level={5}>{interrupt.title}</Title>
          </div>
          <Paragraph type="secondary">
            当前模板为可选项。{acceptedLabel ? `支持格式：${acceptedLabel}` : '支持上传 PPT 模板。'}
          </Paragraph>
          <label className="interrupt-card__upload">
            <span>选择模板文件</span>
            <input
              type="file"
              disabled={!pending}
              onChange={(event) => setTemplateFile(event.target.files?.[0] ?? null)}
            />
          </label>
          {templateFile ? <Text type="secondary">已选择：{templateFile.name}</Text> : null}
          <Space>
            <Button disabled={!pending || loading} onClick={() => onSubmit(message.id, { shouldUseTemplate: false, file: null })}>
              跳过模板
            </Button>
            <Button
              type="primary"
              disabled={!pending || !templateFile}
              loading={loading}
              onClick={() => onSubmit(message.id, { shouldUseTemplate: true, file: templateFile })}
            >
              使用模板继续
            </Button>
          </Space>
        </Space>
      </Card>
    )
  }

  if (interrupt.kind === 'input') {
    return (
      <Card className="interrupt-card" bordered={false}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div className="interrupt-card__header">
            <Tag color={statusColor}>{statusLabel}</Tag>
            <Title level={5}>{interrupt.title}</Title>
          </div>
          <Space wrap>
            {['绿色简约风', '黑色科技风', '蓝白商务风'].map((option) => (
              <Button
                key={option}
                disabled={!pending || loading}
                onClick={() => setTextValue(option)}
              >
                {option}
              </Button>
            ))}
          </Space>
          <Input
            value={textValue}
            disabled={!pending}
            placeholder="例如：绿色简约风"
            onChange={(event) => setTextValue(event.target.value)}
          />
          <Button
            type="primary"
            disabled={!pending || !textValue.trim()}
            loading={loading}
            onClick={() => onSubmit(message.id, textValue.trim())}
          >
            提交终稿风格
          </Button>
        </Space>
      </Card>
    )
  }

  return (
    <Card className="interrupt-card" bordered={false}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Tag color={statusColor}>{statusLabel}</Tag>
        <Alert type="info" showIcon message={interrupt.title} />
      </Space>
    </Card>
  )
}

