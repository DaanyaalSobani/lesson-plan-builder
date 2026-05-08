import os
import anthropic
from .base import LLMProvider


class AnthropicProvider(LLMProvider):
    """
    LLM provider backed by Anthropic Claude.

    Reads ANTHROPIC_API_KEY from the environment. Requires the `anthropic`
    package (see requirements.txt).
    """

    DEFAULT_MODEL = "claude-sonnet-4-6"
    DEFAULT_MAX_TOKENS = 8192

    def __init__(self, model: str | None = None):
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise EnvironmentError(
                "ANTHROPIC_API_KEY is not set. "
                "Copy .env.example to .env and add your key, or export the variable."
            )
        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model or self.DEFAULT_MODEL

    def generate(self, system_prompt: str, user_prompt: str, **params) -> str:
        max_tokens = params.get("max_tokens", self.DEFAULT_MAX_TOKENS)
        message = self._client.messages.create(
            model=self._model,
            max_tokens=max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        block = message.content[0]
        return block.text if block.type == "text" else ""
