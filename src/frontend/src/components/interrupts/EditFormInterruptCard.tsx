import { Button, Card, Form, Input, InputNumber, Select, Space } from 'antd'
import { useState } from 'react'
import type {
  EditFormInterruptValue,
  InterruptEnvelope,
  LayoutStyle,
} from '../../types/ppt-agent'
import type { InterruptActionContext, InterruptSubmitHandler } from './InterruptCard'

type EditFormPayload = EditFormInterruptValue['payload']
const MIN_NUM_PAGES = 1
const MAX_NUM_PAGES = 30
const DEFAULT_LAYOUT_OPTIONS: LayoutStyle[] = ['top_bottom', 'grid']

export type EditFormInterruptCardProps = {
  interrupt: InterruptEnvelope<EditFormInterruptValue>
  actionContext: InterruptActionContext
  disabled?: boolean
  layoutStyleOptions?: LayoutStyle[]
  onSubmit: InterruptSubmitHandler<EditFormPayload>
}

export default function EditFormInterruptCard({
  actionContext,
  disabled = false,
  interrupt,
  layoutStyleOptions = DEFAULT_LAYOUT_OPTIONS,
  onSubmit,
}: EditFormInterruptCardProps) {
  const [formValue, setFormValue] = useState<EditFormPayload>({
    theme: interrupt.value.payload.theme ?? '',
    target_audience: interrupt.value.payload.target_audience ?? '',
    num_pages: interrupt.value.payload.num_pages ?? 0,
    user_role: interrupt.value.payload.user_role ?? '',
    layout_style: interrupt.value.payload.layout_style ?? 'top_bottom',
  })
  const [isPending, setIsPending] = useState(false)

  const numPagesIsValid =
    Number.isInteger(formValue.num_pages) &&
    formValue.num_pages >= MIN_NUM_PAGES &&
    formValue.num_pages <= MAX_NUM_PAGES

  function setField<Key extends keyof EditFormPayload>(field: Key, value: EditFormPayload[Key]) {
    setFormValue((currentValue) => ({
      ...currentValue,
      [field]: value,
    }))
  }

  function handleSubmit() {
    if (disabled || isPending || !numPagesIsValid) {
      return
    }

    const submitResult = onSubmit(actionContext, formValue)

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
        <div className="interrupt-grid">
          <Form.Item label="主题">
            <Input
              aria-label="主题"
              disabled={disabled}
              value={formValue.theme}
              onChange={(event) => setField('theme', event.target.value)}
            />
          </Form.Item>
          <Form.Item label="目标受众">
            <Input
              aria-label="目标受众"
              disabled={disabled}
              value={formValue.target_audience}
              onChange={(event) => setField('target_audience', event.target.value)}
            />
          </Form.Item>
          <Form.Item
            help={!numPagesIsValid ? '页数必须为 1 到 30 之间的整数' : undefined}
            label="页数"
            validateStatus={!numPagesIsValid ? 'error' : undefined}
          >
            <InputNumber
              aria-label="页数"
              disabled={disabled}
              max={30}
              min={1}
              style={{ width: '100%' }}
              value={formValue.num_pages}
              onChange={(value) => setField('num_pages', Number(value ?? 0))}
            />
          </Form.Item>
          <Form.Item label="用户角色">
            <Input
              aria-label="用户角色"
              disabled={disabled}
              value={formValue.user_role}
              onChange={(event) => setField('user_role', event.target.value)}
            />
          </Form.Item>
          <Form.Item label="版式">
            <Select
              aria-label="版式"
              disabled={disabled}
              options={layoutStyleOptions.map((option) => ({
                label: option,
                value: option,
              }))}
              value={formValue.layout_style}
              onChange={(value) => setField('layout_style', value)}
            />
          </Form.Item>
        </div>

        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button
            aria-label="提交"
            disabled={disabled || isPending || !numPagesIsValid}
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
