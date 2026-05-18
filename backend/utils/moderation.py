"""
Content Safety & NSFW Moderation Module for Genfy.

Two-tier guardrail:
  Tier 1 — Instant local keyword/regex filter  (< 1 ms, $0, no network).
  Tier 2 — OpenAI omni-moderation-latest       (~150 ms, $0, multimodal image+text).

Usage:
    from utils.moderation import check_prompt_keywords, check_image_moderation

    # Tier 1 (always, < 1ms)
    is_safe, reason = check_prompt_keywords(prompt)

    # Tier 2 (only when an image is present, ~150ms)
    is_safe, reason = await check_image_moderation(image_b64_or_url)
"""

import asyncio
import base64
import os
import re
from typing import Optional, Tuple, Union

# ── TIER 1: LOCAL KEYWORD BLOCKLIST ──────────────────────────────────────────
# These are *unambiguous* illicit terms. We use word boundaries (\b) to avoid
# false-positives on innocent words (e.g. "cocktail", "therapist", "scunthorpe").
# The list focuses on explicit sexual, CSAM, extreme violence, and non-consensual terms.

_BLOCKED_TERMS = [
    # ── Nudity, Bare Bodies & Exhibition ──
    r"naked(?!\s*(?:eye|truth|mole\s*rat|flame|wire))",
    r"nakedness",
    r"(?<!statue\s)(?<!statue\sof\s)(?<!statue\sof\sa\s)nude(?!\s*(?:lipstick|makeup|cosmetics|palette|shade|tint|tones?|color|shoes|heels|sandals|boots|leather|dress|suit|fabric|canvas|painting\s*study|drawing\s*study|statue|sculpture|male\s*athlete|female\s*figure|figure|model\s*in\s*art|in\s*an?\s*(?:ancient\s*)?(?:greek|roman)?\s*museum))",
    r"nudity",
    r"nudist(?:s)?",
    r"topless",
    r"bottomless",
    r"unclothed",
    r"undressed",
    r"disrobed",
    r"no\s*clothes",
    r"without\s*(?:any\s*)?clothes",
    r"not\s*wearing\s*(?:any\s*)?clothes",
    r"clothes\s*off",
    r"take\s*(?:off\s*)?(?:all\s*)?(?:her|his|their|your)?\s*clothes",
    r"breastfeed(?:ing)?",
    r"lactat(?:e|ion|ing)",
    r"in\s*the\s*buff",
    r"birthday\s*suit",
    r"au\s*naturel",
    r"bare\s*(?:breasts?|boobs?|ass|butt|bottom|tits?|genitals?|nipples?)",
    r"striptease",
    r"stripper(?:s)?",
    r"strip\s*club(?:s)?",
    r"pole\s*danc(?:er|ing)\s*(?:nude|naked|erotic|sexy)",
    r"lap\s*dance(?:r|s|ing)?",
    r"peep\s*show(?:s)?",
    r"flashing\s*(?:breasts?|boobs?|tits?|genitals?)",
    r"exhibitionis(?:m|t)",
    r"voyeur(?:ism|istic)?",

    # ── Explicit Sexual Acts, Positions & Fetishes ──
    r"cuckold(?:ing|ed|s)?",
    r"cuck(?:s)?(?!\s*oo)",
    r"hotwife(?:s)?",
    r"wife\s*sharing",
    r"bull\s*(?:cuckold|fetish)",
    r"sex(?!\s*(?:pistols|ed|education))",
    r"having\s*sex",
    r"rough\s*sex",
    r"group\s*sex",
    r"casual\s*sex",
    r"cybersex",
    r"sexually?\s*explicit",
    r"explicit\s*(?:sexual|scene|act|acts|activity|content|nudity)",
    r"sexual\s*(?:intercourse|act|acts|activity|desire|pleasure|content|relations?|encounter)",
    r"intercourse",
    r"copulat(?:e|ion|ing)",
    r"fornicat(?:e|ion|ing)",
    r"coitus",
    r"masturbat(?:e|ion|ing|or|ors)?",
    r"wank(?:ing|er|ers)?",
    r"jerk(?:ing)?\s*off",
    r"jack(?:ing)?\s*off",
    r"fingering\s*(?:pussy|vagina|ass|girl|woman)",
    r"circlejerk",
    r"penetrat(?:e|ion|ing)",
    r"double\s*penetration",
    r"\bdp\b\s*(?:scene|sex|porn)",
    r"orgasm(?:s)?",
    r"ejaculat(?:e|ion|ing)",
    r"threesome(?:s)?",
    r"foursome(?:s)?",
    r"orgy",
    r"orgies",
    r"swinger(?:s)?",
    r"menage\s*a\s*trois",
    r"gangbang",
    r"bukkake",
    r"creampie(?:s)?",
    r"deepthroat(?:ing)?",
    r"throatpie",
    r"blowjob(?:s)?",
    r"handjob(?:s)?",
    r"giving\s*head",
    r"sucking\s*(?:cock|dick)",
    r"eating\s*out\s*(?:pussy|her)",
    r"cunnilingus",
    r"fellatio",
    r"anilingus",
    r"rimjob(?:s|bing)?",
    r"pegging",
    r"cum\s*(?:shot|face|inside|swap|ming|load|dump|slut|gutter)?",
    r"cumming",
    r"squirting\s*(?:orgasm|pussy|girl|woman|porn)",
    r"anal\s*(?:sex|penetration|intercourse|creampie|play|beads?|plug)?",
    r"sodomy",
    r"butt\s*sex",
    r"oral\s*(?:sex|penetration)?",
    r"(?<!non[\s\-])(?<!not\s)(?<!no\s)erotic(?:a)?",
    r"(?<!non[\s\-])(?<!not\s)(?<!no\s)erotic\s*(?:nude|naked|sex|massage|photo|art|scene|dance)",
    r"fondling\s*(?:breasts?|boobs?|groin|pussy|penis|crotch)",

    # ── Anatomy & Explicit Genital Slang ──
    r"penis(?:es)?",
    r"phallus",
    r"phallic",
    r"erection",
    r"boner(?:s)?",
    r"hard\s*on",
    r"cock(?!\s*(?:tail|pit|chafer|atoo|atrice))",
    r"dick(?!\s*(?:grayson|tracy|van\s*dyke|clark|cheney|ensian|inson))",
    r"schlong",
    r"meat\s*stick",
    r"testicles?",
    r"scrotum",
    r"ballsack",
    r"nutsack",
    r"vagina(?:s)?",
    r"vulva(?:s)?",
    r"clitoris",
    r"clit",
    r"labia",
    r"pussy(?!\s*(?:cat|willow|foot))",
    r"cunt(?:s)?",
    r"cameltoe",
    r"snatch\s*(?:pussy|naked|sex)",
    r"coochie",
    r"cooter",
    r"twat",
    r"genitals?",
    r"genitalia",
    r"pubic(?!\s*hair)?",
    r"crotch\s*(?:shot|grab|touch)",
    r"tits",
    r"titties",
    r"boobs",
    r"boobies",
    r"knockers\s*(?:breasts|boobs|porn)",
    r"sideboob",
    r"underboob",
    r"nipples?(?!\s*(?:bottle|baby|shield))",
    r"areola(?:s)?",
    r"asshole",
    r"anus",
    r"butthole",
    r"butt\s*plug(?:s)?",
    r"dildo(?:s)?",
    r"vibrator(?:s)?",
    r"fleshlight(?:s)?",
    r"sex\s*toy(?:s)?",
    r"chastity\s*cage",
    r"cock\s*ring(?:s)?",
    r"strap-?on",
    r"ball\s*gag(?:ged)?",

    # ── BDSM, Kink & Fetish ──
    r"bdsm",
    r"bondage",
    r"shibari",
    r"rope\s*bondage",
    r"dominatrix",
    r"femdom",
    r"maledom",
    r"sadomasochis(?:m|t)",
    r"spanking\s*(?:ass|bare|erotic|nude)",
    r"flogging\s*(?:erotic|fetish|naked)",
    r"breathplay",
    r"gimp\s*suit",
    r"leather\s*harness\s*(?:fetish|nude|bondage)",
    r"latex\s*fetish",
    r"foot\s*fetish",
    r"foot\s*worship",
    r"watersports\s*(?:fetish|sex|porn)",
    r"golden\s*shower(?:s)?",
    r"scat\s*(?:fetish|porn|sex)",
    r"findom",
    r"netorare",
    r"\bntr\b",
    r"furry\s*(?:porn|yiff|yiffing)",

    # ── Pornography, Prostitution & Adult Media ──
    r"porn",
    r"porno",
    r"pornograph(?:y|ic)",
    r"pornstar(?:s)?",
    r"xxx(?:\s*rated)?",
    r"nsfw",
    r"smut",
    r"hentai",
    r"ecchi",
    r"ahegao",
    r"futanari",
    r"tentacle\s*porn",
    r"rule\s*34",
    r"doujinshi\s*(?:18\+|r18|h)",
    r"\br18\b",
    r"camgirl(?:s)?",
    r"onlyfans",
    r"chaturbate",
    r"pornhub",
    r"xvideos",
    r"brazzers",
    r"playboy\s*(?:mansion|bunny\s*nude|magazine)",
    r"penthouse\s*(?:pet|magazine)",
    r"milf(?:s)?",
    r"dilf(?:s)?",
    r"shemale(?:s)?",
    r"ladyboy(?:s)?",
    r"prostitut(?:e|ion|es)",
    r"hooker(?:s)?",
    r"brothel(?:s)?",
    r"call\s*girl(?:s)?",
    r"escort\s*service\s*(?:sex|erotic)",
    r"sugar\s*baby\s*(?:sex|erotic)",
    r"sugar\s*daddy\s*(?:sex|erotic)",
    r"whore(?:s)?",
    r"slut(?:s|ty)?",

    # ── CSAM / Minors (Zero Tolerance) ──
    r"child\s*(?:porn|sex|nude|naked|erotic|abuse|molestation)",
    r"underage\s*(?:sex|nude|naked|erotic|girl|boy|teen|dating)",
    r"(?:pre\s*)?teen\s*(?:nude|naked|sex|porn|erotic)",
    r"loli(?:con)?",
    r"shota(?:con)?",
    r"lolita\s*(?:sex|porn|nude|erotic)",
    r"(?:minor|kid|child|infant|baby|toddler|kindergarten|elementary\s*school)\s*(?:in\s*)?(?:lingerie|bikini|underwear|thong|panties|bra|nude|naked)",
    r"jailbait",
    r"pedophil(?:e|ia|ic|es)",
    r"pederasty",
    r"hebephil(?:e|ia|ic)",
    r"ephebophil(?:e|ia|ic)",
    r"youth\s*(?:nude|naked|sex|erotic)",

    # ── Non-consensual / Assault & Exploitation ──
    r"rape(?:d|s|ing)?(?!\s*seed)",
    r"rapist(?:s)?",
    r"gang\s*rape",
    r"statutory\s*rape",
    r"date\s*rape",
    r"sexual\s*assault",
    r"sex\s*trafficking",
    r"forced\s*(?:sex|intercourse|penetration|strip|nudity)",
    r"non\s*-?\s*consensual\s*(?:sex|intercourse)",
    r"nonconsensual",
    r"groping",
    r"molest(?:ation|ed|ing|er|ers)?",
    r"revenge\s*porn",
    r"blackmail\s*(?:nude|sex)",
    r"snuff\s*(?:film|video|porn|movie)",
    r"sexual\s*murder",
    r"necrophil(?:e|ia|ic)",

    # ── Extreme Gore, Mutilation & Graphic Violence ──
    r"dismember(?:ment|ed|ing)?",
    r"decapitat(?:e|ed|ion|ing)",
    r"beheading(?:s)?",
    r"severed\s*head",
    r"mutilat(?:e|ed|ion|ing)",
    r"eviscerat(?:e|ed|ion|ing)",
    r"disembowel(?:ment|ed|ing)?",
    r"drawn\s*and\s*quartered",
    r"flaying",
    r"skinning\s*alive",
    r"crushed\s*skull",
    r"torture\s*(?:porn|chamber|victim)",
    r"gore\s*(?:porn|fetish|graphic)",

    # ── Bestiality & Incest ──
    r"bestiality",
    r"zoophil(?:e|ia|ic)",
    r"animal\s*(?:sex|porn|intercourse)",
    r"dog\s*sex",
    r"horse\s*sex",
    r"incest\s*(?:porn|sex|video|taboo)?",
    r"twincest",
    r"stepmom\s*(?:sex|porn|stuck)",
    r"stepsister\s*(?:sex|porn|stuck)",

    # ── Illicit Drug Manufacturing & Weapons of Mass Destruction ──
    r"how\s*to\s*(?:make|cook|synthesize|manufacture)\s*(?:meth|methamphetamine|fentanyl|heroin|cocaine|crack|lsd|dmt)",
    r"how\s*to\s*(?:make|build|construct|assemble)\s*(?:a\s*)?(?:bomb|explosive|ied|pipe\s*bomb|dirty\s*bomb|suicide\s*vest)",
    r"join\s*(?:isis|al[\s\-]*qaeda|terrorist\s*group)",
]

