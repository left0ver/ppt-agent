from enum import Enum


class LayoutType(Enum):
    TOP_BOTTOM = "top_bottom"
    GRID = "grid"


class TimeLine(Enum):
    NO_START = "no_start"
    INFO_GATHERED = "info_gathered"  # 信息收集完成
    OUTLINE_GENERATED = "outline_generated"
    SKETCH_GENERATED = "sketch_generated"
    COMPLETED = "completed"


class InterruptType(Enum):
    FORM = "form"
    CONFIRMATION = "confirmation"
    UPLOAD_PPT_CONTENT_FILES = "upload_ppt_content_files"
    UPLOAD_PPT_TEMPLATE = "upload_ppt_template"
    INPUT = "input"
    EDIT = "edit"
