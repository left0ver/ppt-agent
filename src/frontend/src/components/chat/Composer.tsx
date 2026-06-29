import { Button, Input } from 'antd'
import { useState } from 'react'

export type ComposerActionMode = 'send' | 'cancel' | 'continue'

export type ComposerProps = {
  actionDisabled: boolean
  actionMode: ComposerActionMode
  inputDisabled: boolean
  onSubmit: (prompt: string) => Promise<void> | void
  onCancel: () => Promise<void> | void
  onContinue: () => Promise<void> | void
}

export default function Composer({
  actionDisabled,
  actionMode,
  inputDisabled,
  onSubmit,
  onCancel,
  onContinue,
}: ComposerProps) {
  const [value, setValue] = useState('')

  async function handleSubmit() {
    const trimmedValue = value.trim()

    if (!trimmedValue || inputDisabled || actionMode !== 'send') {
      return
    }

    setValue('')
    await onSubmit(trimmedValue)
  }

  async function handleAction() {
    if (actionDisabled) {
      return
    }

    if (actionMode === 'send') {
      await handleSubmit()
      return
    }

    if (actionMode === 'cancel') {
      await onCancel()
      return
    }

    await onContinue()
  }

  const actionLabel = actionMode === 'continue' ? '继续' : actionMode === 'cancel' ? '取消' : '发送'
  const actionAriaLabel =
    actionMode === 'continue'
      ? '继续'
      : actionMode === 'cancel'
        ? '取消当前生成'
        : '发送'

  return (
    <form
      aria-label="PPT 需求输入"
      className="chat-composer"
      onSubmit={(event) => {
        event.preventDefault()
        void handleAction()
      }}
    >
      <div className="chat-composer__surface">
        <Input.TextArea
          aria-label="输入 PPT 需求"
          disabled={inputDisabled}
          className="chat-composer__input"
          placeholder="一句话输入你的PPT需求，例如我是学生，我需要向导师介绍deepseekR1的论文，PPT页数大概为10页，布局风格采用网格布局方式"
          rows={3}
          variant="borderless"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault()
              void handleSubmit()
            }
          }}
        />

        <div className="chat-composer__footer">
          <Button
            aria-label={actionAriaLabel}
            className={`chat-composer__submit${
              actionMode === 'cancel' ? ' chat-composer__submit--cancel' : ''
            }`}
            disabled={actionDisabled}
            htmlType="submit"
            size="large"
            type="primary"
          >
            {actionMode === 'cancel' ? (
              <span className="chat-composer__submit-status">
                <span className="chat-composer__submit-spinner" aria-hidden="true" />
                {actionLabel}
              </span>
            ) : (
              actionLabel
            )}
          </Button>
        </div>
      </div>
    </form>
  )
}
