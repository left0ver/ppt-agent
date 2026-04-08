import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SessionSidebar from './SessionSidebar'
import type { SessionSummary } from '../types'

const sessions: SessionSummary[] = [
  {
    id: 'session-alpha',
    title: 'Alpha Session',
    status: 'idle',
    stage: 'awaiting_ppt_info',
    created_at: '2026-04-08T08:00:00Z',
    updated_at: '2026-04-08T11:00:00Z',
  },
  {
    id: 'session-beta',
    title: 'Beta Session',
    status: 'completed',
    stage: 'completed',
    created_at: '2026-04-08T09:00:00Z',
    updated_at: '2026-04-08T12:00:00Z',
  },
]

describe('SessionSidebar', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders sessions and highlights the active session', () => {
    const handleCreateSession = vi.fn()
    const handleSelectSession = vi.fn()

    render(
      <SessionSidebar
        sessions={sessions}
        activeSessionId="session-beta"
        loading={false}
        creating={false}
        onCreateSession={handleCreateSession}
        onSelectSession={handleSelectSession}
      />,
    )

    const activeSession = screen.getByRole('button', { name: /Beta Session/i })
    const inactiveSession = screen.getByRole('button', { name: /Alpha Session/i })

    expect(activeSession).toHaveAttribute('aria-current', 'true')
    expect(activeSession).toHaveClass('session-sidebar__item--active')
    expect(inactiveSession).not.toHaveAttribute('aria-current')

    fireEvent.click(inactiveSession)

    expect(handleSelectSession).toHaveBeenCalledWith('session-alpha')
  })

  it('calls the create handler from the 新建会话 button', () => {
    const handleCreateSession = vi.fn()

    render(
      <SessionSidebar
        sessions={sessions}
        activeSessionId="session-alpha"
        loading={false}
        creating={false}
        onCreateSession={handleCreateSession}
        onSelectSession={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '新建会话' }))

    expect(handleCreateSession).toHaveBeenCalledTimes(1)
  })
})
