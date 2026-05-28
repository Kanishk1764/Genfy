import asyncio
from backend.main import _classify_prompt, ANTHROPIC_API_KEY, OPENAI_API_KEY
import os
from dotenv import load_dotenv

load_dotenv('backend/.env')

async def main():
    print(f'Anthropic Key Set: {bool(os.getenv("ANTHROPIC_API_KEY"))}')
    print(f'OpenAI Key Set: {bool(os.getenv("OPENAI_API_KEY"))}')
    prompt1 = "A cinematic shot of a samurai standing in the rain, moody lighting"
    prompt2 = "A crisp commercial photo of a new sports shoe on a white background"
    p1 = await _classify_prompt(prompt1)
    p2 = await _classify_prompt(prompt2)
    print(f'Prompt 1 ({prompt1}) -> {p1}')
    print(f'Prompt 2 ({prompt2}) -> {p2}')

if __name__ == '__main__':
    asyncio.run(main())
