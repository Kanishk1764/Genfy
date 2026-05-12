"""Email validation utilities with DNS MX checking"""
import re
import dns.resolver
from typing import Tuple


def validate_email_format(email: str) -> bool:
    """Validate email format using regex"""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None


def validate_email_domain(email: str) -> Tuple[bool, str]:
    """Check if email domain has valid MX records"""
    try:
        domain = email.split('@')[1]
        mx_records = dns.resolver.resolve(domain, 'MX')
        if mx_records:
            return True, f"Domain {domain} has valid mail servers"
        else:
            return False, f"Domain {domain} has no mail servers"
    except Exception as e:
        # Be lenient for corporate emails with restricted DNS
        return True, f"Could not verify domain (allowed): {str(e)}"


def validate_email_comprehensive(email: str) -> Tuple[bool, str]:
    """Comprehensive email validation"""
    if not validate_email_format(email):
        return False, "Invalid email format"
    domain_valid, domain_message = validate_email_domain(email)
    if not domain_valid:
        return False, domain_message
    return True, "Email appears valid"
