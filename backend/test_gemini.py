import asyncio
from google import genai
from google.genai import types
import os

PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "genfy-ai")

async def test():
    client = genai.Client(vertexai=True, project=PROJECT_ID, location="global")
    response = await asyncio.to_thread(
        client.models.generate_content,
        model="gemini-3.1-flash-image",
        contents=["A kid on a slide"],
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            image_config=types.ImageConfig(
                aspect_ratio="21:9",
                image_size="4K",
            ),
        ),
    )
    for i, part in enumerate(response.candidates[0].content.parts):
        is_thought = getattr(part, 'thought', False)
        # get size
        sz = len(part.inline_data.data) if part.inline_data else 0
        print(f"Part {i}: thought={is_thought}, size={sz}")

asyncio.run(test())
