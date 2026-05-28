import asyncio
from main import _classify_use_case
import os
from dotenv import load_dotenv

load_dotenv('.env')

async def main():
    print(f'Anthropic Key Set: {bool(os.getenv("ANTHROPIC_API_KEY"))}')
    print(f'OpenAI Key Set: {bool(os.getenv("OPENAI_API_KEY"))}')
    prompt1 = "A cinematic shot of a samurai standing in the rain, moody lighting"
    prompt2 = "A crisp commercial photo of a new sports shoe on a white background"
    p1 = await _classify_use_case(prompt1)
    p2 = await _classify_use_case(prompt2)
    print(f'Prompt 1 ({prompt1}) -> {p1}')
    print(f'Prompt 2 ({prompt2}) -> {p2}')

if __name__ == '__main__':
    asyncio.run(main())
