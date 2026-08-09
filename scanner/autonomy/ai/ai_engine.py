"""
AI Intelligence Engine for Confluence X.

Provides human-readable explanations, summaries, and conversational assistance.
Uses LLM for explanation only - all trading decisions remain deterministic.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)


@dataclass
class AIResponse:
    """Response from AI engine."""
    content: str
    confidence: float = 0.8
    sources: List[str] = field(default_factory=list)
    timestamp: float = field(default_factory=time.time)
    query_type: str = ''
    metadata: dict = field(default_factory=dict)


class AIEngine:
    """
    AI Intelligence Engine.
    
    Provides human-readable explanations and conversational assistance.
    Uses deterministic data from the system - does not make trading decisions.
    """
    
    def __init__(self, llm_client=None):
        from .llm_client import LLMClient
        self._llm_client = llm_client or LLMClient()
        self._context: Dict[str, Any] = {}
    
    def _generate_with_llm(self, prompt: str, system_prompt: str = None) -> Optional[str]:
        """Generate response using LLM if available, otherwise return None."""
        if self._llm_client and self._llm_client.is_available:
            return self._llm_client.generate(prompt, system_prompt)
        return None
    
    def set_context(self, key: str, value: Any):
        """Set context for AI responses."""
        self._context[key] = value
    
    def update_system_context(self, active_setups: list, open_positions: list,
                              daily_pnl: float = 0.0, news_status: str = 'CLEAR',
                              regime: str = 'unknown', session: str = 'unknown'):
        """Update AI context with current system state.
        Called every cycle by the autonomous loop.
        """
        self._context['active_setups'] = active_setups
        self._context['open_positions'] = open_positions
        self._context['daily_pnl'] = daily_pnl
        self._context['news_status'] = news_status
        self._context['regime'] = regime
        self._context['session'] = session
    
    def answer_system_question(self, question: str) -> AIResponse:
        """Answer a question about current system state using deterministic data."""
        q = question.lower()
        setups = self._context.get('active_setups', [])
        positions = self._context.get('open_positions', [])
        
        if 'strongest' in q or 'best' in q:
            if not setups:
                return AIResponse(content='No active setups right now.', query_type='system')
            best = max(setups, key=lambda s: s.get('score', 0))
            return AIResponse(
                content=f"Strongest setup: {best.get('symbol','')} {best.get('direction','')} "
                        f"score {best.get('score',0)}/100, state {best.get('state','')}",
                query_type='system', sources=['setup_lifecycle'])
        
        if 'position' in q or 'risk' in q or 'open' in q:
            n = len(positions)
            pnl = self._context.get('daily_pnl', 0)
            return AIResponse(
                content=f"Open positions: {n}. Daily P&L: ${pnl:+.2f}.",
                query_type='system', sources=['paper_broker'])
        
        if 'news' in q:
            ns = self._context.get('news_status', 'UNKNOWN')
            return AIResponse(content=f"News status: {ns}", query_type='system', sources=['news_engine'])
        
        if 'session' in q:
            s = self._context.get('session', 'unknown')
            return AIResponse(content=f"Current session: {s}", query_type='system', sources=['session_engine'])
        
        if 'regime' in q:
            r = self._context.get('regime', 'unknown')
            return AIResponse(content=f"Market regime: {r}", query_type='system', sources=['regime_engine'])
        
        # Default: describe current state
        ready = [s for s in setups if s.get('state') == 'ready']
        developing = [s for s in setups if s.get('state') in ('detected', 'developing', 'watch')]
        parts = [f"{len(setups)} active setups ({len(ready)} ready, {len(developing)} developing)."]
        parts.append(f"{len(positions)} open positions.")
        parts.append(f"News: {self._context.get('news_status', 'UNKNOWN')}.")
        return AIResponse(content=' '.join(parts), query_type='system')
    
    def explain_setup(self, setup_data: dict) -> AIResponse:
        """Explain why a setup is READY or not ready."""
        
        symbol = setup_data.get('symbol', 'Unknown')
        direction = setup_data.get('direction', 'Unknown')
        score = setup_data.get('score', 0)
        state = setup_data.get('state', 'unknown')
        reasons = setup_data.get('technical_reasons', [])
        warnings = setup_data.get('risk_reasons', [])
        news_state = setup_data.get('news_state', 'UNKNOWN')
        
        # Build explanation from deterministic data
        explanation_parts = []
        
        # Score explanation
        if score >= 80:
            explanation_parts.append(f"**{symbol} {direction}** scores {score}/100 - Strong confluence.")
        elif score >= 65:
            explanation_parts.append(f"**{symbol} {direction}** scores {score}/100 - Good setup.")
        elif score >= 50:
            explanation_parts.append(f"**{symbol} {direction}** scores {score}/100 - Watchlist level.")
        else:
            explanation_parts.append(f"**{symbol} {direction}** scores {score}/100 - Below threshold.")
        
        # State explanation
        state_explanations = {
            'ready': "All confirmation criteria are satisfied.",
            'watch': "Setup is developing - nearing trigger area.",
            'developing': "Multiple components aligning.",
            'triggered': "Entry condition occurred.",
            'invalidated': "Setup assumptions no longer valid.",
            'expired': "Setup timed out.",
        }
        if state in state_explanations:
            explanation_parts.append(f"**Status:** {state_explanations[state]}")
        
        # Technical reasons
        if reasons:
            explanation_parts.append("\n**Technical Evidence:**")
            for reason in reasons[:5]:  # Limit to 5
                explanation_parts.append(f"  - {reason}")
        
        # Warnings
        if warnings:
            explanation_parts.append("\n**Risk Factors:**")
            for warning in warnings[:3]:  # Limit to 3
                explanation_parts.append(f"  - {warning}")
        
        # News context
        news_explanations = {
            'CLEAR': "No high-impact news imminent.",
            'CAUTION': "Medium-impact event approaching.",
            'BLOCKED': "High-impact event in blackout window.",
            'POST_NEWS': "Post-event cooldown period.",
        }
        if news_state in news_explanations:
            explanation_parts.append(f"\n**News:** {news_explanations[news_state]}")
        
        content = "\n".join(explanation_parts)
        
        return AIResponse(
            content=content,
            confidence=0.9,
            sources=['setup_lifecycle', 'scoring_engine', 'news_engine'],
            query_type='explain_setup',
            metadata={'symbol': symbol, 'score': score, 'state': state},
        )
    
    def explain_rejection(self, setup_data: dict, rejection_reason: str) -> AIResponse:
        """Explain why a setup was rejected."""
        
        symbol = setup_data.get('symbol', 'Unknown')
        score = setup_data.get('score', 0)
        
        content = f"**{symbol}** was not taken:\n\n"
        content += f"**Reason:** {rejection_reason}\n\n"
        
        # Add context based on rejection type
        if 'news' in rejection_reason.lower():
            content += "The economic calendar shows a high-impact event approaching. New entries are blocked during this window to avoid volatility spikes."
        elif 'score' in rejection_reason.lower():
            content += f"The confluence score ({score}) did not meet the minimum threshold. More technical alignment is needed."
        elif 'risk' in rejection_reason.lower():
            content += "Risk parameters did not permit this trade. This could be due to daily loss limits, position count, or exposure limits."
        elif 'data' in rejection_reason.lower():
            content += "Market data quality was insufficient for reliable analysis. We wait for clean data before entering."
        else:
            content += "Multiple factors contributed to this decision. The system prioritizes quality over quantity."
        
        return AIResponse(
            content=content,
            confidence=0.85,
            sources=['rejection_analysis'],
            query_type='explain_rejection',
            metadata={'symbol': symbol, 'reason': rejection_reason},
        )
    
    def generate_session_brief(self, session_data: dict) -> AIResponse:
        """Generate a human-readable session brief."""
        
        session = session_data.get('session', 'Unknown')
        symbols = session_data.get('symbols', [])
        news_status = session_data.get('news_status', 'UNKNOWN')
        regime_summary = session_data.get('regime_summary', '')
        
        content = f"**{session.upper()} SESSION BRIEF**\n\n"
        
        # Regime overview
        if regime_summary:
            content += f"**Market Regime:**\n{regime_summary}\n\n"
        
        # Best opportunities
        if symbols:
            content += "**Top Opportunities:**\n"
            for i, sym in enumerate(symbols[:5], 1):
                name = sym.get('symbol', '???')
                direction = sym.get('direction', '?')
                score = sym.get('score', 0)
                content += f"{i}. {name} {direction} - {score}/100\n"
            content += "\n"
        
        # News context
        news_text = {
            'CLEAR': "News is clear - no high-impact events imminent.",
            'CAUTION': "Caution - medium-impact event approaching.",
            'BLOCKED': "Blocked - high-impact event in window.",
        }
        if news_status in news_text:
            content += f"**News:** {news_text[news_status]}\n\n"
        
        content += "---\n*This is an AI-generated summary based on system data. All trading decisions remain deterministic.*"
        
        return AIResponse(
            content=content,
            confidence=0.8,
            sources=['session_engine', 'regime_engine', 'news_engine'],
            query_type='session_brief',
            metadata={'session': session, 'news_status': news_status},
        )
    
    def answer_question(self, question: str, context: Dict[str, Any] = None) -> AIResponse:
        """Answer a conversational trading question."""
        
        question_lower = question.lower()
        
        # Pattern matching for common questions
        if 'strongest' in question_lower or 'best' in question_lower:
            return self._answer_strongest_setup(context)
        
        elif 'changed' in question_lower and ('london' in question_lower or 'session' in question_lower):
            return self._answer_session_changes(context)
        
        elif 'why' in question_lower and 'bearish' in question_lower:
            return self._answer_bearish_reason(context)
        
        elif 'news' in question_lower or 'event' in question_lower:
            return self._answer_news_status(context)
        
        elif 'risk' in question_lower and ('open' in question_lower or 'current' in question_lower):
            return self._answer_current_risk(context)
        
        elif 'ready' in question_lower:
            return self._answer_ready_setups(context)
        
        elif 'invalidat' in question_lower:
            return self._answer_invalidation(context)
        
        elif 'perform' in question_lower or ('how' in question_lower and 'did' in question_lower):
            return self._answer_performance(context)
        
        else:
            return AIResponse(
                content="I can help with:\n- Strongest current setups\n- What changed since session open\n- Why we're bearish/bullish on a symbol\n- News and upcoming events\n- Current risk exposure\n- Ready setups\n- Invalidation levels\n- Performance questions\n\nPlease rephrase your question.",
                confidence=0.5,
                query_type='general',
            )
    
    def _answer_strongest_setup(self, context: Dict[str, Any] = None) -> AIResponse:
        """Answer question about strongest setup."""
        opportunities = (context or {}).get('opportunities', [])
        
        if not opportunities:
            return AIResponse(
                content="No strong setups detected at this time. The scanner is continuously monitoring all symbols.",
                confidence=0.9,
                query_type='strongest_setup',
            )
        
        best = opportunities[0]
        content = f"**Strongest Setup:** {best.get('symbol')} {best.get('direction')}\n\n"
        content += f"Score: {best.get('score')}/100\n"
        content += f"State: {best.get('state', 'unknown')}\n"
        content += f"Session: {best.get('session', 'unknown')}\n"
        
        return AIResponse(
            content=content,
            confidence=0.85,
            sources=['autonomous_scanner'],
            query_type='strongest_setup',
        )
    
    def _answer_session_changes(self, context: Dict[str, Any] = None) -> AIResponse:
        """Answer question about session changes."""
        memory = (context or {}).get('market_memory', {})
        
        content = "**Session Changes:**\n\n"
        content += "The market memory tracks all significant changes since session open.\n"
        content += "Key changes include:\n"
        content += "- Price movements\n"
        content += "- Regime shifts\n"
        content += "- Structure breaks (BOS/CHOCH)\n"
        content += "- Liquidity sweeps\n\n"
        content += "Check the Market Memory module for detailed change logs."
        
        return AIResponse(
            content=content,
            confidence=0.8,
            sources=['market_memory'],
            query_type='session_changes',
        )
    
    def _answer_bearish_reason(self, context: Dict[str, Any] = None) -> AIResponse:
        """Answer why bearish on a symbol."""
        content = "**Bearish Analysis:**\n\n"
        content += "The system considers multiple factors:\n"
        content += "- HTF trend alignment (D1/H4/H1)\n"
        content += "- Market structure (BOS/CHOCH)\n"
        content += "- Momentum indicators\n"
        content += "- Liquidity context\n"
        content += "- Session dynamics\n\n"
        content += "The regime engine classifies market conditions based on these inputs."
        
        return AIResponse(
            content=content,
            confidence=0.8,
            sources=['regime_engine', 'scoring_engine'],
            query_type='bearish_reason',
        )
    
    def _answer_news_status(self, context: Dict[str, Any] = None) -> AIResponse:
        """Answer about news status."""
        news = (context or {}).get('news_engine')
        
        content = "**News Status:**\n\n"
        content += "The economic calendar is continuously monitored.\n"
        content += "High-impact events trigger automatic trading gates.\n"
        content += "Check the News Engine for real-time event tracking."
        
        return AIResponse(
            content=content,
            confidence=0.85,
            sources=['news_engine'],
            query_type='news_status',
        )
    
    def _answer_current_risk(self, context: Dict[str, Any] = None) -> AIResponse:
        """Answer about current risk exposure."""
        content = "**Current Risk:**\n\n"
        content += "Risk is calculated deterministically by the Risk Manager.\n"
        content += "Factors include:\n"
        content += "- Open position count\n"
        content += "- Total risk percentage\n"
        content += "- Daily loss tracking\n"
        content += "- Correlated exposure\n\n"
        content += "All risk checks are enforced before any trade execution."
        
        return AIResponse(
            content=content,
            confidence=0.9,
            sources=['risk_manager'],
            query_type='current_risk',
        )
    
    def _answer_ready_setups(self, context: Dict[str, Any] = None) -> AIResponse:
        """Answer about ready setups."""
        opportunities = (context or {}).get('opportunities', [])
        ready = [o for o in opportunities if o.get('state') == 'ready']
        
        content = f"**Ready Setups:** {len(ready)}\n\n"
        
        if ready:
            for setup in ready[:3]:
                content += f"- {setup.get('symbol')} {setup.get('direction')} ({setup.get('score')}/100)\n"
        else:
            content += "No setups currently in READY state.\n"
        
        return AIResponse(
            content=content,
            confidence=0.85,
            sources=['setup_lifecycle'],
            query_type='ready_setups',
        )
    
    def _answer_invalidation(self, context: Dict[str, Any] = None) -> AIResponse:
        """Answer about invalidation levels."""
        content = "**Invalidation Levels:**\n\n"
        content += "Each setup has a defined invalidation price.\n"
        content += "If price crosses this level, the setup is automatically invalidated.\n"
        content += "Check individual setup records for specific invalidation levels."
        
        return AIResponse(
            content=content,
            confidence=0.85,
            sources=['setup_lifecycle'],
            query_type='invalidation',
        )
    
    def _answer_performance(self, context: Dict[str, Any] = None) -> AIResponse:
        """Answer about performance."""
        journal = (context or {}).get('journal')
        
        content = "**Performance Summary:**\n\n"
        content += "The Trading Journal tracks all outcomes.\n"
        content += "Statistics include:\n"
        content += "- Win rate\n"
        content += "- Average R\n"
        content += "- Profit factor\n"
        content += "- Max drawdown\n\n"
        content += "Segment analysis available by symbol, timeframe, session."
        
        return AIResponse(
            content=content,
            confidence=0.85,
            sources=['trading_journal'],
            query_type='performance',
        )
