import httpx
import os
from typing import Optional, Dict, Any

GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET")

async def get_github_access_token(code: str) -> str:
    """
    Exchange authorization code for an access token.
    """
    print(f"[GitHub Auth] Exchanging code for token...")
    async with httpx.AsyncClient() as client:
        payload = {
            "client_id": GITHUB_CLIENT_ID,
            "client_secret": GITHUB_CLIENT_SECRET,
            "code": code,
        }
        response = await client.post(
            "https://github.com/login/oauth/access_token",
            data=payload,
            headers={"Accept": "application/json"},
            timeout=30.0
        )
        
        if response.status_code != 200:
            print(f"❌ GitHub Token Exchange Failed: {response.status_code} {response.text}")
            raise Exception(f"GitHub token exchange failed: {response.text}")
            
        data = response.json()
        print(f"[GitHub Auth] Token response: {data}")
        
        if "error" in data:
            raise Exception(f"GitHub OAuth Error: {data.get('error_description', data['error'])}")
            
        return data.get("access_token")

async def get_github_user_profile(access_token: str) -> Dict[str, Any]:
    """
    Fetch user profile and email from GitHub API.
    """
    async with httpx.AsyncClient() as client:
        headers = {
            "Authorization": f"token {access_token}",
            "Accept": "application/json",
            "User-Agent": "Genfy-Studio"
        }
        
        # 1. Fetch base profile
        profile_resp = await client.get("https://api.github.com/user", headers=headers, timeout=30.0)
        profile_resp.raise_for_status()
        profile = profile_resp.json()
        
        # 2. Fetch email if not public in profile
        if not profile.get("email"):
            email_resp = await client.get("https://api.github.com/user/emails", headers=headers, timeout=30.0)
            email_resp.raise_for_status()
            emails = email_resp.json()
            
            # Find primary verified email
            primary_email = next(
                (e["email"] for e in emails if e.get("primary") and e.get("verified")), 
                None
            )
            
            # Fallback to any verified email
            if not primary_email:
                primary_email = next(
                    (e["email"] for e in emails if e.get("verified")), 
                    None
                )
                
            # Final fallback to first email
            if not primary_email and emails:
                primary_email = emails[0].get("email")
                
            profile["email"] = primary_email
            
        return profile
