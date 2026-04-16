import { Button, Card, Form, Input, Space, Typography, Upload } from 'antd'
import type { UploadFile } from 'antd'
import { useMemo, useState } from 'react'
import type { InterruptEnvelope, InterruptValue } from '../../types/ppt-agent'
import type {
  InterruptActionContext,
  InterruptSkipHandler,
  InterruptSubmitHandler,
} from './InterruptCard'

type ContentUploadInterruptValue = Extract<
  InterruptValue,
  { type: 'upload_ppt_content_files' }
>

export type ContentUploadSubmitPayload = {
  contentFiles: File[]
  have_ppt_content_files: boolean
  ppt_content_source_urls: string[] | null
}

export type ContentUploadInterruptCardProps = {
  actionContext: InterruptActionContext
  disabled?: boolean
  interrupt: InterruptEnvelope<ContentUploadInterruptValue>
  onSubmit: InterruptSubmitHandler<ContentUploadSubmitPayload>
  onSkip: InterruptSkipHandler
}

export default function ContentUploadInterruptCard({
  actionContext,
  disabled = false,
  interrupt,
  onSubmit,
  onSkip,
}: ContentUploadInterruptCardProps) {
  const [urlValue, setUrlValue] = useState('')
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [isPending, setIsPending] = useState(false)

  const normalizedUrls = useMemo(
    () =>
      urlValue
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean),
    [urlValue],
  )

  const files = fileList.reduce<File[]>((result, item) => {
    if (item.originFileObj) {
      result.push(item.originFileObj as File)
    }

    return result
  }, [])

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
        contentFiles: files,
        have_ppt_content_files: files.length > 0,
        ppt_content_source_urls: normalizedUrls.length > 0 ? normalizedUrls : null,
      }),
    )
  }

  function handleSkip() {
    void withPendingGuard(() => onSkip(actionContext))
  }

  const canSubmit = files.length > 0 || normalizedUrls.length > 0

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
        <Form.Item label="内容文件">
          <Upload
            accept=".pdf,.docx,.markdown,.md"
            beforeUpload={() => false}
            disabled={disabled}
            fileList={fileList}
            multiple
            onChange={({ fileList: nextFileList }) => setFileList(nextFileList)}
          >
            <Button disabled={disabled}>选择内容文件</Button>
          </Upload>
        </Form.Item>

        <Form.Item extra="每行输入一个网址，系统会抓取网页内容作为补充资料。" label="内容来源网址">
          <Input.TextArea
            aria-label="内容来源网址"
            disabled={disabled}
            placeholder="https://..."
            rows={4}
            value={urlValue}
            onChange={(event) => setUrlValue(event.target.value)}
          />
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
            disabled={disabled || !canSubmit || isPending}
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
