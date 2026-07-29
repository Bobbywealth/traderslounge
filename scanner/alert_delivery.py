import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import List, Optional
import logging

logger = logging.getLogger(__name__)

class AlertDelivery:
    def __init__(self):
        self.smtp_host = os.environ.get('SMTP_HOST')
        self.smtp_port = int(os.environ.get('SMTP_PORT', '587'))
        self.smtp_user = os.environ.get('SMTP_USER')
        self.smtp_pass = os.environ.get('SMTP_PASS')
        self.from_email = os.environ.get('SMTP_FROM', 'alerts@traderslounge.com')

    def send_email(self, to_email: str, subject: str, body: str) -> bool:
        if not all([self.smtp_host, self.smtp_user, self.smtp_pass]):
            logger.warning('SMTP not configured, skipping email')
            return False

        try:
            msg = MIMEMultipart()
            msg['From'] = self.from_email
            msg['To'] = to_email
            msg['Subject'] = subject
            msg.attach(MIMEText(body, 'html'))

            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                server.starttls()
                server.login(self.smtp_user, self.smtp_pass)
                server.send_message(msg)

            logger.info(f'Email sent to {to_email}: {subject}')
            return True
        except Exception as e:
            logger.error(f'Failed to send email: {e}')
            return False

    def send_telegram(self, bot_token: str, chat_id: str, message: str) -> bool:
        if not bot_token or not chat_id:
            logger.warning('Telegram not configured, skipping message')
            return False

        try:
            import requests
            url = f'https://api.telegram.org/bot{bot_token}/sendMessage'
            response = requests.post(url, json={
                'chat_id': chat_id,
                'text': message,
                'parse_mode': 'HTML'
            })
            return response.status_code == 200
        except Exception as e:
            logger.error(f'Failed to send Telegram message: {e}')
            return False

    def format_alert_message(self, alert: dict, setup: dict) -> str:
        direction = setup.get('direction', 'NEUTRAL')
        symbol = setup.get('symbol', 'UNKNOWN')
        score = setup.get('confluence_score', 0)

        emoji = '🟢' if direction == 'BUY' else '🔴' if direction == 'SELL' else '⚪️'

        messages = {
            'setup_ready': f'{emoji} <b>{symbol}</b> is READY\nScore: {score}/100\nDirection: {direction}',
            'setup_near_trigger': f'🎯 <b>{symbol}</b> near trigger\nScore: {score}/100',
            'setup_invalidated': f'❌ <b>{symbol}</b> invalidated\nReview thesis',
            'tp1_reached': f'🎯 <b>{symbol}</b> TP1 reached!',
            'stop_hit': f'🛑 <b>{symbol}</b> stop triggered',
        }

        return messages.get(alert.get('condition'), f'Alert for {symbol}')