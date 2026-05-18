import os
import asyncio
from dotenv import load_dotenv
import fal_client

DEFAULT_VEO_NEGATIVE_PROMPT = (
    "morphing faces, melting facial features, distorted anatomy, extra limbs, extra arms, extra hands, "
    "missing fingers, mutated fingers, fused fingers, multiple bodies, jittery frame, flickering, "
    "frame tearing, sudden jump cuts, stuttering, floating artifacts, ghosting, warped background geometry, "
    "unnatural robotic movement, jerky motion, digital glitch, low resolution, blurry, text overlay, watermark, subtitles"
)

def get_fal_key() -> str:
    """Retrieve FAL_KEY from environment, refreshing from .env if needed."""
    key = os.environ.get("FAL_KEY")
    if not key:
        load_dotenv(override=True)
        key = os.environ.get("FAL_KEY")
    return key or ""

def prepare_image_for_fal(image_path: str) -> str:
    """
    Ensure the image is a public URL accessible to fal.ai.
    If it's already an http(s) URL, return as-is.
    If it's a local file path, upload using fal_client.upload_file.
    """
    if not image_path:
        raise ValueError("Image path is empty")
        
    if image_path.startswith("http://") or image_path.startswith("https://"):
        return image_path
    
    # Resolve local path
    abs_path = image_path
    if not os.path.isabs(abs_path):
        backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        abs_path = os.path.join(backend_dir, image_path)
    
    if not os.path.exists(abs_path):
        raise FileNotFoundError(f"Local frame image not found at: {abs_path}")
        
    print(f"[FalVeo] Uploading local image to fal storage: {abs_path}")
    url = fal_client.upload_file(abs_path)
    print(f"[FalVeo] Uploaded successfully: {url}")
    return url

def normalize_duration(duration: any) -> str:
    """Normalize duration to valid Google Veo 3.1 enum: '4s', '6s', '8s'."""
    s = str(duration).strip().lower().replace("s", "")
    try:
        val = int(s)
        if val <= 4:
            return "4s"
        elif val <= 6:
            return "6s"
        else:
            return "8s"
    except Exception:
        return "6s"

def generate_veo_single_frame(
    image_path: str,
    prompt: str,
    duration: any = 6,
    aspect_ratio: str = "16:9",
    negative_prompt: str = "",
    resolution: str = "1080p",
    generate_audio: bool = True,
    model_tier: str = "fast"
) -> str:
    """
    Animate a single image using Google Veo 3.1 on Fal.ai with quality guardrails and high resolution.
    Returns the generated MP4 video URL.
    """
    key = get_fal_key()
    if not key:
        raise ValueError("FAL_KEY is missing. Please add FAL_KEY=your_key to backend/.env")
    os.environ["FAL_KEY"] = key

    image_url = prepare_image_for_fal(image_path)
    
    duration_str = normalize_duration(duration)
    res = (resolution or "1080p").lower()
    if res not in ["720p", "1080p"]:
        res = "1080p"

    neg_prompt = (negative_prompt or "").strip() or DEFAULT_VEO_NEGATIVE_PROMPT

    arguments = {
        "prompt": prompt or "Action: Natural lifelike subtle motion. Style: Photorealistic cinematic commercial. Camera motion: Gentle smooth cinematic camera drift. Ambiance: Natural lighting, realistic physics.",
        "negative_prompt": neg_prompt,
        "image_url": image_url,
        "duration": duration_str,
        "resolution": res,
        "aspect_ratio": aspect_ratio if aspect_ratio in ["16:9", "9:16", "auto"] else "16:9",
        "generate_audio": bool(generate_audio),
        "safety_tolerance": "4",
        "auto_fix": True,
    }

    if model_tier == "flagship":
        endpoints_to_try = [
            "fal-ai/veo3.1/image-to-video",
            "fal-ai/veo3.1/lite/image-to-video",
            "fal-ai/veo3.1/fast/image-to-video",
        ]
    else:
        # Lite tier default
        endpoints_to_try = [
            "fal-ai/veo3.1/lite/image-to-video",
            "fal-ai/veo3.1/fast/image-to-video",
            "fal-ai/veo3.1/image-to-video",
        ]
    
    last_err = None
    for endpoint in endpoints_to_try:
        try:
            print(f"[FalVeo] Subscribing to {endpoint} (duration={duration_str}, resolution={res}, audio={generate_audio})...")
            result = fal_client.subscribe(
                endpoint,
                arguments=arguments,
                with_logs=True,
            )
            print(f"[FalVeo] Result from {endpoint}: {result}")
            if isinstance(result, dict):
                video_obj = result.get("video")
                if isinstance(video_obj, dict) and "url" in video_obj:
                    return video_obj["url"]
                if "url" in result and isinstance(result["url"], str) and result["url"].startswith("http"):
                    return result["url"]
                for v in result.values():
                    if isinstance(v, dict) and "url" in v:
                        return v["url"]
            raise ValueError(f"Could not extract video URL from response: {result}")
        except Exception as e:
            print(f"[FalVeo] Error with {endpoint}: {e}")
            last_err = e
            continue
            
    raise last_err or RuntimeError("Failed to generate video with Veo 3.1")

