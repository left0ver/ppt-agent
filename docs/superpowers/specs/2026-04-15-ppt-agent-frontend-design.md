# PPT Agent Frontend Design

Date: 2026-04-15

## Goal

为 `src/frontend` 设计并实现一个正式可用的个人产品前端，基于 `React + TypeScript + antd + @ant-design/x`，对接现有 FastAPI 后端接口，完成从用户输入 PPT 需求到流式生成、人工中断处理、初稿/终稿预览的完整闭环。

该产品不是调试面板，也不是多会话管理器。它是一个单任务、单会话、强引导的创作界面。

## Confirmed Product Rules

1. 用户进入页面或刷新页面时，前端自动调用 `GET /api/create_session_id` 创建一个新的 `thread_id`。
2. 页面主结构为左右分栏。
3. 左侧是 PPT 预览区。
4. 右侧是 AI 对话区。
5. 用户只能在会话开始时输入一次自然语言需求。
6. 用户点击发送后，发送按钮进入 loading，输入框禁用，不允许继续自由输入。
7. 后端 `current_stage` SSE 事件映射为 AI 普通消息气泡。
8. 后端 `interrupts` SSE 事件映射为 AI 在聊天流中插入的可交互卡片。
9. 用户在中断卡片中提交内容后，前端调用 `POST /api/chat` 的 `hitl_resume` 继续同一线程。
10. 用户在支持跳过的中断卡片中点击跳过后，前端调用 `POST /api/chat` 的 `abort_resume` 继续同一线程。
11. `first_draft` 到达后，左侧可以查看初稿。
12. `final_ppt` 到达后，左侧可以切换查看终稿。
13. 左侧点击缩略图后，不是在左栏局部放大，而是打开一个覆盖整个页面的全屏查看器。
14. 全屏查看器内只能看到当前 PPT 页面及其翻页控制，不能看到页面其它内容。
15. `初稿 / 终稿` 切换按钮位于左侧缩略图列的上方，而不是全屏查看器内部。

## Layout

### Page Shell

页面分成两个主栏：

- 左栏：PPT 预览与版本切换
- 右栏：AI 对话与中断处理

整体视觉方向沿用已确认的 `Editorial Atelier`：暖色、精致、白底高留白、弱阴影、卡片圆角，但交互结构以效率优先。

### Left Panel: PPT Preview

左侧由三部分组成：

1. 版本切换区
   - 位于缩略图列顶部
   - 两个按钮：`初稿`、`终稿`
   - `初稿` 在 `first_draft` 到达前默认不可切或空态展示
   - `终稿` 在 `final_ppt` 到达前默认不可切或空态展示

2. 缩略图列
   - 展示当前版本下的 slide 缩略图列表
   - 支持点击选中某一页
   - 当前选中页高亮

3. 查看提示空态
   - 默认不在左栏内部展示大画布
   - 左栏中部只保留“点击缩略图进入全屏查看”的提示态

### Fullscreen Slide Viewer

点击任意缩略图后，打开全屏查看器：

- 覆盖整个页面
- 遮挡左右分栏和聊天内容
- 中央展示当前 slide 的大图
- 左右两侧提供翻页按钮
- 顶部提供页码和关闭按钮
- 不在查看器内部放 `初稿 / 终稿` 切换按钮

全屏查看器只承担查看和翻页职责，不承担会话操作职责。

### Right Panel: Conversation

右栏包含：

1. 对话消息流
   - 用户首条需求消息
   - AI 普通阶段消息
   - AI 中断卡片
   - 用户中断提交后的摘要消息
   - AI 继续执行后的阶段消息
   - 初稿/终稿结果消息

2. Composer
   - 初始可输入
   - 仅允许用户输入一次启动需求
   - 点击发送后进入 loading
   - 一旦工作流开始，文本输入区禁用
   - 后续所有交互通过中断卡片完成，不再允许用户追加自由文本

## Conversation Model

### User Start

