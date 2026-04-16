import { Button, Input } from 'antd'
import { useState } from 'react'

export type ComposerProps = {
  disabled: boolean
  loading: boolean
  onSubmit: (prompt: string) => Promise<void> | void
}

export default function Composer({ disabled, loading, onSubmit }: ComposerProps) {
  const [value, setValue] = useState('')

  async function handleSubmit() {
    const trimmedValue = value.trim()

    if (!trimmedValue || disabled || loading) {
      return
    }

    setValue('')
    await onSubmit(trimmedValue)
  }

  return (
    <form
      aria-label="PPT 需求输入"
      className="chat-composer"
      onSubmit={(event) => {
        event.preventDefault()
        void handleSubmit()
      }}
    >
      <div className="chat-composer__surface">
        <Input.TextArea
          aria-label="输入 PPT 需求"
          disabled={disabled}
          className="chat-composer__input"
          placeholder="我是学生，我需要向导师介绍deepseekR1的论文，PPT页数大概为10页，布局风格采用网格布局方式"
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
            aria-label="发送"
            className="chat-composer__submit"
            disabled={disabled || loading}
            htmlType="submit"
            loading={loading}
            size="large"
            type="primary"
          >
            {loading ? '发送中...' : '发送'}
          </Button>
        </div>
      </div>
    </form>
  )
}
