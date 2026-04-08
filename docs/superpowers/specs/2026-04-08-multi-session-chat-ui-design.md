# Multi-Session PPT Agent Chat UI Design

Date: 2026-04-08

## Summary

Replace the current single-session workspace with a ChatGPT-style multi-session workspace backed by SQLite. The top hero header is removed. The left side becomes a session sidebar with create and rename actions. The timeline moves to a horizontal step bar at the top of the main workspace. All user-required interruptions, including form input, file upload, and confirm/cancel actions, are rendered as AI-issued cards inside the chat message stream instead of a separate stage panel below the chat.

The system will use SQLite for session metadata, message history, and pending interrupt state, while preserving the existing `user_data/<thread_id>` directory structure for uploaded files and generated assets such as SVG pages and PPT outputs.

## Goals

- Support multiple persisted sessions.
- Show sessions in a left sidebar similar to ChatGPT.
- Support creating sessions and renaming session titles.
- Move the step timeline from the left column to a horizontal top bar.
- Remove the current top header block entirely.
- Remove the left-side session info and prompt shortcut panels.
- Render all required user actions as AI cards in the message stream.
- Preserve the existing preview area on the right.
- Make session state recoverable across page refreshes and backend restarts.

## Non-Goals

- No session deletion in this iteration.
- No migration of legacy `user_data/<thread_id>` directories into the new sidebar.
- No full asset migration into SQLite.
- No redesign of the right-side preview feature beyond layout integration.
- No replacement of the current agent workflow logic beyond the API and persistence layer needed to support the new UX.

## Current State

The current frontend creates one session on bootstrap and stores only the active `thread_id` in memory. The UI uses a left column for a vertical step timeline, session summary, and prompt shortcuts; the center column for chat plus a stage-specific panel; and the right column for preview. Backend session state is stored in an in-memory `SessionStore`, so session metadata does not survive restart. Interrupts are surfaced as status payloads, but the frontend handles them by swapping the lower work panel instead of inserting interactive cards into the message stream.

## Product Decisions

- Multi-session support will be persistent and backed by SQLite.
- Session management will include create, list, switch, and rename.
- Legacy session directories will remain untouched and will not be backfilled into the new session list.
- The top step timeline will be horizontal.
- The left sidebar will be the primary entry point for session switching.
- All interrupt-driven user actions will appear as AI cards in the chat stream, including complex forms.
- When a pending interrupt exists, the bottom sender remains visible but is treated as secondary; the primary workflow action is completed through the pending card.

## User Experience

### Layout

The page becomes a three-column workspace:

- Left: session sidebar with a create button and session list.
- Center: chat thread with current session title and message stream.
- Right: preview pane for first draft and final PPT assets.

The top header block is removed. A horizontal step bar spans the main workspace above the chat and preview columns. The current session title appears at the top of the chat column and supports inline rename.

### Session Sidebar

The sidebar contains:

- A primary `+ New Session` action.
- A reverse-chronological list of sessions from SQLite.
- Session row title.
- Session row updated timestamp.
- Highlight for the active session.
- Rename entry point per session row or from the title area.

The list shows only sessions created under the new SQLite-backed model.

### Chat Thread

The chat thread becomes the canonical interaction history. Message types include:

- Plain user text.
- Plain AI text.
- AI status updates.
- AI error cards.
- AI interrupt cards with embedded controls.

Examples of interrupt cards:

- PPT info confirmation form with audience, role, page count, layout, and theme.
- Content source card with file upload and URL entry.
- Template card with upload and skip actions.
- Final style input card.
- Confirmation card with confirm and cancel buttons.

Each interrupt card is created by the backend as an AI-authored structured message. The frontend renders controls based on message type and payload.

### Preview Pane

The preview pane remains on the right and stays bound to the active session. It keeps:

- First draft / final PPT tab switch.
- Gallery / single-page view switch.
- Page modification entry.
- Zoom preview.

Preview content changes only when the active session changes or new assets are generated for that session.

## System Architecture

The implementation uses a hybrid persistence model:

- SQLite stores structured state required for the multi-session product model.
- `user_data/<thread_id>` continues storing large and generated files.

This splits concerns cleanly:

- SQLite is the source of truth for session discovery, chat history, stage, status, titles, and pending interrupts.
- File storage remains the source of truth for uploaded artifacts, SVG previews, and exported presentation assets.

## Data Model

SQLite is introduced with the following core tables.

### `sessions`

Purpose: persistent session metadata.

Columns:

- `id` TEXT PRIMARY KEY
- `title` TEXT NOT NULL
- `status` TEXT NOT NULL
- `stage` TEXT NOT NULL
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL
- `archived` INTEGER NOT NULL DEFAULT 0

Rules:

- `id` equals the workflow `thread_id`.
- Newly created sessions start with title `新会话`.
- After the first user requirement is sent, the backend may auto-update title from the message content if the title is still default.
- Renames explicitly overwrite the current title.

