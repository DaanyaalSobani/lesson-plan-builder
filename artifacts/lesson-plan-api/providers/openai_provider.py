import os

from openai import OpenAI

from .base import LLMProvider


class OpenAIProvider(LLMProvider):
    """LLM provider backed by OpenAI via Replit's AI Integrations proxy.

    No personal API key required — usage is billed to Replit credits.
    Requires the env vars ``AI_INTEGRATIONS_OPENAI_BASE_URL`` and
    ``AI_INTEGRATIONS_OPENAI_API_KEY`` to be present (auto-set by the
    one-time ``setupReplitAIIntegrations`` provisioning step).
    """

    DEFAULT_MODEL = "gpt-5.4"
    DEFAULT_MAX_TOKENS = 8192

    name = "openai"

    def __init__(self, model: str | None = None):
        base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
        api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
        if not base_url or not api_key:
            raise EnvironmentError(
                "Replit OpenAI integration is not provisioned. "
                "Expected AI_INTEGRATIONS_OPENAI_BASE_URL and "
                "AI_INTEGRATIONS_OPENAI_API_KEY environment variables."
            )
        self._client = OpenAI(base_url=base_url, api_key=api_key)
        self.model = model or self.DEFAULT_MODEL
        self.max_tokens = self.DEFAULT_MAX_TOKENS

    def generate(self, system_prompt: str, user_prompt: str, **params) -> str:
        max_tokens = params.get("max_tokens", self.max_tokens)
        completion = self._client.chat.completions.create(
            model=self.model,
            max_completion_tokens=max_tokens,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        choice = completion.choices[0]
        return choice.message.content or ""
