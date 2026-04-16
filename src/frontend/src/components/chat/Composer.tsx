import { Button, Input, Space, Typography } from 'antd'
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
      <div className="chat-composer__heading">
        <Typography.Title level={5}>输入你的 PPT 需求</Typography.Title>

      </div>

      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <Input.TextArea
          aria-label="输入 PPT 需求"
          disabled={disabled}
          placeholder="例如：帮我做一份面向导师的 DeepSeek 论文汇报，12 页，上下结构，风格偏简洁正式。"
          rows={5}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button
          block
          className="chat-composer__submit"
          disabled={disabled || loading}
          htmlType="submit"
          loading={loading}
          size="large"
          type="primary"
        >
          {loading ? '发送中...' : '发送需求'}
        </Button>
      </Space>
    </form>
  )
}
