import { Alert, Layout } from 'antd'
import ChatPanel from '../chat/ChatPanel'
import FullscreenSlideViewer from '../preview/FullscreenSlideViewer'
import PreviewSidebar from '../preview/PreviewSidebar'
import type { usePptAgentSession } from '../../hooks/usePptAgentSession'

type SessionViewModel = ReturnType<typeof usePptAgentSession>

export type AppShellProps = {
  session: SessionViewModel
}

export default function AppShell({ session }: AppShellProps) {
  return (
    <Layout className="app-shell">
      <div className="app-shell__background" />
      <div className="app-shell__inner">
        {session.bootError ? (
          <Alert
            banner
            className="app-shell__alert"
            message={`会话初始化失败：${session.bootError}`}
            type="error"
          />
        ) : null}

        <main className="app-shell__columns">
          <section className="app-shell__preview-column">
            <PreviewSidebar
              activeDeckVersion={session.activeDeckVersion}
              canViewDraft={session.canViewDraft}
              canViewFinal={session.canViewFinal}
              selectedSlideId={session.selectedSlideId}
              selectedSlideIndex={session.selectedSlideIndex}
              slides={session.slides}
              exportDisabled={session.slides.length === 0}
              exportLoading={session.exportLoading}
              onDeckVersionChange={session.changeDeckVersion}
              onExport={session.exportDeck}
              onThumbnailClick={session.openSlide}
              onThumbnailSelect={session.selectSlide}
            />
          </section>

          <section className="app-shell__chat-column">
            <ChatPanel
              composerDisabled={session.composerDisabled}
              composerLoading={session.composerLoading}
              layoutStyleOptions={session.layoutStyleOptions}
              messages={session.state.messages}
              resolvedInterruptMessageIds={session.resolvedInterruptMessageIds}
              threadId={session.state.threadId}
              threadStatus={session.state.threadStatus}
              onComposerSubmit={session.start}
              onInterruptSkip={session.skipInterrupt}
              onInterruptSubmit={session.submitInterrupt}
            />
          </section>
        </main>
      </div>

      <FullscreenSlideViewer
        open={session.viewerOpen}
        slideCount={session.slides.length}
        slideIndex={session.selectedSlideIndex}
        onClose={session.closeViewer}
        onNext={session.showNextSlide}
        onPrevious={session.showPreviousSlide}
      >
        {session.selectedSlide ? (
          session.selectedSlide.imageUrl ? (
            <img
              alt={session.selectedSlide.title}
              className="fullscreen-viewer__image"
              src={session.selectedSlide.imageUrl}
            />
          ) : (
            <div
              className="fullscreen-viewer__svg"
              dangerouslySetInnerHTML={{ __html: session.selectedSlide.svgContent }}
            />
          )
        ) : null}
      </FullscreenSlideViewer>
    </Layout>
  )
}
