from enum import Enum
class TimeLine(Enum):
    NO_START = "no_start"
    INFO_GATHERED = "info_gathered"  # 信息收集完成
    OUTLINE_GENERATED = "outline_generated"
    SKETCH_GENERATED = "sketch_generated"
    COMPLETED = "completed"


class InterruptType(Enum):
    FORM = "form"
    CONFIRMATION = "confirmation"
    UPLOAD_FILE = "upload_file"

