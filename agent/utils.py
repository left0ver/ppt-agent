from tavily import TavilyClient
from dotenv import load_dotenv
import os
from tenacity import retry, stop_after_attempt, wait_exponential
from typing import Any

load_dotenv()


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
def extract_via_travily(urls: list[str]) -> list[dict[str, Any]]:
    client = TavilyClient(
        api_key=os.getenv("TAVILY_API_KEY"), api_base_url=os.getenv("TAVILY_BASE_URL")
    )
    responses = client.extract(
        urls, extract_depth="advanced", format="markdown", include_images=False
    )
    return responses["results"]

