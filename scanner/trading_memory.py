"""
Persistent institutional-style Trading Memory for ConfluenceX.

Stores actionable insights the system has learned over time:

    - Zone interaction patterns ("Gold has rejected this weekly supply zone 3x")
    - News event impact patterns ("Last 4 CPI releases produced >1.2% XAUUSD move")
    - Setup performance by condition ("This setup performs poorly in low-volume Asia")
    - Manual annotations from the trader

Memory is retrieved as context for "Why This Trade" panels, making the system
feel genuinely intelligent by surfacing historical patterns alongside live analysis.

All writes go through the Postgres repository; reads are filterable by symbol,
category, tags, and condition_key for precise context injection.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Mapping, Optional, Sequence

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Insight categories
# ──────────────────────────────────────────────────────────────────────────────

class InsightCategory(str, Enum):
    ZONE_REJECTION = "zone_rejection"          # price rejected at a level N times
    NEWS_IMPACT = "news_impact"                # calendar event caused X% move
    SESSION_PATTERN = "session_pattern"        # setup works / fails in specific sessions
    SETUP_PERFORMANCE = "setup_performance"    # strategy type performs well / poorly under conditions
    STRUCTURAL_OBSERVATION = "structural_observation"  # manual or system observation about structure
    MACRO_REGIME = "macro_regime"              # regime-specific behavior (range/trending/volatile)
    ANNOTATION = "annotation"                  # manual trader note


class InsightStrength(str, Enum):
    LOW = "low"          # 1-2 observations; suggestive only
    MEDIUM = "medium"    # 3-4 observations; noteworthy pattern
    HIGH = "high"        # 5+ observations; strong historical precedent


# Thresholds for auto-promotion
ZONE_REJECTION_THRESHOLD = 3    # 3+ rejections → promote to insight
NEWS_IMPACT_THRESHOLD = 4       # 4+ events with impact > 1.2% → promote
NEWS_IMPACT_MIN_PCT = 1.2       # minimum price move % to count
SETUP_CONDITION_THRESHOLD = 3   # 3+ same-condition wins/losses → promote


# ──────────────────────────────────────────────────────────────────────────────
# Core dataclass
# ──────────────────────────────────────────────────────────────────────────────

class Insight:
    __slots__ = (
        "id", "created_at", "category", "symbol", "condition_key",
        "observation", "evidence_count", "evidence_strength",
        "evidence_data", "source", "created_by", "confidence",
        "tags", "relevance_score",
    )

    def __init__(self, **kwargs: Any) -> None:
        for slot in self.__slots__:
            setattr(self, slot, kwargs.get(slot))

    def to_dict(self) -> dict[str, Any]:
        d = {slot: getattr(self, slot) for slot in self.__slots__ if getattr(self, slot) is not None}
        # Serialize enums
        if isinstance(d.get("category"), InsightCategory):
            d["category"] = d["category"].value
        if isinstance(d.get("evidence_strength"), InsightStrength):
            d["evidence_strength"] = d["evidence_strength"].value
        if isinstance(d.get("created_at"), datetime):
            d["created_at"] = d["created_at"].isoformat()
        return d

    @classmethod
    def from_row(cls, row: Mapping[str, Any]) -> "Insight":
        """Build an Insight from a Postgres dict row (psycopg2 returns dict rows)."""
        evidence_data = row.get("evidence_data")
        if isinstance(evidence_data, str):
            try:
                evidence_data = json.loads(evidence_data)
            except (json.JSONDecodeError, TypeError):
                evidence_data = {}

        tags = row.get("tags")
        if isinstance(tags, str):
            try:
                tags = json.loads(tags)
            except (json.JSONDecodeError, TypeError):
                tags = []

        return cls(
            id=row.get("id"),
            created_at=row.get("created_at"),
            category=InsightCategory(row["category"]) if row.get("category") else None,
            symbol=row.get("symbol"),
            condition_key=row.get("condition_key"),
            observation=row.get("observation"),
            evidence_count=int(row.get("evidence_count") or 0),
            evidence_strength=InsightStrength(row["evidence_strength"]) if row.get("evidence_strength") else InsightStrength.LOW,
            evidence_data=evidence_data or {},
            source=row.get("source"),
            created_by=row.get("created_by"),
            confidence=float(row.get("confidence") or 0),
            tags=tags or [],
            relevance_score=float(row.get("relevance_score") or 0),
        )

    def __repr__(self) -> str:
        return f"Insight({self.category} | {self.symbol} | {self.observation[:40] if self.observation else ''})"


# ──────────────────────────────────────────────────────────────────────────────
# TradingMemoryManager — thin layer over Postgres
# ──────────────────────────────────────────────────────────────────────────────

class TradingMemoryManager:
    """Manages trading insights in Postgres. Handles CRUD, auto-derivation,
    and context retrieval for the "Why This Trade" panel."""

    def __init__(self, conn_factory) -> None:
        """conn_factory: callable returning a psycopg2 connection (with dict cursor)."""
        self._conn_factory = conn_factory

    # ── CRUD ───────────────────────────────────────────────────────────────

    def create(
        self,
        category: str | InsightCategory,
        symbol: str | None,
        condition_key: str,
        observation: str,
        evidence_count: int = 1,
        evidence_strength: str = "medium",
        evidence_data: dict | None = None,
        source: str = "manual",
        created_by: str | None = None,
        confidence: float = 50.0,
        tags: list[str] | None = None,
    ) -> Insight:
        """Insert a new insight."""
        cat = InsightCategory(category) if isinstance(category, str) else category
        strength = InsightStrength(evidence_strength) if isinstance(evidence_strength, str) else evidence_strength
        fingerprint = self._fingerprint(cat, symbol, condition_key)
        now = datetime.now(timezone.utc)
        tags_json = json.dumps(tags or [])
        evidence_json = json.dumps(evidence_data or {})

        with self._conn_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO trading_insights
                       (category, symbol, condition_key, observation, evidence_count,
                        evidence_strength, evidence_data, source, created_by,
                        confidence, tags, fingerprint, created_at)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                       ON CONFLICT (fingerprint) DO UPDATE SET
                           evidence_count = GREATEST(trading_insights.evidence_count, EXCLUDED.evidence_count),
                           evidence_strength = CASE
                               WHEN EXCLUDED.evidence_strength = 'high' THEN 'high'
                               WHEN trading_insights.evidence_strength = 'high' THEN 'high'
                               ELSE EXCLUDED.evidence_strength
                           END,
                           evidence_data = trading_insights.evidence_data || EXCLUDED.evidence_data,
                           observation = EXCLUDED.observation,
                           confidence = GREATEST(trading_insights.confidence, EXCLUDED.confidence),
                           updated_at = NOW()
                       RETURNING id, created_at, updated_at""",
                    (
                        cat.value, symbol, condition_key, observation,
                        evidence_count, strength.value, evidence_json,
                        source, created_by, confidence, tags_json,
                        fingerprint, now,
                    ),
                )
                row = cur.fetchone()
                conn.commit()
                insight_id = row["id"] if row else None

        # Re-fetch to get full row
        return self.get(insight_id) if insight_id else Insight()

    def get(self, insight_id: int) -> Insight | None:
        """Fetch a single insight by id."""
        with self._conn_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT * FROM trading_insights WHERE id = %s",
                    (insight_id,),
                )
                row = cur.fetchone()
        return Insight.from_row(row) if row else None

    def list(
        self,
        symbol: str | None = None,
        category: str | None = None,
        tags: list[str] | None = None,
        min_confidence: float = 0,
        limit: int = 50,
    ) -> list[Insight]:
        """List insights with optional filters."""
        clauses = []
        params: list[Any] = []
        if symbol:
            clauses.append("symbol = %s")
            params.append(symbol)
        if category:
            clauses.append("category = %s")
            params.append(category)
        if tags:
            # Postgres array overlap
            clauses.append("tags && %s")
            params.append(tags)
        if min_confidence > 0:
            clauses.append("confidence >= %s")
            params.append(min_confidence)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(limit)

        with self._conn_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT * FROM trading_insights {where} ORDER BY evidence_count DESC, created_at DESC LIMIT %s",
                    params,
                )
                rows = cur.fetchall()
        return [Insight.from_row(r) for r in rows]

    def delete(self, insight_id: int) -> bool:
        """Delete an insight by id."""
        with self._conn_factory() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM trading_insights WHERE id = %s", (insight_id,))
                conn.commit()
                return cur.rowcount > 0

    # ── Context retrieval for "Why This Trade" ─────────────────────────────

    def get_context_for_setup(
        self,
        symbol: str,
        direction: str,
        timeframe: str | None = None,
        session: str | None = None,
        regime: str | None = None,
        zone_price: float | None = None,
        limit: int = 10,
    ) -> list[Insight]:
        """Retrieve insights relevant to a specific setup being considered.
        
        Looks for:
        1. Symbol-specific insights (highest priority)
        2. Insights matching the current session
        3. Insights matching the current regime
        4. Zone-related insights if zone_price is provided
        5. General/market-wide insights
        
        Returns sorted by relevance (confidence * evidence_count).
        """
        candidates: list[tuple[float, Insight]] = []

        # Symbol-specific
        for ins in self.list(symbol=symbol, limit=20):
            relevance = ins.confidence * (1 + min(ins.evidence_count, 10) * 0.1)
            candidates.append((relevance, ins))

        # Session-specific
        if session:
            for ins in self.list(tags=[f"session:{session}"], limit=10):
                relevance = ins.confidence * 0.8
                candidates.append((relevance, ins))

        # Regime-specific
        if regime:
            for ins in self.list(tags=[f"regime:{regime}"], limit=10):
                relevance = ins.confidence * 0.7
                candidates.append((relevance, ins))

        # Market-wide
        for ins in self.list(symbol=None, limit=10):
            relevance = ins.confidence * 0.5
            candidates.append((relevance, ins))

        # Dedupe and sort by relevance
        seen = set()
        ranked = []
        for relevance, ins in sorted(candidates, key=lambda x: x[0], reverse=True):
            if ins.id not in seen:
                seen.add(ins.id)
                ranked.append(ins)
        return ranked[:limit]

    # ── Auto-derivation from observations ───────────────────────────────────

    def record_zone_interaction(
        self,
        symbol: str,
        zone_price: float,
        zone_type: str,
        reaction: str,
        price_change_pct: float = 0.0,
        timeframe: str = "H1",
    ) -> Insight | None:
        """Record that price interacted with a zone. Auto-promotes after threshold.
        
        zone_type: 'supply', 'demand', 'support', 'resistance', 'fvg', 'order_block', etc.
        reaction: 'rejection', 'breakthrough', 'bounce', 'sweep'
        """
        condition_key = f"{symbol}|{zone_type}|{round(zone_price, 2)}"

        # Count existing interactions for this zone
        existing = self.list(symbol=symbol, category=InsightCategory.ZONE_REJECTION, tags=[], limit=100)
        zone_insights = [
            i for i in existing
            if i.condition_key == condition_key
        ]

        # Update the existing insight or check for manual one
        count = len(zone_insights) + 1
        if count < ZONE_REJECTION_THRESHOLD:
            # Below threshold: just record the data point but don't promote
            self._record_zone_datapoint(symbol, condition_key, zone_price, zone_type, reaction, price_change_pct, timeframe)
            return None

        # Above threshold: promote to full insight
        if zone_insights:
            ins = zone_insights[0]
            strength = InsightStrength.HIGH if count >= 5 else InsightStrength.MEDIUM
            evidence_data = ins.evidence_data.copy() if ins.evidence_data else {}
            evidence_data.setdefault("interactions", []).append({
                "price": zone_price, "reaction": reaction,
                "change_pct": price_change_pct, "timeframe": timeframe,
                "ts": datetime.now(timezone.utc).isoformat(),
            })
            return self.create(
                category=InsightCategory.ZONE_REJECTION,
                symbol=symbol,
                condition_key=condition_key,
                observation=f"{symbol} has rejected the {round(zone_price, 2)} {zone_type} zone {count} times.",
                evidence_count=count,
                evidence_strength=strength.value,
                evidence_data=evidence_data,
                source="system",
                confidence=min(80, 40 + count * 8),
                tags=[f"zone_type:{zone_type}", f"tf:{timeframe}"],
            )
        else:
            evidence_data = {"interactions": [{"price": zone_price, "reaction": reaction, "change_pct": price_change_pct, "timeframe": timeframe, "ts": datetime.now(timezone.utc).isoformat()}]}
            return self.create(
                category=InsightCategory.ZONE_REJECTION,
                symbol=symbol,
                condition_key=condition_key,
                observation=f"{symbol} has rejected the {round(zone_price, 2)} {zone_type} zone {count} times.",
                evidence_count=count,
                evidence_strength=InsightStrength.MEDIUM.value,
                evidence_data=evidence_data,
                source="system",
                confidence=60,
                tags=[f"zone_type:{zone_type}", f"tf:{timeframe}"],
            )

    def _record_zone_datapoint(
        self, symbol: str, condition_key: str, zone_price: float,
        zone_type: str, reaction: str, price_change_pct: float, timeframe: str,
    ) -> None:
        """Store a zone interaction datapoint that hasn't yet reached threshold."""
        try:
            with self._conn_factory() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """INSERT INTO zone_interactions
                           (symbol, condition_key, zone_price, zone_type, reaction, price_change_pct, timeframe, ts)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,NOW())
                           ON CONFLICT DO NOTHING""",
                        (symbol, condition_key, zone_price, zone_type, reaction, price_change_pct, timeframe),
                    )
                    conn.commit()
        except Exception:
            logger.debug("zone_interactions table may not exist yet; skipping", exc_info=True)

    def record_news_impact(
        self,
        symbol: str,
        event_name: str,
        event_impact: str,
        price_before: float,
        price_after_5m: float | None = None,
        price_after_30m: float | None = None,
        currency: str = "USD",
    ) -> Insight | None:
        """Record a news event's price impact. Auto-promotes after threshold."""
        condition_key = f"{symbol}|{event_name}|{currency}"

        existing = self.list(symbol=symbol, category=InsightCategory.NEWS_IMPACT, tags=[], limit=100)
        event_insights = [i for i in existing if i.condition_key == condition_key]
        count = len(event_insights) + 1

        # Calculate the relevant price move
        move_pct = 0.0
        if price_after_5m and price_before:
            move_pct = abs((price_after_5m - price_before) / price_before * 100)

        if count < NEWS_IMPACT_THRESHOLD or move_pct < NEWS_IMPACT_MIN_PCT:
            self._record_news_datapoint(symbol, condition_key, event_name, event_impact, currency, price_before, price_after_5m, price_after_30m, move_pct)
            return None

        if event_insights:
            ins = event_insights[0]
            evidence_data = ins.evidence_data.copy() if ins.evidence_data else {}
            evidence_data.setdefault("events", []).append({
                "price_before": price_before, "price_after_5m": price_after_5m,
                "price_after_30m": price_after_30m, "move_pct": move_pct,
                "impact": event_impact, "ts": datetime.now(timezone.utc).isoformat(),
            })
            avg_move = sum(e.get("move_pct", 0) for e in evidence_data["events"]) / len(evidence_data["events"])
            strength = InsightStrength.HIGH if count >= 6 else InsightStrength.MEDIUM
            return self.create(
                category=InsightCategory.NEWS_IMPACT,
                symbol=symbol,
                condition_key=condition_key,
                observation=f"Last {count} {event_name} releases produced >{round(avg_move, 1)}% initial {symbol} move.",
                evidence_count=count,
                evidence_strength=strength.value,
                evidence_data=evidence_data,
                source="system",
                confidence=min(90, 50 + count * 8),
                tags=[f"event:{event_name}", f"currency:{currency}"],
            )
        return None

    def _record_news_datapoint(
        self, symbol: str, condition_key: str, event_name: str, event_impact: str,
        currency: str, price_before: float, price_after_5m: float | None,
        price_after_30m: float | None, move_pct: float,
    ) -> None:
        try:
            with self._conn_factory() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """INSERT INTO news_event_interactions
                           (symbol, condition_key, event_name, event_impact, currency,
                            price_before, price_after_5m, price_after_30m, move_pct, ts)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())
                           ON CONFLICT DO NOTHING""",
                        (symbol, condition_key, event_name, event_impact, currency,
                         price_before, price_after_5m, price_after_30m, move_pct),
                    )
                    conn.commit()
        except Exception:
            logger.debug("news_event_interactions table may not exist yet; skipping", exc_info=True)

    def record_setup_condition_performance(
        self,
        symbol: str,
        setup_type: str,
        session: str,
        regime: str,
        result: str,
        pnl_pct: float = 0.0,
    ) -> Insight | None:
        """Record a setup result under specific conditions. Auto-promotes after threshold.
        
        setup_type: 'confluence', 'harmonic', 'impulse', 'reversal', etc.
        session: 'asian', 'london', 'new_york', 'overlap'
        regime: 'trending', 'range_bound', 'volatile', 'quiet'
        result: 'win', 'loss', 'breakeven'
        """
        condition_key = f"{symbol}|{setup_type}|{session}|{regime}"
        tags = [f"session:{session}", f"regime:{regime}", f"setup:{setup_type}"]

        existing = self.list(symbol=symbol, category=InsightCategory.SETUP_PERFORMANCE, tags=[], limit=100)
        perf_insights = [i for i in existing if i.condition_key == condition_key]
        count = len(perf_insights) + 1

        if count < SETUP_CONDITION_THRESHOLD:
            return None

        if perf_insights:
            ins = perf_insights[0]
            evidence_data = ins.evidence_data.copy() if ins.evidence_data else {}
            evidence_data.setdefault("trades", []).append({
                "result": result, "pnl_pct": pnl_pct,
                "ts": datetime.now(timezone.utc).isoformat(),
            })
            wins = sum(1 for t in evidence_data["trades"] if t.get("result") == "win")
            total = len(evidence_data["trades"])
            win_rate = wins / total if total > 0 else 0
            direction = "outperforms" if win_rate > 0.55 else "underperforms" if win_rate < 0.45 else "performs inconsistently"
            return self.create(
                category=InsightCategory.SETUP_PERFORMANCE,
                symbol=symbol,
                condition_key=condition_key,
                observation=f"{symbol} {setup_type} setups {direction} in {session} sessions during {regime} markets (W/L: {wins}/{total - wins}, {round(win_rate * 100, 0)}%).",
                evidence_count=count,
                evidence_strength=InsightStrength.MEDIUM.value,
                evidence_data=evidence_data,
                source="system",
                confidence=min(85, 45 + count * 7),
                tags=tags,
            )
        return None

    def record_manual_annotation(
        self,
        symbol: str,
        observation: str,
        created_by: str = "trader",
        tags: list[str] | None = None,
        confidence: float = 70.0,
    ) -> Insight:
        """Record a manual trader annotation."""
        condition_key = f"{symbol}|annotation|{hashlib.sha256(observation.encode()).hexdigest()[:12]}"
        return self.create(
            category=InsightCategory.ANNOTATION,
            symbol=symbol,
            condition_key=condition_key,
            observation=observation,
            evidence_count=1,
            evidence_strength=InsightStrength.MEDIUM.value,
            evidence_data={},
            source="manual",
            created_by=created_by,
            confidence=confidence,
            tags=tags or [],
        )

    # ── Helpers ─────────────────────────────────────────────────────────────

    @staticmethod
    def _fingerprint(category: InsightCategory, symbol: str | None, condition_key: str) -> str:
        raw = f"{category.value}|{symbol or ''}|{condition_key}"
        return hashlib.sha256(raw.encode()).hexdigest()


