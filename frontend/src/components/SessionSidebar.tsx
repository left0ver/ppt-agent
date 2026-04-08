import { useState } from 'react'
import type { SessionSummary } from '../types'

interface SessionSidebarProps {
  sessions: SessionSummary[]
  activeSessionId: string | null
  loading: boolean
  creating: boolean
  onCreateSession: () => void
  onSelectSession: (sessionId: string) => void
  onRenameSession: (sessionId: string, title: string) => void
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
  onRenameSession,
}: SessionSidebarProps) {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')

  const startRename = (session: SessionSummary) => {
    setMenuSessionId(null)
    setEditingSessionId(session.id)
    setDraftTitle(getSessionTitle(session))
  }

  const cancelRename = () => {
    setEditingSessionId(null)
    setMenuSessionId(null)
    setDraftTitle('')
  }

  const commitRename = (session: SessionSummary) => {
    const nextTitle = draftTitle.trim()
    if (!nextTitle) {
      setDraftTitle(getSessionTitle(session))
      return
    }
    if (nextTitle !== getSessionTitle(session)) {
      onRenameSession(session.id, nextTitle)
    }
    cancelRename()
  }

  return (
    <aside className="session-sidebar">
      <div className="session-sidebar__header">
        <div>
          <h1 className="session-sidebar__title">对话</h1>
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
              const isEditing = session.id === editingSessionId
              const menuOpen = session.id === menuSessionId
              return (
                <li key={session.id} className="session-sidebar__list-item">
                  <div className={`session-sidebar__entry${isActive ? ' session-sidebar__entry--active' : ''}`}>
                    {isEditing ? (
                      <div className="session-sidebar__rename">
                        <input
                          className="session-sidebar__rename-input"
                          value={draftTitle}
                          autoFocus
                          aria-label={`会话标题 ${getSessionTitle(session)}`}
                          onChange={(event) => setDraftTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              commitRename(session)
                            }
                            if (event.key === 'Escape') {
                              cancelRename()
                            }
                          }}
                        />
                        <div className="session-sidebar__rename-actions">
                          <button
                            type="button"
                            className="session-sidebar__rename-action"
                            onClick={() => commitRename(session)}
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            className="session-sidebar__rename-action session-sidebar__rename-action--ghost"
                            onClick={cancelRename}
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="session-sidebar__item-row">
                          <button
                            type="button"
                            className={`session-sidebar__item${isActive ? ' session-sidebar__item--active' : ''}`}
                            aria-current={isActive ? 'true' : undefined}
                            onClick={() => onSelectSession(session.id)}
                          >
                            <span className="session-sidebar__item-title">{getSessionTitle(session)}</span>
                            <span className="session-sidebar__item-meta">
                              <span>{formatTimestamp(session.updated_at)}</span>
                            </span>
                          </button>
                          <div className="session-sidebar__menu">
                            <button
                              type="button"
                              className="session-sidebar__menu-trigger"
                              aria-label={`会话操作 ${getSessionTitle(session)}`}
                              aria-expanded={menuOpen}
                              onClick={() =>
                                setMenuSessionId((current) =>
                                  current === session.id ? null : session.id,
                                )
                              }
                            >
                              ⋯
                            </button>
                            {menuOpen ? (
                              <div className="session-sidebar__menu-popover">
                                <button
                                  type="button"
                                  className="session-sidebar__menu-item"
                                  onClick={() => startRename(session)}
                                >
                                  重命名
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
    </aside>
  )
}