用户在右侧输入一段自然语言，例如：

- 角色
- 场景
- 主题
- 期望页数
- 布局偏好

点击发送后：

1. 如果当前没有 `thread_id`，先等待自动创建完成
2. 发送 `POST /api/chat`
3. 请求体为：

```json
{
  "thread_id": "<auto-created-thread-id>",
  "type": "start",
  "user_input": "<user prompt>"
}
```

### SSE Event Mapping

#### `current_stage`

映射为 AI 普通气泡消息。

示例：

- 正在分析你的需求
- 正在生成 PPT 大纲
- 正在整理参考资料

不显示原始 SSE 文本结构，不显示事件名，不做调试日志式 UI。

#### `interrupts`

映射为 AI 发出的内嵌卡片。卡片插入聊天流当前位置，用户直接在卡片中完成交互。

支持四类卡片：

1. `edit_form`
   - 编辑 PPT 基本信息
   - 字段包括：
     - `theme`
     - `target_audience`
     - `num_pages`
     - `user_role`
     - `layout_style`

2. `upload_ppt_content_files`
   - 上传内容文件
   - 可选填写内容来源网址
   - 支持跳过

3. `upload_ppt_template`
   - 上传模板文件
   - 支持跳过

4. `text_input`
   - 输入最终风格描述
   - 如“绿色简约风”“黑色科技风”

#### `first_draft`

映射成：

1. AI 一条“初稿已生成”的结果消息
2. 更新左侧 `初稿` 版本的数据
3. 允许用户点击缩略图进入全屏查看初稿

#### `final_ppt`

映射成：

1. AI 一条“终稿已生成”的结果消息
2. 更新左侧 `终稿` 版本的数据
3. 允许用户切换到 `终稿`
4. 允许用户在全屏查看器中浏览终稿

## Interrupt Card Behavior

### Shared Rules

所有中断卡片共用同一套外层视觉框架：

- AI 头像 + 卡片主体
- 标题
- 说明
- 表单区 / 上传区 / 文本输入区
- 主按钮：提交
- 次按钮：跳过（仅对支持跳过的卡片显示）

用户提交卡片后：

1. 卡片进入已完成态或只读态
2. 聊天流中追加一条用户摘要消息
3. 前端继续发起 `hitl_resume`
4. 重新进入 SSE 消费流程

### Resume Payload Rules

#### 基本信息卡片

提交：

```json
{
  "thread_id": "<thread_id>",
  "type": "hitl_resume",
  "user_input": {
    "target_audience": "...",
    "user_role": "...",
    "layout_style": "top_bottom",
    "num_pages": 10,
    "theme": "..."
  }
}
```

#### 内容资料卡片

若上传了文件：

1. 先调用 `POST /api/upload/content_files`
2. 再调用 `hitl_resume`

提交结构：

```json
{
  "have_ppt_content_files": true,
  "ppt_content_source_urls": ["https://..."]
}
```

跳过：

```json
{
  "thread_id": "<thread_id>",
  "type": "abort_resume",
  "user_input": null
}
```

#### 模板卡片

若上传了模板：

1. 先调用 `POST /api/upload/ppt_template`
2. 再调用 `hitl_resume`

提交结构：

```json
{
  "have_ppt_template": true,
  "ppt_template_path": "<backend returned path>"
}
```

跳过同样走 `abort_resume`。

#### 风格输入卡片

提交：

```json
{
  "thread_id": "<thread_id>",
  "type": "hitl_resume",
  "user_input": {
    "user_ppt_style": "绿色简约风"
  }
}
```

## Data Model

前端至少需要维护以下状态：

- `threadId`
- `threadStatus`
  - `creating`
  - `ready`
  - `running`
  - `waiting_interrupt`
  - `completed`
  - `error`
- `composerLocked`
- `messages`
- `activeInterrupt`
- `draftSlides`
- `finalSlides`
- `activeDeckVersion`
- `selectedSlideIndex`
- `viewerOpen`
- `viewerSlideIndex`
- `viewerDeckVersion`
- `layoutStyles`

