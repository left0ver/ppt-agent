import { useEffect, useMemo, useState } from 'react'
import {
  FullscreenOutlined,
  LayoutOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { Sender } from '@ant-design/x'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Drawer,
  Empty,
  Flex,
  Layout,
  List,
  Modal,
  Select,
  Segmented,
  Space,
  Tabs,
} from 'antd'
import type { TabsProps } from 'antd'
import './App.css'
import {
  createSession,
  getSessionDetail,
  listSessions,
  modifyPage,
  sendSessionMessage,
  uploadContentFiles,
  uploadTemplate,
} from './api'
import ChatThread from './components/ChatThread'
import SessionSidebar from './components/SessionSidebar'
import TopTimeline from './components/TopTimeline'
import type {
  PreviewResult,
  SessionDetail,
  SessionMessage,
  SessionMessageInput,
  SessionPreview,
  SessionSummary,
} from './types'

const { Sider, Content } = Layout

const emptyPreview: SessionPreview = {
  first_draft_results: [],
  final_ppt_results: [],
}

function sortSessionsByUpdatedAt(items: SessionSummary[]): SessionSummary[] {
  return [...items].sort((left, right) => right.updated_at.localeCompare(left.updated_at))
}

function upsertSessionSummary(items: SessionSummary[], next: SessionSummary): SessionSummary[] {
  const filtered = items.filter((item) => item.id !== next.id)
  return sortSessionsByUpdatedAt([next, ...filtered])
}

