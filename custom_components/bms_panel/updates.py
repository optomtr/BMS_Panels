"""Обновления панелей через собственный дом клиента — без публичных ссылок.

Зачем так. Раньше панель ходила за обновлением на публичную страницу релизов:
ссылка открыта всему интернету, скачать APK мог кто угодно. Теперь панель берёт
обновление у своего же Home Assistant, где она давно авторизована собственным
ключом, а сам файл кладёт туда владелец.

Что это даёт:
  • публичной ссылки на приложение больше нет — репозиторий можно закрыть;
  • в APK НЕ зашит ни один пароль, поэтому и выковыривать из него нечего
    (прошлый урок: токен, зашитый в сборку, извлекается за минуту);
  • файл отдаётся только тому, кто уже авторизован в этом доме, то есть
    установленной и привязанной панели.

Проверку подписи APK на стороне панели это НЕ отменяет: панель по-прежнему
ставит только то, что подписано тем же ключом, что и она сама.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

# Каталог внутри config HA. Не в `www/` — оттуда файлы раздаются БЕЗ авторизации,
# что вернуло бы ровно ту проблему, от которой уходим.
UPDATES_DIR = "bms_panel_updates"
META_FILE = "latest.json"

# APK панели весит ~2 МБ. Потолок с запасом — и заслон от заливки чего попало.
MAX_APK_BYTES = 60 * 1024 * 1024
VERSION_RE = re.compile(r"v?\d+\.\d+\.\d+")


def _dir(hass: HomeAssistant) -> str:
    return hass.config.path(UPDATES_DIR)


def _meta_path(hass: HomeAssistant) -> str:
    return os.path.join(_dir(hass), META_FILE)


def _read_meta(hass: HomeAssistant) -> dict | None:
    try:
        with open(_meta_path(hass), encoding="utf-8") as f:
            meta = json.load(f)
    except (OSError, ValueError):
        return None
    apk = os.path.join(_dir(hass), meta.get("filename", ""))
    if not meta.get("filename") or not os.path.isfile(apk):
        return None
    return meta


def _write_apk(hass: HomeAssistant, filename: str, contents: bytes, version: str) -> dict:
    """Кладёт APK и описание рядом. Старые файлы убираем — место на диске дома
    не резиновое, а хранить историю версий тут незачем: она есть у владельца."""
    directory = _dir(hass)
    os.makedirs(directory, exist_ok=True)
    for old in os.listdir(directory):
        if old.endswith(".apk"):
            try:
                os.remove(os.path.join(directory, old))
            except OSError:
                _LOGGER.warning("BMS Panel: не удалось убрать старый файл %s", old)
    path = os.path.join(directory, filename)
    with open(path, "wb") as f:
        f.write(contents)
    meta = {
        "version": version,
        "filename": filename,
        "size": len(contents),
        "sha256": hashlib.sha256(contents).hexdigest(),
    }
    with open(_meta_path(hass), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    return meta


class BmsPanelUpdateUploadView(HomeAssistantView):
    """POST /api/bms_panel/update/upload — владелец кладёт новую версию в дом.

    Только администратор: файл ставится на СТЕНОВЫЕ панели, это не та вещь,
    которую может подсунуть любой пользователь дома.
    """

    url = "/api/bms_panel/update/upload"
    name = "api:bms_panel:update_upload"
    requires_auth = True

    async def post(self, request):
        hass = request.app["hass"] if "hass" in request.app else None
        if hass is None:
            from homeassistant.components.http import KEY_HASS
            hass = request.app[KEY_HASS]

        user = request.get("hass_user")
        if user is None or not user.is_admin:
            return self.json({"error": "Требуются права администратора"}, status_code=401)

        data = await request.post()
        field = data.get("file")
        if field is None or not hasattr(field, "file"):
            return self.json({"error": "Нет файла"}, status_code=400)

        filename = os.path.basename(field.filename or "")
        if not filename.lower().endswith(".apk"):
            return self.json({"error": "Ожидался файл .apk"}, status_code=400)

        contents = await hass.async_add_executor_job(field.file.read)
        if not contents:
            return self.json({"error": "Пустой файл"}, status_code=400)
        if len(contents) > MAX_APK_BYTES:
            mb = MAX_APK_BYTES // (1024 * 1024)
            return self.json({"error": f"Файл больше {mb} МБ"}, status_code=400)

        version = str(data.get("version") or "").strip()
        if not version:
            found = VERSION_RE.search(filename)
            version = found.group(0) if found else ""
        if not version:
            return self.json(
                {"error": "Не удалось определить версию: назовите файл вида "
                          "bms-smart-panel-v0.2.42.apk или укажите версию явно"},
                status_code=400,
            )
        if not version.startswith("v"):
            version = "v" + version

        meta = await hass.async_add_executor_job(_write_apk, hass, filename, contents, version)
        _LOGGER.info(
            "BMS Panel: загружено обновление панелей %s (%d байт), загрузил %s",
            version, meta["size"], user.name or user.id,
        )
        return self.json(meta)


class BmsPanelUpdateLatestView(HomeAssistantView):
    """GET /api/bms_panel/update/latest — что за версия лежит в доме.

    Авторизация обязательна: спрашивает уже привязанная панель своим ключом.
    """

    url = "/api/bms_panel/update/latest"
    name = "api:bms_panel:update_latest"
    requires_auth = True

    async def get(self, request):
        from homeassistant.components.http import KEY_HASS
        hass = request.app[KEY_HASS]
        meta = await hass.async_add_executor_job(_read_meta, hass)
        if meta is None:
            return self.json({"error": "Обновление не загружено"}, status_code=404)
        return self.json(meta)


class BmsPanelUpdateDownloadView(HomeAssistantView):
    """GET /api/bms_panel/update/download — сам файл, тоже только по ключу."""

    url = "/api/bms_panel/update/download"
    name = "api:bms_panel:update_download"
    requires_auth = True

    async def get(self, request):
        from homeassistant.components.http import KEY_HASS
        hass = request.app[KEY_HASS]
        meta = await hass.async_add_executor_job(_read_meta, hass)
        if meta is None:
            return self.json({"error": "Обновление не загружено"}, status_code=404)
        path = os.path.join(_dir(hass), meta["filename"])
        return web.FileResponse(
            path,
            headers={"Content-Type": "application/vnd.android.package-archive"},
        )


def async_register_updates(hass: HomeAssistant) -> None:
    """Регистрирует ручки обновления. Идемпотентно."""
    data = hass.data.setdefault(DOMAIN, {})
    if data.get("updates_registered"):
        return
    hass.http.register_view(BmsPanelUpdateUploadView())
    hass.http.register_view(BmsPanelUpdateLatestView())
    hass.http.register_view(BmsPanelUpdateDownloadView())
    data["updates_registered"] = True
