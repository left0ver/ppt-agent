import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./pptExport', () => ({
  exportSlidesToPptx: vi.fn(),
}))

vi.mock('@ant-design/icons', () => {
  const Icon = () => null
  return {
    BellOutlined: Icon,
    CloudDownloadOutlined: Icon,
    EditOutlined: Icon,
    EyeOutlined: Icon,
    FilePptOutlined: Icon,
    FolderOpenOutlined: Icon,
    FullscreenOutlined: Icon,
    LayoutOutlined: Icon,
    LeftOutlined: Icon,
    MoreOutlined: Icon,
    PlusOutlined: Icon,
    ReloadOutlined: Icon,
    RightOutlined: Icon,
    UploadOutlined: Icon,
  }
})

vi.mock('@ant-design/x', async () => {
  const Sender = ({
    value,
    onChange,
    onSubmit,
    placeholder,
    disabled,
  }: {
    value?: string
    onChange?: (value: string) => void
    onSubmit?: () => void
    placeholder?: string
    disabled?: boolean
  }) => (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!disabled) {
          onSubmit?.()
        }
      }}
    >
      <input
        aria-label={placeholder ?? 'sender'}
        placeholder={placeholder}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
      />
      <button type="submit" disabled={disabled}>submit</button>
    </form>
  )

  const Prompts = ({
    items,
    onItemClick,
  }: {
    items?: Array<{ key?: string; label?: React.ReactNode } | string>
    onItemClick?: (info: { data: { label: React.ReactNode } }) => void
  }) => (
    <div>
      {(items ?? []).map((item, index) => {
        const label = typeof item === 'string' ? item : item.label
        return (
          <button
            key={typeof item === 'string' ? item : item.key ?? String(index)}
            type="button"
            onClick={() => onItemClick?.({ data: { label } })}
          >
            {label}
          </button>
        )
      })}
    </div>
  )

  const BubbleList = ({ items }: { items?: Array<{ key: string; content: React.ReactNode }> }) => (
    <div>{(items ?? []).map((item) => <div key={item.key}>{item.content}</div>)}</div>
  )

  const XProvider = ({ children }: React.PropsWithChildren) => <>{children}</>

  return {
    Sender,
    Prompts,
    Bubble: {
      List: BubbleList,
    },
    XProvider,
  }
})

