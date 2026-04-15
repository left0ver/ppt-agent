import pickle

from pydantic import BaseModel

from src.ppt_agent.config import get_config
from src.ppt_agent.task_node import FinalPPTTaskState, FirstDraftTaskState


def generate_first_draft_task_key_func(worker_state: FirstDraftTaskState) -> str:
    user_config = get_config()
    model_name = user_config["generate_model_config"]["model"]
    omit_fields = {"delay"}
    worker_state_dict = {k: v for k, v in worker_state.items() if k not in omit_fields}
    worker_state_dict["model_name"] = model_name
    return pickle.dumps(worker_state_dict, protocol=5, fix_imports=False)


def generate_final_ppt_task_key_func(worker_state: FinalPPTTaskState) -> str:
    omit_fields = {"delay"}
    user_config = get_config()
    model_name = user_config["generate_model_config"]["model"]
    worker_state_dict = {k: v for k, v in worker_state.items() if k not in omit_fields}
    worker_state_dict["model_name"] = model_name
    return pickle.dumps(worker_state_dict, protocol=5, fix_imports=False)


def generate_ppt_content_per_page_key_func(state):
    user_config = get_config()
    model_name = user_config["search_model_config"]["model"]
    include_fields = {
        "have_ppt_content_files",
        "user_content",
        "ppt_info",
        "ppt_outline",
    }
    if isinstance(state, BaseModel):
        state = state.model_dump()
        
    state_dict = {k: v for k, v in state.items() if k in include_fields}
    state_dict["model_name"] = model_name
    return pickle.dumps(state_dict, protocol=5, fix_imports=False)
