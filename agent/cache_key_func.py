import pickle

from task_node import FirstDraftTaskState, FinalPPTTaskState


def generate_first_draft_task_key_func(worker_state: FirstDraftTaskState) -> str:
    omit_fields = {"delay"}
    worker_state_dict = {k: v for k, v in worker_state.items() if k not in omit_fields}
    return pickle.dumps(worker_state_dict, protocol=5, fix_imports=False)


def generate_final_ppt_task_key_func(worker_state: FinalPPTTaskState) -> str:
    omit_fields = {"delay"}
    worker_state_dict = {k: v for k, v in worker_state.items() if k not in omit_fields}
    return pickle.dumps(worker_state_dict, protocol=5, fix_imports=False)
