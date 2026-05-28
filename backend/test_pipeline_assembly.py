import asyncio
from main import _build_nanobanana_enhanced_prompt, AUTHENTIC_PHOTOREALISM_FOUNDATION, UNIVERSAL_PHOTOREALISM_FOUNDATION
import os
from dotenv import load_dotenv

load_dotenv('.env')

async def main():
    # Test AUTHENTIC pipeline
    prompt1 = "A stylish young woman standing in a bright sunlit city street wearing a beige trench coat"
    result1, pipeline1 = await _build_nanobanana_enhanced_prompt(prompt1, "Standard", True)
    print(f"=== AUTHENTIC TEST ===")
    print(f"Pipeline: {pipeline1}")
    print(f"Contains BETA_SKIN_V3: {'healthy clear skin' in result1 or 'subsurface light scattering' in result1}")
    print(f"Contains BETA_SHARPNESS_V3: {'eye autofocus tracking' in result1}")
    print(f"Contains 'commercial retouching': {'commercial retouching' in result1}")
    print(f"Prompt length: {len(result1)} chars")
    print()

    # Test PORTRAIT pipeline
    prompt2 = "Close-up beauty headshot of a woman smiling softly near a window"
    result2, pipeline2 = await _build_nanobanana_enhanced_prompt(prompt2, "Standard", True)
    print(f"=== PORTRAIT TEST ===")
    print(f"Pipeline: {pipeline2}")
    print(f"Contains BETA_SKIN_V3: {'healthy clear skin' in result2 or 'subsurface light scattering' in result2}")
    print(f"Contains BETA_SHARPNESS_V3: {'eye autofocus tracking' in result2}")
    print(f"Prompt length: {len(result2)} chars")
    print()

    # Test COMMERCIAL pipeline
    prompt3 = "A luxury silver watch on a white marble surface, product photography"
    result3, pipeline3 = await _build_nanobanana_enhanced_prompt(prompt3, "Standard", True)
    print(f"=== COMMERCIAL TEST ===")
    print(f"Pipeline: {pipeline3}")
    print(f"Prompt length: {len(result3)} chars")

if __name__ == '__main__':
    asyncio.run(main())