### `messages`

Purpose: complete chat and workflow event history for one session.

Columns:

- `id` TEXT PRIMARY KEY
- `session_id` TEXT NOT NULL
- `role` TEXT NOT NULL
- `type` TEXT NOT NULL
- `content` TEXT
- `payload_json` TEXT
- `created_at` TEXT NOT NULL

Message type values:

- `text`
- `status`
- `interrupt`
- `error`

Rules:

- `role` can be `user`, `ai`, or `system`.
- `content` stores human-readable text.
- `payload_json` stores structured data for interrupt cards and richer status/error payloads.
- Rendering is determined by `type` plus `payload_json`.

### `session_interrupts`

Purpose: track the currently actionable interrupt state independently of chat history.

Columns:

- `id` TEXT PRIMARY KEY
- `session_id` TEXT NOT NULL
- `interrupt_type` TEXT NOT NULL
- `title` TEXT NOT NULL
- `payload_json` TEXT NOT NULL
- `status` TEXT NOT NULL
- `message_id` TEXT NOT NULL
- `created_at` TEXT NOT NULL
- `resolved_at` TEXT

Status values:

- `pending`
- `resolved`
- `cancelled`

Rules:

- At most one `pending` interrupt is allowed per session.
- Every pending interrupt points to the corresponding AI interrupt message in `messages`.
- Resolving or cancelling an interrupt updates this table and appends follow-up messages as needed.

## Backend Design

### Persistence Layer

Replace the in-memory-only `SessionStore` role with a storage layer that reads and writes SQLite-backed session state. The backend still creates `user_data/<thread_id>` directories for every new session.

The backend keeps helper functions for:

- Creating sessions in SQLite and on disk.
- Listing sessions.
- Loading one session with messages and current pending interrupt.
- Appending messages.
- Updating stage and status.
- Upserting or resolving interrupt state.

### Workflow Integration

The agent workflow remains the engine for generation. The API layer changes how workflow results are persisted and exposed:

- Starting a workflow appends the user message, sets session status to `running`, and calls `start_workflow`.
- Resuming a workflow after user action uses the active pending interrupt to route to the correct resume path.
- If the workflow returns an interrupt, the backend:
  - maps it to stage and interrupt type,
  - persists a pending interrupt row,
  - creates an AI interrupt message with structured payload,
  - updates the session status to `interrupted`.
- If the workflow completes a stage or the full run, the backend:
  - clears pending interrupt state,
  - appends an AI status message,
  - updates stage and status.
- If the workflow raises an error, the backend:
  - sets session status to `failed`,
  - appends an AI error message,
  - keeps the rest of the thread intact.

### API Surface

The API is reorganized around sessions instead of a single active thread.

#### `POST /api/sessions`

Creates a new session, initializes SQLite metadata plus `user_data/<thread_id>`, and returns the created session object.

#### `GET /api/sessions`

Returns all SQLite-backed sessions ordered by `updated_at DESC`.

#### `GET /api/sessions/{id}`

Returns:

- session metadata,
- full message list,
- pending interrupt, if any,
- preview asset metadata,
- counts for first draft and final PPT pages.

#### `PATCH /api/sessions/{id}`

Updates mutable session metadata. In this iteration, only title rename is required.

#### `POST /api/sessions/{id}/messages`

Unified message submission endpoint.

Behavior:

- If the session is idle and has no pending interrupt, the message is treated as the initial requirement and triggers `start_workflow`.
- If the session has a pending interrupt, the request is validated against that interrupt's type and then routed to the appropriate resume path.
- If the session is completed or failed and no interrupt is pending, the endpoint may still accept a new user message only if it is explicitly defined as a supported continuation path; otherwise it returns a validation error. For this iteration, workflow advancement is limited to known interrupt-driven transitions plus the initial requirement.

The request format supports structured payloads, not only plain text.

#### Attachment Endpoints

Keep dedicated upload endpoints:

- `POST /api/sessions/{id}/attachments/content-files`
- `POST /api/sessions/{id}/attachments/template`

These save files to disk and return uploaded file metadata. They do not themselves advance the workflow. Advancement happens when the related interrupt card is submitted.

#### `POST /api/sessions/{id}/modify`

Preserves the current multi-page modification capability and appends resulting status messages to the session thread.

#### `GET /api/ppt/svg/{thread_id}/{ppt_type}/{page}`

Can remain unchanged because it serves session-bound generated files.

## Frontend Design

### State Model

Frontend state becomes centered on an `activeSessionId` instead of a single bootstrap `thread_id`.

Primary client state:

- list of sessions,
- active session detail,
- active preview tab and view mode,
- rename UI state,
- page modification drawer state,
- upload temporary selections for pending cards.

The frontend loads:

- session list on app start,
- creates a session only when the user clicks `+ New Session`,
- loads full session detail when a session is selected,
- refreshes only the active session on interval polling.

