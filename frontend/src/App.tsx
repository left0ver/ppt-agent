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
  getSessionDetail,
  listSessions,
  modifyPage,
  sendSessionMessage,
  uploadContentFiles,
  uploadTemplate,
} from './api'
import { exportSlidesToPptx } from './pptExport'
import type {
  PreviewResult,
  SessionDetail,
  SessionMessage,
  SessionMessageInput,
  SessionPreview,
  SessionSummary,
} from './types'

const { Header, Sider, Content } = Layout
const { Dragger } = Upload
const { Paragraph, Text, Title } = Typography

type UploadChangeParam = Parameters<GetProp<typeof Upload, 'onChange'>>[0]

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

const emptyPreview: SessionPreview = {
  first_draft_results: [],
  final_ppt_results: [],
}

const defaultPptInfoDraft: PptInfoDraft = {
  target_audience: '',
  user_role: '',
  num_pages: 10,
  theme: '',
  layout_style: 'top_bottom',
}

const stageToStepIndex = (stage: string, hasFirstDraft: boolean, hasFinalDraft: boolean) => {
  if (hasFinalDraft || stage === 'completed') return 6
  if (stage === 'awaiting_final_style') return 5
  if (hasFirstDraft) return 4
  if (stage === 'awaiting_template' || stage === 'generating_outline') return 3
  if (stage === 'awaiting_content_sources') return 2
  if (stage === 'awaiting_ppt_info') return 1
  return 0
}

function sortSessionsByUpdatedAt(items: SessionSummary[]): SessionSummary[] {
  return [...items].sort((left, right) => right.updated_at.localeCompare(left.updated_at))
}

function upsertSessionSummary(items: SessionSummary[], next: SessionSummary): SessionSummary[] {
  const filtered = items.filter((item) => item.id !== next.id)
  return sortSessionsByUpdatedAt([next, ...filtered])
}

function getMessageText(message: SessionMessage): string {
  if (typeof message.content === 'string' && message.content.trim()) {
    return message.content
  }

  if (message.type === 'interrupt' && message.payload && typeof message.payload === 'object') {
    const title = (message.payload as { title?: unknown }).title
    if (typeof title === 'string' && title.trim()) {
      return title
    }
  }

  if (message.type === 'error') {
    const payloadMessage =
      message.payload && typeof message.payload === 'object'
        ? (message.payload as { message?: unknown }).message
        : null
    if (typeof payloadMessage === 'string' && payloadMessage.trim()) {
      return `执行失败：${payloadMessage}`
    }
    return '执行失败'
  }

  if (message.type === 'status') {
    return '状态已更新'
  }

  if (message.type === 'interrupt_response') {
    return '已提交确认信息'
  }

  return ''
}

function extractErrorMessage(detail: SessionDetail | null): string | null {
  if (!detail) return null
  const latestError = [...detail.messages].reverse().find((message) => message.type === 'error')
  if (!latestError) return null
  if (typeof latestError.content === 'string' && latestError.content.trim()) {
    return latestError.content
  }
  const payloadMessage =
    latestError.payload && typeof latestError.payload === 'object'
      ? (latestError.payload as { message?: unknown }).message
      : null
  return typeof payloadMessage === 'string' && payloadMessage.trim() ? payloadMessage : '未知错误'
}

