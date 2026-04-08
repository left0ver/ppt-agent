import { useEffect, useMemo, useState } from 'react'
import {
  BellOutlined,
  CloudDownloadOutlined,
  EyeOutlined,
  FilePptOutlined,
  FolderOpenOutlined,
  FullscreenOutlined,
  LayoutOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { Bubble, Prompts, Sender } from '@ant-design/x'
import {
  Alert,
  App as AntApp,
  Avatar,
  Button,
  Card,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Layout,
  List,
  Modal,
  Select,
  Segmented,
  Space,
  Spin,
  Steps,
  Tabs,
  Tag,
  Typography,
  Upload,
} from 'antd'
import type { GetProp, TabsProps } from 'antd'
import './App.css'
import {
  createSession,
  getApiBaseUrl,
  getStatus,
  modifyPage,
  resumeContentSources,
  resumeFinalStyle,
  resumePptInfo,
  resumeTemplate,
  startPpt,
  type ApiResponse,
  type PreviewResult,
  type SessionData,
  uploadContentFiles,
  uploadTemplate,
} from './api'
import { exportSlidesToPptx } from './pptExport'

const { Header, Sider, Content } = Layout
const { Dragger } = Upload
const { Paragraph, Text, Title } = Typography

type UploadChangeParam = Parameters<GetProp<typeof Upload, 'onChange'>>[0]

type Message = {
  role: 'ai' | 'user'
  content: string
  key: string
}

type PptInfoDraft = {
  target_audience: string
  user_role: string
  num_pages: number
  theme: string
  layout_style: 'top_bottom' | 'grid'
}

const promptSamples = [
  '我是学生，想做一个 DeepSeek 论文汇报，排版使用上下结构',
  '我要做一份 AI 产品介绍，适合投资人演示，控制在 12 页内',
  '帮我生成一份企业内训课件，主题是知识库和智能体落地',
]

const stepItems = [
  { key: 'requirement', label: '需求输入' },
  { key: 'ppt_info', label: '信息确认' },
  { key: 'content', label: '资料来源' },
  { key: 'template', label: '模板上传' },
  { key: 'first_draft', label: '初稿生成' },
  { key: 'style', label: '风格确认' },
  { key: 'final', label: '终稿完成' },
]

const stageToStepIndex = (stage: string, hasFirstDraft: boolean, hasFinalDraft: boolean) => {
  if (hasFinalDraft || stage === 'completed') return 6
  if (stage === 'awaiting_final_style') return 5
  if (hasFirstDraft) return 4
  if (stage === 'awaiting_template' || stage === 'generating_outline') return 3
  if (stage === 'awaiting_content_sources') return 2
  if (stage === 'awaiting_ppt_info') return 1
  return 0
}

const emptyData: SessionData = {
  first_draft_results: [],
  final_ppt_results: [],
  ppt_page_contents: [],
}

function App() {
  const { message } = AntApp.useApp()
  const [threadId, setThreadId] = useState('')
  const [session, setSession] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [requirement, setRequirement] = useState('')
  const [pptInfoDraft, setPptInfoDraft] = useState<PptInfoDraft>({
    target_audience: '',
    user_role: '',
    num_pages: 10,
    theme: '',
    layout_style: 'top_bottom' as 'top_bottom' | 'grid',
  })
  const [contentFiles, setContentFiles] = useState<File[]>([])
  const [contentUrls, setContentUrls] = useState([''])
  const [templateFile, setTemplateFile] = useState<File | null>(null)
  const [finalStyle, setFinalStyle] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [modifyDrawerOpen, setModifyDrawerOpen] = useState(false)
  const [previewType, setPreviewType] = useState<'first_draft' | 'final_ppt'>('first_draft')
  const [selectedPage, setSelectedPage] = useState(1)
  const [modifyInstruction, setModifyInstruction] = useState('')
  const [modifyType, setModifyType] = useState<'初稿' | '终稿'>('终稿')
  const [selectedModifyPages, setSelectedModifyPages] = useState<number[]>([])
  const [previewMode, setPreviewMode] = useState<'gallery' | 'single'>('single')
  const [zoomOpen, setZoomOpen] = useState(false)
  const [pptInfoForm] = Form.useForm<PptInfoDraft>()

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const result = await createSession()
        setThreadId(result.thread_id)
      } finally {
        setLoading(false)
      }
    }
    void bootstrap()
  }, [])

  useEffect(() => {
    if (!threadId) return
    const timer = window.setInterval(() => {
      void getStatus(threadId)
        .then((result) => setSession((current) => result ?? current))
        .catch(() => undefined)
    }, 10000)
    return () => window.clearInterval(timer)
  }, [threadId])

  useEffect(() => {
    if (!session?.interrupt?.payload || session.stage !== 'awaiting_ppt_info') return
    const payload = session.interrupt.payload as Partial<typeof pptInfoDraft>
    setPptInfoDraft((current) => {
      const nextDraft = {
        ...current,
        ...payload,
        layout_style:
          payload.layout_style === 'grid' || payload.layout_style === 'top_bottom'
            ? payload.layout_style
            : current.layout_style,
        num_pages: typeof payload.num_pages === 'number' ? payload.num_pages : current.num_pages,
      }
      pptInfoForm.setFieldsValue(nextDraft)
      return nextDraft
    })
  }, [session?.interrupt, session?.stage])

  useEffect(() => {
    const hasFinalDraft = (session?.data?.final_ppt_results?.length ?? 0) > 0
    const hasFirstDraft = (session?.data?.first_draft_results?.length ?? 0) > 0
    if (hasFinalDraft) {
      setPreviewType('final_ppt')
      setModifyType('终稿')
    } else if (hasFirstDraft) {
      setPreviewType('first_draft')
      setModifyType('初稿')
    }
  }, [session?.data?.first_draft_results, session?.data?.final_ppt_results])

  const data = session?.data ?? emptyData
  const previewList = previewType === 'final_ppt' ? data.final_ppt_results ?? [] : data.first_draft_results ?? []
  const firstDraftCount = data.first_draft_results?.length ?? 0
  const finalDraftCount = data.final_ppt_results?.length ?? 0
  const canModifyFirstDraft = firstDraftCount > 0
  const canModifyFinalDraft = finalDraftCount > 0
  const availableModifyType = canModifyFinalDraft ? '终稿' : '初稿'

  useEffect(() => {
    if (previewList.length === 0) return
    if (!previewList.some((item) => item.page === selectedPage)) {
      setSelectedPage(previewList[0].page)
    }
  }, [previewList, selectedPage])

  useEffect(() => {
    if (selectedPage > 0) {
      setSelectedModifyPages((current) => (current.length > 0 ? current : [selectedPage]))
    }
  }, [selectedPage])

  useEffect(() => {
    setModifyType(availableModifyType)
  }, [availableModifyType])

  useEffect(() => {
    const pages = (modifyType === '终稿' ? data.final_ppt_results : data.first_draft_results)?.map((item) => item.page) ?? []
    setSelectedModifyPages((current) => {
      const filtered = current.filter((page) => pages.includes(page))
      if (filtered.length > 0) return filtered
      return pages.includes(selectedPage) ? [selectedPage] : pages.slice(0, 1)
    })
  }, [modifyType, data.final_ppt_results, data.first_draft_results, selectedPage])

  const selectedPreview = useMemo(
    () => previewList.find((item) => item.page === selectedPage) ?? previewList[0] ?? null,
    [previewList, selectedPage],
  )

  const stepIndex = stageToStepIndex(
    session?.stage ?? 'idle',
    firstDraftCount > 0,
    finalDraftCount > 0,
  )

  const appendMessage = (role: Message['role'], content: string) => {
    setMessages((current) => [...current, { role, content, key: `${Date.now()}-${current.length}` }])
  }

  const applyResponse = (response: ApiResponse) => {
    setSession(response)
    if (response.error?.message) {
      appendMessage('ai', `执行失败：${response.error.message}`)
      void message.error(response.error.message)
      return
    }
    if (response.status === 'interrupted' && response.interrupt) {
      appendMessage('ai', response.interrupt.title)
      return
    }
    if (response.status === 'completed') {
      appendMessage('ai', '当前阶段已完成，预览结果已更新。')
    }
  }

  const withAction = async (action: () => Promise<ApiResponse>) => {
    setActionLoading(true)
    try {
      const response = await action()
      applyResponse(response)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '请求失败'
      appendMessage('ai', errorMessage)
      void message.error(errorMessage)
    } finally {
      setActionLoading(false)
    }
  }

  const handleStart = async () => {
    if (!threadId || !requirement.trim()) return
    appendMessage('user', requirement.trim())
    await withAction(() => startPpt(threadId, requirement.trim()))
    setRequirement('')
  }

  const handleSubmitPptInfo = async () => {
    const values = await pptInfoForm.validateFields()
    setPptInfoDraft(values)
    appendMessage('user', `已确认 PPT 信息：${values.theme}`)
    await withAction(() => resumePptInfo(threadId, values))
  }

  const handleSubmitContentSources = async () => {
    if (contentFiles.length > 0) {
      await uploadContentFiles(threadId, contentFiles)
    }
    const urls = contentUrls.map((item) => item.trim()).filter(Boolean)
    appendMessage('user', contentFiles.length > 0 || urls.length > 0 ? '已提交内容资料' : '跳过内容资料')
    await withAction(() => resumeContentSources(threadId, contentFiles.length > 0, urls))
  }

  const handleSubmitTemplate = async (shouldUseTemplate: boolean) => {
    if (shouldUseTemplate && templateFile) {
      await uploadTemplate(threadId, templateFile)
      appendMessage('user', `已上传模板 ${templateFile.name}`)
    } else {
      appendMessage('user', '跳过模板')
    }
    await withAction(() => resumeTemplate(threadId, shouldUseTemplate))
  }

  const handleSubmitFinalStyle = async () => {
    if (!finalStyle.trim()) return
    appendMessage('user', finalStyle.trim())
    await withAction(() => resumeFinalStyle(threadId, finalStyle.trim()))
  }

  const handleModify = async () => {
    if (!modifyInstruction.trim() || selectedModifyPages.length === 0) return
    appendMessage('user', modifyInstruction.trim())
    await withAction(() => modifyPage(threadId, modifyType, selectedModifyPages, modifyInstruction.trim()))
    setModifyInstruction('')
    setModifyDrawerOpen(false)
  }

  const handleExport = async (type: 'first_draft' | 'final_ppt') => {
    const slides = type === 'first_draft' ? data.first_draft_results ?? [] : data.final_ppt_results ?? []
    if (slides.length === 0) {
      void message.warning(`当前没有可导出的${type === 'first_draft' ? '初稿' : '终稿'}`)
      return
    }
    await exportSlidesToPptx({
      slides,
      fileName: `${type}-${threadId}.pptx`,
      title: type === 'first_draft' ? '初稿导出' : '终稿导出',
      subject: `thread_id=${threadId}`,
    })
    void message.success(`${type === 'first_draft' ? '初稿' : '终稿'}已导出`)
  }

  const bubbleItems = messages.map((item) => ({
    key: item.key,
    content: item.content,
    placement: item.role === 'user' ? ('end' as const) : ('start' as const),
    avatar: item.role === 'user' ? { children: 'U' } : { children: 'AI' },
  }))

  const promptItems = promptSamples.map((label) => ({
    key: label,
    label,
    description: '点击后填入输入框',
  }))

  const previewTabItems: TabsProps['items'] = [
    {
      key: 'first_draft',
      label: '初稿',
      children: null,
    },
    {
      key: 'final_ppt',
      label: '终稿',
      children: null,
    },
  ]

  const handleContentUploadChange = (info: UploadChangeParam) => {
    const fileList = info.fileList.slice(-8)
    setContentFiles(
      fileList.reduce<File[]>((acc, item) => {
        if (item.originFileObj) {
          acc.push(item.originFileObj as File)
        }
        return acc
      }, []),
    )
  }

  const renderRequirementPanel = () => (
    <Card className="work-card" title="开始一个新的 PPT 会话">
      <Paragraph type="secondary">从一句自然语言需求开始，Agent 会在关键节点打断并让你确认信息。</Paragraph>
      <Prompts
        title="常用提示词"
        vertical
        items={promptItems}
        onItemClick={(info) => setRequirement(String(info.data.label))}
      />
    </Card>
  )

  const renderPptInfoPanel = () => (
    <Card className="work-card" title="确认 PPT 基本信息">
      <Form form={pptInfoForm} layout="vertical" initialValues={pptInfoDraft}>
        <Form.Item label="目标受众" name="target_audience" rules={[{ required: true }]}>
          <Input placeholder="导师和同学" />
        </Form.Item>
        <Form.Item label="用户角色" name="user_role" rules={[{ required: true }]}>
          <Input placeholder="学生 / 产品经理 / 讲师" />
        </Form.Item>
        <Flex gap={12}>
          <Form.Item label="页数" name="num_pages" rules={[{ required: true }]} className="half-field">
            <InputNumber min={1} max={30} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="布局" name="layout_style" rules={[{ required: true }]} className="half-field">
            <Segmented
              block
              options={[
                { label: '上下结构', value: 'top_bottom' },
                { label: '网格布局', value: 'grid' },
              ]}
            />
          </Form.Item>
        </Flex>
        <Form.Item label="主题" name="theme" rules={[{ required: true }]}>
          <Input placeholder="DeepSeek 论文汇报" />
        </Form.Item>
      </Form>
      <Button type="primary" onClick={() => void handleSubmitPptInfo()} loading={actionLoading}>
        提交基础信息
      </Button>
    </Card>
  )

  const renderContentPanel = () => (
    <Card className="work-card" title="上传资料或补充 URL">
      <Alert
        type="info"
        showIcon
        message="资料是可选项"
        description="可以上传 PDF、DOCX、Markdown，也可以只填 URL。如果都不提供，后端会自行搜索资料。"
        style={{ marginBottom: 16 }}
      />
      <Dragger
        multiple
        beforeUpload={() => false}
        accept=".pdf,.docx,.md,.markdown"
        onChange={handleContentUploadChange}
      >
        <p className="upload-emoji">
          <FolderOpenOutlined />
        </p>
        <p>拖拽资料到这里，或点击上传</p>
      </Dragger>
      <Divider />
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {contentUrls.map((item, index) => (
          <Input
            key={`${index}-${item}`}
            value={item}
            placeholder="https://example.com/article"
            onChange={(event) => {
              const next = [...contentUrls]
              next[index] = event.target.value
              setContentUrls(next)
            }}
          />
        ))}
        <Button icon={<PlusOutlined />} onClick={() => setContentUrls([...contentUrls, ''])}>
          增加 URL
        </Button>
      </Space>
      <Divider />
      <Button type="primary" onClick={() => void handleSubmitContentSources()} loading={actionLoading}>
        提交资料来源
      </Button>
    </Card>
  )

  const renderTemplatePanel = () => (
    <Card className="work-card" title="上传模板">
      <Alert
        type="warning"
        showIcon
        message="模板格式约束"
        description="当前后端只支持 .ppt / .pptx 模板参与生成，上传后会覆盖之前的模板。"
        style={{ marginBottom: 16 }}
      />
      <Dragger
        maxCount={1}
        beforeUpload={() => false}
        accept=".ppt,.pptx"
        onChange={(info) => setTemplateFile(info.fileList[0]?.originFileObj ?? null)}
      >
        <p className="upload-emoji">
          <FilePptOutlined />
        </p>
        <p>上传模板文件</p>
      </Dragger>
      <Divider />
      <Space>
        <Button onClick={() => void handleSubmitTemplate(false)} disabled={actionLoading}>
          跳过模板
        </Button>
        <Button type="primary" onClick={() => void handleSubmitTemplate(true)} loading={actionLoading} disabled={!templateFile}>
          使用模板继续
        </Button>
      </Space>
    </Card>
  )

  const renderFinalStylePanel = () => (
    <Card className="work-card" title="输入终稿风格">
      <Paragraph type="secondary">初稿已生成。可以先预览右侧页面，再输入例如“绿色简约风”“黑色科技风”这样的整体风格。</Paragraph>
      <Space wrap style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => void handleExport('first_draft')}>
          导出初稿 PPTX
        </Button>
        <Button icon={<EyeOutlined />} onClick={() => setModifyDrawerOpen(true)}>
          修改初稿
        </Button>
      </Space>
      <Prompts
        vertical
        items={['绿色简约风', '黑色科技风', '蓝白商务风'].map((label) => ({
          key: label,
          label,
          description: '点击填入风格输入框',
        }))}
        onItemClick={(info) => setFinalStyle(String(info.data.label))}
      />
      <div style={{ marginTop: 16 }}>
        <Sender
          value={finalStyle}
          onChange={setFinalStyle}
          onSubmit={() => void handleSubmitFinalStyle()}
          loading={actionLoading}
          placeholder="输入最终风格"
        />
      </div>
    </Card>
  )

  const renderRunningPanel = () => (
    <Card className="work-card running-card">
      <Spin size="large" />
      <Title level={4} style={{ marginTop: 16 }}>
        生成中
      </Title>
      <Text type="secondary">当前阶段：{session?.stage ?? 'starting'}</Text>
    </Card>
  )

  const renderCompletedPanel = () => (
    <Card className="work-card" title="输出结果">
      <Space wrap>
        <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => void handleExport('first_draft')}>
          导出初稿 PPTX
        </Button>
        <Button icon={<CloudDownloadOutlined />} onClick={() => void handleExport('final_ppt')}>
          导出终稿 PPTX
        </Button>
        <Button icon={<EyeOutlined />} onClick={() => setModifyDrawerOpen(true)}>
          修改页面
        </Button>
      </Space>
      {data.response_content ? (
        <Alert style={{ marginTop: 16 }} type="success" showIcon message={data.response_content} />
      ) : null}
    </Card>
  )

  const renderMainPanel = () => {
    if (loading) return renderRunningPanel()
    if (!session || session.stage === 'idle') return renderRequirementPanel()
    if (session.status === 'running') return renderRunningPanel()
    if (session.stage === 'awaiting_ppt_info') return renderPptInfoPanel()
    if (session.stage === 'awaiting_content_sources') return renderContentPanel()
    if (session.stage === 'awaiting_template') return renderTemplatePanel()
    if (session.stage === 'awaiting_final_style') return renderFinalStylePanel()
    if (session.status === 'failed') {
      return (
        <Card className="work-card">
          <Alert type="error" showIcon message="执行失败" description={session.error?.message ?? '未知错误'} />
        </Card>
      )
    }
    return renderCompletedPanel()
  }

  const renderSvg = (item: PreviewResult | null) => {
    if (!item?.svg_content) {
      return <Empty description="当前还没有可预览的 SVG 页面" />
    }
    return <div className="svg-canvas" dangerouslySetInnerHTML={{ __html: item.svg_content }} />
  }

  return (
    <Layout className="app-shell">
      <Header className="app-header">
        <Flex justify="space-between" align="center" gap={16} wrap>
          <Space size={16} align="center">
            <Avatar size={44} className="brand-avatar" icon={<BellOutlined />} />
            <div>
              <Title level={4} style={{ margin: 0 }}>
                PPT Agent 工作台
              </Title>
              <Text type="secondary">会话驱动的 PPT 生成与修改</Text>
            </div>
          </Space>
          <Space wrap>
            <Tag color={session?.status === 'completed' ? 'success' : session?.status === 'failed' ? 'error' : 'processing'}>
              {session?.status ?? 'idle'}
            </Tag>
            <Tag>{threadId || '初始化中'}</Tag>
            <Button icon={<ReloadOutlined />} onClick={() => threadId && void getStatus(threadId).then(applyResponse)}>
              刷新
            </Button>
            <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => void handleExport(previewType)}>
              导出当前预览
            </Button>
          </Space>
        </Flex>
      </Header>

      <Layout className="app-body">
        <Sider width={300} className="left-panel">
          <Card className="panel-card" bordered={false}>
            <Steps current={stepIndex} direction="vertical" items={stepItems.map((item) => ({ title: item.label }))} />
          </Card>
          <Card className="panel-card" bordered={false} title="当前会话信息">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="状态">{session?.status ?? 'idle'}</Descriptions.Item>
              <Descriptions.Item label="阶段">{session?.stage ?? 'idle'}</Descriptions.Item>
              <Descriptions.Item label="初稿页数">{session?.session_meta.generated_first_draft_pages ?? 0}</Descriptions.Item>
              <Descriptions.Item label="终稿页数">{session?.session_meta.generated_final_ppt_pages ?? 0}</Descriptions.Item>
              <Descriptions.Item label="API">{getApiBaseUrl()}</Descriptions.Item>
            </Descriptions>
          </Card>
          <Card className="panel-card" bordered={false} title="提示词快捷入口">
            <Prompts
              vertical
              items={promptItems}
              onItemClick={(info) => setRequirement(String(info.data.label))}
            />
          </Card>
        </Sider>

        <Content className="center-panel">
          <Card className="chat-card" bordered={false}>
            <div className="chat-history">
              <Bubble.List items={bubbleItems.length > 0 ? bubbleItems : [{ key: 'empty', content: '欢迎使用 PPT Agent，先在下方输入需求。', placement: 'start', avatar: { children: 'AI' } }]} />
            </div>
            {renderMainPanel()}
            <div className="sender-wrap">
              <Sender
                value={requirement}
                onChange={setRequirement}
                onSubmit={() => void handleStart()}
                loading={actionLoading && (!session || session.stage === 'starting' || session.stage === 'idle')}
                placeholder="输入消息，拖拽或粘贴文件 / 图片，Enter 发送，Shift + Enter 换行"
                prefix={<Tag bordered={false}>待用户输入</Tag>}
              />
            </div>
          </Card>
        </Content>

        <Sider width={420} className="right-panel">
          <Card className="panel-card preview-panel" bordered={false}>
            <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
              <Tabs
                activeKey={previewType}
                items={previewTabItems}
                onChange={(key) => setPreviewType(key as 'first_draft' | 'final_ppt')}
              />
              <Space>
                <Segmented
                  value={previewMode}
                  onChange={(value) => setPreviewMode(value as 'gallery' | 'single')}
                  options={[
                    { label: '缩略图视图', value: 'gallery' },
                    { label: '单页视图', value: 'single' },
                  ]}
                />
                <Button icon={<LayoutOutlined />} onClick={() => setModifyDrawerOpen(true)}>
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
                        setSelectedPage(item.page)
                        setZoomOpen(true)
                      }}
                      title={`第 ${item.page} 页`}
                      extra={<FullscreenOutlined />}
                    >
                      <div className="thumbnail-canvas" dangerouslySetInnerHTML={{ __html: item.svg_content ?? '' }} />
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
                    <List.Item onClick={() => setSelectedPage(item.page)} className={selectedPage === item.page ? 'page-selector-active' : ''}>
                      第 {item.page} 页
                    </List.Item>
                  )}
                />
                <div className="preview-stage preview-stage-clickable" onClick={() => setZoomOpen(true)}>
                  {renderSvg(selectedPreview)}
                </div>
              </>
            )}
          </Card>
        </Sider>
      </Layout>

      <Drawer
        title={`修改${modifyType}`}
        open={modifyDrawerOpen}
        onClose={() => setModifyDrawerOpen(false)}
        width={420}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Segmented
            block
            value={modifyType}
            onChange={(value) => setModifyType(value as '初稿' | '终稿')}
            options={[
              ...(canModifyFirstDraft ? [{ label: '初稿', value: '初稿' as const }] : []),
              ...(canModifyFinalDraft ? [{ label: '终稿', value: '终稿' as const }] : []),
            ]}
          />
          <Alert
            showIcon
            type="info"
            message={`当前默认页：第 ${selectedPage} 页`}
            description="可以同时选择多个页面，后端会把同一条修改指令应用到所选页面。"
          />
          <Select
            mode="multiple"
            placeholder="选择要修改的页面"
            value={selectedModifyPages}
            onChange={(value) => setSelectedModifyPages(value)}
            options={(modifyType === '终稿' ? data.final_ppt_results : data.first_draft_results)?.map((item) => ({
              label: `第 ${item.page} 页`,
              value: item.page,
            }))}
          />
          <Sender
            value={modifyInstruction}
            onChange={setModifyInstruction}
            onSubmit={() => void handleModify()}
            loading={actionLoading}
            placeholder="例如：背景改成蓝色，标题更粗一点，正文字号统一"
          />
          <Button type="primary" onClick={() => void handleModify()} loading={actionLoading} disabled={selectedModifyPages.length === 0}>
            提交多页修改
          </Button>
        </Space>
      </Drawer>

      <Modal
        open={zoomOpen}
        onCancel={() => setZoomOpen(false)}
        footer={null}
        width="88vw"
        className="zoom-modal"
        title={selectedPreview ? `第 ${selectedPreview.page} 页` : '页面预览'}
      >
        <div className="zoom-stage">{renderSvg(selectedPreview)}</div>
      </Modal>
    </Layout>
  )
}

export default App
