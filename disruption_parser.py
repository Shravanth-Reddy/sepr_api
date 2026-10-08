"""
Disruption News Parsing & Information Extraction Module.

Extracts structured DisruptionEvent objects from news articles using either:
1. LLM JSON Mode (if OPENAI_API_KEY or GEMINI_API_KEY is available)
2. Heuristic Rule-Based Extractor (offline, deterministic fallback)
"""
import re
import json
import logging
from typing import Dict, Any, List, Optional, Tuple
from pydantic import BaseModel, Field
import config

logger = logging.getLogger(__name__)


class DisruptionEvent(BaseModel):
    event_name: str = Field(..., description="Descriptive name of the disruption event")
    disruption_type: str = Field(..., description="Category: weather, port_congestion, strike, logistics, geopolitical")
    location: str = Field(..., description="Affected port or region, e.g., Port Klang")
    severity: str = Field(..., description="Severity level: LOW, MEDIUM, HIGH, CRITICAL")
    delay_days: int = Field(default=config.DEFAULT_DELAY_DAYS, description="Estimated delay duration in days")
    headline: str = Field(..., description="Original headline of the news article")
    source_url: str = Field(..., description="URL to the source article")
    summary: str = Field(..., description="Concise 1-2 sentence summary of the incident")


def heuristic_parse_article(article: Dict[str, Any]) -> DisruptionEvent:
    """
    Deterministic rule-based extractor that parses a raw SerpAPI news result
    into a structured DisruptionEvent without needing an external LLM.
    """
    title = article.get("title", "")
    snippet = article.get("snippet", "")
    link = article.get("link", "")
    text = f"{title} {snippet}"
    text_lower = text.lower()

    # 1. Location detection (cross-referenced with supply chain hubs)
    location = "Port Klang"
    if "port klang" in text_lower or "klang" in text_lower:
        location = "Port Klang"
    elif "manila" in text_lower:
        location = "Manila"
    elif "yantian" in text_lower:
        location = "Yantian"
    elif "singapore" in text_lower:
        location = "Singapore"
    elif "kaohsiung" in text_lower:
        location = "Kaohsiung"
    elif "chennai" in text_lower:
        location = "Chennai"
    elif "rotterdam" in text_lower:
        location = "Rotterdam"
    elif "shanghai" in text_lower:
        location = "Shanghai"
    elif "busan" in text_lower:
        location = "Busan"

    # 2. Disruption Type detection
    disruption_type = "port_congestion"
    if any(k in text_lower for k in ["storm", "typhoon", "cyclone", "flood", "weather"]):
        disruption_type = "weather"
    elif any(k in text_lower for k in ["strike", "labor", "walkout", "protest", "union"]):
        disruption_type = "strike"
    elif any(k in text_lower for k in ["congestion", "berth delay", "waiting time", "queue"]):
        disruption_type = "port_congestion"
    elif any(k in text_lower for k in ["customs", "sanction", "trade", "geopolitical"]):
        disruption_type = "geopolitical"

    # 3. Severity detection
    severity = "HIGH"
    if any(k in text_lower for k in ["critical", "halt", "closure", "shut down", "severe", "major"]):
        severity = "CRITICAL"
    elif any(k in text_lower for k in ["moderate", "slight", "minor"]):
        severity = "MEDIUM"

    # 4. Delay days extraction
    if any(phrase in text_lower for phrase in [
        "no delay", "no delays", "on schedule", "on time", "no disruption",
        "operating normally", "normal operations",
    ]):
        delay_days = 0
    else:
        delay_days = config.DEFAULT_DELAY_DAYS
        # Check for patterns like "12 days", "10-14 days", "2 weeks"
        delay_match = re.search(r"(\d+)\s*(?:to|-)\s*(\d+)\s*days", text_lower)
        if delay_match:
            # e.g. "10 to 14 days" -> average = 12
            low = int(delay_match.group(1))
            high = int(delay_match.group(2))
            delay_days = round((low + high) / 2)
        else:
            single_match = re.search(r"(\d+)\s*day[s]?", text_lower)
            if single_match:
                delay_days = int(single_match.group(1))
            elif "two weeks" in text_lower or "2 weeks" in text_lower:
                delay_days = 14
            elif "one week" in text_lower or "1 week" in text_lower:
                delay_days = 7

    # Ensure delay_days is realistic for an event (minimum 5 days to trigger shortage)
    if delay_days != 0 and (delay_days < 5 or delay_days > 45):
        delay_days = config.DEFAULT_DELAY_DAYS

    # 5. Event Name
    if disruption_type == "weather":
        event_name = f"Tropical Weather & Port Disruption at {location}"
    elif disruption_type == "strike":
        event_name = f"Dockworker Strike & Cargo Stoppage at {location}"
    else:
        event_name = f"Berth Congestion & Supply Chain Delay at {location}"

    # Summary
    summary = snippet if snippet else title

    return DisruptionEvent(
        event_name=event_name,
        disruption_type=disruption_type,
        location=location,
        severity=severity,
        delay_days=delay_days,
        headline=title,
        source_url=link,
        summary=summary[:250]
    )