# ── Plain-language memory notes (degrades to [] without DB) ──────────────────────


def build_memory_notes(
    pair: str,
    timeframe: str = "H1",
    lookback: int = 200,
    min_samples: int = 5,
    conn_factory=None,
) -> list[dict]:
    """Build plain-language memory notes for a given pair + timeframe.

    Returns a list of {"category", "note", "confidence", "evidence_n"} dicts
    ready to feed straight to the frontend. Three note categories:

      - zone_rejection:  how many times a recent entry zone acted as resistance
                         (BUY that entered the zone and ended in a loss) or
                         support (SELL that ended in a loss after touching).
      - news_impact:     average realized move within ~5 minutes of the last
                         few high-impact calendar events for this pair.
      - session_pattern: setup_type + session + regime combinations that
                         are statistically underperforming (>=min_samples,
                         win-rate <= 40%).

    The function is **safe to call with no DB**: it degrades to ``[]``.
    It is **safe to call with empty tables**: returns [].
    """
    pair = (pair or "").upper()
    if not pair:
        return []

    notes: list[dict] = []

    # Resolve a connection. Anything truthy that returns a context-manager
    # yielding a cursor (psycopg conn, repo._get_connection(), or sqlite3
    # connection) works. Anything falsy / None -> degraded mode.
    ctx = None
    cur = None
    if conn_factory is not None:
        try:
            ctx = conn_factory()
            if ctx is not None:
                cur = ctx.__enter__()
        except Exception as e:
            logger.debug("build_memory_notes: conn_factory failed: %s", e)
            cur = None
    if cur is None:
        return notes  # degraded mode - empty list, never an error

    is_pg = _is_postgres(cur)
    placeholder = "%s" if is_pg else "?"

    try:
        # ---- Zone rejection history -------------------------------------
        # Count BUY setups where actual_entry was inside the planned zone
        # but the trade ended as a loss (price reversed through the zone
        # instead of bouncing) AND analog for SELL.
        try:
            cur.execute(
                f"""
                SELECT entry_low, entry_high, direction, outcome
                FROM journal_entries
                WHERE symbol = {placeholder}
                  AND entry_low > 0 AND entry_high > 0
                  AND outcome IN ('loss', 'invalidated')
                ORDER BY detected_at DESC
                LIMIT {placeholder}
                """,
                (pair, lookback),
            )
            zones_rejected = {}
            for row in cur.fetchall():
                entry_low, entry_high, direction, outcome = row[:4]
                zone_key = (round(entry_low, 2), round(entry_high, 2), direction)
                zones_rejected[zone_key] = zones_rejected.get(zone_key, 0) + 1
            for (low, high, direction), count in sorted(
                zones_rejected.items(), key=lambda kv: -kv[1]
            )[:2]:
                if count >= 3:
                    side = "supply" if direction == "BUY" else "demand"
                    notes.append({
                        "category": "zone_rejection",
                        "note": (
                            f"{pair} has rejected the {low:.0f}-{high:.0f} "
                            f"{side} zone {count} times in the last "
                            f"{min(count, lookback)} setups."
                        ),
                        "confidence": "high" if count >= 5 else "med",
                        "evidence_n": count,
                    })
        except Exception:
            logger.debug("build_memory_notes: zone query failed", exc_info=True)

        # ---- News impact history -----------------------------------------
        # Average |move_pct| for high-impact events on this pair.
        events = []
        for table in ("news_event_interactions", "news_event_impacts"):
            try:
                cur.execute(
                    f"""
                    SELECT event_name, move_pct
                    FROM {table}
                    WHERE symbol = {placeholder}
                      AND impact = 'high' AND move_pct IS NOT NULL
                    ORDER BY ts DESC
                    LIMIT 8
                    """,
                    (pair,),
                )
                events = cur.fetchall()
                if events:
                    break
            except Exception:
                continue
        if events:
            by_event = {}
            for row in events:
                name, move = row[0], abs(float(row[1]))
                by_event.setdefault(name, []).append(move)
            for name, moves in sorted(by_event.items(), key=lambda kv: -len(kv[1])):
                if len(moves) >= 4 and sum(moves) / len(moves) >= 1.2:
                    avg = sum(moves) / len(moves)
                    notes.append({
                        "category": "news_impact",
                        "note": (
                            f"Last {len(moves)} {name} releases moved {pair} "
                            f">{avg:.1f}% on the initial reaction."
                        ),
                        "confidence": "high" if len(moves) >= 6 else "med",
                        "evidence_n": len(moves),
                    })

        # ---- Setup-type performance by session/regime --------------------
        try:
            cur.execute(
                f"""
                SELECT strategy_type, session, market_regime,
                       SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS wins,
                       SUM(CASE WHEN outcome = 'loss' THEN 1 ELSE 0 END) AS losses,
                       COUNT(*) AS n
                FROM journal_entries
                WHERE symbol = {placeholder} AND outcome IN ('win', 'loss')
                GROUP BY strategy_type, session, market_regime
                HAVING COUNT(*) >= {placeholder}
                LIMIT 200
                """,
                (pair, min_samples),
            )
            rows = cur.fetchall()
            for row in rows:
                strat, sess, regime, wins, losses, n = row[:6]
                if not strat or not sess:
                    continue
                win_rate = (wins or 0) / (n or 1)
                if win_rate <= 0.40 and (n or 0) >= min_samples:
                    notes.append({
                        "category": "session_pattern",
                        "note": (
                            f"{strat} setups have underperformed in the {sess} "
                            f"session during {regime or 'any'} regimes "
                            f"({wins}W/{losses}L, {win_rate*100:.0f}% win-rate)."
                        ),
                        "confidence": "high" if (n or 0) >= 10 else "med",
                        "evidence_n": n or 0,
                    })
        except Exception:
            logger.debug("build_memory_notes: session query failed", exc_info=True)

    finally:
        try:
            if ctx is not None:
                ctx.__exit__(None, None, None)
        except Exception:
            pass

    # Sort by confidence then evidence
    conf_rank = {"high": 0, "med": 1, "low": 2}
    notes.sort(key=lambda n: (conf_rank.get(n["confidence"], 9), -n["evidence_n"]))
    return notes


def _is_postgres(cur) -> bool:
    """Best-effort detection of psycopg vs sqlite cursor (for %s vs ?)."""
    mod = type(cur).__module__
    return "psycopg" in mod
