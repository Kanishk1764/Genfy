import asyncio
from main import _build_nanobanana_enhanced_prompt, AUTHENTIC_PHOTOREALISM_FOUNDATION, AUTHENTIC_NEGATIVE_FOUNDATION, UNIVERSAL_PHOTOREALISM_FOUNDATION, UNIVERSAL_NEGATIVE_FOUNDATION
import os
from dotenv import load_dotenv

load_dotenv('.env')

async def main():
    prompt = "A stylish young woman standing in a bright sunlit city street wearing a beige trench coat and white sneakers, holding a takeaway coffee cup, medium full-body shot, candid lifestyle photography, natural daylight."
    
    enhanced_prompt, detected_pipeline = await _build_nanobanana_enhanced_prompt(prompt, "Standard", True)
    
    if detected_pipeline == "AUTHENTIC":
        final_prompt = f"{enhanced_prompt}, {AUTHENTIC_PHOTOREALISM_FOUNDATION}, {AUTHENTIC_NEGATIVE_FOUNDATION}"
    else:
        final_prompt = f"{enhanced_prompt}, {UNIVERSAL_PHOTOREALISM_FOUNDATION}, {UNIVERSAL_NEGATIVE_FOUNDATION}"
        
    print(f"\n--- FINAL PROMPT ---\n{final_prompt}\n--------------------")

if __name__ == '__main__':
    asyncio.run(main())
