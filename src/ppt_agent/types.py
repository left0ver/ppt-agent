from dataclasses import dataclass, field
from typing import Literal, Optional

from pydantic import BaseModel, Field

InterruptType = Literal[
    "edit_form", "upload_ppt_content_files", "upload_ppt_template", "text_input"
]
LayoutType = Literal["top_bottom", "grid"]


class PPTInfo(BaseModel):
    target_audience: Optional[str] = Field(description="PPT的目标群体")
    user_role: Optional[str] = Field(
        description="用户的角色，例如软件工程师、学生、产品经理"
    )
    # purpose: Optional[str] = Field(description="PPT的目的，例如汇报、演讲、培训")
    num_pages: Optional[int] = Field(description="PPT的页数,1—30页", gt=0, le=30)
    theme: Optional[str] = Field(
        description="PPT的主题，例如'dify的介绍', '人工智能的发展趋势', '如何提升工作效率'等"
    )
    layout_style: Optional[LayoutType] = Field(
        default="top_bottom",
        description=f"PPT的布局风格,可选的有{LayoutType.__args__}",
    )


@dataclass
class PPTInfoInterruptValues:
    title: str
    type: InterruptType = field(default="edit_form", init=False)
    payload: PPTInfo | None


AllowPPTContentFileType = Literal["pdf", "docx", "markdown", "md"]


@dataclass
class UploadPPTContentFilesInterruptValues:
    title: str
    type: InterruptType = field(default="upload_ppt_content_files", init=False)
    file_type: list[AllowPPTContentFileType] = field(
        default_factory=lambda: ["pdf", "docx", "markdown", "md"], init=False
    )


AllowPPTTemplateFileType = Literal["pptx", "ppt"]


@dataclass
class UploadPPTTemplateInterruptValues:
    title: str
    type: InterruptType = field(default="upload_ppt_template", init=False)
    file_type: list[AllowPPTTemplateFileType] = field(
        default_factory=lambda: ["pptx", "ppt"], init=False
    )


@dataclass
class PPTStyleInterruptValues:
    title: str
    type: InterruptType = field(default="text_input", init=False)
