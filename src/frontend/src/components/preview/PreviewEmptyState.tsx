export default function PreviewEmptyState() {
  return (
    <div
      aria-label="预览空状态"
      style={{
        minHeight: '220px',
        border: '1px dashed #d1d5db',
        borderRadius: '16px',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        textAlign: 'center',
        color: '#4b5563',
      }}
    >
      <div>
        <p style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#111827' }}>
          点击左侧缩略图查看页面预览
        </p>
        <p style={{ margin: '8px 0 0', fontSize: '14px' }}>
          选择任意一页后，可继续进入全屏查看。
        </p>
      </div>
    </div>
  )
}