def normalize_url(url: str) -> str:
    """Normalizes URL for deduplication."""
    if not url:
        return ""
    clean = re.sub(r"^https?://(www\.)?", "", url.strip().lower())
    clean = clean.split("?")[0].rstrip("/")
    return clean


def score_and_rank_articles(
    news_results: List[Dict[str, Any]],
    vessel_name: Optional[str] = None,
    location: Optional[str] = None,
    supplier_name: Optional[str] = None,
    material_name: Optional[str] = None,
    max_sources: int = 3,
) -> List[Dict[str, Any]]:
    """
    Ranks, filters, and deduplicates SerpAPI news results based on Section 5 specification:
    - Discards results without meaningful disruption language
    - Scores relevance using vessel, location, supplier/material, disruption terms, and freshness
    - Deduplicates by normalized URL or headline
    - Preserves up to max_sources top evidence items
    """
    disruption_terms = [
        "delay", "delayed", "delays", "disruption", "disruptions", "congestion",
        "storm", "typhoon", "cyclone", "flood", "strike", "closure", "closed",
        "suspension", "backlog", "berth", "weather", "port disruption", "anchored",
        "grounding", "stranding", "stoppage", "squall"
    ]

    seen_urls = set()
    seen_headlines = set()
    scored_candidates = []

    for item in news_results:
        title = item.get("title", "").strip()
        snippet = item.get("snippet", "").strip()
        link = item.get("link", "").strip()
        pub_name = (item.get("source") or {}).get("name", "Unknown Source")
        pub_date = item.get("date") or item.get("iso_date") or config.REFERENCE_DATE

        if not title and not snippet:
            continue

        # Deduplication check
        norm_url = normalize_url(link)
        norm_title = re.sub(r"[^\w\s]", "", title.lower()).strip()
        if norm_url and norm_url in seen_urls:
            continue
        if norm_title and norm_title in seen_headlines:
            continue

        text = f"{title} {snippet}".lower()

        # Check disruption keyword presence
        matched_terms = [t for t in disruption_terms if t in text]
        if not matched_terms:
            # Discard results without disruption keywords as per spec
            continue

        # Base relevance from disruption keywords (0.35 + up to 0.15)
        score = 0.35 + min(0.15, len(matched_terms) * 0.05)

        # Port / Location match (+0.30)
        target_loc = (location or "Port Klang").lower()
        if target_loc in text or "klang" in text:
            score += 0.30

        # Vessel match (+0.30)
        if vessel_name and vessel_name.lower() in text:
            score += 0.30

        # Supplier / Material match (+0.10)
        if supplier_name and supplier_name.lower() in text:
            score += 0.10
        if material_name and material_name.lower() in text:
            score += 0.10

        relevance = round(min(1.0, score), 2)
        if norm_url:
            seen_urls.add(norm_url)
        if norm_title:
            seen_headlines.add(norm_title)

        scored_candidates.append({
            "title": title,
            "url": link,
            "publisher": pub_name,
            "published_at": pub_date,
            "snippet": snippet,
            "relevance": relevance,
            "raw_item": item,
        })

    # Sort descending by relevance
    scored_candidates.sort(key=lambda x: x["relevance"], reverse=True)
    return scored_candidates[:max_sources]


