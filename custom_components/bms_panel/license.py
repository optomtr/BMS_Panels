"""Лицензия объекта — проверяется при подключении новой панели.

Что это даёт. Копию приложения и интеграции можно унести — это свойство любого
софта, и притворяться иначе не нужно. Лицензия делает копию бесполезной на
ЧУЖОМ объекте: без ключа, выпущенного владельцем, новая панель не привяжется.

Чего это НЕ даёт (честно, чтобы не было иллюзий):
  • уже работающие панели никогда не блокируются — дом клиента не должен
    вставать из-за лицензии, поэтому проверка стоит ТОЛЬКО в момент привязки;
  • тот, кто готов править исходный код интеграции, проверку уберёт. Это
    защита от «взял и поставил», а не от целенаправленного взлома. Ценность —
    в том, что обход становится осознанным действием, а не случайностью.

Как устроено. Пара ключей ECDSA P-256: закрытый только у владельца, открытый
вшит здесь. Лицензия — подписанная строка, проверяется БЕЗ интернета, поэтому
объект работает, даже когда сервера владельца нет вовсе. Лицензию можно
привязать к конкретному дому — тогда её нельзя перенести на другой объект.

Ключи выпускаются инструментом `tools/bms_license.py`.
"""
from __future__ import annotations

import base64
import json
import logging

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers import instance_id, storage

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

# ОТКРЫТЫЙ ключ владельца. Не секрет: им можно только ПРОВЕРИТЬ лицензию,
# выпустить новую нельзя. Закрытый ключ хранится у владельца отдельно.
LICENSE_PUBLIC_KEY = (
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEFXGWVygHz8fX6bNlFd5Pj9ffqepykOUjJ_Ul"
    "BNzW6ktHGdF-3EqtRbCm7DaA5JU9F5xuxwxD-oZa33EbMVX9lw"
)

LICENSE_STORAGE_KEY = "bms_panel_license"
LICENSE_STORAGE_VERSION = 1
DATA_LICENSE = "license_store"


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def verify_license(license_str: str) -> dict | None:
    """Проверяет подпись лицензии. Возвращает содержимое или None."""
    if not license_str or "." not in license_str:
        return None
    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import ec

        body_b64, sig_b64 = license_str.strip().split(".", 1)
        body, sig = _unb64(body_b64), _unb64(sig_b64)
        pub = serialization.load_der_public_key(_unb64(LICENSE_PUBLIC_KEY))
        pub.verify(sig, body, ec.ECDSA(hashes.SHA256()))
        return json.loads(body)
    except Exception:  # noqa: BLE001 — любая ошибка = лицензия недействительна
        return None


def _store(hass: HomeAssistant) -> storage.Store:
    data = hass.data.setdefault(DOMAIN, {})
    st = data.get(DATA_LICENSE)
    if st is None:
        st = storage.Store(hass, LICENSE_STORAGE_VERSION, LICENSE_STORAGE_KEY)
        data[DATA_LICENSE] = st
    return st


async def async_get_state(hass: HomeAssistant) -> dict:
    """Состояние лицензии этого дома — для интерфейса и для проверки привязки."""
    raw = (await _store(hass).async_load()) or {}
    license_str = raw.get("license") or ""
    house = await instance_id.async_get(hass)

    if not license_str:
        return {
            "valid": False,
            "instance": house,
            "reason": "Лицензия не введена. BMS Панели → Лицензия.",
        }
    data = verify_license(license_str)
    if data is None:
        return {
            "valid": False,
            "instance": house,
            "reason": "Лицензия недействительна — подпись не сходится.",
        }
    bound = (data.get("instance") or "").strip()
    # Правило владельца: одна лицензия — один объект. Лицензия без привязки
    # переносится куда угодно, поэтому такие не принимаем вовсе.
    if not bound:
        return {
            "valid": False,
            "instance": house,
            "reason": "Лицензия не привязана к объекту — нужна лицензия для этого дома.",
        }
    if bound != house:
        return {
            "valid": False,
            "instance": house,
            "reason": "Лицензия выдана другому объекту.",
        }
    # Срок действия — необязательное поле. Его нет у лицензий, выпущенных
    # раньше: они бессрочные и должны продолжать работать, иначе обновление
    # интеграции однажды заблокировало бы привязку на живых объектах.
    expires = (data.get("expires") or "").strip()
    if expires:
        from datetime import date
        try:
            if date.fromisoformat(expires) < date.today():
                return {
                    "valid": False,
                    "instance": house,
                    "reason": f"Срок лицензии истёк {expires}.",
                }
        except ValueError:
            return {
                "valid": False,
                "instance": house,
                "reason": "В лицензии неверная дата окончания.",
            }
    return {
        "valid": True,
        "instance": house,
        "object": data.get("object", ""),
        "object_id": str(data.get("object_id", "")),
        "issued": data.get("issued", ""),
        "expires": expires,
        "bound": bool(bound),
    }


async def async_set_license(hass: HomeAssistant, license_str: str) -> dict:
    """Сохраняет лицензию, если она проходит проверку."""
    state_now = verify_license(license_str)
    if state_now is None:
        raise ValueError("Лицензия недействительна — проверьте, что скопирована целиком")
    house = await instance_id.async_get(hass)
    bound = (state_now.get("instance") or "").strip()
    if not bound:
        raise ValueError(f"Лицензия не привязана к объекту. Нужна лицензия для дома {house}")
    if bound != house:
        raise ValueError(f"Эта лицензия выдана другому объекту (нужен дом {house})")
    # Просроченную не сохраняем вовсе: иначе установщик видит «принято», а
    # привязка потом отказывает — и он ищет причину не там.
    expires = (state_now.get("expires") or "").strip()
    if expires:
        from datetime import date
        try:
            if date.fromisoformat(expires) < date.today():
                raise ValueError(f"Срок лицензии истёк {expires} — нужна новая")
        except ValueError as err:
            if "истёк" in str(err):
                raise
            raise ValueError("В лицензии неверная дата окончания") from err
    await _store(hass).async_save({"license": license_str.strip()})
    _LOGGER.info("BMS Panel: лицензия принята — объект «%s»", state_now.get("object", ""))
    return await async_get_state(hass)


def async_register_license(hass: HomeAssistant) -> None:
    """WebSocket-команды лицензии. Идемпотентно."""
    data = hass.data.setdefault(DOMAIN, {})
    if data.get("license_registered"):
        return

    @websocket_api.websocket_command({vol.Required("type"): "bms_panel/license_get"})
    @websocket_api.require_admin
    @websocket_api.async_response
    async def ws_get(hass, connection, msg):
        connection.send_result(msg["id"], await async_get_state(hass))

    @websocket_api.websocket_command({
        vol.Required("type"): "bms_panel/license_set",
        vol.Required("license"): str,
    })
    @websocket_api.require_admin
    @websocket_api.async_response
    async def ws_set(hass, connection, msg):
        try:
            connection.send_result(msg["id"], await async_set_license(hass, msg["license"]))
        except ValueError as err:
            connection.send_error(msg["id"], "invalid_license", str(err))

    websocket_api.async_register_command(hass, ws_get)
    websocket_api.async_register_command(hass, ws_set)
    data["license_registered"] = True
