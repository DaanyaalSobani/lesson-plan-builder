from abc import ABC, abstractmethod


class LLMProvider(ABC):
    """
    Abstract base class for LLM providers.

    To add a new provider (e.g. OpenAI), create a new file in this directory
    (e.g. providers/openai_provider.py) that subclasses LLMProvider and
    implements the `generate` method. Nothing outside this module should
    import a concrete provider directly — only this base class.
    """

    @abstractmethod
    def generate(self, system_prompt: str, user_prompt: str, **params) -> str:
        """
        Generate a text response from the LLM.

        Args:
            system_prompt: The system-level instructions for the model.
            user_prompt:   The user-level message / request.
            **params:      Provider-specific optional parameters (e.g. max_tokens).

        Returns:
            The model's text response as a plain string.
        """
        ...