vi.mock('antd', async () => {
  const passthrough = (displayName: string) => {
    const Component = ({
      children,
      className,
      onClick,
      style,
    }: React.PropsWithChildren<{
      className?: string
      onClick?: () => void
      style?: React.CSSProperties
    }>) => (
      <div data-component={displayName} className={className} onClick={onClick} style={style}>
        {children}
      </div>
    )
    Component.displayName = displayName
    return Component
  }

  const Button = ({
    children,
    onClick,
    disabled,
    htmlType,
  }: React.PropsWithChildren<{
    onClick?: () => void
    disabled?: boolean
    htmlType?: 'button' | 'submit' | 'reset'
  }>) => (
    <button type={htmlType ?? 'button'} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )

  const Input = ({
    value,
    onChange,
    placeholder,
    onKeyDown,
    onBlur,
    disabled,
    autoFocus,
  }: {
    value?: string
    onChange?: (event: { target: { value: string } }) => void
    placeholder?: string
    onKeyDown?: (event: { key: string }) => void
    onBlur?: () => void
    disabled?: boolean
    autoFocus?: boolean
  }) => (
    <input
      value={value ?? ''}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      onChange={(event) => onChange?.({ target: { value: event.target.value } })}
      onKeyDown={(event) => onKeyDown?.({ key: event.key })}
      onBlur={() => onBlur?.()}
    />
  )

  const InputNumber = ({
    value,
    onChange,
  }: {
    value?: number
    onChange?: (value: number | null) => void
  }) => (
    <input
      type="number"
      value={value ?? 0}
      onChange={(event) => onChange?.(Number(event.target.value))}
    />
  )

  const Card = ({
    title,
    extra,
    children,
  }: React.PropsWithChildren<{ title?: React.ReactNode; extra?: React.ReactNode }>) => (
    <section>
      {title ? <h2>{title}</h2> : null}
      {extra}
      {children}
    </section>
  )

  const List = ({
    dataSource,
    renderItem,
  }: {
    dataSource?: unknown[]
    renderItem?: (item: unknown, index: number) => React.ReactNode
  }) => <div>{(dataSource ?? []).map((item, index) => <div key={index}>{renderItem?.(item, index)}</div>)}</div>
  List.Item = passthrough('List.Item')

  const Select = passthrough('Select')
  const Space = passthrough('Space')
  const Flex = passthrough('Flex')
  const Drawer = ({ children, open }: React.PropsWithChildren<{ open?: boolean }>) => (open ? <div>{children}</div> : null)
  const Modal = ({ children, open }: React.PropsWithChildren<{ open?: boolean }>) =>
    open ? <div data-testid="modal">{children}</div> : null
  const Empty = ({ description }: { description?: React.ReactNode }) => <div>{description}</div>
  const Spin = () => <div>loading</div>
  const Avatar = passthrough('Avatar')
  const Divider = () => <hr />
  const Tag = ({ children }: React.PropsWithChildren) => <span>{children}</span>
  const Tabs = ({ items }: { items?: Array<{ key: string; label: React.ReactNode }> }) => <div>{(items ?? []).map((item) => <span key={item.key}>{item.label}</span>)}</div>
  const Steps = ({ items }: { items?: Array<{ title: React.ReactNode }> }) => <div>{(items ?? []).map((item, index) => <span key={index}>{item.title}</span>)}</div>
  const Segmented = passthrough('Segmented')
  const Alert = ({
    message,
    description,
  }: {
    message?: React.ReactNode
    description?: React.ReactNode
  }) => (
    <div>
      {message}
      {description}
    </div>
  )

  const Descriptions = ({ children }: React.PropsWithChildren) => <dl>{children}</dl>
  Descriptions.Item = ({
    label,
    children,
  }: React.PropsWithChildren<{ label?: React.ReactNode }>) => (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )

  const FormComponent = ({ children }: React.PropsWithChildren) => <form>{children}</form>
  FormComponent.Item = passthrough('Form.Item')
  const formApi = {
    validateFields: vi.fn(async () => ({
      target_audience: '导师和同学',
      user_role: '学生',
      num_pages: 10,
      theme: 'DeepSeek 论文汇报',
      layout_style: 'top_bottom',
    })),
    setFieldsValue: vi.fn(),
  }
  const Form = Object.assign(FormComponent, {
    useForm: () => [formApi],
  })

  const UploadComponent = passthrough('Upload')
  const Upload = Object.assign(UploadComponent, {
    Dragger: passthrough('Upload.Dragger'),
  })

  const Typography = {
    Paragraph: passthrough('Paragraph'),
    Text: passthrough('Text'),
    Title: ({ children }: React.PropsWithChildren) => <h1>{children}</h1>,
  }

  const LayoutComponent = passthrough('Layout')
  const Layout = Object.assign(LayoutComponent, {
    Header: passthrough('Header'),
    Sider: passthrough('Sider'),
    Content: passthrough('Content'),
  })

  const messageApi = {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
  }
  const AntAppComponent = ({ children }: React.PropsWithChildren) => <>{children}</>
  const AntApp = Object.assign(AntAppComponent, {
    useApp: () => ({ message: messageApi }),
  })

  return {
    Alert,
    App: AntApp,
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
  }
})

const { default: App } = await import('./App')
const { exportSlidesToPptx } = await import('./pptExport')

