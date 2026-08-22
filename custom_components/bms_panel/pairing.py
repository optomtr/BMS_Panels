"""Привязка панели по QR-коду — без ручного ввода адреса и токена.

Как это выглядит у установщика:
  1. Свежая панель показывает на экране QR и короткий код (например `K7P2QM`).
  2. Установщик открывает «BMS Панели» в Home Assistant с телефона (он уже под
     своей учёткой), нажимает «Подключить панель» и наводит камеру на экран
     панели — либо просто выбирает панель из списка ожидающих.
  3. Выбирает, какой комнате принадлежит панель, и нажимает «Подключить».
  4. Панель через пару секунд забирает свой токен и подключается.

Ни адрес сервера, ни токен на панели руками не вводятся.

Механика — «код устройства» (как вход в аккаунт на телевизоре):
  • панель находит HA в сети по mDNS и регистрирует сессию:
    POST /api/bms_panel/pair/start   {secret, name} → {code}
  • панель опрашивает:
    GET  /api/bms_panel/pair/poll?secret=…  → 204 пока не подтверждено,
                                              200 {token, panel_id} один раз
  • администратор подтверждает по WebSocket: bms_panel/pair_approve {code, panel_id}

Обе HTTP-ручки БЕЗ авторизации — у панели ещё нет никаких учётных данных, в
этом весь смысл. Защита построена так:
  • `secret` (192 бита) генерирует сама панель, он не показывается на экране,
    не кладётся в QR и не уходит никуда, кроме собственных запросов панели;
  • в QR попадает только короткий код — знание кода НИЧЕГО не даёт, подтвердить
    может лишь администратор HA под своей учёткой;
  • токен появляется в сессии только после явного подтверждения человеком,
    отдаётся ОДИН раз и сразу стирается;
  • сессии живут 10 минут, их не больше 20, есть ограничение частоты запросов.

Токен для каждой панели выпускается СВОЙ (client_name = «BMS Panel <id>») и
отзывается по отдельности: HA → Профиль → Долгоживущие токены. Раньше один
токен расходился по всем панелям — потеря одной панели означала доступ ко
всему дому. Повторная привязка той же панели отзывает старый токен.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import time
from dataclasses import dataclass, field
from datetime import timedelta

import voluptuous as vol

from homeassistant.auth.models import TOKEN_TYPE_LONG_LIVED_ACCESS_TOKEN
from homeassistant.components import websocket_api
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers import storage

from .const import DOMAIN, SLUG_REGEX

_LOGGER = logging.getLogger(__name__)

# Короткий код читают с экрана панели и набирают руками — исключены символы,
# которые путают: O/0, I/1. 32 символа × 6 позиций ≈ миллиард сочетаний.
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 6

# 10 минут: установщику надо дойти до панели, разблокировать телефон, открыть HA.
PAIR_TTL_SECONDS = 600
# Потолок против забивания памяти незалогиненными запросами. При переполнении
# вытесняем самую старую НЕподтверждённую сессию, чтобы честная панель всегда
# могла зарегистрироваться.
MAX_SESSIONS = 20
# Ограничение частоты для ручек без авторизации.
RATE_LIMIT_WINDOW = 60
RATE_LIMIT_MAX_START = 10       # регистраций сессии с одного адреса в минуту
RATE_LIMIT_MAX_POLL = 120       # опросов с одного адреса в минуту (панель — раз в 2 с)

# Долгоживущий токен: 10 лет. Панель висит на стене годами, перевыпуск токена
# означает поход к каждой панели — ровно то, от чего уходим.
TOKEN_YEARS = timedelta(days=3650)

DATA_PAIRING = "pairing"

# Постоянная «личность» панели. Хранится у сервера и переживает всё: истёкший
# ключ, отзыв, восстановление дома из архива. По ней панель САМА получает новый
# ключ — без человека, камеры и QR.
DEVICES_STORAGE_KEY = "bms_panel_devices"
DEVICES_STORAGE_VERSION = 1
DATA_DEVICES = "devices"
DATA_DEVICES_STORE = "devices_store"

# Обновлять ключ заранее, пока старый ещё действует. Панель просит обновление,
# когда до конца меньше года, — запас на случай, что её выключат на пару лет.
RENEW_RATE_LIMIT_MAX = 20


@dataclass
class PairingSession:
    """Ожидающая привязка. Живёт в памяти — переживать перезапуск незачем."""

    secret: str
    code: str
    name: str
    created: float
    remote_ip: str = ""
    # Заполняется при подтверждении администратором.
    token: str | None = None
    panel_id: str | None = None
    approved_by: str = ""
    device_id: str | None = None
    device_secret: str | None = None

    @property
    def approved(self) -> bool:
        return self.token is not None

    def expired(self, now: float) -> bool:
        return (now - self.created) > PAIR_TTL_SECONDS

    def age(self, now: float) -> int:
        return int(now - self.created)


@dataclass
class _RateBucket:
    window_start: float = 0.0
    count: int = 0


@dataclass
class PairingStore:
    """Все ожидающие привязки + счётчики частоты запросов."""

    sessions: dict[str, PairingSession] = field(default_factory=dict)
    rate_start: dict[str, _RateBucket] = field(default_factory=dict)
    rate_poll: dict[str, _RateBucket] = field(default_factory=dict)

    def purge(self, now: float) -> None:
        for secret in [s for s, sess in self.sessions.items() if sess.expired(now)]:
            del self.sessions[secret]
        # Счётчики частоты запросов тоже чистим: иначе на доме, работающем
        # годами, копилась бы запись на каждый адрес, который когда-либо
        # обращался, — тихий рост памяти без единой ошибки в журнале.
        for buckets in (self.rate_start, self.rate_poll):
            for key in [
                k for k, b in buckets.items()
                if (now - b.window_start) > RATE_LIMIT_WINDOW * 10
            ]:
                del buckets[key]

    def by_code(self, code: str) -> PairingSession | None:
        code = (code or "").strip().upper()
        if not code:
            return None
        for sess in self.sessions.values():
            # compare_digest — чтобы по времени ответа нельзя было подбирать код.
            if hmac.compare_digest(sess.code, code):
                return sess
        return None

    def allow(self, buckets: dict[str, _RateBucket], key: str, limit: int, now: float) -> bool:
        bucket = buckets.get(key)
        if bucket is None or (now - bucket.window_start) > RATE_LIMIT_WINDOW:
            buckets[key] = _RateBucket(window_start=now, count=1)
            return True
        bucket.count += 1
        return bucket.count <= limit


def _store(hass: HomeAssistant) -> PairingStore:
    data = hass.data.setdefault(DOMAIN, {})
    store = data.get(DATA_PAIRING)
    if store is None:
        store = PairingStore()
        data[DATA_PAIRING] = store
    return store


def _new_code(store: PairingStore) -> str:
    """Код, которого сейчас нет среди активных сессий."""
    for _ in range(50):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        if store.by_code(code) is None:
            return code
    # Практически недостижимо (сессий максимум 20 на миллиард кодов).
    raise RuntimeError("не удалось подобрать свободный код привязки")


def _client_ip(request) -> str:
    remote = getattr(request, "remote", None)
    return str(remote or "unknown")


class BmsPanelPairStartView(HomeAssistantView):
    """POST /api/bms_panel/pair/start — панель заявляет о себе и получает код.

    Без авторизации: у панели ещё нет ни адреса аккаунта, ни токена. Тело
    запроса несёт `secret`, придуманный самой панелью, — он и будет её
    пропуском при опросе. Наружу отдаём только короткий код для человека.
    """

    url = "/api/bms_panel/pair/start"
    name = "api:bms_panel:pair_start"
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

        secret = str(body.get("secret") or "").strip()
        # 24 символа — нижняя граница здравого секрета; свой генерим 32+.
        if len(secret) < 24 or len(secret) > 128:
            return self.json({"error": "Некорректный secret"}, status_code=400)

        name = str(body.get("name") or "Панель").strip()[:40] or "Панель"

        existing = store.sessions.get(secret)
        if existing is not None and not existing.expired(now):
            # Панель перезапросила — отдаём тот же код, а не плодим сессии.
            return self.json({"code": existing.code, "ttl": PAIR_TTL_SECONDS})

        if len(store.sessions) >= MAX_SESSIONS:
            oldest = min(
                (s for s in store.sessions.values() if not s.approved),
                key=lambda s: s.created,
                default=None,
            )
            if oldest is None:
                return self.json({"error": "Слишком много ожидающих привязок"}, status_code=429)
            del store.sessions[oldest.secret]

        session = PairingSession(
            secret=secret,
            code=_new_code(store),
            name=name,
            created=now,
            remote_ip=ip,
        )
        store.sessions[secret] = session
        _LOGGER.info("BMS Panel: ожидает привязки «%s» (код %s, %s)", name, session.code, ip)
        return self.json({"code": session.code, "ttl": PAIR_TTL_SECONDS})


class BmsPanelPairPollView(HomeAssistantView):
    """GET /api/bms_panel/pair/poll?secret=… — панель ждёт подтверждения.

    204 — ещё не подтвердили; 200 с токеном — подтвердили (отдаём ОДИН раз и
    сразу стираем сессию); 404 — сессии нет или истекла (панель покажет новый код).
    """

    url = "/api/bms_panel/pair/poll"
    name = "api:bms_panel:pair_poll"
    requires_auth = False

    async def get(self, request):
        hass = _hass_of(request)
        store = _store(hass)
        now = time.time()
        store.purge(now)

        ip = _client_ip(request)
        if not store.allow(store.rate_poll, ip, RATE_LIMIT_MAX_POLL, now):
            return self.json({"error": "Слишком много запросов"}, status_code=429)

        secret = str(request.query.get("secret") or "").strip()
        session = store.sessions.get(secret) if secret else None
        if session is None:
            return self.json({"error": "Сессия не найдена"}, status_code=404)
        if not session.approved:
            return self.json({"status": "pending", "code": session.code}, status_code=202)

        # Одноразовая выдача: даже если secret утечёт позже, второй раз токен
        # по нему не получить.
        del store.sessions[secret]
        _LOGGER.info(
            "BMS Panel: панель «%s» привязана к %s (подтвердил %s)",
            session.name, session.panel_id, session.approved_by or "администратор",
        )
        return self.json({
            "token": session.token,
            "panel_id": session.panel_id,
            # Постоянная личность панели: по ней она потом сама обновит ключ,
            # даже если вернутся к дому через годы.
            "device_id": session.device_id,
            "device_secret": session.device_secret,
        })


# ---------------------------------------------------------------------------
# Постоянная «личность» панели: самовосстановление без человека
# ---------------------------------------------------------------------------

class DeviceRegistry:
    """Список панелей, которым дом однажды доверился.

    Запись переживает и истёкший ключ, и отзыв, и восстановление дома из
    архива. Пока запись жива, панель обновляет себе ключ САМА — никто никуда
    не идёт и ничего не сканирует.

    Хранится только ОТПЕЧАТОК пароля устройства (sha256), не он сам: даже
    заглянув в файлы сервера, выдать себя за панель нельзя.

    Пароль меняется при каждом обновлении ключа. Прежний принимается ещё
    некоторое время — иначе панель, у которой пропало питание между «получил
    новый ключ» и «записал новый пароль», потеряла бы себя навсегда.
    """

    GRACE_SECONDS = 7 * 24 * 3600

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._store = storage.Store(hass, DEVICES_STORAGE_VERSION, DEVICES_STORAGE_KEY)
        self._devices: dict[str, dict] = {}
        self._loaded = False

    async def async_load(self) -> None:
        if self._loaded:
            return
        data = await self._store.async_load() or {}
        self._devices = data.get("devices", {})
        self._loaded = True

    async def _async_save(self) -> None:
        await self._store.async_save({"devices": self._devices})

    @staticmethod
    def _hash(secret: str) -> str:
        return hashlib.sha256(secret.encode()).hexdigest()

    async def async_register(self, panel_id: str, user_id: str, name: str) -> tuple[str, str]:
        """Заводит личность панели. Возвращает (device_id, device_secret) — единожды."""
        await self.async_load()
        device_id = secrets.token_hex(16)
        device_secret = secrets.token_urlsafe(32)
        self._devices[device_id] = {
            "panel_id": panel_id,
            "user_id": user_id,
            "name": name,
            "secret_hash": self._hash(device_secret),
            "prev_hash": None,
            "prev_until": 0,
            "created": time.time(),
            "last_renew": 0,
        }
        # Одна панель — одна личность: прежние записи той же панели убираем,
        # иначе после нескольких перепривязок в доме копились бы «призраки»
        # с правами выпускать ключи.
        for old_id in [
            d_id for d_id, rec in self._devices.items()
            if rec["panel_id"] == panel_id and d_id != device_id
        ]:
            del self._devices[old_id]
        await self._async_save()
        return device_id, device_secret

    def get(self, device_id: str) -> dict | None:
        return self._devices.get(device_id)

    def verify(self, device_id: str, secret: str, now: float) -> dict | None:
        """Проверяет пароль устройства: текущий или ещё действующий прежний."""
        rec = self._devices.get(device_id)
        if rec is None or not secret:
            return None
        candidate = self._hash(secret)
        if hmac.compare_digest(rec["secret_hash"], candidate):
            return rec
        prev = rec.get("prev_hash")
        if prev and now < rec.get("prev_until", 0) and hmac.compare_digest(prev, candidate):
            return rec
        return None

    async def async_rotate(self, device_id: str, now: float) -> str:
        """Меняет пароль устройства, оставляя прежний действующим на неделю."""
        rec = self._devices[device_id]
        new_secret = secrets.token_urlsafe(32)
        rec["prev_hash"] = rec["secret_hash"]
        rec["prev_until"] = now + self.GRACE_SECONDS
        rec["secret_hash"] = self._hash(new_secret)
        rec["last_renew"] = now
        await self._async_save()
        return new_secret

    async def async_forget_panel(self, panel_id: str) -> int:
        """Забывает панель целиком — при удалении панели из списка."""
        await self.async_load()
        gone = [d_id for d_id, rec in self._devices.items() if rec["panel_id"] == panel_id]
        for d_id in gone:
            del self._devices[d_id]
        if gone:
            await self._async_save()
        return len(gone)


async def async_forget_panel_devices(hass: HomeAssistant, panel_id: str) -> int:
    """Полностью отсоединить панель от дома при её удалении из списка.

    Двумя действиями, и оба обязательны:
      1) отозвать ВЫДАННЫЙ ей ключ — иначе снятая со стены панель продолжала бы
         управлять домом как ни в чём не бывало;
      2) забыть личность устройства — иначе она выпросила бы себе новый ключ.

    Первое важнее: удаление панели из списка человек воспринимает как «эта
    панель больше не имеет доступа», и так и должно быть на самом деле.
    """
    client_name = f"BMS Panel {panel_id}"
    revoked = 0
    for user in await hass.auth.async_get_users():
        for token in list(user.refresh_tokens.values()):
            if (
                token.client_name == client_name
                and token.token_type == TOKEN_TYPE_LONG_LIVED_ACCESS_TOKEN
            ):
                hass.auth.async_remove_refresh_token(token)
                revoked += 1
    if revoked:
        _LOGGER.info("BMS Panel: отозван ключ удалённой панели «%s» (%d)", panel_id, revoked)
    forgotten = await _devices(hass).async_forget_panel(panel_id)
    return revoked + forgotten


def _devices(hass: HomeAssistant) -> DeviceRegistry:
    data = hass.data.setdefault(DOMAIN, {})
    reg = data.get(DATA_DEVICES)
    if reg is None:
        reg = DeviceRegistry(hass)
        data[DATA_DEVICES] = reg
    return reg


class BmsPanelRenewView(HomeAssistantView):
    """POST /api/bms_panel/pair/renew — панель сама обновляет свой ключ.

    Это и есть ответ на «вернулись через пять лет». Панель предъявляет свою
    личность (device_id + пароль устройства, выданные при первой привязке) и
    получает свежий ключ на десять лет. Человек не участвует.

    Без авторизации — как и привязка: старый ключ может быть уже мёртв, иначе
    обновиться было бы нечем. Защита: 256-битный пароль устройства, отпечаток
    которого хранится на сервере; смена пароля при каждом обновлении (украденный
    перестаёт работать после первого же честного обновления, и панель это
    заметит); ограничение частоты; запись в журнал с адресом.
    """

    url = "/api/bms_panel/pair/renew"
    name = "api:bms_panel:pair_renew"
    requires_auth = False

    async def post(self, request):
        hass = _hass_of(request)
        store = _store(hass)
        now = time.time()
        ip = _client_ip(request)
        if not store.allow(store.rate_poll, "renew:" + ip, RENEW_RATE_LIMIT_MAX, now):
            return self.json({"error": "Слишком много попыток"}, status_code=429)

        try:
            body = await request.json()
        except ValueError:
            return self.json({"error": "Ожидался JSON"}, status_code=400)

        device_id = str(body.get("device_id") or "").strip()
        device_secret = str(body.get("device_secret") or "").strip()
        registry = _devices(hass)
        await registry.async_load()
        rec = registry.verify(device_id, device_secret, now)
        if rec is None:
            _LOGGER.warning("BMS Panel: отказ в обновлении ключа (%s, устройство %s)", ip, device_id[:8])
            return self.json({"error": "Устройство не опознано"}, status_code=403)

        # Панель могли удалить из списка, а запись устройства пережить сбой
        # удаления: ключ такой панели выпускать нельзя.
        known = hass.data.get(DOMAIN, {}).get("configs") or {}
        if known and rec["panel_id"] not in known:
            _LOGGER.warning(
                "BMS Panel: отказ в обновлении — панели «%s» больше нет", rec["panel_id"]
            )
            return self.json({"error": "Панель удалена"}, status_code=403)

        user = await hass.auth.async_get_user(rec["user_id"])
        if user is None or not user.is_active or not user.is_admin:
            # Учётка, под которой выпускали ключ, удалена или лишена прав —
            # автоматически заменить её мы не вправе, нужен человек.
            _LOGGER.warning(
                "BMS Panel: панель «%s» не может обновить ключ — учётная запись недоступна",
                rec["panel_id"],
            )
            return self.json({"error": "Учётная запись недоступна"}, status_code=409)

        try:
            token = await async_issue_panel_token(hass, user, rec["panel_id"])
        except ValueError as err:
            return self.json({"error": f"Не удалось выпустить ключ: {err}"}, status_code=500)

        new_secret = await registry.async_rotate(device_id, now)
        _LOGGER.info(
            "BMS Panel: панель «%s» обновила ключ самостоятельно (%s)", rec["panel_id"], ip
        )
        return self.json({
            "token": token,
            "panel_id": rec["panel_id"],
            "device_secret": new_secret,
        })


def _hass_of(request) -> HomeAssistant:
    try:
        from homeassistant.components.http import KEY_HASS
        return request.app[KEY_HASS]
    except (ImportError, KeyError):
        return request.app["hass"]


async def async_issue_panel_token(hass: HomeAssistant, user, panel_id: str) -> str:
    """Выпускает персональный долгоживущий токен для одной панели.

    Имя токена (`BMS Panel <id>`) уникально в пределах пользователя, поэтому
    повторная привязка той же панели сначала ОТЗЫВАЕТ прежний токен: у панели
    всегда ровно один действующий ключ, а потерянная панель отключается
    удалением одной строки в профиле HA.
    """
    client_name = f"BMS Panel {panel_id}"
    for token in list(user.refresh_tokens.values()):
        if (
            token.client_name == client_name
            and token.token_type == TOKEN_TYPE_LONG_LIVED_ACCESS_TOKEN
        ):
            hass.auth.async_remove_refresh_token(token)
            _LOGGER.info("BMS Panel: прежний токен «%s» отозван", client_name)

    refresh_token = await hass.auth.async_create_refresh_token(
        user,
        client_name=client_name,
        token_type=TOKEN_TYPE_LONG_LIVED_ACCESS_TOKEN,
        access_token_expiration=TOKEN_YEARS,
    )
    return hass.auth.async_create_access_token(refresh_token)


def async_register_pairing(hass: HomeAssistant, taken_panel_ids) -> None:
    """Регистрирует ручки и WebSocket-команды привязки. Идемпотентно."""
    data = hass.data.setdefault(DOMAIN, {})
    if data.get("pairing_registered"):
        return

    hass.http.register_view(BmsPanelPairStartView())
    hass.http.register_view(BmsPanelPairPollView())
    hass.http.register_view(BmsPanelRenewView())

    @websocket_api.websocket_command({vol.Required("type"): "bms_panel/pair_list"})
    @websocket_api.require_admin
    @websocket_api.async_response
    async def websocket_pair_list(hass, connection, msg):
        """Панели, ожидающие привязки прямо сейчас."""
        store = _store(hass)
        now = time.time()
        store.purge(now)
        pending = [
            {"code": s.code, "name": s.name, "age": s.age(now), "ip": s.remote_ip}
            for s in store.sessions.values()
            if not s.approved
        ]
        pending.sort(key=lambda item: item["age"])
        connection.send_result(msg["id"], pending)

    @websocket_api.websocket_command({
        vol.Required("type"): "bms_panel/pair_approve",
        vol.Required("code"): str,
        vol.Required("panel_id"): str,
    })
    @websocket_api.require_admin
    @websocket_api.async_response
    async def websocket_pair_approve(hass, connection, msg):
        """Подтверждение человеком: выпускаем токен и кладём его в сессию."""
        import re

        store = _store(hass)
        now = time.time()
        store.purge(now)

        panel_id = (msg["panel_id"] or "").strip()
        if not re.match(SLUG_REGEX, panel_id):
            connection.send_error(msg["id"], "invalid_panel_id", "Некорректный идентификатор панели")
            return
        if panel_id not in taken_panel_ids(hass):
            connection.send_error(
                msg["id"], "unknown_panel",
                f"Панели «{panel_id}» нет — сначала создайте её в списке панелей",
            )
            return

        session = store.by_code(msg["code"])
        if session is None:
            connection.send_error(
                msg["id"], "unknown_code",
                "Код не найден или устарел. Обновите код на экране панели.",
            )
            return
        if session.approved:
            connection.send_error(msg["id"], "already_approved", "Эта привязка уже подтверждена")
            return

        user = connection.user
        if user is None or not user.is_admin:
            connection.send_error(msg["id"], "unauthorized", "Нужны права администратора")
            return

        try:
            token = await async_issue_panel_token(hass, user, panel_id)
        except ValueError as err:
            connection.send_error(msg["id"], "token_failed", f"Не удалось выпустить токен: {err}")
            return

        registry = _devices(hass)
        device_id, device_secret = await registry.async_register(
            panel_id=panel_id, user_id=user.id, name=session.name,
        )
        session.token = token
        session.panel_id = panel_id
        session.device_id = device_id
        session.device_secret = device_secret
        session.approved_by = user.name or user.id
        connection.send_result(msg["id"], {"panel_id": panel_id, "name": session.name})

    websocket_api.async_register_command(hass, websocket_pair_list)
    websocket_api.async_register_command(hass, websocket_pair_approve)
    data["pairing_registered"] = True
