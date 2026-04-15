import { describe, expect, it } from 'vitest'
import { createInitialSessionState, sessionReducer } from '../state/session-state'
import type {
  InterruptReceivedEvent,
  SessionState,
  StartSubmittedEvent,
  StatusReceivedEvent,
  ThreadReadyEvent,
} from '../types/ppt-agent'

function expectValidSessionState(state: SessionState) {
  expect(state.messageSequence).toBe(state.messages.length)

  switch (state.threadStatus) {
    case 'creating':
      expect(state.threadId).toBeNull()
      expect(state.composerLocked).toBe(false)
      expect(state.activeInterrupt).toBeNull()
      break
    case 'ready':
      expect(state.threadId).toBeTypeOf('string')
      expect(state.composerLocked).toBe(false)
      expect(state.activeInterrupt).toBeNull()
      break
    case 'running':
      expect(state.threadId).toBeTypeOf('string')
      expect(state.composerLocked).toBe(true)
      expect(state.activeInterrupt).toBeNull()
      break
    case 'waiting_interrupt':
      expect(state.threadId).toBeTypeOf('string')
      expect(state.composerLocked).toBe(true)
      expect(state.activeInterrupt).not.toBeNull()
      break
    case 'completed':
    case 'error':
      expect(state.threadId).toBeTypeOf('string')
      expect(state.activeInterrupt).toBeNull()
      break
  }
}

