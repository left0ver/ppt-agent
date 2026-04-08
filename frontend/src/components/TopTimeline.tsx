import type { SessionStage } from '../types'

interface TopTimelineProps {
  stage: SessionStage
  firstDraftCount: number
  finalDraftCount: number
}

const timelineSteps = [
  { key: 'requirement', label: '需求输入' },
  { key: 'ppt_info', label: '信息确认' },
  { key: 'content', label: '资料来源' },
  { key: 'template', label: '模板上传' },
  { key: 'first_draft', label: '初稿生成' },
  { key: 'style', label: '风格确认' },
  { key: 'final', label: '终稿完成' },
]

function getCurrentStepIndex(
  stage: SessionStage,
  hasFirstDraft: boolean,
  hasFinalDraft: boolean,
): number {
  if (hasFinalDraft || stage === 'completed') return 6
  if (stage === 'generating_final_ppt') return 6
  if (stage === 'awaiting_final_style') return 5
  if (hasFirstDraft) return 4
  if (stage === 'awaiting_template' || stage === 'generating_outline') return 3
  if (stage === 'awaiting_content_sources') return 2
  if (stage === 'awaiting_ppt_info') return 1
  return 0
}

function getStepNote(stepKey: string, firstDraftCount: number, finalDraftCount: number): string {
  if (stepKey === 'first_draft') {
    return firstDraftCount > 0 ? `${firstDraftCount} 页预览` : '等待生成'
  }

  if (stepKey === 'final') {
    return finalDraftCount > 0 ? `${finalDraftCount} 页终稿` : '未完成'
  }

  return ''
}

export default function TopTimeline({
  stage,
  firstDraftCount,
  finalDraftCount,
}: TopTimelineProps) {
  const currentStepIndex = getCurrentStepIndex(stage, firstDraftCount > 0, finalDraftCount > 0)

  return (
    <section className="top-timeline" aria-label="当前流程时间线">
      <div className="top-timeline__header">
        <div>
          <p className="top-timeline__eyebrow">Workspace Timeline</p>
          <h2 className="top-timeline__title">当前流程</h2>
        </div>
        <div className="top-timeline__stats">
          <span className="top-timeline__stat">初稿 {firstDraftCount} 页</span>
          <span className="top-timeline__stat">终稿 {finalDraftCount} 页</span>
        </div>
      </div>

      <ol className="top-timeline__list">
        {timelineSteps.map((step, index) => {
          const state =
            index < currentStepIndex ? 'complete' : index === currentStepIndex ? 'active' : 'upcoming'

          return (
            <li
              key={step.key}
              className={`top-timeline__step top-timeline__step--${state}`}
              aria-current={state === 'active' ? 'step' : undefined}
            >
              <span className="top-timeline__step-index">{index + 1}</span>
              <span className="top-timeline__step-copy">
                <span className="top-timeline__step-label">{step.label}</span>
                {getStepNote(step.key, firstDraftCount, finalDraftCount) ? (
                  <span className="top-timeline__step-note">
                    {getStepNote(step.key, firstDraftCount, finalDraftCount)}
                  </span>
                ) : null}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