# Compile once at module load for < 0.1ms matching
_BLOCKED_PATTERN = re.compile(
    r"\b(?:" + "|".join(_BLOCKED_TERMS) + r")\b",
    re.IGNORECASE | re.UNICODE
)

# ── Leetspeak / obfuscation normalizer ───────────────────────────────────────
_LEET_MAP = str.maketrans({
    "0": "o", "1": "i", "3": "e", "4": "a", "5": "s",
    "7": "t", "@": "a", "$": "s", "!": "i",
})


def _normalize_text(text: str) -> Tuple[str, str]:
    """Lowercase + base64 decode + leetspeak decode + spacing normalizer."""
    # 1. Base64 payload detection (detects base64 encoded strings in prompts)
    extra = ""
    b64_tokens = re.findall(r"[A-Za-z0-9+/=]{16,}", text)
    for tok in b64_tokens:
        try:
            dec = base64.b64decode(tok).decode("utf-8", errors="ignore")
            if dec.strip():
                extra += " " + dec
        except Exception:
            pass

    full_text = text + (" " + extra if extra else "")
    t = full_text.lower().translate(_LEET_MAP)
    t_clean = re.sub(r"\s+", " ", t).strip()
    # Collapse spaced-out and dotted single letters (e.g. 's.e.x' -> 'sex', 's e x' -> 'sex', 'p.o.r.n' -> 'porn')
    t_condensed = re.sub(r"(?<=\b[a-z0-9])[.\s_\-]+(?=[a-z0-9](?:[.\s_\-]|\b))", "", t_clean)
    return t_clean, t_condensed


