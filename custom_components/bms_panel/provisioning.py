"""Установка нашего приложения на заводскую Linux-панель по сети — без
компьютера и без физического доступа к панели.

ПОЧЕМУ ЭТО ВООБЩЕ ВОЗМОЖНО. Заводская прошивка конкретной партии железа
(SigmaStar SSD20x / FlyThings) держит ADB (порт 5555) открытым в сети с
правами root и БЕЗ ПАРОЛЯ — задокументированный факт конкретного образца,
не наш взлом (см. linux/docs/паспорт-панели-SSD202D.txt, раздел «Какие панели
подойдут»). Именно поэтому discover() проверяет ТРИ признака, а не просто
«порт открыт» — так отсекаются чужие устройства в той же сети.

ПОЧЕМУ ЭТО БЕЗОПАСНО ОСТАВИТЬ ВКЛЮЧЁННЫМ В ИНТЕГРАЦИИ. Не сработает против
чужих панелей: install() требует явно выбранного IP (список кандидатов —
только для того, чтобы техник ткнул в нужный, а не «само всё поставило»), и
пишет учётные данные конкретного дома. А открытая дверь ADB, которой мы
пользуемся, закрывается самим устройством на первой же загрузке нашего
приложения — см. lockdown_adb_network() в linux/src/autostart/bmsstart.c.
Эта интеграция НЕ размыкает ничего нового — она лишь автоматизирует те же
команды, что раньше человек вводил руками с ноутбука (см. тот же паспорт,
раздел «Запуск и отладка»).

Поток:
  1. async_discover_factory_panels — сканирует подсети HA, ищет хосты с
     открытым 5555, подтверждает фингерпринт. НИЧЕГО не меняет на устройстве.
  2. async_install_panel — на ВЫБРАННЫЙ вызывающим IP: заливает mtdflash +
     заранее собранный образ раздела res, прошивает раздел, тут же (сама, как
     администратор — без QR и без ожидания телефона) выпускает панели её
     собственные учётные данные и кладёт их в ha.conf, перезагружает панель.

ЧЕГО ЗДЕСЬ НЕТ. Асинхронной библиотеки ADB (`adb-shell`) при первом запуске
может не быть в окружении — см. _require_adb_shell(). Работа с реальным
адаптером не проверялась на живой панели (нет доступа к железу из среды
разработки) — прежде чем полагаться на это для всего парка, пройти ОДИН раз
руками до конца на запасной панели и сверить с паспортом.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
import os
import re
import shutil
import socket
import tarfile
import time
from dataclasses import dataclass, field

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric import ed25519

from homeassistant.core import HomeAssistant, HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    DOMAIN,
    PROVISION_REPO_NAME,
    PROVISION_REPO_OWNER,
    PROVISION_SIGNING_PUBKEY_B64,
    SLUG_REGEX,
)
from .pairing import async_issue_panel_token, async_register_device_identity

# Куда на диске HA кешируются проверенные файлы установки (переживает
# перезапуск HA — не /tmp). Разложено по тегу релиза: новый релиз просто
# получает свою подпапку, старые можно чистить руками при желании.
PROVISION_CACHE_SUBDIR = "bms_panel_provision_cache"
# Что должно быть в манифесте каждого релиза — provisioning.py и release.py
# (сборщик релиза) должны совпадать по этому списку имён.
PROVISION_ARTIFACT_NAMES = ("bmspanel", "mtdflash", "res_new.sqfs", "assets.tar.gz")

_LOGGER = logging.getLogger(__name__)

ADB_PORT = 5555
# Признаки конкретной партии железа — см. паспорт панели, раздел «Какие панели
# подойдут». Обе строки ОБЯЗАНЫ совпасть, иначе это не наша панель (или другая
# прошивка, для которой этот путь не изучен) — тогда молча пропускаем хост.
FINGERPRINT_MODEL = "SSD20X"
FINGERPRINT_RELEASE_PREFIX = "flythings"

# Куда на панели временно кладём инструмент прошивки и образ — существующий
# писчий раздел (74 МБ), тот же что упомянут в паспорте. Не /tmp: содержимое
# /tmp пропадает при первом же ребуте, а mtdflash должен пережить один пуск.
DEVICE_PROVISION_DIR = "/mnt/sdnand/bms-provision"
DEVICE_APP_DIR = "/mnt/sdnand/bms"

# Сколько хостов сканируем параллельно — подсеть /24 это 254 адреса; больше
# держим в уме, чтобы не забить Wi-Fi клиента залпом SYN-пакетов разом.
SCAN_CONCURRENCY = 24
SCAN_PORT_TIMEOUT_S = 0.35
ADB_CONNECT_TIMEOUT_S = 6.0


class ProvisioningError(HomeAssistantError):
    """Установка не удалась на каком-то шаге — текст уже готов для пользователя."""


def _require_adb_shell():
    """adb-shell — необязательная (тяжёлая) зависимость: нужна только тем, кто
    реально пользуется автоустановкой. Без неё остальная интеграция работает
    как раньше. Ловим импорт здесь, а не на верхнем уровне модуля.

    Ключевой аутентификации сознательно не заводим (rsa_keys=[] везде ниже) —
    заводская прошивка этой партии её не требует (см. паспорт панели, «root,
    пароля нет»); если конкретный образец всё же потребует ключ, ADB просто
    откажет — такой хост не попадёт в список кандидатов."""
    try:
        from adb_shell.adb_device_async import AdbDeviceTcpAsync
    except ImportError as err:
        raise ProvisioningError(
            "Для автоустановки нужен пакет adb-shell — его нет в текущей сборке "
            "дополнения. Обновите дополнение BMS Smart Panel (requirements "
            "подхватываются только пересборкой, не «Обновить конфигурацию»)."
        ) from err
    return AdbDeviceTcpAsync


@dataclass
class DiscoveredPanel:
    """Один найденный кандидат — заводская панель нашей партии в сети HA."""

    ip: str
    model: str
    release: str


@dataclass
class ProvisionProgress:
    """Ход установки на один IP — читается фронтом/уведомлением по шагам."""

    ip: str
    step: str = "старт"
    done: bool = False
    ok: bool = False
    error: str | None = None
    panel_id: str | None = None
    steps_log: list[str] = field(default_factory=list)

    def note(self, text: str) -> None:
        self.step = text
        self.steps_log.append(text)
        _LOGGER.info("BMS provisioning %s: %s", self.ip, text)


# ---------------------------------------------------------------------------
# Обнаружение
# ---------------------------------------------------------------------------

def _local_ipv4_and_prefix() -> tuple[str, str] | None:
    """Свой адрес в локальной сети и префикс /24 — тем же приёмом, что уже
    применяется на Android-панели для поиска дома (PairingClient.kt,
    localSubnetPrefix): открываем UDP-сокет «в сторону» публичного адреса,
    данные не уходят, но ОС выбирает исходящий интерфейс — забираем его адрес.
    """
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
        prefix = ".".join(ip.split(".")[:3])
        return ip, prefix
    except OSError:
        return None


async def _probe_port(host: str, port: int, timeout: float) -> bool:
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=timeout
        )
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:  # noqa: BLE001 — закрытие сокета не должно ронять скан
            pass
        return True
    except (OSError, asyncio.TimeoutError):
        return False


async def _fingerprint_host(host: str) -> DiscoveredPanel | None:
    """Полная проверка кандидата: ADB-подключение без ключа + два getprop.
    Дороже простого TCP-пробника, поэтому вызывается только для хостов с уже
    открытым портом."""
    AdbDeviceTcpAsync = _require_adb_shell()
    device = AdbDeviceTcpAsync(host, port=ADB_PORT, default_transport_timeout_s=ADB_CONNECT_TIMEOUT_S)
    try:
        # rsa_keys=[] — без попытки ключевой аутентификации: заводская сборка
        # этой партии её не требует (подтверждено паспортом панели, «root,
        # пароля нет»). Если конкретный образец всё же потребует ключ — ADB
        # вернёт отказ, и хост просто не попадёт в список кандидатов.
        await asyncio.wait_for(
            device.connect(rsa_keys=[], auth_timeout_s=ADB_CONNECT_TIMEOUT_S),
            timeout=ADB_CONNECT_TIMEOUT_S + 1,
        )
        model = (await device.shell("getprop ro.product.model")).strip()
        release = (await device.shell("getprop ro.build.version.release")).strip()
        if FINGERPRINT_MODEL not in model or not release.startswith(FINGERPRINT_RELEASE_PREFIX):
            return None
        return DiscoveredPanel(ip=host, model=model, release=release)
    except Exception as exc:  # noqa: BLE001 — чужое устройство на порту 5555 тоже сюда попадёт
        _LOGGER.debug("BMS provisioning: %s не подошёл (%s)", host, exc)
        return None
    finally:
        try:
            await device.close()
        except Exception:  # noqa: BLE001
            pass


async def async_discover_factory_panels(hass: HomeAssistant) -> list[DiscoveredPanel]:
    """Сканирует локальную подсеть HA и возвращает список заводских панелей.

    Ничего не меняет на найденных устройствах — только читает. Чтобы
    действительно поставить софт, вызывающий должен явно выбрать один IP и
    передать его в async_install_panel — списком кандидатов установка НЕ
    управляет сама, это осознанный шаг человека."""
    local = await hass.async_add_executor_job(_local_ipv4_and_prefix)
    if local is None:
        raise ProvisioningError("Не удалось определить локальную сеть — нет сетевого интерфейса?")
    my_ip, prefix = local
    _LOGGER.info("BMS provisioning: сканирую %s.0/24 (свой адрес %s)", prefix, my_ip)

    sem = asyncio.Semaphore(SCAN_CONCURRENCY)

    async def check(host: str) -> DiscoveredPanel | None:
        async with sem:
            if not await _probe_port(host, ADB_PORT, SCAN_PORT_TIMEOUT_S):
                return None
        return await _fingerprint_host(host)

    hosts = [f"{prefix}.{i}" for i in range(1, 255) if f"{prefix}.{i}" != my_ip]
    results = await asyncio.gather(*(check(h) for h in hosts))
    found = [r for r in results if r is not None]
    _LOGGER.info("BMS provisioning: найдено кандидатов %d", len(found))
    return found


# ---------------------------------------------------------------------------
# Установка
# ---------------------------------------------------------------------------

def _addon_dir() -> str:
    return os.path.dirname(__file__)


def _dev_local_paths() -> dict[str, str] | None:
    """Путь РАЗРАБОТЧИКА: если рядом с дополнением лежит собранное дерево
    linux/ (тот же компьютер, где идёт разработка) — используем файлы прямо
    оттуда, без похода в интернет. На боевом сервере HA этого дерева нет —
    тогда возвращаем None, и _resolve_release_artifacts скачивает релиз."""
    root = os.path.abspath(os.path.join(_addon_dir(), "..", "..", "..", "linux"))
    paths = {
        "bmspanel": os.path.join(root, "build", "bmspanel"),
        "mtdflash": os.path.join(root, "build", "mtdflash"),
        "res_new.sqfs": os.path.join(root, "build", "res_new.sqfs"),
        "assets_dir": os.path.join(root, "assets"),
    }
    if all(os.path.exists(p) for p in paths.values()):
        return paths
    return None


async def _github_latest_tag(hass: HomeAssistant) -> str:
    """Тег последнего релиза БЕЗ api.github.com (у него лимит 60 запросов/час
    на IP — на нём уже спотыкался Android-обновлятор). Тот же приём, что
    checkViaRedirect в UpdateChecker.kt: /releases/latest отдаёт 302, разбираем
    Location сами, редирект не проходим."""
    session = async_get_clientsession(hass)
    url = f"https://github.com/{PROVISION_REPO_OWNER}/{PROVISION_REPO_NAME}/releases/latest"
    try:
        async with session.get(url, allow_redirects=False, timeout=_http_timeout(10)) as resp:
            location = resp.headers.get("Location", "")
    except Exception as exc:  # noqa: BLE001
        raise ProvisioningError(f"Не удалось связаться с GitHub за релизом: {exc}") from exc

    tag = location.rsplit("/tag/", 1)[-1].split("?")[0] if "/tag/" in location else ""
    if not tag.startswith("v"):
        raise ProvisioningError(
            f"Не найден релиз для автоустановки в {PROVISION_REPO_OWNER}/{PROVISION_REPO_NAME} "
            "— репозиторий пуст или недоступен."
        )
    return tag


def _http_timeout(total_s: float):
    import aiohttp
    return aiohttp.ClientTimeout(total=total_s)


async def _download_to_file(hass: HomeAssistant, url: str, dest_path: str, timeout_s: float = 180) -> None:
    session = async_get_clientsession(hass)
    try:
        async with session.get(url, timeout=_http_timeout(timeout_s)) as resp:
            if resp.status != 200:
                raise ProvisioningError(f"Не удалось скачать {os.path.basename(dest_path)} (HTTP {resp.status})")
            data = await resp.read()
    except ProvisioningError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ProvisioningError(f"Сеть подвела при скачивании {os.path.basename(dest_path)}: {exc}") from exc
    await hass.async_add_executor_job(_write_bytes, dest_path, data)


def _write_bytes(path: str, data: bytes) -> None:
    with open(path, "wb") as f:
        f.write(data)


def _verify_manifest_signature(manifest_bytes: bytes, sig_b64: str) -> None:
    """Manifest ДОЛЖЕН быть подписан ИМЕННО нашим приватным ключом (см.
    tools/release.py) — без этого скомпрометированный GitHub-релиз означал бы
    root на панели любого клиента, установившего его."""
    try:
        pubkey_raw = base64.b64decode(PROVISION_SIGNING_PUBKEY_B64)
        pubkey = ed25519.Ed25519PublicKey.from_public_bytes(pubkey_raw)
        pubkey.verify(base64.b64decode(sig_b64.strip()), manifest_bytes)
    except InvalidSignature as err:
        raise ProvisioningError(
            "Подпись файлов установки не совпала с ожидаемой — файлы релиза "
            "могли быть подменены. Установка ОСТАНОВЛЕНА, на панель ничего "
            "не отправлено."
        ) from err
    except Exception as err:  # noqa: BLE001 — битый base64/ключ и т.п.
        raise ProvisioningError(f"Не удалось проверить подпись файлов установки: {err}") from err


def _verify_file_checksum(path: str, expected_hex: str, name: str) -> None:
    actual = hashlib.sha256(open(path, "rb").read()).hexdigest()
    if actual != expected_hex:
        raise ProvisioningError(
            f"Контрольная сумма «{name}» не совпала с манифестом релиза — файл "
            "повреждён или подменён. Установка остановлена."
        )


def _parse_manifest(manifest_bytes: bytes) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in manifest_bytes.decode("utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        digest, _, name = line.partition("  ")
        if digest and name:
            out[name] = digest
    return out


def _extract_assets(cache_dir: str, assets_dir: str) -> None:
    if os.path.isdir(assets_dir):
        shutil.rmtree(assets_dir)
    with tarfile.open(os.path.join(cache_dir, "assets.tar.gz"), "r:gz") as tar:
        tar.extractall(cache_dir)  # архив уже содержит верхнюю папку assets/


async def _resolve_release_artifacts(hass: HomeAssistant) -> dict[str, str]:
    """Реальные пути к файлам установки: сначала — локальная сборка
    разработчика (быстрый путь, без сети), иначе — СКАЧАННЫЙ И ПРОВЕРЕННЫЙ
    релиз с GitHub, закешированный на диске HA по тегу релиза.

    Проверка ДВУХСТУПЕНЧАТАЯ, обе ступени обязательны:
      1) manifest.txt подписан нашим приватным ключом (см. _verify_manifest_
         signature) — доказывает подлинность НАБОРА файлов как единого целого;
      2) каждый скачанный файл сверяется по SHA-256 со строкой в manifest.txt
         (см. _verify_file_checksum) — доказывает, что скачался именно ОН,
         а не битый/подменённый файл под тем же именем.
    Без любой из двух ступеней проверка была бы декоративной."""
    dev = await hass.async_add_executor_job(_dev_local_paths)
    if dev is not None:
        _LOGGER.info("BMS provisioning: использую локальную сборку разработчика (%s)", dev["bmspanel"])
        return dev

    tag = await _github_latest_tag(hass)
    cache_dir = hass.config.path(PROVISION_CACHE_SUBDIR, tag)
    verified_marker = os.path.join(cache_dir, ".verified")
    result = {
        "bmspanel": os.path.join(cache_dir, "bmspanel"),
        "mtdflash": os.path.join(cache_dir, "mtdflash"),
        "res_new.sqfs": os.path.join(cache_dir, "res_new.sqfs"),
        "assets_dir": os.path.join(cache_dir, "assets"),
    }
    already_ok = await hass.async_add_executor_job(
        lambda: os.path.exists(verified_marker)
        and all(os.path.exists(result[k]) for k in ("bmspanel", "mtdflash", "res_new.sqfs", "assets_dir"))
    )
    if already_ok:
        _LOGGER.info("BMS provisioning: релиз %s уже скачан и проверен ранее", tag)
        return result

    await hass.async_add_executor_job(lambda: os.makedirs(cache_dir, exist_ok=True))
    base_url = f"https://github.com/{PROVISION_REPO_OWNER}/{PROVISION_REPO_NAME}/releases/download/{tag}"

    manifest_path = os.path.join(cache_dir, "manifest.txt")
    sig_path = os.path.join(cache_dir, "manifest.sig")
    await _download_to_file(hass, f"{base_url}/manifest.txt", manifest_path, timeout_s=15)
    await _download_to_file(hass, f"{base_url}/manifest.sig", sig_path, timeout_s=15)

    manifest_bytes, sig_text = await hass.async_add_executor_job(
        lambda: (open(manifest_path, "rb").read(), open(sig_path, "r", encoding="utf-8").read())
    )
    await hass.async_add_executor_job(_verify_manifest_signature, manifest_bytes, sig_text)
    checksums = _parse_manifest(manifest_bytes)

    for name in PROVISION_ARTIFACT_NAMES:
        if name not in checksums:
            raise ProvisioningError(f"В манифесте релиза {tag} нет записи для «{name}» — релиз собран неверно")
        dest = os.path.join(cache_dir, name)
        await _download_to_file(hass, f"{base_url}/{name}", dest)
        await hass.async_add_executor_job(_verify_file_checksum, dest, checksums[name], name)

    await hass.async_add_executor_job(_extract_assets, cache_dir, result["assets_dir"])
    await hass.async_add_executor_job(lambda: open(verified_marker, "w").write(tag))

    _LOGGER.info(
        "BMS provisioning: релиз %s скачан, подпись и контрольные суммы проверены", tag
    )
    return result


def _write_ha_conf(host: str, port: int, token: str, panel_id: str,
                   device_id: str, device_secret: str) -> str:
    """Формат — БУКВАЛЬНО тот, что читает read_conf/пишет write_conf в
    linux/src/main.c. Расхождение в хоть одном имени ключа — панель не
    подключится, поэтому это не переносится «на глаз», а копируется 1-в-1."""
    content = (
        f"host={host}\n"
        f"port={port}\n"
        f"token={token}\n"
        f"panel={panel_id}\n"
        f"device_id={device_id}\n"
        f"device_secret={device_secret}\n"
    )
    fd_path = f"/tmp/bms_ha_conf_{panel_id}_{int(time.time())}.tmp"
    with open(fd_path, "w", encoding="utf-8") as f:
        f.write(content)
    return fd_path


async def _ensure_panel_exists(hass: HomeAssistant, panel_id: str | None,
                               panel_name: str) -> str:
    """Панель уже существует в списке — используем её. Иначе заводим новую тем
    же путём, что и обычная кнопка «Добавить панель» (сервис add_panel) —
    не дублируем его логику (лицензия/уникальность panel_id/создание sensor),
    а вызываем сам сервис."""
    taken = set(hass.data.get(DOMAIN, {}).get("meta", {})) | set(
        hass.data.get(DOMAIN, {}).get("configs", {})
    )
    if panel_id and panel_id in taken:
        return panel_id
    if panel_id and not re.match(SLUG_REGEX, panel_id):
        raise ProvisioningError(f"panel_id «{panel_id}» не подходит по формату")

    await hass.services.async_call(
        DOMAIN, "add_panel",
        {"panel_id": panel_id, "panel_name": panel_name} if panel_id
        else {"panel_name": panel_name},
        blocking=True,
    )
    # add_panel сам подбирает id, если не передан явно — забираем актуальный
    # список и берём то, что появилось нового (по имени, раз id не знаем).
    if panel_id:
        return panel_id
    meta = hass.data.get(DOMAIN, {}).get("meta", {})
    for pid, m in meta.items():
        if m.get("panel_name") == panel_name and pid not in taken:
            return pid
    raise ProvisioningError("Панель создана, но не удалось определить её panel_id")


async def async_install_panel(
    hass: HomeAssistant,
    ip: str,
    *,
    user_id: str,
    panel_id: str | None = None,
    panel_name: str = "Новая панель",
    ha_host: str | None = None,
    ha_port: int = 8123,
    progress: ProvisionProgress | None = None,
) -> ProvisionProgress:
    """Полная установка на один IP: прошивка + собственные учётные данные +
    перезагрузка. Вызывающий ДОЛЖЕН заранее вызвать async_discover_factory_panels
    и передать сюда именно тот IP, который решил ставить — вслепую по всей
    сети эта функция не бегает."""
    AdbDeviceTcpAsync = _require_adb_shell()
    p = progress or ProvisionProgress(ip=ip)

    user = await hass.auth.async_get_user(user_id)
    if user is None or not user.is_admin:
        raise ProvisioningError("Установка панели доступна только администраторам Home Assistant")

    # Лицензия — ТА ЖЕ проверка, что при подтверждении QR (pairing.py,
    # websocket_pair_approve): новая панель без действующей лицензии дома не
    # заводится никаким путём, автоустановка не в обход.
    from .license import async_get_state as _license_state
    lic = await _license_state(hass)
    if not lic.get("valid"):
        raise ProvisioningError(
            f"{lic.get('reason', 'Нет действующей лицензии')} "
            f"Идентификатор этого дома: {lic.get('instance', '')}"
        )

    if ha_host:
        host = ha_host
    else:
        local = await hass.async_add_executor_job(_local_ipv4_and_prefix)
        if local is None:
            raise ProvisioningError(
                "Не удалось определить адрес сервера HA в локальной сети — "
                "передайте ha_host явно."
            )
        host = local[0]

    device = AdbDeviceTcpAsync(ip, port=ADB_PORT, default_transport_timeout_s=ADB_CONNECT_TIMEOUT_S)
    try:
        # Файлы установки — ПЕРВЫМ делом, до того как трогать панель: если
        # скачивание/проверка подписи не удались, нет смысла подключаться к
        # устройству вообще. При повторных установках после первой обычно
        # мгновенно (кеш на диске HA, см. _resolve_release_artifacts).
        p.note("получаю файлы установки")
        paths = await _resolve_release_artifacts(hass)

        p.note("подключаюсь по ADB")
        await asyncio.wait_for(
            device.connect(rsa_keys=[], auth_timeout_s=ADB_CONNECT_TIMEOUT_S),
            timeout=ADB_CONNECT_TIMEOUT_S + 1,
        )

        p.note("проверяю, что это наша панель")
        model = (await device.shell("getprop ro.product.model")).strip()
        release = (await device.shell("getprop ro.build.version.release")).strip()
        if FINGERPRINT_MODEL not in model or not release.startswith(FINGERPRINT_RELEASE_PREFIX):
            raise ProvisioningError(
                f"{ip} не похож на заводскую панель нашей партии "
                f"(model={model!r}, release={release!r}) — установка отменена"
            )

        p.note("завожу/нахожу панель в списке")
        resolved_panel_id = await _ensure_panel_exists(hass, panel_id, panel_name)
        p.panel_id = resolved_panel_id

        p.note("выпускаю ключ панели")
        token = await async_issue_panel_token(hass, user, resolved_panel_id)
        device_id, device_secret = await async_register_device_identity(
            hass, resolved_panel_id, user.id, panel_name,
        )

        p.note("готовлю приложение и конфиг")
        await device.shell(f"mkdir -p {DEVICE_APP_DIR} {DEVICE_PROVISION_DIR}")
        await device.push(paths["bmspanel"], f"{DEVICE_APP_DIR}/bmspanel")
        await device.push(paths["assets_dir"], f"{DEVICE_APP_DIR}/assets")
        await device.shell(f"chmod 755 {DEVICE_APP_DIR}/bmspanel")

        conf_local = await hass.async_add_executor_job(
            _write_ha_conf, host, ha_port, token, resolved_panel_id, device_id, device_secret
        )
        try:
            await device.push(conf_local, f"{DEVICE_APP_DIR}/ha.conf")
        finally:
            os.remove(conf_local)

        p.note("заливаю инструмент прошивки и образ раздела")
        await device.push(paths["mtdflash"], f"{DEVICE_PROVISION_DIR}/mtdflash")
        await device.push(paths["res_new.sqfs"], f"{DEVICE_PROVISION_DIR}/res_new.sqfs")
        await device.shell(f"chmod 755 {DEVICE_PROVISION_DIR}/mtdflash")

        p.note("прошиваю раздел res (не выключать питание!)")
        out = await asyncio.wait_for(
            device.shell(
                f"{DEVICE_PROVISION_DIR}/mtdflash --write /dev/mtd/mtd3 "
                f"{DEVICE_PROVISION_DIR}/res_new.sqfs",
                read_timeout_s=120,
            ),
            timeout=130,
        )
        if "ГОТОВО" not in out:
            raise ProvisioningError(
                "Прошивка раздела res не подтвердила успех — панель НЕ трогаю дальше "
                f"(остаётся на заводской Tuya). Вывод mtdflash: {out.strip()[-800:]}"
            )
        p.note("раздел прошит и сверен")

        await device.shell(f"rm -rf {DEVICE_PROVISION_DIR}")

        p.note("перезагружаю панель")
        try:
            await device.shell("reboot")
        except Exception:  # noqa: BLE001 — после reboot соединение обрывается штатно
            pass

        p.ok = True
        p.note("установка завершена — панель перезагружается со своим приложением")
    except ProvisioningError:
        p.error = p.step
        raise
    except Exception as exc:  # noqa: BLE001
        p.error = str(exc)
        _LOGGER.exception("BMS provisioning: сбой на шаге «%s» для %s", p.step, ip)
        raise ProvisioningError(f"Установка на {ip} остановлена на шаге «{p.step}»: {exc}") from exc
    finally:
        p.done = True
        try:
            await device.close()
        except Exception:  # noqa: BLE001
            pass
    return p
