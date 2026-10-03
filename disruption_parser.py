"""
Disruption News Parsing & Information Extraction Module.

Extracts structured DisruptionEvent objects from news articles using either:
1. LLM JSON Mode (if OPENAI_API_KEY or GEMINI_API_KEY is available)
2. Heuristic Rule-Based Extractor (offline, deterministic fallback)
"""
import re
import json
import logging
from typing import Dict, Any, List, Optional
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
    location = "Port Klang"  # Default canonical scenario hub
    if "port klang" in text_lower or "klang" in text_lower:
        location = "Port Klang"
    elif "yantian" in text_lower:
        location = "Yantian"
    elif "singapore" in text_lower:
        location = "Singapore"
    elif "kaohsiung" in text_lower:
        location = "Kaohsiung"
    elif "chennai" in text_lower:
        location = "Chennai"

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
    if delay_days < 5 or delay_days > 45:
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


def llm_parse_article(article: Dict[str, Any]) -> Optional[DisruptionEvent]:
    """
    Parses article using OpenAI API in JSON mode if configured.
    Falls back to heuristic if API key is not present or error occurs.
    """
    if not config.OPENAI_API_KEY:
        return None

    try:
        from openai import OpenAI
        client = OpenAI(api_key=config.OPENAI_API_KEY)

        title = article.get("title", "")
        snippet = article.get("snippet", "")
        link = article.get("link", "")

        prompt = f"""
Analyze the following maritime supply chain news item and extract the disruption details in JSON format.
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
        logger.warning(f"LLM parsing failed, falling back to heuristic: {e}")
        return None


def extract_primary_disruption(news_payload: Dict[str, Any]) -> DisruptionEvent:
    """
    Selects the most relevant article from the news results payload and extracts
    the structured DisruptionEvent.
    """
    news_results = news_payload.get("news_results", [])
    if not news_results:
        # Fallback to default scenario event
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

    # Search for an article that explicitly mentions key hubs or disruption words
    candidate = news_results[0]
    for item in news_results:
        text = f"{item.get('title', '')} {item.get('snippet', '')}".lower()
        if "port klang" in text or "klang" in text or "congestion" in text or "storm" in text:
            candidate = item
            break

    # Try LLM first if available, otherwise heuristic
    event = llm_parse_article(candidate)
    if not event:
        event = heuristic_parse_article(candidate)

    return event
