"""
LLM Client for Confluence X AI Engine.

Provides integration with LLM providers for richer explanations.
Supports multiple providers with fallback.
"""
from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Optional

log = logging.getLogger(__name__)


@dataclass
class LLMConfig:
    """LLM configuration."""
    provider: str = 'openai'  # openai, anthropic, local
    api_key: str = ''
    model: str = 'gpt-4'
    max_tokens: int = 500
    temperature: float = 0.7
    timeout: float = 30.0


class LLMClient:
    """
    LLM Client.
    
    Provides integration with LLM providers for richer explanations.
    """
    
    def __init__(self, config: Optional[LLMConfig] = None):
        self._config = config or LLMConfig(
            api_key=os.environ.get('OPENAI_API_KEY', ''),
            model=os.environ.get('LLM_MODEL', 'gpt-4'),
        )
        self._available = bool(self._config.api_key)
    
    @property
    def is_available(self) -> bool:
        """Check if LLM is available."""
        return self._available
    
    def generate(self, prompt: str, system_prompt: str = None) -> Optional[str]:
        """Generate a response from the LLM."""
        if not self._available:
            log.debug("LLM not available, using fallback")
            return None
        
        try:
            if self._config.provider == 'openai':
                return self._generate_openai(prompt, system_prompt)
            elif self._config.provider == 'anthropic':
                return self._generate_anthropic(prompt, system_prompt)
            else:
                return None
        except Exception as e:
            log.error("LLM generation failed: %s", e)
            return None
    
    def _generate_openai(self, prompt: str, system_prompt: str = None) -> Optional[str]:
        """Generate using OpenAI API."""
        try:
            import openai
            
            client = openai.OpenAI(api_key=self._config.api_key)
            
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})
            
            response = client.chat.completions.create(
                model=self._config.model,
                messages=messages,
                max_tokens=self._config.max_tokens,
                temperature=self._config.temperature,
            )
            
            return response.choices[0].message.content
            
        except ImportError:
            log.warning("openai package not installed")
            return None
        except Exception as e:
            log.error("OpenAI API error: %s", e)
            return None
    
    def _generate_anthropic(self, prompt: str, system_prompt: str = None) -> Optional[str]:
        """Generate using Anthropic API."""
        try:
            import anthropic
            
            client = anthropic.Anthropic(api_key=self._config.api_key)
            
            kwargs = {
                "model": self._config.model,
                "max_tokens": self._config.max_tokens,
            }
            if system_prompt:
                kwargs["system"] = system_prompt
            
            response = client.messages.create(
                **kwargs,
                messages=[{"role": "user", "content": prompt}],
            )
            
            return response.content[0].text
            
        except ImportError:
            log.warning("anthropic package not installed")
            return None
        except Exception as e:
            log.error("Anthropic API error: %s", e)
            return None
