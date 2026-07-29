import os
from enum import Enum
from dataclasses import dataclass
from typing import List, Optional
from .alert_delivery import AlertDelivery


class DeliveryChannel(str, Enum):
    EMAIL = "email"
    TELEGRAM = "telegram"
    BROWSER_NOTIFICATION = "browser_notification"
    IN_APP = "in_app"


@dataclass
class Alert:
    symbol: str
    condition: str
    channels: List[DeliveryChannel]
    user_email: Optional[str] = None
    user_telegram_chat_id: Optional[str] = None


class AlertManager:
    def __init__(self):
        self.delivery = AlertDelivery()

    def _deliver_alert(self, alert: Alert, state: dict):
        message = self.delivery.format_alert_message(
            {'condition': alert.condition, 'symbol': alert.symbol},
            state
        )

        for channel in alert.channels:
            if channel == DeliveryChannel.EMAIL:
                self.delivery.send_email(alert.user_email, f'Traders Lounge Alert: {alert.symbol}', message)
            elif channel == DeliveryChannel.TELEGRAM:
                bot_token = os.environ.get('TELEGRAM_BOT_TOKEN')
                self.delivery.send_telegram(bot_token, alert.user_telegram_chat_id, message)
            elif channel == DeliveryChannel.BROWSER_NOTIFICATION:
                pass
            elif channel == DeliveryChannel.IN_APP:
                self._create_in_app_notification(alert, state)

    def _create_in_app_notification(self, alert: Alert, state: dict):
        pass