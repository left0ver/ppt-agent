from langchain.chat_models import init_chat_model
import os
from dotenv import load_dotenv

load_dotenv()


def build_model():
      # 设置User-Agent来解决被cf拦截的问题
    user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    search_model = init_chat_model(
        model=os.getenv("SEARCH_MODEL_NAME"),
        model_provider=os.getenv("SEARCH_MODEL_PROVIDER", "openai"),
        base_url=os.getenv("SEARCH_MODEL_BASE_URL"),
        api_key=os.getenv("SEARCH_MODEL_API_KEY"),
        default_headers={"User-Agent": user_agent},
    )

    # 创建生成模型
    generate_model = init_chat_model(
        model=os.getenv("GENERATE_MODEL_NAME"),
        model_provider=os.getenv("GENERATE_MODEL_PROVIDER", "openai"),
        base_url=os.getenv("GENERATE_MODEL_BASE_URL"),
        api_key=os.getenv("GENERATE_MODEL_API_KEY"),
    )

    if (
        not os.getenv("INTENT_RECOGNITION_MODEL_API_KEY")
        or os.getenv("INTENT_RECOGNITION_MODEL_API_KEY").strip() == ""
    ):
        intent_recognition_model = generate_model
    else:
        # 创建意图识别模型
        intent_recognition_model = init_chat_model(
            model=os.getenv("INTENT_RECOGNITION_MODEL_NAME"),
            model_provider=os.getenv("INTENT_RECOGNITION_MODEL_PROVIDER", "openai"),
            base_url=os.getenv("INTENT_RECOGNITION_MODEL_BASE_URL"),
            api_key=os.getenv("INTENT_RECOGNITION_MODEL_API_KEY"),
        )
    return {
        "search_model": search_model,
        "generate_model": generate_model,
        "intent_recognition_model": intent_recognition_model,
    }