function getInterruptEnvelope(message: SessionMessage): { kind: string } {
  const payload =
    message.payload && typeof message.payload === 'object' && !Array.isArray(message.payload)
      ? (message.payload as Record<string, unknown>)
      : null

  return {
    kind: typeof payload?.type === 'string' ? payload.type : '',
  }
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
  const [modifyDrawerOpen, setModifyDrawerOpen] = useState(false)
  const [previewType, setPreviewType] = useState<'first_draft' | 'final_ppt'>('first_draft')
  const [selectedPage, setSelectedPage] = useState(1)
  const [modifyInstruction, setModifyInstruction] = useState('')
  const [modifyType, setModifyType] = useState<'初稿' | '终稿'>('终稿')
  const [selectedModifyPages, setSelectedModifyPages] = useState<number[]>([])
  const [previewMode, setPreviewMode] = useState<'gallery' | 'single'>('single')
  const [zoomOpen, setZoomOpen] = useState(false)

  const activeSessionDetail =
    sessionDetail?.session.id === activeSessionId ? sessionDetail : null
  const activeSession =
    activeSessionDetail?.session ?? sessions.find((item) => item.id === activeSessionId) ?? null
  const preview = activeSessionDetail?.preview ?? emptyPreview
  const firstDraftCount = preview.first_draft_results.length
  const finalDraftCount = preview.final_ppt_results.length
  const previewList =
    previewType === 'final_ppt' ? preview.final_ppt_results : preview.first_draft_results
  const canModifyFirstDraft = firstDraftCount > 0
  const canModifyFinalDraft = finalDraftCount > 0
  const availableModifyType = canModifyFinalDraft ? '终稿' : '初稿'

  const selectedPreview = useMemo(
    () => previewList.find((item) => item.page === selectedPage) ?? previewList[0] ?? null,
    [previewList, selectedPage],
  )

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
        const sortedSessions = sortSessionsByUpdatedAt(result)
        if (cancelled) return
        setSessions(sortedSessions)
        setActiveSessionId((current) => current ?? sortedSessions[0]?.id ?? null)
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
    setSessionDetail(null)
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
    setModifyInstruction('')
    setModifyDrawerOpen(false)
    setSelectedModifyPages([])
  }, [activeSessionId])

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

  const handleInterruptSubmit = async (messageId: string, payload: unknown) => {
    if (!activeSessionId || !activeSessionDetail) return

    const targetMessage = activeSessionDetail.messages.find((item) => item.id === messageId)
    if (!targetMessage) return

    const kind = getInterruptEnvelope(targetMessage).kind

    switch (kind) {
      case 'edit':
      case 'ppt_info': {
        const values =
          payload && typeof payload === 'object'
            ? (payload as {
                theme?: string
              })
            : {}
        await submitMessage({
          type: 'interrupt_response',
          content: values.theme ? `已确认 PPT 信息：${values.theme}` : '已确认 PPT 信息',
          payload,
        })
        return
      }
      case 'upload_ppt_content_files': {
        const values =
          payload && typeof payload === 'object'
            ? (payload as { files?: File[]; urls?: string[] })
            : {}
        const files = Array.isArray(values.files) ? values.files : []
        const urls = Array.isArray(values.urls) ? values.urls.filter(Boolean) : []

        setActionLoading(true)
        try {
          if (files.length > 0) {
            await uploadContentFiles(activeSessionId, files)
          }
          const detail = await sendSessionMessage(activeSessionId, {
            type: 'interrupt_response',
            content: files.length > 0 || urls.length > 0 ? '已提交内容资料' : '跳过内容资料',
            payload: {
              have_ppt_content_files: files.length > 0,
              ppt_content_source_urls: urls,
            },
          })
          applySessionDetail(detail)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '提交资料失败'
          void message.error(errorMessage)
        } finally {
          setActionLoading(false)
        }
        return
      }
      case 'upload_ppt_template': {
        const values =
          payload && typeof payload === 'object'
            ? (payload as { shouldUseTemplate?: boolean; file?: File | null })
            : {}
        const shouldUseTemplate = Boolean(values.shouldUseTemplate)
        const file = values.file instanceof File ? values.file : null

        setActionLoading(true)
        try {
          if (shouldUseTemplate && file) {
            await uploadTemplate(activeSessionId, file)
          }
          const detail = await sendSessionMessage(activeSessionId, {
            type: 'interrupt_response',
            content:
              shouldUseTemplate && file ? `已上传模板 ${file.name}` : '跳过模板',
            payload: { have_ppt_template: shouldUseTemplate },
          })
          applySessionDetail(detail)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '提交模板失败'
          void message.error(errorMessage)
        } finally {
          setActionLoading(false)
        }
        return
      }
      case 'input': {
        const style = typeof payload === 'string' ? payload.trim() : ''
        if (!style) return
        await submitMessage({
          type: 'interrupt_response',
          content: style,
          payload: style,
        })
        return
      }
      case 'confirmation':
      case 'confirm': {
        const values =
          payload && typeof payload === 'object'
            ? (payload as { confirmed?: boolean })
            : {}
        await submitMessage({
          type: 'interrupt_response',
          content: values.confirmed ? '确认' : '取消',
          payload: { confirmed: Boolean(values.confirmed) },
        })
        return
      }
      default:
        await submitMessage({
          type: 'interrupt_response',
          payload,
        })
    }
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

  const renderSvg = (item: PreviewResult | null) => {
    if (!item?.svg_content) {
      return <Empty description="当前还没有可预览的 SVG 页面" />
    }
    return <div className="svg-canvas" dangerouslySetInnerHTML={{ __html: item.svg_content }} />
  }

  return (
    <Layout className="app-shell">
      <Sider width={320} className="app-shell__sidebar">
        <SessionSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          loading={loadingSessions}
          creating={actionLoading}
          onCreateSession={() => void handleCreateSession()}
          onSelectSession={setActiveSessionId}
        />
      </Sider>

      <Layout className="workspace-shell">
        <div className="workspace-shell__top">
          <TopTimeline
            stage={activeSession?.stage ?? 'idle'}
            firstDraftCount={firstDraftCount}
            finalDraftCount={finalDraftCount}
          />
          <div className="workspace-toolbar">
            <Button
              icon={<ReloadOutlined />}
              onClick={() => void handleRefreshActiveSession()}
              disabled={!activeSessionId}
            >
              刷新
            </Button>
          </div>
        </div>

        <Layout className="workspace-body">
          <Content className="center-panel">
            <ChatThread
              sessionTitle={activeSession?.title ?? '多会话 PPT 工作区'}
              sessionStatus={activeSession?.status ?? 'idle'}
              sessionStage={activeSession?.stage ?? 'idle'}
              loading={loadingSessions || (loadingDetail && !activeSessionDetail)}
              actionLoading={actionLoading}
              messages={activeSessionDetail?.messages ?? []}
              pendingInterruptId={activeSessionDetail?.pending_interrupt?.message_id ?? null}
              requirement={requirement}
              onRequirementChange={setRequirement}
              onRename={() => undefined}
              onSend={() => void handleStart()}
              onSubmitInterrupt={(messageId, payload) =>
                void handleInterruptSubmit(messageId, payload)
              }
              hasActiveSession={Boolean(activeSessionId)}
            />
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
                  <Button
                    icon={<LayoutOutlined />}
                    onClick={() => setModifyDrawerOpen(true)}
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
          <Button
            type="primary"
            onClick={() => void handleModify()}
            loading={actionLoading}
            disabled={selectedModifyPages.length === 0}
          >
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
