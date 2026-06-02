import asyncio
from main import _build_nanobanana_enhanced_prompt
import os
from dotenv import load_dotenv

load_dotenv('.env')

async def main():
    prompt = "Close-up beauty campaign headshot of a stunning young woman with soft wavy brown hair and expressive hazel eyes, smiling softly, flawless smooth luminous skin, silk porcelain complexion, subtle nude lip gloss, soft natural window light, shot on Hasselblad X2D with 90mm f/2.5 portrait lens, cosmetics advertisement."
    
    enhanced_prompt, detected_pipeline = await _build_nanobanana_enhanced_prompt(prompt, "Standard", True)
    
    print(f"\n--- DETECTED PIPELINE ---\n{detected_pipeline}")
    print(f"\n--- ENHANCED PROMPT ---\n{enhanced_prompt}\n--------------------")

if __name__ == '__main__':
    asyncio.run(main())
