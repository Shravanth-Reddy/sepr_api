"""
SerpAPI Ingestion Client with 3-Tier Fallback Chain.

Tier 1: Live SerpAPI Google News query
Tier 2: Local cache (cache/serp_cache.json)
Tier 3: Hardcoded canonical scenario block (demo insurance)
"""
import json
import logging
import requests
from typing import Dict, Any, Tuple, Optional
import config

logger = logging.getLogger(__name__)

# Canonical fallback scenario block: Ensures the demo never dies on network/quota failure
HARDCODED_SCENARIO: Dict[str, Any] = {
    "search_metadata": {
        "status": "Hardcoded Scenario Fallback",
        "scenario_id": "SCENARIO-PORT-KLANG-01"
    },
    "search_parameters": {
        "engine": "google_news",
        "q": "Port Klang port disruption OR delay OR strike OR weather"
    },
    "news_results": [
        {
            "position": 1,
            "title": "Severe Tropical Storm Causes Major Congestion and Berth Delays at Port Klang",
            "link": "https://www.maritimenews-example.com/port-klang-congestion-2026",
            "source": {
                "name": "Maritime Trade & Logistics Gazette"
            },
            "date": "2026-10-02",
            "snippet": "Vessel operations at Malaysia's premier hub Port Klang face extensive delays of up to 10 to 14 days following tropical storm squalls and equipment downtime, impacting container feeder schedules across Malacca Strait including departures to Chennai."
        }
    ]
}


def fetch_from_live_api(query: str, timeout_seconds: int = 10) -> Optional[Dict[str, Any]]:
    """Fetches news results from SerpAPI Google News engine."""
    api_key = config.SERPAPI_API_KEY
    if not api_key:
        logger.warning("No SERPAPI_API_KEY configured. Skipping Tier 1 live call.")
        return None

    url = "https://serpapi.com/search.json"
    params = {
        "engine": "google_news",
        "q": query,
        "api_key": api_key,
        "hl": "en",
        "gl": "us",
    }

    try:
        response = requests.get(url, params=params, timeout=timeout_seconds)
        if response.status_code == 200:
            data = response.json()
            if "error" in data:
                logger.warning(f"SerpAPI returned error message: {data['error']}")
                return None
            return data
        else:
            logger.warning(f"SerpAPI request returned status code {response.status_code}: {response.text}")
            return None
    except Exception as e:
        logger.warning(f"Live SerpAPI request failed: {e}")
        return None


def fetch_from_cache() -> Optional[Dict[str, Any]]:
    """Loads results from local cache file."""
    if not config.CACHE_FILE.exists():
        logger.warning(f"Cache file {config.CACHE_FILE} does not exist.")
        return None

    try:
        with open(config.CACHE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data
    except Exception as e:
        logger.warning(f"Failed to read cache file: {e}")
        return None


def save_to_cache(data: Dict[str, Any]) -> bool:
    """Saves live results to cache file."""
    try:
        with open(config.CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        logger.warning(f"Failed to write to cache file: {e}")
        return False


def fetch_disruption_news(
    query: Optional[str] = None, 
    force_tier: Optional[int] = None,
    timeout_seconds: int = 10
) -> Tuple[Dict[str, Any], str]:
    """
    Executes the 3-Tier Fallback Chain:
    - Tier 1: Live SerpAPI query (saves to cache on success)
    - Tier 2: Read cache/serp_cache.json
    - Tier 3: Hardcoded scenario fallback
    
    Returns:
        (data_dict, source_tier_name)
    """
    search_query = query or config.DEFAULT_SEARCH_QUERY

    # Force Tier override (useful for testing each tier deterministically)
    if force_tier == 1:
        data = fetch_from_live_api(search_query, timeout_seconds=timeout_seconds)
        if data:
            save_to_cache(data)
            return data, "live_api"
        raise RuntimeError("Tier 1 (Live API) forced but failed.")

    elif force_tier == 2:
        cached = fetch_from_cache()
        if cached:
            return cached, "cache"
        raise RuntimeError("Tier 2 (Cache) forced but cache file missing/invalid.")

    elif force_tier == 3:
        return HARDCODED_SCENARIO, "hardcoded_scenario"

    # Default fallback execution chain:
    # 1. Attempt Live API
    live_data = fetch_from_live_api(search_query, timeout_seconds=timeout_seconds)
    if live_data and "news_results" in live_data and len(live_data["news_results"]) > 0:
        save_to_cache(live_data)
        return live_data, "live_api"

    # 2. Attempt Cache Fallback
    cached_data = fetch_from_cache()
    if cached_data and "news_results" in cached_data and len(cached_data["news_results"]) > 0:
        return cached_data, "cache"

    # 3. Hardcoded Scenario Fallback
    return HARDCODED_SCENARIO, "hardcoded_scenario"
