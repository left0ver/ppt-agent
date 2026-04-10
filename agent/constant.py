import os
from enum import Enum


class LayoutType(Enum):
    TOP_BOTTOM = "top_bottom"
    GRID = "grid"


# class TimeLine(Enum):
#     NO_START = "no_start"
#     ASK_FOR_PPT_INFO = "ask_for_ppt_info"
#     SEARCH_PPT_CONTENTS = "search_ppt_contents"
#     PARSE_PPT_CONTENT_FILES = "parser_ppt_content_files"
#     PARSE_PPT_CONTENT_URLS = "parse_ppt_content_urls"
#     PARSE_PPT_TEMPLATE = "parse_ppt_template"
#     GENERATE_PPT_OUTLINE = "generate_ppt_outline"
#     GENERATE_PPT_CONTENT_PER_PAGE = "generate_ppt_content_per_page"
#     GENERATE_FIRST_DRAFT = "generate_first_draft"
#     ASK_FOR_STYLE = "ask_for_style"
#     GENERATE_FINAL_PPT = "generate_final_ppt"
#     COMPLETED = "completed"


class InterruptType(Enum):
    FORM = "form"
    CONFIRMATION = "confirmation"
    UPLOAD_PPT_CONTENT_FILES = "upload_ppt_content_files"
    UPLOAD_PPT_TEMPLATE = "upload_ppt_template"
    INPUT = "input"
    EDIT = "edit"
    
USER_DATA_ROOT_DIR = os.getenv("USER_DATA_ROOT_DIR", "./user_data")