### Component Responsibilities

- `SessionSidebar`: create session, list sessions, switch session, rename trigger.
- `TopTimeline`: horizontal steps derived from active session stage and asset completion state.
- `ChatThread`: renders ordered messages and embedded interactive cards.
- `InterruptCardRenderer`: renders a specific card UI from interrupt message payload.
- `PreviewPanel`: current right-side preview behavior with active session binding.

This decomposition reduces the current single-file responsibility concentration in `frontend/src/App.tsx`.

### Message Rendering

The frontend renders messages by `type`.

- `text`: standard chat bubble.
- `status`: AI status bubble or subtle status card.
- `error`: error card with human-readable failure reason.
- `interrupt`: AI card with embedded controls.

Interrupt cards are disabled after resolution or cancellation.

### Interrupt Card Behaviors

#### PPT Info Card

Contains the full form previously shown in the stage panel. Submit sends a structured payload through the unified message endpoint.

#### Content Sources Card

Contains:

- content file uploader,
- repeatable URL inputs,
- submit action,
- optional skip action if empty sources are allowed.

File upload is executed through the attachment endpoint. Final confirmation is submitted through the interrupt card action.

#### Template Card

Contains:

- template uploader,
- `Skip` action,
- `Use Template and Continue` action.

#### Final Style Card

Contains a single text input and submit action.

#### Confirm Card

Contains confirm and cancel actions. The UI matches the second reference image in principle: the robot asks, the user confirms inline, and a follow-up user or system message is appended.

### Title Rename UX

The active session title in the chat header supports inline edit.

Flow:

- click title or rename icon,
- switch to input,
- confirm on Enter or save action,
- persist via `PATCH /api/sessions/{id}`,
- update both sidebar and current header title.

### Sender Behavior

The bottom sender remains visible at all times, but its messaging is contextual:

- no pending interrupt: standard chat entry for initial requirement or future text-based interactions,
- pending interrupt: placeholder changes to indicate that the user should complete the active card first.

The sender does not replace structured interrupt controls.

## Stage Mapping

The horizontal top timeline continues to map workflow state to visible progress. The existing stage-to-step mapping logic is preserved conceptually:

- requirement
- ppt_info
- content
- template
- first_draft
- style
- final

Displayed progress uses:

- session `stage`,
- first draft asset count,
- final PPT asset count.

This preserves the current behavior where generated assets can imply advancement beyond a raw stage name.

## Error Handling

Errors are preserved in-thread rather than only shown as global notifications.

Rules:

- Backend writes AI error messages into `messages`.
- Frontend may still show toast feedback, but the durable source of truth is the thread.
- Validation errors on interrupt submission appear as message-adjacent errors and do not silently discard user input.
- A failed session remains viewable and recoverable; existing previews and message history stay intact.

## Migration Strategy

This is a forward-only migration for new sessions.

- SQLite is initialized automatically on backend startup.
- Existing `user_data/<thread_id>` directories remain on disk.
- Existing non-SQLite sessions are not inserted into the new sidebar.
- New sessions created after this feature ships are registered in SQLite and use the hybrid model.

This avoids risky retroactive migration while enabling the new product behavior immediately for future sessions.

## Testing Strategy

### Backend

Add tests for:

- SQLite schema initialization,
- create/list/get/rename session flows,
- message persistence,
- pending interrupt creation and resolution,
- restart recovery from SQLite,
- attachment upload plus workflow continuation,
- error persistence into message history.

### Frontend

Add tests for:

- session sidebar rendering and switching,
- create session flow,
- rename session flow,
- top horizontal timeline updates,
- interrupt card rendering by type,
- interrupt card submission behavior,
- active session preview switching,
- disabled sender guidance when an interrupt is pending.

### Integration

Validate an end-to-end path:

- create session,
- send initial requirement,
- receive AI interrupt card,
- submit required data,
- continue through uploads or confirmation,
- generate preview assets,
- switch to another session and back,
- verify state, messages, and previews remain correct.

## Risks and Mitigations

### Risk: State duplication between SQLite and filesystem

Mitigation: keep SQLite only for structured metadata and use file storage only for assets. Avoid storing duplicate asset blobs in the database.

### Risk: Complex interrupt cards in the chat stream become hard to manage

Mitigation: render cards from typed payload schemas and isolate renderer logic into dedicated frontend components.

### Risk: Current `App.tsx` is too monolithic for safe change

Mitigation: split the new UI into focused components instead of layering the new behavior into the existing single-file structure.

### Risk: Service restart breaks active session continuity

Mitigation: SQLite becomes the source of truth for session list, stage, messages, and pending interrupt state. The frontend always reloads the active session from the backend.

## Implementation Notes

The implementation should preserve current preview asset discovery helpers and existing SVG file serving endpoints where possible. The main required refactor is shifting session state and interrupt handling from transient memory plus stage panels into persistent session records plus message-driven interrupt cards.
