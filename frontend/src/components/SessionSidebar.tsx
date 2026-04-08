import type { SessionSummary } from '../types'

interface SessionSidebarProps {
  sessions: SessionSummary[]
  activeSessionId: string | null
  loading: boolean
  creating: boolean
  onCreateSession: () => void
  onSelectSession: (sessionId: string) => void
}

function formatTimestamp(value: string): string {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    return value
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp)
}

function getSessionTitle(session: SessionSummary): string {
  return session.title.trim() || '未命名会话'
}

export default function SessionSidebar({
  sessions,
  activeSessionId,
  loading,
  creating,
  onCreateSession,
  onSelectSession,
}: SessionSidebarProps) {
  return (
    <aside className="session-sidebar">
      <div className="session-sidebar__header">
        <div>
          <p className="session-sidebar__eyebrow">Multi-session Workspace</p>
          <h1 className="session-sidebar__title">会话</h1>
          <p className="session-sidebar__count">{sessions.length} 个会话</p>
        </div>
        <button
          type="button"
          className="session-sidebar__create"
          onClick={onCreateSession}
          disabled={creating}
        >
          新建会话
        </button>
      </div>

      <div className="session-sidebar__content">
        {loading && sessions.length === 0 ? (
          <p className="session-sidebar__empty">正在加载会话列表…</p>
        ) : null}

        {!loading && sessions.length === 0 ? (
          <p className="session-sidebar__empty">还没有会话，先从左上角创建一个。</p>
        ) : null}

        {sessions.length > 0 ? (
          <ul className="session-sidebar__list">
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId
              return (
                <li key={session.id} className="session-sidebar__list-item">
                  <button
                    type="button"
                    className={`session-sidebar__item${isActive ? ' session-sidebar__item--active' : ''}`}
                    aria-current={isActive ? 'true' : undefined}
                    onClick={() => onSelectSession(session.id)}
                  >
                    <span className="session-sidebar__item-title">{getSessionTitle(session)}</span>
                    <span className="session-sidebar__item-meta">
                      <span>{session.stage}</span>
                      <span>{formatTimestamp(session.updated_at)}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
    </aside>
  )
}
