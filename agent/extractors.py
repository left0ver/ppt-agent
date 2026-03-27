from abc import ABC, abstractmethod
from typing import Any
from tavily import TavilyClient
from firecrawl import Firecrawl
from tenacity import retry, stop_after_attempt, wait_exponential
import os


class PageExtractor(ABC):
    """页面内容提取器基类"""

    @abstractmethod
    def extract(self, urls: list[str]) -> list[dict[str, Any]]:
        """提取页面内容

        Args:
            urls: 要提取的URL列表

        """
        pass


class TavilyExtractor(PageExtractor):
    """Tavily提取器"""

    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        self.api_key = api_key or os.getenv("TAVILY_API_KEY")
        self.base_url = (
            base_url or os.getenv("TAVILY_BASE_URL") or "https://api.tavily.com"
        )
        self.client = TavilyClient(api_key=self.api_key, api_base_url=self.base_url)

    def extract(self, urls: list[str]) -> list[dict[str, Any]]:
        responses = self.client.extract(
            urls, extract_depth="advanced", format="markdown", include_images=False
        )

        return responses["results"]


class FirecrawlExtractor(PageExtractor):
    """Firecrawl提取器"""

    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        self.api_key = api_key or os.getenv("FIRECRAWL_API_KEY")
        self.base_url = (
            base_url or os.getenv("FIRECRAWL_BASE_URL") or "https://api.firecrawl.dev"
        )
        self.client = Firecrawl(api_key=self.api_key, api_url=self.base_url)

    def extract(self, urls: list[str]) -> list[dict[str, Any]]:
        results = []
        for url in urls:
            response = self.client.scrape(
                url, formats=["markdown"], remove_base64_images=True
            )
            results.append(dict(response))

        return results


class ExtractorFactory:
    """提取器工厂类"""

    _extractors = {
        "tavily": TavilyExtractor,
        "firecrawl": FirecrawlExtractor,
    }

    def __init__(
        self,
        provider: str = "tavily",
    ) -> None:
        self.provider = provider.lower()
        if self.provider not in self._extractors:
            raise ValueError(f"Unknown provider: {provider}")
        self.extract_client = self._extractors[self.provider]()

    def extract(self, urls: list[str]) -> list[dict[str, Any]]:
        """统一的提取方法

        Args:
            urls: 要提取的URL列表
            provider: 提供商名称 (tavily/firecrawl)
            **kwargs: 传递给提取器的参数

        Returns:
            统一格式的提取结果: [{"url": str, "title": str, "markdown_content": str}]
        """

        results = self.extract_client.extract(urls)
        # results = extractor.extract(urls)

        # 统一返回格式
        normalized_results = []
        match self.provider:
            case "tavily":
                for result in results:
                    normalized_results.append(
                        {
                            "url": result.get("url", ""),
                            "title": result.get("title", ""),
                            "markdown_content": result.get("raw_content", ""),
                        }
                    )
            case "firecrawl":
                for result in results:
                    normalized_results.append(
                        {
                            "url": result["metadata"].url,
                            "title": result["metadata"].title,
                            "markdown_content": result.get("markdown", ""),
                        }
                    )
            case _:
                raise ValueError(f"Unsupported provider: {self.provider}")
        return normalized_results

    def extract_with_retry(
        self, urls: list[str], max_attempts: int = 3
    ) -> list[dict[str, Any]]:

        retry_decorator = retry(
            stop=stop_after_attempt(max_attempts),
            wait=wait_exponential(multiplier=1, min=2, max=10),
        )
        return retry_decorator(self.extract)(urls)
