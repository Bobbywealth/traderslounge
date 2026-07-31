"""GitHub public provider — repository stats and developer activity.

Fetches repository information via the GitHub API v3. Works with or without
authentication:

  - Unauthenticated: 60 requests/hour per IP (usually sufficient for one
    pair per analysis).
  - Authenticated (with GitHub personal access token): 5,000 requests/hour
    per user token. Recommended for production deployments.

Extracts developer metrics:
  - Stars, forks, watchers (popularity)
  - Open/closed issues (activity)
  - Recent commit activity (cadence)

Used by §13 fundamentals for developer activity signals.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from ._http import HttpError, get_json

log = logging.getLogger(__name__)

BASE = "https://api.github.com"

# Map canonical pair names to GitHub repository owner/repo.
# Extended as projects are added to the scanner.
_GITHUB_REPOS = {
    # Bitcoin → bitcoin/bitcoin (upstream reference implementation)
    "BTCUSD": "bitcoin/bitcoin",
    # Ethereum → ethereum/go-ethereum (Go implementation)
    "ETHUSD": "ethereum/go-ethereum",
    # Ripple → XRPLF/rippled
    "XRPUSD": "XRPLF/rippled",
    # Litecoin → litecoin-project/litecoin
    "LTCUSD": "litecoin-project/litecoin",
    # Polkadot → paritytech/polkadot-sdk
    "DOTUSD": "paritytech/polkadot-sdk",
    # Stellar → stellar/stellar-core
    "XLMUSD": "stellar/stellar-core",
    # Basic Attention Token → brave/brave-browser
    "BATUSD": "brave/brave-browser",
    # Neo → neo-project/neo
    "NEOUSD": "neo-project/neo",
}


def repo_for(pair: str) -> Optional[str]:
    """Return the GitHub repo (owner/repo) for a scanner pair, or ``None``."""
    if not pair:
        return None
    return _GITHUB_REPOS.get(pair.strip().upper().replace("USDT", "USD"))


def fetch_repo(
    pair: str,
    auth_token: Optional[str] = None,
) -> Dict[str, Any]:
    """Return GitHub repository statistics and activity metrics.

    Fetches basic repo metadata (stars, forks, watchers, open issues) and
    recent commit activity. Raises :class:`HttpError` on transport failure
    or unknown pair.

    Args:
        pair: Scanner pair name (e.g., "BTCUSD").
        auth_token: Optional GitHub personal access token for higher rate
                   limits (5000/hr vs 60/hr).

    Returns:
        Dict with repo stats and activity metrics.
    """
    repo = repo_for(pair)
    if not repo:
        raise HttpError(0, "github", f"unknown pair: {pair!r}")

    headers = None
    if auth_token:
        headers = {"Authorization": f"token {auth_token}"}

    # Fetch repository info (stars, forks, watchers, etc.)
    try:
        repo_data = get_json(
            f"{BASE}/repos/{repo}",
            headers=headers,
        )
    except HttpError as exc:
        if exc.status == 404:
            raise HttpError(
                404,
                f"{BASE}/repos/{repo}",
                f"repository not found: {repo}"
            ) from exc
        if exc.status == 401:
            raise HttpError(
                401,
                f"{BASE}/repos/{repo}",
                "invalid GitHub token"
            ) from exc
        raise

    # Extract key metrics
    stars = repo_data.get("stargazers_count", 0)
    forks = repo_data.get("forks_count", 0)
    watchers = repo_data.get("watchers_count", 0)
    open_issues = repo_data.get("open_issues_count", 0)
    pushed_at = repo_data.get("pushed_at", "")  # ISO 8601 timestamp

    # Fetch recent commits for activity assessment
    try:
        commits_data = get_json(
            f"{BASE}/repos/{repo}/commits?per_page=100",
            headers=headers,
        )
    except HttpError as exc:
        # Non-fatal; repo stats are still valuable
        log.warning(f"Failed to fetch commits for {repo}: {exc}")
        commits_data = []

    return {
        "repository": repo,
        "url": repo_data.get("html_url", ""),
        "description": repo_data.get("description") or "",
        "popularity": {
            "stars": stars,
            "forks": forks,
            "watchers": watchers,
            "open_issues": open_issues,
        },
        "activity": {
            "last_pushed": pushed_at,
            "recent_commits": len(commits_data) if isinstance(commits_data, list) else 0,
        },
        "source": "github",
    }
