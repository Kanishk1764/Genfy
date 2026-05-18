import base64
from urllib.parse import urlparse, parse_qs
from typing import Optional

import httpx


async def materialize_image_url(url: Optional[str]) -> Optional[str]:
    """Convert remote image URLs into durable data URIs when possible."""
    if not url:
        return url
    if url.startswith("data:image"):
        return url
    if not url.startswith(("http://", "https://")):
        return url

    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    # Signed delivery URLs are often time-limited and cannot be safely refetched.
    if "delivery.eu2.bfl.ai" in parsed.netloc or "sig" in query or "se" in query:
        return url

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "image/png").split(";")[0].strip() or "image/png"
            b64 = base64.b64encode(resp.content).decode("ascii")
            return f"data:{content_type};base64,{b64}"
    except Exception as e:
        return url
