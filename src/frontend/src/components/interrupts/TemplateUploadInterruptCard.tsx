import { Button, Card, Form, Space, Typography, Upload } from 'antd'
import type { UploadFile } from 'antd'
import { useState } from 'react'
import type { InterruptEnvelope, InterruptValue } from '../../types/ppt-agent'
import type {
  InterruptActionContext,
  InterruptSkipHandler,
  InterruptSubmitHandler,
} from './InterruptCard'

type TemplateUploadInterruptValue = Extract<
  InterruptValue,
  { type: 'upload_ppt_template' }
>

export type TemplateUploadSubmitPayload = {
  have_ppt_template: boolean
  ppt_template_path: null
  templateFile: File | null
}

export type TemplateUploadInterruptCardProps = {
  actionContext: InterruptActionContext
  disabled?: boolean
  interrupt: InterruptEnvelope<TemplateUploadInterruptValue>
  onSubmit: InterruptSubmitHandler<TemplateUploadSubmitPayload>
  onSkip: InterruptSkipHandler
}

export default function TemplateUploadInterruptCard({
  actionContext,
  disabled = false,
  interrupt,
  onSubmit,
  onSkip,
}: TemplateUploadInterruptCardProps) {
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [isPending, setIsPending] = useState(false)

  const templateFile =
    fileList[0]?.originFileObj instanceof File ? fileList[0].originFileObj : null

  async function withPendingGuard(callback: () => Promise<void> | void) {
    if (disabled || isPending) {
      return
    }

    const maybePromise = callback()
    if (maybePromise && typeof maybePromise.then === 'function') {
      setIsPending(true)
      void maybePromise.finally(() => {
        setIsPending(false)
      })
    }
  }

  function handleSubmit() {
    void withPendingGuard(() =>
      onSubmit(actionContext, {
        have_ppt_template: templateFile !== null,
        ppt_template_path: null,
        templateFile,
      }),
    )
  }

  function handleSkip() {
    void withPendingGuard(() => onSkip(actionContext))
  }

  return (
    <Card
      className="interrupt-card"
      title={interrupt.value.title}
      variant="borderless"
    >
      <Typography.Paragraph className="interrupt-card__hint">
        支持格式：{interrupt.value.file_type.join(', ')}
      </Typography.Paragraph>

      <Form layout="vertical">
        <Form.Item label="模板文件">
          <Upload
            accept=".ppt,.pptx"
            beforeUpload={() => false}
            disabled={disabled}
            fileList={fileList}
            maxCount={1}
            onChange={({ fileList: nextFileList }) => setFileList(nextFileList.slice(-1))}
          >
            <Button disabled={disabled}>选择模板文件</Button>
          </Upload>
        </Form.Item>

        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button
            aria-label="跳过"
            disabled={disabled || isPending}
            onClick={handleSkip}
          >
            跳过
          </Button>
          <Button
            aria-label="提交"
            disabled={disabled || templateFile === null || isPending}
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
