import { fireEvent, render, screen } from '@testing-library/react'
import type * as React from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@ant-design/icons', () => {
  const Icon = () => null
  return {
    EditOutlined: Icon,
    PlusOutlined: Icon,
    UploadOutlined: Icon,
  }
})

vi.mock('@ant-design/x', () => {
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
      <button type="submit" disabled={disabled}>
        submit
      </button>
    </form>
  )

  return { Sender }
})

vi.mock('antd', () => {
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

  const Card = ({
    title,
    children,
  }: React.PropsWithChildren<{ title?: React.ReactNode }>) => (
    <section>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  )

  const Input = ({
    value,
    onChange,
    placeholder,
    disabled,
  }: {
    value?: string
    onChange?: (event: { target: { value: string } }) => void
    placeholder?: string
    disabled?: boolean
  }) => (
    <input
      value={value ?? ''}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange?.({ target: { value: event.target.value } })}
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

  const Segmented = ({
    value,
    options,
    onChange,
  }: {
    value?: string
    options?: Array<{ label: React.ReactNode; value: string }>
    onChange?: (value: string) => void
  }) => (
    <div>
      {(options ?? []).map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange?.(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )

  const Typography = {
    Paragraph: passthrough('Paragraph'),
    Text: passthrough('Text'),
    Title: ({ children }: React.PropsWithChildren) => <h1>{children}</h1>,
  }

  return {
    Alert: ({
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
    ),
    Button,
    Card,
    Input,
    InputNumber,
    Segmented,
    Space: passthrough('Space'),
    Tag: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
    Typography,
  }
})

import { ChatThread } from './ChatThread'

describe('ChatThread', () => {
  it('renders interrupt card content inside the message stream', () => {
    render(
      <ChatThread
        sessionTitle="今天为什么要上班"
        sessionStatus="interrupted"
        sessionStage="awaiting_ppt_info"
        loading={false}
        messages={[
          {
            id: 'm1',
            session_id: 's1',
            role: 'assistant',
            type: 'interrupt',
            content: '请确认 PPT 基本信息',
            payload: {
              type: 'edit',
              title: '请确认 PPT 基本信息',
              payload: { theme: 'DeepSeek', num_pages: 10 },
            },
            created_at: '2026-04-08T00:00:00Z',
          },
        ]}
        pendingInterruptId="m1"
        requirement=""
        onRequirementChange={() => undefined}
        onRename={() => undefined}
        onSend={() => undefined}
        onSubmitInterrupt={() => undefined}
      />,
    )

    expect(screen.getByText('请确认 PPT 基本信息')).toBeInTheDocument()
    expect(screen.getByDisplayValue('DeepSeek')).toBeInTheDocument()
    expect(screen.getByDisplayValue('10')).toBeInTheDocument()
  })

  it('disables sender when an interrupt is pending', () => {
    render(
      <ChatThread
        sessionTitle="新会话"
        sessionStatus="interrupted"
        sessionStage="awaiting_template"
        loading={false}
        messages={[]}
        pendingInterruptId="pending-1"
        requirement=""
        onRequirementChange={() => undefined}
        onRename={() => undefined}
        onSend={() => undefined}
        onSubmitInterrupt={() => undefined}
      />,
    )

    expect(screen.getAllByPlaceholderText('请先完成上方待处理卡片')[0]).toBeDisabled()
  })

  it('submits confirm interrupts from the message stream', () => {
    const onSubmitInterrupt = vi.fn()

    render(
      <ChatThread
        sessionTitle="确认会话"
        sessionStatus="interrupted"
        sessionStage="interrupted"
        loading={false}
        messages={[
          {
            id: 'm-confirm',
            session_id: 's1',
            role: 'assistant',
            type: 'interrupt',
            content: '请确认是否继续执行“会话标题修改”',
            payload: {
              type: 'confirmation',
              title: '请确认是否继续执行“会话标题修改”',
              payload: null,
            },
            created_at: '2026-04-08T00:00:00Z',
          },
        ]}
        pendingInterruptId="m-confirm"
        requirement=""
        onRequirementChange={() => undefined}
        onRename={() => undefined}
        onSend={() => undefined}
        onSubmitInterrupt={onSubmitInterrupt}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    expect(onSubmitInterrupt).toHaveBeenCalledWith('m-confirm', { confirmed: true })
  })
})