def generate_veo_transition(
    first_frame_path: str,
    last_frame_path: str,
    prompt: str,
    duration: any = 6,
    aspect_ratio: str = "16:9",
    negative_prompt: str = "",
    resolution: str = "1080p",
    generate_audio: bool = True,
    model_tier: str = "fast"
) -> str:
    """
    Generate transition animation interpolating between two frames using Google Veo 3.1 on Fal.ai.
    Uses quality guardrails, 1080p/4k resolution, and structured prompt parameters.
    Returns the generated MP4 video URL.
    """
    key = get_fal_key()
    if not key:
        raise ValueError("FAL_KEY is missing. Please add FAL_KEY=your_key to backend/.env")
    os.environ["FAL_KEY"] = key

    first_url = prepare_image_for_fal(first_frame_path)
    last_url = prepare_image_for_fal(last_frame_path)

    duration_str = normalize_duration(duration)
    res = (resolution or "1080p").lower()
    if res not in ["720p", "1080p"]:
        res = "1080p"

    neg_prompt = (negative_prompt or "").strip() or DEFAULT_VEO_NEGATIVE_PROMPT

    arguments = {
        "prompt": prompt or "Action: Seamless continuous transition connecting first and last frame. Style: Photorealistic cinematic commercial. Camera motion: Fluid continuous camera move. Ambiance: Consistent lighting and environment.",
        "negative_prompt": neg_prompt,
        "first_frame_url": first_url,
        "last_frame_url": last_url,
        "duration": duration_str,
        "resolution": res,
        "aspect_ratio": aspect_ratio if aspect_ratio in ["16:9", "9:16", "auto"] else "16:9",
        "generate_audio": bool(generate_audio),
        "safety_tolerance": "4",
        "auto_fix": True,
    }

    if model_tier == "flagship":
        endpoints_to_try = [
            "fal-ai/veo3.1/first-last-frame-to-video",
            "fal-ai/veo3.1/lite/first-last-frame-to-video",
            "fal-ai/veo3.1/fast/first-last-frame-to-video",
        ]
    else:
        # Lite tier default
        endpoints_to_try = [
            "fal-ai/veo3.1/lite/first-last-frame-to-video",
            "fal-ai/veo3.1/fast/first-last-frame-to-video",
            "fal-ai/veo3.1/first-last-frame-to-video",
        ]

    last_err = None
    for endpoint in endpoints_to_try:
        try:
            print(f"[FalVeo] Subscribing to {endpoint} (duration={duration_str}, resolution={res}, audio={generate_audio})...")
            result = fal_client.subscribe(
                endpoint,
                arguments=arguments,
                with_logs=True,
            )
            print(f"[FalVeo] Result from {endpoint}: {result}")
            if isinstance(result, dict):
                video_obj = result.get("video")
                if isinstance(video_obj, dict) and "url" in video_obj:
                    return video_obj["url"]
                if "url" in result and isinstance(result["url"], str) and result["url"].startswith("http"):
                    return result["url"]
                for v in result.values():
                    if isinstance(v, dict) and "url" in v:
                        return v["url"]
            raise ValueError(f"Could not extract video URL from response: {result}")
        except Exception as e:
            print(f"[FalVeo] Error with {endpoint}: {e}")
            last_err = e
            continue

    raise last_err or RuntimeError("Failed to generate transition video with Veo 3.1")


