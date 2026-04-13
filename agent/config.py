import os
from copy import deepcopy

from dotenv import load_dotenv

load_dotenv()


def get_config():
    # 设置User-Agent来解决被cf拦截的问题
    user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    generate_model_config = {
        "model": os.getenv("GENERATE_MODEL_NAME"),
        "model_provider": os.getenv("GENERATE_MODEL_PROVIDER", "openai"),
        "base_url": os.getenv("GENERATE_MODEL_BASE_URL"),
        "api_key": os.getenv("GENERATE_MODEL_API_KEY"),
    }
    search_model_config = {
        "model": os.getenv("SEARCH_MODEL_NAME"),
        "model_provider": os.getenv("SEARCH_MODEL_PROVIDER", "openai"),
        "base_url": os.getenv("SEARCH_MODEL_BASE_URL"),
        "api_key": os.getenv("SEARCH_MODEL_API_KEY"),
        "default_headers": {"User-Agent": user_agent},
    }
    if (
        not os.getenv("INTENT_RECOGNITION_MODEL_API_KEY")
        or os.getenv("INTENT_RECOGNITION_MODEL_API_KEY").strip() == ""
    ):
        intent_recognition_model_config = deepcopy(generate_model_config)
    else:
        intent_recognition_model_config = {
            "model": os.getenv("INTENT_RECOGNITION_MODEL_NAME"),
            "model_provider": os.getenv("INTENT_RECOGNITION_MODEL_PROVIDER", "openai"),
            "base_url": os.getenv("INTENT_RECOGNITION_MODEL_BASE_URL"),
            "api_key": os.getenv("INTENT_RECOGNITION_MODEL_API_KEY"),
        }
    page_extractor_provider = os.getenv("PAGE_EXTRACTOR_PROVIDER", "tavily").lower()
    page_extractor_api_key = (
        os.getenv("TAVILY_API_KEY")
        if page_extractor_provider == "tavily"
        else os.getenv("FIRECRAWL_API_KEY")
    )

    return {
        "generate_model_config": generate_model_config,
        "search_model_config": search_model_config,
        "intent_recognition_model_config": intent_recognition_model_config,
        "USER_DATA_ROOT_DIR": os.getenv("USER_DATA_ROOT_DIR", "./user_data"),
        "page_extractor_provider": page_extractor_provider,
        "page_extractor_api_key": page_extractor_api_key,
        "mineru_api_key": os.getenv("MINERU_API_KEY"),
        "cache_path": os.getenv("CACHE_PATH", "./cache.db"),
        "checkpoint_path": os.getenv("CHECKPOINT_PATH", "./checkpoint.db"),
        "delay": float(os.getenv("DELAY", "0.0")),
    }
