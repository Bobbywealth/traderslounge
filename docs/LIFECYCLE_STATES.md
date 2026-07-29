# Signal Lifecycle States

## State Definitions

| State | Description |
|-------|-------------|
| OBSERVING | Setup identified, gathering evidence |
| DEVELOPING | Evidence building, approaching readiness |
| NEAR_TRIGGER | Close to triggering, awaiting final confirmation |
| READY | Can be traded when trigger condition is met |
| ACTIVE | Entry triggered, position open |
| TP1_REACHED | First target hit |
| TP2_REACHED | Second target hit |
| TP3_REACHED | Third target hit |
| BREAK_EVEN | Stop moved to entry |
| STOPPED | Stop loss triggered |
| EXPIRED | Time window passed without entry |
| INVALIDATED | Thesis proven wrong |
| BLOCKED_BY_NEWS | High-impact news event |
| BLOCKED_BY_DATA | Data quality insufficient |
| BLOCKED_BY_SPREAD | Spread too wide |
| BLOCKED_BY_RISK | Portfolio risk exceeded |
| CLOSED | Trade finished normally |

## Valid Transitions

- OBSERVING → DEVELOPING → NEAR_TRIGGER → READY
- READY → ACTIVE (entry triggered)
- READY → INVALIDATED (thesis broken)
- READY → BLOCKED_BY_* (condition blocked)
- ACTIVE → TP1_REACHED → TP2_REACHED → TP3_REACHED or STOPPED
- Any terminal state cannot transition back to earlier states