### Message Types

消息流建议统一成结构化类型：

- `user_prompt`
- `assistant_status`
- `assistant_interrupt`
- `user_interrupt_reply`
- `assistant_result_draft`
- `assistant_result_final`
- `assistant_error`

## Preview Data Strategy

后端当前文档只明确了 `first_draft` 和 `final_ppt` 事件会返回对应结果，不保证直接返回适合展示的缩略图 URL。

因此设计上应允许两种显示模式：

1. 如果返回的是可直接渲染的页面数据或图片地址，则直接渲染缩略图与全屏图
2. 如果返回的是结构化结果但没有图像资源，则左侧先展示占位缩略图和版本可用状态，待后续补充真实渲染能力

实现应把预览层抽象出来，不把 UI 绑定到某一种返回格式。

## Error Handling

### API Errors

接口失败时在聊天流中插入错误消息卡片，样式明显但不破坏整体设计。

覆盖场景：

- 创建会话失败
- 上传内容文件失败
- 上传模板失败
- SSE 建连失败
- `hitl_resume` 失败
- `abort_resume` 失败

### Upload Errors

针对后端已有约束，需要在前端给出清晰提示：

- 内容文件格式不支持
- 内容文件超过 20 MB
- 当前会话已经上传过内容文件
- 模板格式不支持

### Empty States

- 页面初始：等待用户输入第一条需求
- 初稿未生成：左侧仅显示缩略图空态与查看提示
- 终稿未生成：`终稿` 按钮不可用或弱化

## Component Breakdown

建议拆分为以下组件：

- `AppShell`
- `PreviewSidebar`
- `DeckVersionSwitch`
- `SlideThumbnailList`
- `PreviewEmptyState`
- `FullscreenSlideViewer`
- `ChatPanel`
- `MessageList`
- `UserBubble`
- `AssistantBubble`
- `InterruptCard`
- `EditFormInterruptCard`
- `ContentUploadInterruptCard`
- `TemplateUploadInterruptCard`
- `StyleInputInterruptCard`
- `Composer`
- `ResultCard`
- `ErrorCard`

## Styling Direction

保留已经确认的视觉方向：

- 暖米白底色
- 深棕标题
- 蓝色用户气泡
- AI 卡片白底
- 大圆角
- 柔和阴影
- 明确层级

避免：

- 终端感
- 紫色渐变
- 过度科技风
- 过度复杂的工具栏

## Accessibility

至少满足以下要求：

- 所有按钮有清晰可见的 focus 样式
- 全屏查看器支持键盘关闭与左右翻页
- 上传按钮和输入控件有明确标签
- 错误消息可读
- 颜色对比足够

## Verification Requirements

实现完成后至少验证：

1. 页面加载自动创建新会话
2. 首次输入后 Composer 锁定
3. `current_stage` 正确追加为 AI 消息
4. `interrupts` 正确渲染为对应卡片
5. 卡片提交后正确触发 `hitl_resume`
6. 卡片跳过后正确触发 `abort_resume`
7. 内容文件上传链路可用
8. 模板上传链路可用
9. `first_draft` 到达后左侧初稿可浏览
10. `final_ppt` 到达后终稿可切换和浏览
11. 点击缩略图后进入全屏查看器
12. 全屏查看器中看不到页面其它内容
13. 全屏查看器支持左右翻页与关闭

## Scope Boundaries

本次设计不包含：

- 多会话历史恢复
- 会话列表
- 用户登录
- 服务端状态持久化恢复 UI
- 真正的 PPT 二次编辑
- 完整 PowerPoint 工具栏

## Implementation Direction

下一阶段实现应优先完成：

1. 页面框架与视觉主题
2. 自动创建会话
3. 聊天消息流与 SSE 消费
4. 中断卡片系统
5. 上传链路
6. 左侧版本切换与缩略图数据结构
7. 全屏查看器

