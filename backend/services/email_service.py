"""Email service using FastMail with styled HTML templates"""
from fastapi_mail import FastMail, MessageSchema, ConnectionConfig
from pydantic import EmailStr
import os
from dotenv import load_dotenv

load_dotenv()

# Email configuration from environment
conf = ConnectionConfig(
    MAIL_USERNAME=os.getenv("MAIL_USERNAME"),
    MAIL_PASSWORD=os.getenv("MAIL_PASSWORD"),
    MAIL_FROM=os.getenv("MAIL_FROM"),
    MAIL_PORT=int(os.getenv("MAIL_PORT", 587)),
    MAIL_SERVER=os.getenv("MAIL_SERVER"),
    MAIL_STARTTLS=os.getenv("MAIL_STARTTLS", "True") == "True",
    MAIL_SSL_TLS=os.getenv("MAIL_SSL_TLS", "False") == "True",
    USE_CREDENTIALS=os.getenv("USE_CREDENTIALS", "True") == "True",
    VALIDATE_CERTS=True
)

# Must match the actual running frontend URL
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
APP_NAME = os.getenv("MAIL_FROM_NAME", "Genfy").strip('"')


async def send_verification_email(email: str, otp_code: str, user_name: str = None):
    """Send email verification OTP code with styled HTML"""
    greeting = f"Hi {user_name}," if user_name else "Hi,"

    html_body = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your Email</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
            <tr>
                <td align="center" style="padding: 40px 0;">
                    <table role="presentation" style="width: 500px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); overflow: hidden;">
                        <tr>
                            <td style="padding: 40px 30px; text-align: center;">
                                <h1 style="color: #111827; margin: 0 0 10px 0; font-size: 28px; font-weight: 800;">{APP_NAME}</h1>
                                <h2 style="color: #374151; margin: 0 0 20px 0; font-size: 20px; font-weight: 600;">Verify Your Email Address</h2>
                                <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin: 0 0 25px 0;">{greeting}<br>Thank you for signing up! Enter the 6-digit code below to activate your account:</p>
                                
                                <div style="margin: 30px 0; padding: 20px; background-color: #f8fafc; border-radius: 10px; border: 1px border #e2e8f0; display: inline-block;">
                                    <span style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 800; letter-spacing: 10px; color: #f95738;">{otp_code}</span>
                                </div>
                                
                                <p style="color: #6b7280; font-size: 13px; margin-top: 25px;">
                                    This code is valid for <strong>10 minutes</strong>. If you didn't create an account, please ignore this email.
                                </p>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>
    """

    message = MessageSchema(
        subject=f"{otp_code} is your {APP_NAME} verification code",
        recipients=[email],
        body=html_body,
        subtype="html"
    )

    fm = FastMail(conf)
    await fm.send_message(message)


async def send_password_reset_email(email: str, otp_code: str, user_name: str = None):
    """Send password reset OTP code with styled HTML"""
    greeting = f"Hi {user_name}," if user_name else "Hi,"

    html_body = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Your Password</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
            <tr>
                <td align="center" style="padding: 40px 0;">
                    <table role="presentation" style="width: 500px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); overflow: hidden;">
                        <tr>
                            <td style="padding: 40px 30px; text-align: center;">
                                <h1 style="color: #111827; margin: 0 0 10px 0; font-size: 28px; font-weight: 800;">{APP_NAME}</h1>
                                <h2 style="color: #374151; margin: 0 0 20px 0; font-size: 20px; font-weight: 600;">Reset Your Password</h2>
                                <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin: 0 0 25px 0;">{greeting}<br>We received a request to reset your password. Use the 6-digit code below to proceed:</p>
                                
                                <div style="margin: 30px 0; padding: 20px; background-color: #f8fafc; border-radius: 10px; border: 1px border #e2e8f0; display: inline-block;">
                                    <span style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 800; letter-spacing: 10px; color: #f95738;">{otp_code}</span>
                                </div>
                                
                                <p style="color: #6b7280; font-size: 13px; margin-top: 25px;">
                                    This code is valid for <strong>10 minutes</strong>. If you did not request a password reset, you can safely ignore this email.
                                </p>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>
    """

    message = MessageSchema(
        subject=f"{otp_code} is your {APP_NAME} password reset code",
        recipients=[email],
        body=html_body,
        subtype="html"
    )

    fm = FastMail(conf)
    await fm.send_message(message)