function App() {
  const { message } = AntApp.useApp()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [requirement, setRequirement] = useState('')
  const [pptInfoDraft, setPptInfoDraft] = useState<PptInfoDraft>(defaultPptInfoDraft)
  const [contentFiles, setContentFiles] = useState<File[]>([])
  const [contentUrls, setContentUrls] = useState([''])
  const [templateFile, setTemplateFile] = useState<File | null>(null)
  const [finalStyle, setFinalStyle] = useState('')
  const [modifyDrawerOpen, setModifyDrawerOpen] = useState(false)
  const [previewType, setPreviewType] = useState<'first_draft' | 'final_ppt'>('first_draft')
  const [selectedPage, setSelectedPage] = useState(1)
  const [modifyInstruction, setModifyInstruction] = useState('')
  const [modifyType, setModifyType] = useState<'初稿' | '终稿'>('终稿')
  const [selectedModifyPages, setSelectedModifyPages] = useState<number[]>([])
  const [previewMode, setPreviewMode] = useState<'gallery' | 'single'>('single')
  const [zoomOpen, setZoomOpen] = useState(false)
  const [pptInfoForm] = Form.useForm<PptInfoDraft>()

  const activeSession = sessionDetail?.session ?? sessions.find((item) => item.id === activeSessionId) ?? null
  const preview = sessionDetail?.preview ?? emptyPreview
  const firstDraftCount = preview.first_draft_results.length
  const finalDraftCount = preview.final_ppt_results.length
  const previewList =
    previewType === 'final_ppt' ? preview.final_ppt_results : preview.first_draft_results
  const canModifyFirstDraft = firstDraftCount > 0
  const canModifyFinalDraft = finalDraftCount > 0
  const availableModifyType = canModifyFinalDraft ? '终稿' : '初稿'
  const errorMessage = extractErrorMessage(sessionDetail)
  const stepIndex = stageToStepIndex(
    activeSession?.stage ?? 'idle',
    firstDraftCount > 0,
    finalDraftCount > 0,
  )

  const bubbleItems = useMemo(
    () =>
      (sessionDetail?.messages ?? [])
        .map((item) => {
          const content = getMessageText(item)
          if (!content) return null
          return {
            key: item.id,
            content,
            placement: item.role === 'user' ? ('end' as const) : ('start' as const),
            avatar: item.role === 'user' ? { children: 'U' } : { children: 'AI' },
          }
        })
        .filter((item): item is NonNullable<typeof item> => item !== null),
    [sessionDetail?.messages],
  )

  const selectedPreview = useMemo(
    () => previewList.find((item) => item.page === selectedPage) ?? previewList[0] ?? null,
    [previewList, selectedPage],
  )

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

  const applySessionDetail = (detail: SessionDetail) => {
    setSessionDetail(detail)
    setSessions((current) => upsertSessionSummary(current, detail.session))
  }

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      try {
        const result = await listSessions()
        if (cancelled) return
        setSessions(result)
        setActiveSessionId((current) => current ?? result[0]?.id ?? null)
      } catch (error) {
        if (cancelled) return
        const errorMessage = error instanceof Error ? error.message : '加载会话列表失败'
        void message.error(errorMessage)
      } finally {
        if (!cancelled) {
          setLoadingSessions(false)
        }
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [message])

  useEffect(() => {
    if (!activeSessionId) {
      setSessionDetail(null)
      return
    }

    let cancelled = false
    setLoadingDetail(true)

    void getSessionDetail(activeSessionId)
      .then((detail) => {
        if (cancelled) return
        applySessionDetail(detail)
      })
      .catch((error) => {
        if (cancelled) return
        const errorMessage = error instanceof Error ? error.message : '加载会话详情失败'
        void message.error(errorMessage)
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDetail(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeSessionId, message])

  useEffect(() => {
    if (!activeSessionId) return

    const timer = window.setInterval(() => {
      void getSessionDetail(activeSessionId)
        .then((detail) => {
          setSessionDetail((current) =>
            current?.session.id === detail.session.id ? detail : current,
          )
          setSessions((current) => upsertSessionSummary(current, detail.session))
        })
        .catch(() => undefined)
    }, 10000)

    return () => window.clearInterval(timer)
  }, [activeSessionId])

  useEffect(() => {
    setRequirement('')
    setContentFiles([])
    setContentUrls([''])
    setTemplateFile(null)
    setFinalStyle('')
    setModifyInstruction('')
    setModifyDrawerOpen(false)
    setSelectedModifyPages([])
    setPptInfoDraft(defaultPptInfoDraft)
    pptInfoForm.setFieldsValue(defaultPptInfoDraft)
  }, [activeSessionId, pptInfoForm])

  useEffect(() => {
    const payload = sessionDetail?.pending_interrupt?.payload
    if (!payload || activeSession?.stage !== 'awaiting_ppt_info' || typeof payload !== 'object') {
      return
    }

    const draftPayload = payload as Partial<PptInfoDraft>
    const nextDraft = {
      ...defaultPptInfoDraft,
      ...draftPayload,
      layout_style:
        draftPayload.layout_style === 'grid' || draftPayload.layout_style === 'top_bottom'
          ? draftPayload.layout_style
          : defaultPptInfoDraft.layout_style,
      num_pages:
        typeof draftPayload.num_pages === 'number'
          ? draftPayload.num_pages
          : defaultPptInfoDraft.num_pages,
    }

    setPptInfoDraft(nextDraft)
    pptInfoForm.setFieldsValue(nextDraft)
  }, [activeSession?.stage, pptInfoForm, sessionDetail?.pending_interrupt?.payload])

  useEffect(() => {
    if (finalDraftCount > 0) {
      setPreviewType('final_ppt')
      setModifyType('终稿')
      return
    }
    if (firstDraftCount > 0) {
      setPreviewType('first_draft')
      setModifyType('初稿')
    }
  }, [finalDraftCount, firstDraftCount])

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
    const pages =
      (modifyType === '终稿' ? preview.final_ppt_results : preview.first_draft_results).map(
        (item) => item.page,
      ) ?? []
    setSelectedModifyPages((current) => {
      const filtered = current.filter((page) => pages.includes(page))
      if (filtered.length > 0) return filtered
      return pages.includes(selectedPage) ? [selectedPage] : pages.slice(0, 1)
    })
  }, [modifyType, preview.final_ppt_results, preview.first_draft_results, selectedPage])

  const submitMessage = async (input: SessionMessageInput) => {
    if (!activeSessionId) return

    setActionLoading(true)
    try {
      const detail = await sendSessionMessage(activeSessionId, input)
      applySessionDetail(detail)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '请求失败'
      void message.error(errorMessage)
    } finally {
      setActionLoading(false)
    }
  }

  const handleCreateSession = async () => {
    setActionLoading(true)
    try {
      const nextSession = await createSession()
      setSessions((current) => upsertSessionSummary(current, nextSession))
      setActiveSessionId(nextSession.id)
      setSessionDetail(null)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '创建会话失败'
      void message.error(errorMessage)
    } finally {
      setActionLoading(false)
    }
  }

  const handleRefreshActiveSession = async () => {
    if (!activeSessionId) return

    setLoadingDetail(true)
    try {
      const detail = await getSessionDetail(activeSessionId)
      applySessionDetail(detail)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '刷新会话失败'
      void message.error(errorMessage)
    } finally {
      setLoadingDetail(false)
    }
  }

  const handleStart = async () => {
    if (!requirement.trim()) return
    await submitMessage({
      type: 'text',
      content: requirement.trim(),
    })
    setRequirement('')
  }

  const handleSubmitPptInfo = async () => {
    const values = await pptInfoForm.validateFields()
    setPptInfoDraft(values)
    await submitMessage({
      type: 'interrupt_response',
      content: `已确认 PPT 信息：${values.theme}`,
      payload: values,
    })
  }

  const handleSubmitContentSources = async () => {
    if (!activeSessionId) return
    if (contentFiles.length > 0) {
      await uploadContentFiles(activeSessionId, contentFiles)
    }
    const urls = contentUrls.map((item) => item.trim()).filter(Boolean)
    await submitMessage({
      type: 'interrupt_response',
      content: contentFiles.length > 0 || urls.length > 0 ? '已提交内容资料' : '跳过内容资料',
      payload: {
        have_ppt_content_files: contentFiles.length > 0,
        ppt_content_source_urls: urls,
      },
    })
  }

  const handleSubmitTemplate = async (shouldUseTemplate: boolean) => {
    if (!activeSessionId) return
    if (shouldUseTemplate && templateFile) {
      await uploadTemplate(activeSessionId, templateFile)
    }
    await submitMessage({
      type: 'interrupt_response',
      content:
        shouldUseTemplate && templateFile ? `已上传模板 ${templateFile.name}` : '跳过模板',
      payload: { have_ppt_template: shouldUseTemplate },
    })
  }

  const handleSubmitFinalStyle = async () => {
    if (!finalStyle.trim()) return
    const style = finalStyle.trim()
    await submitMessage({
      type: 'interrupt_response',
      content: style,
      payload: style,
    })
    setFinalStyle('')
  }

  const handleModify = async () => {
    if (!activeSessionId || !modifyInstruction.trim() || selectedModifyPages.length === 0) return

    setActionLoading(true)
    try {
      await modifyPage(
        activeSessionId,
        modifyType,
        selectedModifyPages,
        modifyInstruction.trim(),
      )
      const detail = await getSessionDetail(activeSessionId)
      applySessionDetail(detail)
      setModifyInstruction('')
      setModifyDrawerOpen(false)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '修改页面失败'
      void message.error(errorMessage)
    } finally {
      setActionLoading(false)
    }
  }

  const handleExport = async (type: 'first_draft' | 'final_ppt') => {
    if (!activeSessionId) return
    const slides = type === 'first_draft' ? preview.first_draft_results : preview.final_ppt_results
    if (slides.length === 0) {
      void message.warning(`当前没有可导出的${type === 'first_draft' ? '初稿' : '终稿'}`)
      return
    }
    await exportSlidesToPptx({
      slides,
      fileName: `${type}-${activeSessionId}.pptx`,
      title: type === 'first_draft' ? '初稿导出' : '终稿导出',
      subject: `session_id=${activeSessionId}`,
    })
    void message.success(`${type === 'first_draft' ? '初稿' : '终稿'}已导出`)
  }

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
    <Card className="work-card" title="开始新的需求">
      <Paragraph type="secondary">
        当前应用已经按会话列表启动。选择一个会话后，可以从一句自然语言需求开始。
      </Paragraph>
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
        <Button
          type="primary"
          onClick={() => void handleSubmitTemplate(true)}
          loading={actionLoading}
          disabled={!templateFile}
        >
          使用模板继续
        </Button>
      </Space>
    </Card>
  )

  const renderFinalStylePanel = () => (
    <Card className="work-card" title="输入终稿风格">
      <Paragraph type="secondary">
        初稿已生成。可以先预览右侧页面，再输入例如“绿色简约风”“黑色科技风”这样的整体风格。
      </Paragraph>
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
      <Text type="secondary">当前阶段：{activeSession?.stage ?? 'starting'}</Text>
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
      {preview.response_content ? (
        <Alert style={{ marginTop: 16 }} type="success" showIcon message={preview.response_content} />
      ) : null}
    </Card>
  )

  const renderEmptyPanel = () => (
    <Card className="work-card" title="还没有活动会话">
      <Empty description="先创建一个会话，再开始输入需求。" />
      <Button
        style={{ marginTop: 16 }}
        type="primary"
        icon={<PlusOutlined />}
        onClick={() => void handleCreateSession()}
        loading={actionLoading}
      >
        新建会话
      </Button>
    </Card>
  )

  const renderMainPanel = () => {
    if (loadingSessions && sessions.length === 0) return renderRunningPanel()
    if (!activeSession) return renderEmptyPanel()
    if (loadingDetail && !sessionDetail) return renderRunningPanel()
    if (activeSession.status === 'running') return renderRunningPanel()
    if (activeSession.stage === 'awaiting_ppt_info') return renderPptInfoPanel()
    if (activeSession.stage === 'awaiting_content_sources') return renderContentPanel()
    if (activeSession.stage === 'awaiting_template') return renderTemplatePanel()
    if (activeSession.stage === 'awaiting_final_style') return renderFinalStylePanel()
    if (activeSession.status === 'failed') {
      return (
        <Card className="work-card">
          <Alert type="error" showIcon message="执行失败" description={errorMessage ?? '未知错误'} />
        </Card>
      )
    }
    if (activeSession.status === 'completed') return renderCompletedPanel()
    return renderRequirementPanel()
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
              <Text type="secondary">
                {activeSession?.title ?? '会话驱动的 PPT 生成与修改'}
              </Text>
            </div>
          </Space>
          <Space wrap>
            <Tag
              color={
                activeSession?.status === 'completed'
                  ? 'success'
                  : activeSession?.status === 'failed'
                    ? 'error'
                    : 'processing'
              }
            >
              {activeSession?.status ?? 'idle'}
            </Tag>
            <Tag>{activeSessionId ?? '未选择会话'}</Tag>
            <Button icon={<ReloadOutlined />} onClick={() => void handleRefreshActiveSession()} disabled={!activeSessionId}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => void handleCreateSession()} loading={actionLoading}>
              新建会话
            </Button>
          </Space>
        </Flex>
      </Header>

      <Layout className="app-body">
        <Sider width={300} className="left-panel">
          <Card className="panel-card" bordered={false} title="会话列表">
            {loadingSessions && sessions.length === 0 ? (
              <Spin />
            ) : sessions.length === 0 ? (
              <Empty description="还没有会话" />
            ) : (
              <List
                dataSource={sessions}
                renderItem={(item) => (
                  <List.Item
                    onClick={() => setActiveSessionId(item.id)}
                    className={item.id === activeSessionId ? 'page-selector-active' : ''}
                    style={{ cursor: 'pointer' }}
                  >
                    <Space direction="vertical" size={0}>
                      <Text strong={item.id === activeSessionId}>{item.title}</Text>
                      <Text type="secondary">
                        {item.stage} · {item.updated_at}
                      </Text>
                    </Space>
                  </List.Item>
                )}
              />
            )}
          </Card>
          <Card className="panel-card" bordered={false}>
            <Steps current={stepIndex} direction="vertical" items={stepItems.map((item) => ({ title: item.label }))} />
          </Card>
          <Card className="panel-card" bordered={false} title="当前会话信息">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="标题">{activeSession?.title ?? '未选择'}</Descriptions.Item>
              <Descriptions.Item label="状态">{activeSession?.status ?? 'idle'}</Descriptions.Item>
              <Descriptions.Item label="阶段">{activeSession?.stage ?? 'idle'}</Descriptions.Item>
              <Descriptions.Item label="初稿页数">{firstDraftCount}</Descriptions.Item>
              <Descriptions.Item label="终稿页数">{finalDraftCount}</Descriptions.Item>
              <Descriptions.Item label="API">{getApiBaseUrl()}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Sider>

        <Content className="center-panel">
          <Card className="chat-card" bordered={false}>
            <div className="chat-history">
              <Bubble.List
                items={
                  bubbleItems.length > 0
                    ? bubbleItems
                    : [
                        {
                          key: 'empty',
                          content: '欢迎使用 PPT Agent，先选择一个会话，再在下方输入需求。',
                          placement: 'start',
                          avatar: { children: 'AI' },
                        },
                      ]
                }
              />
            </div>
            {sessionDetail?.pending_interrupt ? (
              <Alert
                style={{ marginBottom: 16 }}
                type="info"
                showIcon
                message={sessionDetail.pending_interrupt.title}
                description="当前会话存在待处理的中断，下面的表单会根据阶段提交结构化响应。"
              />
            ) : null}
            {renderMainPanel()}
            <div className="sender-wrap">
              <Sender
                value={requirement}
                onChange={setRequirement}
                onSubmit={() => void handleStart()}
                loading={actionLoading && (activeSession?.stage === 'starting' || activeSession?.stage === 'idle')}
                placeholder="输入消息，Enter 发送"
                prefix={<Tag bordered={false}>{activeSession ? '发送到当前会话' : '先创建会话'}</Tag>}
                disabled={!activeSessionId || activeSession?.stage !== 'idle'}
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
                <Button icon={<LayoutOutlined />} onClick={() => setModifyDrawerOpen(true)} disabled={previewList.length === 0}>
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
                    <List.Item
                      onClick={() => setSelectedPage(item.page)}
                      className={selectedPage === item.page ? 'page-selector-active' : ''}
                    >
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
            options={(modifyType === '终稿' ? preview.final_ppt_results : preview.first_draft_results).map(
              (item) => ({
                label: `第 ${item.page} 页`,
                value: item.page,
              }),
            )}
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