async def synthesize_director_transition_prompt(
    start_prompt: str,
    end_prompt: str,
    character_context: str = "",
    product_context: str = "",
    duration_seconds: any = 6,
    style_preference: str = "natural_action"
) -> dict:
    """
    Uses Gemini to synthesize a structured 4-part cinematic director prompt connecting Frame A to Frame B.
    Follows Google Veo 3.1's optimal prompt structure:
      Action: ...
      Style: ...
      Camera motion: ...
      Ambiance: ...
    """
    import main
    from google.genai import types as genai_types

    gemini_client = getattr(main, 'flash_client', None) or getattr(main, 'global_client', None)
    if not gemini_client:
        return {
            "director_prompt": f"Action: The subject performs a continuous, natural movement connecting {start_prompt} smoothly into {end_prompt}. Style: Photorealistic cinematic commercial, natural physics. Camera motion: Elegant steady dolly-in and tilt to match the movement. Ambiance: Consistent lighting, color temperature, and atmospheric details.",
            "negative_prompt": DEFAULT_VEO_NEGATIVE_PROMPT
        }

    system_instruction = (
        "You are an expert Hollywood Cinematographer and AI Video Motion Director specializing in Google Veo 3.1 video generation. "
        "Your task is to write a structured, high-precision cinematic transition prompt that bridges two keyframes (Start Frame -> End Frame). "
        "According to official Google Veo 3.1 documentation, the model generates the highest quality output when prompts are structured into four explicit sections: "
        "Action: (Detailed physical movement of the subject and character hands/body/gaze moving from Pose 1 to Pose 2) "
        "Style: (Photorealistic cinematic, physics-aware, natural movement, no morphing) "
        "Camera motion: (Exact camera trajectory, e.g. continuous smooth dolly-in, tracking pan, tilt down, focus pull) "
        "Ambiance: (Lighting continuity, environment, atmosphere, reflections) "
        "Make sure the prompt is between 50 and 90 words total. "
        "Output ONLY valid JSON with keys 'director_prompt' and 'negative_prompt'."
    )

    dur_str = normalize_duration(duration_seconds)
    user_query = f"""
START FRAME:
"{start_prompt}"

END FRAME:
"{end_prompt}"

CHARACTER CONTEXT:
"{character_context or 'Consistent character identity across frames'}"

PRODUCT / PROP CONTEXT:
"{product_context or 'Consistent props across frames'}"

DURATION: {dur_str}
CHOREOGRAPHY STYLE PREFERENCE: {style_preference}

Generate the optimal structured 4-part prompt (Action:, Style:, Camera motion:, Ambiance:) and customized negative prompt in JSON format:
{{"director_prompt": "Action: ... Style: ... Camera motion: ... Ambiance: ...", "negative_prompt": "..."}}
"""

    try:
        response = await asyncio.to_thread(
            gemini_client.models.generate_content,
            model="gemini-2.5-flash",
            contents=user_query,
            config=genai_types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.3,
                response_mime_type="application/json"
            )
        )
        raw_text = response.text.strip()
        import json
        data = json.loads(raw_text)
        prompt = data.get("director_prompt", "").strip()
        neg = data.get("negative_prompt", "").strip() or DEFAULT_VEO_NEGATIVE_PROMPT
        return {"director_prompt": prompt, "negative_prompt": neg}
    except Exception as e:
        print(f"[FalVeo Director] AI synthesis fallback: {e}")
        return {
            "director_prompt": f"Action: The subject naturally shifts focus and physical posture from '{start_prompt}' into '{end_prompt}'. Style: Photorealistic cinematic commercial, natural physics. Camera motion: Smooth steady dolly-in and tilt tracking the action. Ambiance: Consistent warm lighting, polished surfaces, stable environment.",
            "negative_prompt": DEFAULT_VEO_NEGATIVE_PROMPT
        }


