import asyncio
from main import _optimize_with_gpt
import os
from dotenv import load_dotenv

load_dotenv('.env')

async def main():
    prompt = "A cinematic shot of a samurai standing in the rain, moody lighting"
    opt = await _optimize_with_gpt(prompt, "CINEMATIC")
    print(f'Original: {prompt}')
    print(f'Optimized: {opt}')

if __name__ == '__main__':
    asyncio.run(main())