def check_prompt_keywords(prompt: str) -> Tuple[bool, Optional[str]]:
    """
    Tier 1: Instant local keyword check.

    Returns:
        (is_safe: bool, reason: Optional[str])
        - (True, None)  if the prompt is clean.
        - (False, "...") if a prohibited pattern matched.

    Performance: < 0.5 ms (regex on pre-compiled pattern, no I/O).
    """
    if not prompt or not prompt.strip():
        return True, None

    t_clean, t_condensed = _normalize_text(prompt)
    match = _BLOCKED_PATTERN.search(t_clean)
    if match:
        return False, f"Prompt contains prohibited content: '{match.group()}'"

    match_condensed = _BLOCKED_PATTERN.search(t_condensed)
    if match_condensed:
        return False, f"Prompt contains prohibited content: '{match_condensed.group()}'"

    return True, None


# ── TIER 2: OPENAI OMNI-MODERATION (MULTIMODAL) ─────────────────────────────

async def check_image_moderation(
    image_data: Union[str, bytes],
    timeout: float = 4.0,
) -> Tuple[bool, Optional[str]]:
    """
    Tier 2: OpenAI omni-moderation-latest for images (multimodal).

    Accepts:
      - A base64-encoded image string (raw base64 or data:image/...;base64,... URI)
      - An HTTP(S) image URL string
      - Raw image bytes

    Returns:
        (is_safe: bool, reason: Optional[str])
        - (True, None)  if the image is safe or the check could not be performed.
        - (False, "...") if the image was flagged.

    On timeout or API error, fails open (returns safe) to avoid blocking
    legitimate users during OpenAI outages.

    Performance: ~150–250 ms typical, hard-capped at `timeout` seconds.
    Cost: $0.00 (OpenAI Moderation API is free).
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("[Moderation] Warning: OPENAI_API_KEY not set, skipping image moderation.")
        return True, None

    try:
        import openai as openai_lib

        # Format the image for the moderation API
        if isinstance(image_data, bytes):
            b64_str = base64.b64encode(image_data).decode("utf-8")
            image_url = f"data:image/png;base64,{b64_str}"
        elif isinstance(image_data, str):
            if image_data.startswith(("http://", "https://")):
                image_url = image_data
            elif image_data.startswith("data:"):
                image_url = image_data
            else:
                # Raw base64 string
                image_url = f"data:image/png;base64,{image_data}"
        else:
            print(f"[Moderation] Warning: Unsupported image_data type {type(image_data)}, skipping.")
            return True, None

        client = openai_lib.AsyncOpenAI(api_key=api_key)

        async def _run_moderation():
            response = await client.moderations.create(
                model="omni-moderation-latest",
                input=[
                    {"type": "image_url", "image_url": {"url": image_url}}
                ],
            )
            result = response.results[0]
            if result.flagged:
                # Extract flagged category names
                flagged_cats = []
                cats = result.categories
                for attr in [
                    "sexual", "sexual/minors", "harassment", "harassment/threatening",
                    "hate", "hate/threatening", "illicit", "illicit/violent",
                    "self-harm", "self-harm/intent", "self-harm/instructions",
                    "violence", "violence/graphic",
                ]:
                    # categories uses attributes with slashes replaced by underscores in some SDK versions
                    safe_attr = attr.replace("/", "_").replace("-", "_")
                    if getattr(cats, safe_attr, False) or getattr(cats, attr.replace("/", "__"), False):
                        flagged_cats.append(attr)
                category_str = ", ".join(flagged_cats) if flagged_cats else "unspecified"
                return False, f"Image flagged by safety policy ({category_str})"
            return True, None

        is_safe, reason = await asyncio.wait_for(_run_moderation(), timeout=timeout)
        return is_safe, reason

    except asyncio.TimeoutError:
        print("[Moderation] Warning: OpenAI image moderation timed out, failing open.")
        return True, None
    except Exception as e:
        print(f"[Moderation] Warning: OpenAI image moderation error: {e}, failing open.")
        return True, None


async def check_text_moderation(
    prompt: str,
    timeout: float = 4.0,
) -> Tuple[bool, Optional[str]]:
    """
    Tier 2: OpenAI text moderation API.
    Can be run concurrently with generation to catch subtle, multilingual, or semantic NSFW text.
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key or not prompt or not prompt.strip():
        return True, None

    try:
        import openai as openai_lib
        client = openai_lib.AsyncOpenAI(api_key=api_key)

        async def _run():
            response = await client.moderations.create(
                model="omni-moderation-latest",
                input=prompt
            )
            result = response.results[0]
            if result.flagged:
                flagged_cats = []
                cats = result.categories
                for attr in [
                    "sexual", "sexual/minors", "harassment", "harassment/threatening",
                    "hate", "hate/threatening", "illicit", "illicit/violent",
                    "self-harm", "self-harm/intent", "self-harm/instructions",
                    "violence", "violence/graphic",
                ]:
                    safe_attr = attr.replace("/", "_").replace("-", "_")
                    if getattr(cats, safe_attr, False) or getattr(cats, attr.replace("/", "__"), False):
                        flagged_cats.append(attr)
                cat_str = ", ".join(flagged_cats) if flagged_cats else "unspecified"
                return False, f"Prompt flagged by safety policy ({cat_str})"
            return True, None

        return await asyncio.wait_for(_run(), timeout=timeout)
    except Exception as e:
        print(f"[Moderation] Warning: OpenAI text moderation error: {e}, failing open.")
        return True, None

