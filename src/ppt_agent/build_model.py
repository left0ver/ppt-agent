from dotenv import load_dotenv
from langchain.chat_models import init_chat_model

from src.ppt_agent.config import get_config

load_dotenv()


def build_model():
    config = get_config()
    search_model = init_chat_model(**config["search_model_config"])

    # 创建生成模型
    generate_model = init_chat_model(**config["generate_model_config"])
    intent_recognition_model = init_chat_model(
        **config["intent_recognition_model_config"]
    )

    return {
        "search_model": search_model,
        "generate_model": generate_model,
        "intent_recognition_model": intent_recognition_model,
    }
