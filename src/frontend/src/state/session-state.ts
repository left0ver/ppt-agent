import type {
  ChatMessageDraft,
  DraftGeneratedEvent,
  ErrorReceivedEvent,
  FinalGeneratedEvent,
  InterruptReceivedEvent,
  InterruptResponseRecordedEvent,
  SessionEvent,
  SessionState,
  StartSubmittedEvent,
  StatusReceivedEvent,
} from '../types/ppt-agent'

type MessageState = Pick<SessionState, 'messages' | 'messageSequence'>

const EMPTY_MESSAGE_STATE: MessageState = {
  messages: [],
  messageSequence: 0,
}

function appendMessage(
  state: SessionState,
  message: ChatMessageDraft,
): MessageState {
  return {
    messages: [
      ...state.messages,
      {
        id: `message-${state.messageSequence}`,
        ...message,
      },
    ],
    messageSequence: state.messageSequence + 1,
  }
}

function createReadyState(
  state: SessionState,
  threadId: string,
): SessionState {
  return {
    ...(state.threadId === threadId ? getMessageState(state) : EMPTY_MESSAGE_STATE),
    threadId,
    composerLocked: false,
    threadStatus: 'ready',
    activeInterrupt: null,
  }
}

function createRunningState(
  state: SessionState,
  messageState: MessageState,
): SessionState {
  if (state.threadId === null) {
    return state
  }

  return {
    ...messageState,
    threadId: state.threadId,
    composerLocked: true,
    threadStatus: 'running',
    activeInterrupt: null,
  }
}

function createWaitingInterruptState(
  state: SessionState,
  messageState: MessageState,
  activeInterrupt: NonNullable<SessionState['activeInterrupt']>,
): SessionState {
  if (state.threadId === null) {
    return state
  }

  return {
    ...messageState,
    threadId: state.threadId,
    composerLocked: true,
    threadStatus: 'waiting_interrupt',
    activeInterrupt,
  }
}

function getMessageState(state: SessionState): MessageState {
  return {
    messages: state.messages,
    messageSequence: state.messageSequence,
  }
}

function isCorrelatedEventForActiveThread(
  state: SessionState,
  event:
    | StartSubmittedEvent
    | StatusReceivedEvent
    | InterruptReceivedEvent
    | InterruptResponseRecordedEvent
    | DraftGeneratedEvent
    | FinalGeneratedEvent
    | ErrorReceivedEvent,
): boolean {
  return state.threadId !== null && event.threadId === state.threadId
}

export function createInitialSessionState(): SessionState {
  return {
    threadId: null,
    composerLocked: false,
    threadStatus: 'creating',
    activeInterrupt: null,
    messages: [],
    messageSequence: 0,
  }
}

export function sessionReducer(
  state: SessionState,
  event: SessionEvent,
): SessionState {
  switch (event.type) {
    case 'thread_ready':
      if (
        event.threadId === state.threadId &&
        (state.threadStatus === 'running' ||
          state.threadStatus === 'waiting_interrupt')
      ) {
        return state
      }

      return createReadyState(state, event.threadId)

    case 'start_submitted': {
      if (!isCorrelatedEventForActiveThread(state, event)) {
        return state
      }

      const messageState = appendMessage(state, {
        kind: 'user_prompt',
        text: event.prompt,
      })

      return createRunningState(state, messageState)
    }

    case 'status_received': {
      if (!isCorrelatedEventForActiveThread(state, event)) {
        return state
      }

      const messageState = appendMessage(state, {
        kind: 'assistant_status',
        text: event.text,
      })

      return createRunningState(state, messageState)
    }

    case 'interrupt_received': {
      if (!isCorrelatedEventForActiveThread(state, event)) {
        return state
      }

      const messageState = appendMessage(state, {
        kind: 'assistant_interrupt',
        interrupt: event.interrupt,
      })

      return createWaitingInterruptState(state, messageState, event.interrupt)
    }

    case 'interrupt_response_recorded': {
      if (!isCorrelatedEventForActiveThread(state, event)) {
        return state
      }

      const messageState = appendMessage(state, {
        kind: 'user_interrupt_reply',
        text: event.text,
      })

      return createRunningState(state, messageState)
    }

    case 'draft_generated': {
      if (!isCorrelatedEventForActiveThread(state, event)) {
        return state
      }

      return {
        ...state,
        ...appendMessage(state, {
          kind: 'assistant_result_draft',
          text: event.text,
        }),
      }
    }

    case 'final_generated': {
      if (!isCorrelatedEventForActiveThread(state, event)) {
        return state
      }

      if (state.threadId === null) {
        return state
      }

      return {
        ...appendMessage(state, {
          kind: 'assistant_result_final',
          text: event.text,
        }),
        threadId: state.threadId,
        composerLocked: false,
        threadStatus: 'completed',
        activeInterrupt: null,
      }
    }

    case 'error_received': {
      if (!isCorrelatedEventForActiveThread(state, event)) {
        return state
      }

      const messageState = appendMessage(state, {
        kind: 'assistant_error',
        text: event.text,
      })

      if (state.threadStatus === 'waiting_interrupt' && state.threadId !== null) {
        return {
          ...messageState,
          threadId: state.threadId,
          composerLocked: true,
          threadStatus: 'waiting_interrupt',
          activeInterrupt: state.activeInterrupt,
        }
      }

      if (state.threadId === null) {
        return state
      }

      return {
        ...messageState,
        threadId: state.threadId,
        composerLocked: false,
        threadStatus: 'error',
        activeInterrupt: null,
      }
    }
  }
}
