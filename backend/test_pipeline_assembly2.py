import asyncio
from main import _build_nanobanana_enhanced_prompt, AUTHENTIC_PHOTOREALISM_FOUNDATION, AUTHENTIC_NEGATIVE_FOUNDATION, UNIVERSAL_PHOTOREALISM_FOUNDATION
import os
from dotenv import load_dotenv

load_dotenv('.env')

async def main():
    prompt = "A stylish young woman standing in a bright sunlit city street wearing a beige trench coat"
    enhanced_prompt, detected_pipeline = await _build_nanobanana_enhanced_prompt(prompt, "Standard", True)
    print("=== ASSEMBLED PROMPT & PIPELINE ===")
    print(f"Detected Pipeline: {detected_pipeline}")
    
    if detected_pipeline == "AUTHENTIC":
        final_full = f"{enhanced_prompt}, {AUTHENTIC_PHOTOREALISM_FOUNDATION}, {AUTHENTIC_NEGATIVE_FOUNDATION}"
    else:
        final_full = f"{enhanced_prompt}, {UNIVERSAL_PHOTOREALISM_FOUNDATION}"
        
    print(f"Total Final Length: {len(final_full)} chars")
    print("Contains AUTHENTIC Foundation:", "genuine skin with natural micro-detail" in final_full)
    print("Contains Commercial Retouching in Authentic:", "commercial retouching standard" in AUTHENTIC_PHOTOREALISM_FOUNDATION)

if __name__ == '__main__':
    asyncio.run(main())