describe('sessionReducer', () => {
  const threadReadyEvent: ThreadReadyEvent = {
    type: 'thread_ready',
    threadId: 'thread-123',
  }

  const startSubmittedEvent: StartSubmittedEvent = {
    type: 'start_submitted',
    threadId: 'thread-123',
    prompt: 'Build a quarterly business review deck.',
  }

  const statusReceivedEvent: StatusReceivedEvent = {
    type: 'status_received',
    threadId: 'thread-123',
    text: 'Drafting the outline.',
  }

  const interruptReceivedEvent: InterruptReceivedEvent = {
    type: 'interrupt_received',
    threadId: 'thread-123',
    interrupt: {
      id: 'interrupt-1',
      value: {
        title: 'Confirm the deck inputs',
        type: 'edit_form',
        payload: {
          theme: 'Quarterly business review',
          target_audience: 'Executive team',
          num_pages: 8,
          user_role: 'Product manager',
          layout_style: 'grid',
        },
      },
    },
  }

  it('tracks a realistic thread lifecycle with deterministic message ids', () => {
    const initialState = createInitialSessionState()

    const readyState = sessionReducer(initialState, threadReadyEvent)
    const runningState = sessionReducer(readyState, startSubmittedEvent)
    const statusState = sessionReducer(runningState, statusReceivedEvent)
    const interruptedState = sessionReducer(statusState, interruptReceivedEvent)

    expectValidSessionState(initialState)
    expectValidSessionState(readyState)
    expectValidSessionState(runningState)
    expectValidSessionState(statusState)
    expectValidSessionState(interruptedState)

    expect(initialState).toMatchObject({
      threadId: null,
      threadStatus: 'creating',
      composerLocked: false,
      activeInterrupt: null,
      messages: [],
    })

    expect(readyState).toMatchObject({
      threadId: 'thread-123',
      threadStatus: 'ready',
      composerLocked: false,
      activeInterrupt: null,
    })

    expect(runningState).toMatchObject({
      threadId: 'thread-123',
      threadStatus: 'running',
      composerLocked: true,
      activeInterrupt: null,
    })

    expect(statusState).toMatchObject({
      threadId: 'thread-123',
      threadStatus: 'running',
      composerLocked: true,
      activeInterrupt: null,
    })

    expect(interruptedState).toMatchObject({
      threadId: 'thread-123',
      threadStatus: 'waiting_interrupt',
      composerLocked: true,
      activeInterrupt: interruptReceivedEvent.interrupt,
    })

    expect(interruptedState.messages).toEqual([
      {
        id: 'message-0',
        kind: 'user_prompt',
        text: 'Build a quarterly business review deck.',
      },
      {
        id: 'message-1',
        kind: 'assistant_status',
        text: 'Drafting the outline.',
      },
      {
        id: 'message-2',
        kind: 'assistant_interrupt',
        interrupt: interruptReceivedEvent.interrupt,
      },
    ])
  })

  it('appends status messages after existing conversation without disturbing prior entries', () => {
    const readyState = sessionReducer(createInitialSessionState(), threadReadyEvent)
    const runningState = sessionReducer(readyState, startSubmittedEvent)

    const nextState = sessionReducer(runningState, statusReceivedEvent)

    expectValidSessionState(nextState)

    expect(nextState.threadId).toBe('thread-123')
    expect(nextState.threadStatus).toBe('running')
    expect(nextState.composerLocked).toBe(true)
    expect(nextState.activeInterrupt).toBeNull()
    expect(nextState.messages).toHaveLength(2)
    expect(nextState.messages[0]).toEqual({
      id: 'message-0',
      kind: 'user_prompt',
      text: 'Build a quarterly business review deck.',
    })
    expect(nextState.messages[1]).toEqual({
      id: 'message-1',
      kind: 'assistant_status',
      text: 'Drafting the outline.',
    })
  })

  it('thread_ready resets conversation state when a different thread id arrives', () => {
    const stateAfterStart = sessionReducer(
      sessionReducer(createInitialSessionState(), threadReadyEvent),
      startSubmittedEvent,
    )
    const stateAfterStatus = sessionReducer(stateAfterStart, statusReceivedEvent)

    const reboundReadyState = sessionReducer(stateAfterStatus, {
      type: 'thread_ready',
      threadId: 'thread-456',
    })

    expectValidSessionState(reboundReadyState)

    expect(reboundReadyState).toMatchObject({
      threadId: 'thread-456',
      threadStatus: 'ready',
      composerLocked: false,
      activeInterrupt: null,
      messages: [],
      messageSequence: 0,
    })
    expect(stateAfterStatus.messages).toHaveLength(2)
  })

  it('ignores stale correlated events from the previous thread after a thread switch', () => {
    const originalReadyState = sessionReducer(
      createInitialSessionState(),
      threadReadyEvent,
    )
    const switchedReadyState = sessionReducer(originalReadyState, {
      type: 'thread_ready',
      threadId: 'thread-456',
    })

    const staleStartState = sessionReducer(switchedReadyState, startSubmittedEvent)
    const staleStatusState = sessionReducer(switchedReadyState, statusReceivedEvent)
    const staleInterruptState = sessionReducer(
      switchedReadyState,
      interruptReceivedEvent,
    )

    expectValidSessionState(staleStartState)
    expectValidSessionState(staleStatusState)
    expectValidSessionState(staleInterruptState)

    expect(staleStartState).toEqual(switchedReadyState)
    expect(staleStatusState).toEqual(switchedReadyState)
    expect(staleInterruptState).toEqual(switchedReadyState)
  })

  it('ignores duplicate thread_ready for the active running thread', () => {
    const runningState = sessionReducer(
      sessionReducer(createInitialSessionState(), threadReadyEvent),
      startSubmittedEvent,
    )

    const nextState = sessionReducer(runningState, threadReadyEvent)

    expectValidSessionState(nextState)
    expect(nextState).toEqual(runningState)
  })

  it('ignores duplicate thread_ready while waiting on an interrupt for the same thread', () => {
    const waitingState = sessionReducer(
      sessionReducer(
        sessionReducer(createInitialSessionState(), threadReadyEvent),
        startSubmittedEvent,
      ),
      interruptReceivedEvent,
    )

    const nextState = sessionReducer(waitingState, threadReadyEvent)

    expectValidSessionState(nextState)
    expect(nextState).toEqual(waitingState)
  })

  it('status_received clears an active interrupt when returning to running', () => {
    const waitingState = sessionReducer(
      sessionReducer(
        sessionReducer(
          sessionReducer(createInitialSessionState(), threadReadyEvent),
          startSubmittedEvent,
        ),
        statusReceivedEvent,
      ),
      interruptReceivedEvent,
    )

    const resumedState = sessionReducer(waitingState, {
      type: 'status_received',
      threadId: 'thread-123',
      text: 'Continuing after the interrupt.',
    })

    expectValidSessionState(resumedState)
    expect(resumedState).toMatchObject({
      threadId: 'thread-123',
      threadStatus: 'running',
      composerLocked: true,
      activeInterrupt: null,
    })
    expect(resumedState.messages.at(-1)).toEqual({
      id: 'message-3',
      kind: 'assistant_status',
      text: 'Continuing after the interrupt.',
    })
  })

  it('ignores start_submitted until a thread id exists', () => {
    const initialState = createInitialSessionState()

    const nextState = sessionReducer(initialState, startSubmittedEvent)

    expect(nextState).toEqual(initialState)
    expectValidSessionState(nextState)
  })

  it('ignores status_received until a thread id exists', () => {
    const initialState = createInitialSessionState()

    const nextState = sessionReducer(initialState, statusReceivedEvent)

    expect(nextState).toEqual(initialState)
    expectValidSessionState(nextState)
  })

  it('ignores interrupt_received until a thread id exists', () => {
    const initialState = createInitialSessionState()

    const nextState = sessionReducer(initialState, interruptReceivedEvent)

    expect(nextState).toEqual(initialState)
    expectValidSessionState(nextState)
  })
})
