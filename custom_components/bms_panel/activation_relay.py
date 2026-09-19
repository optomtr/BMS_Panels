"""Прокси активации панели через ERP (docs/ТЗ-активация-панели-через-ERP.md
в репозитории панели) — только для Linux-панелей (SSD202D).

Зачем нужен именно прокси. У Linux-панели нет TLS-стека (см. в её репозитории
linux/src/ha/http.c — только plain HTTP по LAN), поэтому она не может сама
дойти до ERP по https. Android дотягивается до ERP напрямую — у него есть
системный TLS. Здесь HA просто пересылает тело запроса панели на ERP по
https и пересылает ответ обратно панели по LAN — как уже делает
provisioning.py для скачивания релизов Linux-панелей с GitHub.

Прокси НИЧЕГО не проверяет и никому не доверяет: панель сама проверяет
подпись выданной лицензии (её собственным встроенным открытым ключом ERP) и
то, что device_pubkey в ней — её собственный. Если бы кто-то подменял ответ
на этом прокси-шаге, панель просто отклонила бы такую лицензию — см.
device_identity.c/activation.c в репозитории Linux-панели.

Обе ручки БЕЗ авторизации HA — как и у pairing.py: панель либо ещё не
привязана к HA вообще (Android — активация раньше привязки), либо это
Linux-панель, для которой авторизация от HA тут не нужна (сам ERP отдельно
проверяет право активировать конкретный code — сотрудник подтверждает
сканированием). Ограничены только частотой запросов с одного IP.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

ERP_BASE_URL = "https://system.bmssmart.uz"
DATA_ACTIVATION_RELAY = "activation_relay"

RATE_LIMIT_WINDOW = 60
RATE_LIMIT_MAX_START = 10
RATE_LIMIT_MAX_POLL = 60   # панель опрашивает раз в 2.5 с


@dataclass
class _RateBucket:
    window_start: float = 0.0
    count: int = 0


@dataclass
class _RelayStore:
    rate_start: dict[str, _RateBucket] = field(default_factory=dict)
    rate_poll: dict[str, _RateBucket] = field(default_factory=dict)

    def purge(self, now: float) -> None:
        for buckets in (self.rate_start, self.rate_poll):
            for key in [k for k, b in buckets.items() if (now - b.window_start) > RATE_LIMIT_WINDOW * 10]:
                del buckets[key]

    def allow(self, buckets: dict[str, _RateBucket], key: str, limit: int, now: float) -> bool:
        bucket = buckets.get(key)
        if bucket is None or (now - bucket.window_start) > RATE_LIMIT_WINDOW:
            buckets[key] = _RateBucket(window_start=now, count=1)
            return True
        bucket.count += 1
        return bucket.count <= limit


def _store(hass: HomeAssistant) -> _RelayStore:
    data = hass.data.setdefault(DOMAIN, {})
    store = data.get(DATA_ACTIVATION_RELAY)
    if store is None:
        store = _RelayStore()
        data[DATA_ACTIVATION_RELAY] = store
    return store


def _client_ip(request) -> str:
    return str(getattr(request, "remote", None) or "unknown")


def _hass_of(request) -> HomeAssistant:
    try:
        from homeassistant.components.http import KEY_HASS
        return request.app[KEY_HASS]
    except (ImportError, KeyError):
        return request.app["hass"]


def _http_timeout(total_s: float):
    import aiohttp
    return aiohttp.ClientTimeout(total=total_s)


class BmsPanelActivationStartView(HomeAssistantView):
    """POST /api/bms_panel/activation/start → проксирует в ERP /api/panel-activation/start."""

    url = "/api/bms_panel/activation/start"
    name = "api:bms_panel:activation_start"
    requires_auth = False

    async def post(self, request):
        hass = _hass_of(request)
        store = _store(hass)
        now = time.time()
        store.purge(now)

        ip = _client_ip(request)
        if not store.allow(store.rate_start, ip, RATE_LIMIT_MAX_START, now):
            return self.json({"error": "Слишком много попыток"}, status_code=429)

        try:
            body = await request.json()
        except ValueError:
            return self.json({"error": "Ожидался JSON"}, status_code=400)

        pubkey = str(body.get("device_pubkey") or "").strip()
        model = str(body.get("model") or "Панель BMS").strip()[:80]
        # DER SubjectPublicKeyInfo (несжатая точка P-256), base64url без
        # паддинга — 91 байт даёт ровно 122 символа; берём с запасом.
        if not (20 <= len(pubkey) <= 200):
            return self.json({"error": "Некорректный device_pubkey"}, status_code=400)

        session = async_get_clientsession(hass)
        try:
            async with session.post(
                f"{ERP_BASE_URL}/api/panel-activation/start",
                json={"device_pubkey": pubkey, "model": model},
                timeout=_http_timeout(10),
            ) as resp:
                if resp.status != 200:
                    _LOGGER.warning("ERP activation/start ответил %s", resp.status)
                    return self.json({"error": "ERP недоступен"}, status_code=502)
                data = await resp.json(content_type=None)
        except Exception as exc:  # noqa: BLE001
            _LOGGER.warning("ERP activation/start: нет связи (%s)", exc)
            return self.json({"error": "Нет связи с ERP"}, status_code=502)

        code = str(data.get("code") or "")
        ttl = data.get("ttl") or 600
        if not code:
            return self.json({"error": "ERP не выдал код"}, status_code=502)
        return self.json({"code": code, "ttl": ttl})


class BmsPanelActivationPollView(HomeAssistantView):
    """GET /api/bms_panel/activation/poll?code=… → проксирует в ERP /api/panel-activation/poll."""

    url = "/api/bms_panel/activation/poll"
    name = "api:bms_panel:activation_poll"
    requires_auth = False

    async def get(self, request):
        hass = _hass_of(request)
        store = _store(hass)
        now = time.time()
        store.purge(now)

        ip = _client_ip(request)
        if not store.allow(store.rate_poll, ip, RATE_LIMIT_MAX_POLL, now):
            return self.json({"error": "Слишком много запросов"}, status_code=429)

        code = str(request.query.get("code") or "").strip()
        if not code or len(code) > 12:
            return self.json({"error": "Некорректный code"}, status_code=400)

        session = async_get_clientsession(hass)
        try:
            async with session.get(
                f"{ERP_BASE_URL}/api/panel-activation/poll",
                params={"code": code},
                timeout=_http_timeout(10),
            ) as resp:
                if resp.status == 202:
                    return self.json({"status": "pending"}, status_code=202)
                if resp.status == 404:
                    return self.json({"error": "Код не найден или истёк"}, status_code=404)
                if resp.status != 200:
                    _LOGGER.warning("ERP activation/poll ответил %s", resp.status)
                    return self.json({"error": "ERP недоступен"}, status_code=502)
                data = await resp.json(content_type=None)
        except Exception as exc:  # noqa: BLE001
            _LOGGER.warning("ERP activation/poll: нет связи (%s)", exc)
            return self.json({"error": "Нет связи с ERP"}, status_code=502)

        license_str = str(data.get("license") or "")
        if not license_str:
            return self.json({"error": "ERP не выдал лицензию"}, status_code=502)
        return self.json({"license": license_str})


def async_register_activation_relay(hass: HomeAssistant) -> None:
    hass.http.register_view(BmsPanelActivationStartView())
    hass.http.register_view(BmsPanelActivationPollView())
