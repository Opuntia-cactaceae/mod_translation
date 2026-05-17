from typing import Protocol, List, Dict


class PromptProfile(Protocol):
    def build_batch_messages(self, texts: List[str], src_lang: str, dst_lang: str) -> List[Dict[str, str]]:
        """
        Args:
            texts: List of protected source texts.
            src_lang: Source language code.
            dst_lang: Target language code.

        Returns:
            List of chat API message dicts.
        """
        ...

    def build_single_messages(self, text: str, src_lang: str, dst_lang: str) -> List[Dict[str, str]]:
        """
        Args:
            text: Protected source text.
            src_lang: Source language code.
            dst_lang: Target language code.

        Returns:
            List of chat API message dicts.
        """
        ...

    def expects_json_array(self) -> bool:
        """
        Returns:
            True if expecting JSON array.
        """
        ...