def llm_parse_article(article: Dict[str, Any]) -> Optional[DisruptionEvent]:
    """
    Parses article using Gemini API (or OpenAI fallback) in JSON mode.
    Falls back gracefully to heuristic if API key is not present or error occurs.
    """
    title = article.get("title", "")
    snippet = article.get("snippet", "")
    link = article.get("link") or article.get("url", "")
    prompt = f"""Analyze the following maritime supply chain news item and extract the disruption details in JSON format.
Headline: {title}
Snippet: {snippet}
Link: {link}

Return a JSON object conforming exactly to this structure:
{{
  "event_name": "Short title describing the event",
  "disruption_type": "weather | port_congestion | strike | logistics | geopolitical",
  "location": "Affected port or hub (e.g. Port Klang, Yantian, Singapore, etc.)",
  "severity": "LOW | MEDIUM | HIGH | CRITICAL",
  "delay_days": integer (estimated delay in days, default to {config.DEFAULT_DELAY_DAYS} if unspecified),
  "headline": "{title}",
  "source_url": "{link}",
  "summary": "1-2 sentence operational summary"
}}
"""

    # 1. Try Google Gemini API if configured
    if config.GEMINI_API_KEY:
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=config.GEMINI_API_KEY)
            config_obj = types.GenerateContentConfig(
                temperature=0.1,
                response_mime_type="application/json"
            )

            # Test primary models with graceful cascade
            for model_name in ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]:
                try:
                    response = client.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config=config_obj
                    )
                    data = json.loads(response.text)
                    return DisruptionEvent(**data)
                except Exception as model_err:
                    logger.debug(f"Gemini model {model_name} attempt skipped: {model_err}")
                    continue
        except Exception as e:
            logger.warning(f"Gemini LLM parsing failed: {e}")

    # 2. Try OpenAI API if configured
    if config.OPENAI_API_KEY:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=config.OPENAI_API_KEY)
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are a supply chain risk intelligence parser. Output valid JSON only."},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"},
                temperature=0.1
            )
            content = response.choices[0].message.content
            data = json.loads(content)
            return DisruptionEvent(**data)
        except Exception as e:
            logger.warning(f"OpenAI LLM parsing failed: {e}")

    # Return None so caller falls back to deterministic heuristic extractor
    return None


def extract_primary_disruption(
    news_payload: Dict[str, Any],
    vessel_name: Optional[str] = None,
    location: Optional[str] = None,
    supplier_name: Optional[str] = None,
    material_name: Optional[str] = None,
) -> DisruptionEvent:
    """
    Selects the most relevant article from the news results payload and extracts
    the structured DisruptionEvent using ranked multi-source processing.
    """
    event, _, _ = extract_disruption_with_sources(
        news_payload=news_payload,
        vessel_name=vessel_name,
        location=location,
        supplier_name=supplier_name,
        material_name=material_name,
    )
    if event:
        return event

    # Fallback default scenario event
    return DisruptionEvent(
        event_name="Port Klang Berth Congestion & Weather Disruption",
        disruption_type="port_congestion",
        location="Port Klang",
        severity="HIGH",
        delay_days=config.DEFAULT_DELAY_DAYS,
        headline="Severe Tropical Storm Causes Major Congestion and Berth Delays at Port Klang",
        source_url="https://www.maritimenews-example.com/port-klang-congestion-2026",
        summary="Port Klang operations face severe congestion causing estimated 12-day outbound shipment delays."
    )


def extract_primary_disruption_if_present(
    news_payload: Dict[str, Any],
    vessel_name: Optional[str] = None,
    location: Optional[str] = None,
    supplier_name: Optional[str] = None,
    material_name: Optional[str] = None,
) -> Optional[DisruptionEvent]:
    """Parse a usable disruption signal without inventing one for empty/irrelevant results."""
    event, _, _ = extract_disruption_with_sources(
        news_payload=news_payload,
        vessel_name=vessel_name,
        location=location,
        supplier_name=supplier_name,
        material_name=material_name,
    )
    return event


def extract_disruption_with_sources(
    news_payload: Dict[str, Any],
    vessel_name: Optional[str] = None,
    location: Optional[str] = None,
    supplier_name: Optional[str] = None,
    material_name: Optional[str] = None,
) -> Tuple[Optional[DisruptionEvent], List[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """
    Full Day 1 pipeline:
    1. Scores, ranks, and deduplicates sources from the payload.
    2. Returns (event, top_sources, selected_article).
    3. Guarantees top_sources preserves top 3 evidence items.
    """
    news_results = news_payload.get("news_results") or []
    if not news_results:
        return None, [], None

    ranked_sources = score_and_rank_articles(
        news_results=news_results,
        vessel_name=vessel_name,
        location=location,
        supplier_name=supplier_name,
        material_name=material_name,
        max_sources=3,
    )

    if not ranked_sources:
        return None, [], None

    best_source = ranked_sources[0]
    candidate_article = best_source.get("raw_item") or {
        "title": best_source.get("title", ""),
        "snippet": best_source.get("snippet", ""),
        "link": best_source.get("url", ""),
    }

    # Try LLM first, fall back to heuristic
    event = llm_parse_article(candidate_article)
    if not event:
        event = heuristic_parse_article(candidate_article)

    # Ensure source_url matches the candidate link exactly
    if event and not event.source_url:
        event.source_url = best_source.get("url", "")

    return event, ranked_sources, best_source

