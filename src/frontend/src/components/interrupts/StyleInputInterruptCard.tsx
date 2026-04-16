import { Button, Card, Form, Input, Space } from 'antd'
import { useMemo, useState } from 'react'
import type { InterruptEnvelope, InterruptValue } from '../../types/ppt-agent'
import type { InterruptActionContext, InterruptSubmitHandler } from './InterruptCard'

type StyleInputInterruptValue = Extract<InterruptValue, { type: 'text_input' }>

export type StyleInputInterruptCardProps = {
  actionContext: InterruptActionContext
  disabled?: boolean
  interrupt: InterruptEnvelope<StyleInputInterruptValue>
  onSubmit: InterruptSubmitHandler<{ user_ppt_style: string }>
}

export default function StyleInputInterruptCard({
  actionContext,
  disabled = false,
  interrupt,
  onSubmit,
}: StyleInputInterruptCardProps) {
  const [styleValue, setStyleValue] = useState('')
  const [isPending, setIsPending] = useState(false)
  const normalizedValue = useMemo(() => styleValue.trim(), [styleValue])

  function handleSubmit() {
    if (disabled || isPending) {
      return
    }

    const submitResult = onSubmit(actionContext, {
      user_ppt_style: normalizedValue,
    })

    if (submitResult && typeof submitResult.then === 'function') {
      setIsPending(true)
      void submitResult.finally(() => {
        setIsPending(false)
      })
    }
  }

  return (
    <Card
      className="interrupt-card"
      title={interrupt.value.title}
      variant="borderless"
    >
      <Form layout="vertical">
        <Form.Item extra="如果留空，系统将按默认风格继续生成。" label="PPT 整体风格">
          <Input
            aria-label="PPT 整体风格"
            disabled={disabled}
            placeholder="例如：绿色简约风、黑色科技风、米白学术风"
            value={styleValue}
            onChange={(event) => setStyleValue(event.target.value)}
          />
        </Form.Item>
        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button
            aria-label="提交"
            disabled={disabled}
            loading={isPending}
            type="primary"
            onClick={handleSubmit}
          >
            提交
          </Button>
        </Space>
      </Form>
    </Card>
  )
}
