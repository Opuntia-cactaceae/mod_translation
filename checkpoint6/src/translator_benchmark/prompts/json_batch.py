from typing import List, Dict
from ..config.schema import PromptConfig

#промпт профайлер под батч запрос и обработку по одному при ошибке
class JsonBatchPromptProfile:

    def __init__(self, config: PromptConfig):
        self.config = config

    def build_batch_messages(self, texts: List[str], src_lang: str, dst_lang: str) -> List[Dict[str, str]]:
        from ..utils.prompt_logging import log_prompt

        messages = []
        system_prompt = self.config.batch_system_prompt or self.config.system_prompt
        user_template = self.config.batch_user_template or self.config.user_template
        system_content = None
        if system_prompt:
            try:
                system_content = system_prompt.format(
                    texts=texts, src_lang=src_lang, dst_lang=dst_lang
                )
            except KeyError:
                system_content = system_prompt
            messages.append({"role": "system", "content": system_content})
        user_content = user_template.format(
            texts=texts, src_lang=src_lang, dst_lang=dst_lang
        )
        messages.append({"role": "user", "content": user_content})
        if self.config.log_prompts:
            log_prompt(system_content, user_content)
        return messages

    def build_single_messages(self, text: str, src_lang: str, dst_lang: str) -> List[Dict[str, str]]:
        from ..utils.prompt_logging import log_prompt

        messages = []
        system_prompt = self.config.single_system_prompt or self.config.system_prompt
        user_template = self.config.single_user_template or self.config.user_template
        system_content = None
        if system_prompt:
            try:
                system_content = system_prompt.format(
                    text=text, texts=[text], src_lang=src_lang, dst_lang=dst_lang
                )
            except KeyError:
                system_content = system_prompt
            messages.append({"role": "system", "content": system_content})
        try:
            user_content = user_template.format(
                text=text, texts=[text], src_lang=src_lang, dst_lang=dst_lang
            )
        except KeyError:
            user_content = user_template.format(
                texts=[text], src_lang=src_lang, dst_lang=dst_lang
            )
        messages.append({"role": "user", "content": user_content})
        if self.config.log_prompts:
            log_prompt(system_content, user_content)
        return messages

    def expects_json_array(self) -> bool:
        return True


def build_json_batch_profile(config: PromptConfig) -> JsonBatchPromptProfile:
    """
    Args:
        config: Prompt configuration.

    Returns:
        JsonBatchPromptProfile instance.
    """
    return JsonBatchPromptProfile(config)