function deferredResponse() {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('App session bootstrap', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
      matches: false,
      media: '',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })))
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('selects the most recently updated session on bootstrap and loads its detail', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.endsWith('/api/sessions')) {
        return new Response(
          JSON.stringify([
            {
              id: 'session-older',
              title: 'Older Session',
              status: 'completed',
              stage: 'completed',
              created_at: '2026-04-08T08:00:00Z',
              updated_at: '2026-04-08T09:00:00Z',
            },
            {
              id: 'session-newest',
              title: 'Newest Session',
              status: 'interrupted',
              stage: 'awaiting_ppt_info',
              created_at: '2026-04-08T10:00:00Z',
              updated_at: '2026-04-08T11:00:00Z',
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      if (url.endsWith('/api/sessions/session-newest')) {
        return new Response(
          JSON.stringify({
            session: {
              id: 'session-newest',
              title: 'Newest Session',
              status: 'interrupted',
              stage: 'awaiting_ppt_info',
              created_at: '2026-04-08T10:00:00Z',
              updated_at: '2026-04-08T11:00:00Z',
            },
            messages: [
              {
                id: 'message-1',
                session_id: 'session-newest',
                role: 'assistant',
                type: 'interrupt',
                content: '请确认 PPT 信息',
                payload: {
                  type: 'edit',
                  title: '请确认 PPT 信息',
                  payload: {
                    target_audience: '导师',
                    user_role: '学生',
                    num_pages: 12,
                    theme: 'DeepSeek 论文汇报',
                    layout_style: 'top_bottom',
                  },
                },
                created_at: '2026-04-08T11:00:00Z',
              },
            ],
            pending_interrupt: {
              id: 'interrupt-1',
              session_id: 'session-newest',
              interrupt_type: 'ppt_info',
              title: '请确认 PPT 信息',
              payload: {
                target_audience: '导师',
                user_role: '学生',
                num_pages: 12,
                theme: 'DeepSeek 论文汇报',
                layout_style: 'top_bottom',
              },
              status: 'pending',
              message_id: 'message-1',
              created_at: '2026-04-08T11:00:00Z',
              resolved_at: null,
            },
            preview: {
              first_draft_results: [],
              final_ppt_results: [],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    expect((await screen.findAllByText('Newest Session')).length).toBeGreaterThan(0)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8000/api/sessions', expect.anything())
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8000/api/sessions/session-newest', expect.anything())
      expect(fetchMock).not.toHaveBeenCalledWith('http://127.0.0.1:8000/api/sessions/session-older', expect.anything())
    })
  })

  it('clears stale session detail from the active view when switching sessions', async () => {
    const betaSessionDetail = deferredResponse()

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)

      if (url.endsWith('/api/sessions')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
            {
              id: 'session-b',
              title: 'Beta Session',
              status: 'completed',
              stage: 'completed',
              created_at: '2026-04-08T09:00:00Z',
              updated_at: '2026-04-08T10:00:00Z',
            },
            {
              id: 'session-a',
              title: 'Alpha Session',
              status: 'interrupted',
              stage: 'awaiting_ppt_info',
              created_at: '2026-04-08T08:00:00Z',
              updated_at: '2026-04-08T11:00:00Z',
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      }

      if (url.endsWith('/api/sessions/session-b')) {
        return betaSessionDetail.promise
      }

      if (url.endsWith('/api/sessions/session-a')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              session: {
                id: 'session-a',
                title: 'Alpha Session',
                status: 'interrupted',
                stage: 'awaiting_ppt_info',
                created_at: '2026-04-08T08:00:00Z',
                updated_at: '2026-04-08T10:00:00Z',
              },
              messages: [
                {
                  id: 'message-a',
                  session_id: 'session-a',
                  role: 'assistant',
                  type: 'interrupt',
                  content: 'Alpha Interrupt',
                  payload: {
                    type: 'edit',
                    title: 'Alpha Interrupt',
                    payload: {
                      target_audience: '导师',
                      user_role: '学生',
                      num_pages: 10,
                      theme: 'Alpha Theme',
                      layout_style: 'top_bottom',
                    },
                  },
                },
              ],
              pending_interrupt: {
                id: 'interrupt-a',
                session_id: 'session-a',
                interrupt_type: 'ppt_info',
                title: 'Alpha Interrupt',
                payload: {
                  target_audience: '导师',
                  user_role: '学生',
                  num_pages: 10,
                  theme: 'Alpha Theme',
                  layout_style: 'top_bottom',
                },
                status: 'pending',
                message_id: 'message-a',
                created_at: '2026-04-08T10:00:00Z',
                resolved_at: null,
              },
              preview: {
                first_draft_results: [],
                final_ppt_results: [],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8000/api/sessions', expect.anything())
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8000/api/sessions/session-a', expect.anything())
    })

    expect(await screen.findByText(/Alpha Interrupt/)).toBeInTheDocument()

    fireEvent.click(screen.getAllByText('Beta Session')[0])

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8000/api/sessions/session-b', expect.anything())
    })

    expect(screen.queryByText(/Alpha Interrupt/)).not.toBeInTheDocument()
    expect(screen.queryByText('确认 PPT 基本信息')).not.toBeInTheDocument()

    betaSessionDetail.resolve(
      new Response(
        JSON.stringify({
          session: {
            id: 'session-b',
            title: 'Beta Session',
            status: 'completed',
            stage: 'completed',
            created_at: '2026-04-08T09:00:00Z',
            updated_at: '2026-04-08T10:00:00Z',
          },
          messages: [],
          pending_interrupt: null,
          preview: {
            first_draft_results: [],
            final_ppt_results: [],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    expect((await screen.findAllByText('Beta Session')).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Alpha Interrupt/)).not.toBeInTheDocument()
  })

  it('renames the active session title from the sidebar', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/api/sessions') && (!init?.method || init.method === 'GET')) {
        return new Response(
          JSON.stringify([
            {
              id: 'session-rename',
              title: '今天为什么要上班',
              status: 'completed',
              stage: 'completed',
              created_at: '2026-04-08T08:00:00Z',
              updated_at: '2026-04-08T09:00:00Z',
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      if (url.endsWith('/api/sessions/session-rename') && (!init?.method || init.method === 'GET')) {
        return new Response(
          JSON.stringify({
            session: {
              id: 'session-rename',
              title: '今天为什么要上班',
              status: 'completed',
              stage: 'completed',
              created_at: '2026-04-08T08:00:00Z',
              updated_at: '2026-04-08T09:00:00Z',
            },
            messages: [],
            pending_interrupt: null,
            preview: {
              first_draft_results: [],
              final_ppt_results: [],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      if (url.endsWith('/api/sessions/session-rename') && init?.method === 'PATCH') {
        return new Response(
          JSON.stringify({
            id: 'session-rename',
            title: '新的标题',
            status: 'completed',
            stage: 'completed',
            created_at: '2026-04-08T08:00:00Z',
            updated_at: '2026-04-08T09:30:00Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '会话操作 今天为什么要上班' }))
    fireEvent.click(await screen.findByRole('button', { name: '重命名' }))
    fireEvent.change(screen.getByDisplayValue('今天为什么要上班'), { target: { value: '新的标题' } })
    fireEvent.keyDown(screen.getByDisplayValue('新的标题'), { key: 'Enter' })

    expect((await screen.findAllByText('新的标题')).length).toBeGreaterThan(0)
  })

  it('exports final slides from the preview panel', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/api/sessions') && (!init?.method || init.method === 'GET')) {
        return new Response(
          JSON.stringify([
            {
              id: 'session-export',
              title: 'AI 产品介绍',
              status: 'completed',
              stage: 'completed',
              created_at: '2026-04-08T08:00:00Z',
              updated_at: '2026-04-08T09:00:00Z',
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      if (url.endsWith('/api/sessions/session-export') && (!init?.method || init.method === 'GET')) {
        return new Response(
          JSON.stringify({
            session: {
              id: 'session-export',
              title: 'AI 产品介绍',
              status: 'completed',
              stage: 'completed',
              created_at: '2026-04-08T08:00:00Z',
              updated_at: '2026-04-08T09:00:00Z',
            },
            messages: [],
            pending_interrupt: null,
            preview: {
              first_draft_results: [
                {
                  page: 1,
                  svg_content: '<svg><text>draft</text></svg>',
                  svg_url: '/api/ppt/svg/session-export/first_draft/1',
                  file_path: '/tmp/draft-1.svg',
                },
              ],
              final_ppt_results: [
                {
                  page: 1,
                  svg_content: '<svg><text>final</text></svg>',
                  svg_url: '/api/ppt/svg/session-export/final_ppt/1',
                  file_path: '/tmp/final-1.svg',
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    const exportButton = await screen.findByRole('button', { name: '导出终稿' })
    await waitFor(() => expect(exportButton).not.toBeDisabled())
    fireEvent.click(exportButton)

    await waitFor(() => {
      expect(exportSlidesToPptx).toHaveBeenCalledWith({
        slides: [
          {
            page: 1,
            svg_content: '<svg><text>final</text></svg>',
            svg_url: '/api/ppt/svg/session-export/final_ppt/1',
            file_path: '/tmp/final-1.svg',
          },
        ],
        fileName: 'AI 产品介绍-终稿.pptx',
        author: 'PPT Agent',
        subject: '终稿导出',
        title: 'AI 产品介绍-终稿',
      })
    })
  })

  it('switches pages from the zoom modal', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/api/sessions') && (!init?.method || init.method === 'GET')) {
        return new Response(
          JSON.stringify([
            {
              id: 'session-zoom',
              title: '缩放测试',
              status: 'completed',
              stage: 'completed',
              created_at: '2026-04-08T08:00:00Z',
              updated_at: '2026-04-08T09:00:00Z',
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      if (url.endsWith('/api/sessions/session-zoom') && (!init?.method || init.method === 'GET')) {
        return new Response(
          JSON.stringify({
            session: {
              id: 'session-zoom',
              title: '缩放测试',
              status: 'completed',
              stage: 'completed',
              created_at: '2026-04-08T08:00:00Z',
              updated_at: '2026-04-08T09:00:00Z',
            },
            messages: [],
            pending_interrupt: null,
            preview: {
              first_draft_results: [],
              final_ppt_results: [
                {
                  page: 1,
                  svg_content: '<svg><text>final-1</text></svg>',
                  svg_url: '/api/ppt/svg/session-zoom/final_ppt/1',
                  file_path: '/tmp/final-1.svg',
                },
                {
                  page: 2,
                  svg_content: '<svg><text>final-2</text></svg>',
                  svg_url: '/api/ppt/svg/session-zoom/final_ppt/2',
                  file_path: '/tmp/final-2.svg',
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(<App />)

    await screen.findByText('final-1')
    const zoomTrigger = container.querySelector('.preview-stage-clickable')
    expect(zoomTrigger).not.toBeNull()
    fireEvent.click(zoomTrigger!)
    const modal = await screen.findByTestId('modal')

    expect(within(modal).getByRole('button', { name: '上一页' })).toBeInTheDocument()
    expect(within(modal).getByRole('button', { name: '下一页' })).toBeInTheDocument()

    fireEvent.click(within(modal).getByRole('button', { name: '下一页' }))
    expect(await within(modal).findByText('第 2 / 2 页')).toBeInTheDocument()

    fireEvent.click(within(modal).getByRole('button', { name: '上一页' }))
    expect(await within(modal).findByText('第 1 / 2 页')).toBeInTheDocument()
  })
})
