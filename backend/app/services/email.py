"""
邮件发送服务

开发环境：将验证码输出到控制台（不实际发送）。
生产环境：通过 SMTP 发送邮件。
"""
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from app.config import settings

logger = logging.getLogger(__name__)


def _build_verification_email(to_email: str, code: str, purpose: str) -> MIMEMultipart:
    """构建验证码邮件"""
    purpose_text = {
        "register": "注册账号",
        "login": "登录",
        "reset_password": "重置密码",
    }.get(purpose, "操作")

    subject = f"【{settings.APP_NAME}】{purpose_text}验证码"
    html = f"""
    <div style="max-width: 480px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
        <div style="background: linear-gradient(135deg, #6366F1, #4F46E5); padding: 32px; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">{settings.APP_NAME}</h1>
        </div>
        <div style="background: #ffffff; padding: 32px; border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="color: #374151; font-size: 16px; margin: 0 0 16px;">您好，</p>
            <p style="color: #374151; font-size: 16px; margin: 0 0 24px;">
                您正在{purpose_text}，验证码为：
            </p>
            <div style="background: #F3F4F6; padding: 20px; border-radius: 8px; text-align: center; margin: 0 0 24px;">
                <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #4F46E5;">{code}</span>
            </div>
            <p style="color: #6B7280; font-size: 14px; margin: 0 0 8px;">
                验证码 {settings.VERIFICATION_CODE_EXPIRE_MINUTES} 分钟内有效，请勿泄露给他人。
            </p>
            <p style="color: #9CA3AF; font-size: 12px; margin: 16px 0 0;">
                如非本人操作，请忽略此邮件。
            </p>
        </div>
    </div>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_USER}>"
    msg["To"] = to_email
    msg.attach(MIMEText(html, "html", "utf-8"))
    return msg


def send_verification_email(to_email: str, code: str, purpose: str = "register") -> bool:
    """
    发送验证码邮件。

    开发环境下仅打印到控制台，不实际发送。
    返回 True 表示成功。
    """
    purpose_text = {
        "register": "注册",
        "login": "登录",
        "reset_password": "重置密码",
    }.get(purpose, "操作")

    # 开发环境：仅打印到控制台
    if settings.ENVIRONMENT == "development" or not settings.SMTP_HOST:
        logger.info(
            "\n"
            "============================================\n"
            "  邮箱验证码 (开发模式 - 未实际发送)\n"
            "  收件人: %s\n"
            "  用途: %s\n"
            "  验证码: %s\n"
            "  有效期: %d 分钟\n"
            "============================================",
            to_email, purpose_text, code,
            settings.VERIFICATION_CODE_EXPIRE_MINUTES,
        )
        return True

    # 生产环境：通过 SMTP 发送
    try:
        msg = _build_verification_email(to_email, code, purpose)

        if settings.SMTP_USE_SSL:
            server = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT)
        else:
            server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT)
            server.starttls()

        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.sendmail(settings.SMTP_USER, [to_email], msg.as_string())
        server.quit()

        logger.info("验证码邮件已发送: %s (%s)", to_email, purpose_text)
        return True

    except Exception:
        logger.exception("发送验证码邮件失败: %s", to_email)
        return False
