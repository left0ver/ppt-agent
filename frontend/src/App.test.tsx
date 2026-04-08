import { render, screen, waitFor } from '@testing-library/react'
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
    EyeOutlined: Icon,
    FilePptOutlined: Icon,
    FolderOpenOutlined: Icon,
    FullscreenOutlined: Icon,
    LayoutOutlined: Icon,
    PlusOutlined: Icon,
    ReloadOutlined: Icon,
  }
})

vi.mock('@ant-design/x', async () => {
  const Sender = ({
    value,
    onChange,
    onSubmit,
    placeholder,
  }: {
    value?: string
    onChange?: (value: string) => void
    onSubmit?: () => void
    placeholder?: string
  }) => (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit?.()
      }}
    >
      <input
        aria-label={placeholder ?? 'sender'}
        value={value ?? ''}
        onChange={(event) => onChange?.(event.target.value)}
      />
      <button type="submit">submit</button>
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
    const Component = ({ children }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div data-component={displayName}>{children}</div>
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
  }: {
    value?: string
    onChange?: (event: { target: { value: string } }) => void
    placeholder?: string
  }) => <input value={value ?? ''} placeholder={placeholder} onChange={(event) => onChange?.({ target: { value: event.target.value } })} />

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
    renderItem?: (item: any, index: number) => React.ReactNode
  }) => <div>{(dataSource ?? []).map((item, index) => <div key={index}>{renderItem?.(item, index)}</div>)}</div>
  List.Item = passthrough('List.Item')

  const Select = passthrough('Select')
  const Space = passthrough('Space')
  const Flex = passthrough('Flex')
  const Drawer = ({ children, open }: React.PropsWithChildren<{ open?: boolean }>) => (open ? <div>{children}</div> : null)
  const Modal = ({ children, open }: React.PropsWithChildren<{ open?: boolean }>) => (open ? <div>{children}</div> : null)
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
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads the session list and shows the active session title from session detail', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.endsWith('/api/sessions')) {
        return new Response(
          JSON.stringify([
            {
              id: 'session-newest',
              title: 'Newest Session',
              status: 'interrupted',
              stage: 'awaiting_ppt_info',
              created_at: '2026-04-08T10:00:00Z',
              updated_at: '2026-04-08T11:00:00Z',
            },
            {
              id: 'session-older',
              title: 'Older Session',
              status: 'completed',
              stage: 'completed',
              created_at: '2026-04-08T08:00:00Z',
              updated_at: '2026-04-08T09:00:00Z',
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
            messages: [],
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
    })
  })
})
