"""BMS Smart Panel — единый модуль для управления настенными панелями.

Регистрирует свой пункт в сайдбаре HA, хранит конфиги панелей,
динамически создаёт sensor.bms_panel_<id> для каждой добавленной панели.
"""
from __future__ import annotations

import copy
import logging
import os
import re
import voluptuous as vol

from homeassistant.components import panel_custom
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import (
    config_validation as cv,
    entity_registry as er,
    storage,
)

from .const import (
    DOMAIN,
    DEFAULT_CONFIG,
    SERVICE_UPDATE_CONFIG,
    SERVICE_RESET_CONFIG,
    SERVICE_ADD_PANEL,
    SERVICE_REMOVE_PANEL,
)

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.SENSOR]
STORAGE_VERSION = 1
STORAGE_KEY = "bms_panel.configs"

SIDEBAR_TITLE = "BMS Panels"
SIDEBAR_ICON = "mdi:tablet-dashboard"
SIDEBAR_URL_PATH = "bms-panels"
STATIC_URL_PATH = "/bms_panel_static"


def _slug(s: str) -> str:
    s = re.sub(r"[^a-zа-я0-9_]+", "_", (s or "").lower())
    return s.strip("_") or "panel"


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Базовая инициализация — хранилище, статика, сервисы."""
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN].setdefault("panels", {})    # panel_id → sensor entity
    hass.data[DOMAIN].setdefault("panels_meta", {})  # panel_id → {panel_name}

    # ---- Persistent store с конфигами ----
    store = storage.Store(hass, STORAGE_VERSION, STORAGE_KEY)
    stored = await store.async_load() or {}
    hass.data[DOMAIN]["store"] = store
    hass.data[DOMAIN]["configs"] = stored.get("configs", {})
    hass.data[DOMAIN]["meta"] = stored.get("meta", {})  # panel_id → {panel_name}

    async def _save():
        await store.async_save({
            "configs": hass.data[DOMAIN]["configs"],
            "meta":    hass.data[DOMAIN]["meta"],
        })

    hass.data[DOMAIN]["save"] = _save

    # ---- Static path: отдаём JS/CSS из panel/ ----
    panel_dir = os.path.join(os.path.dirname(__file__), "panel")
    try:
        await hass.http.async_register_static_paths([
            type("StaticPathConfig", (), {
                "url_path": STATIC_URL_PATH,
                "path": panel_dir,
                "cache_headers": False,
            })()
        ])
    except (AttributeError, TypeError):
        # Старые версии HA — синхронная регистрация
        hass.http.register_static_path(STATIC_URL_PATH, panel_dir, cache_headers=False)

    # ---- Сайдбар-панель ----
    try:
        await panel_custom.async_register_panel(
            hass,
            webcomponent_name="bms-panel-editor",
            sidebar_title=SIDEBAR_TITLE,
            sidebar_icon=SIDEBAR_ICON,
            frontend_url_path=SIDEBAR_URL_PATH,
            module_url=f"{STATIC_URL_PATH}/editor.js",
            embed_iframe=False,
            require_admin=False,
        )
        _LOGGER.info("BMS Panel registered sidebar item: %s", SIDEBAR_TITLE)
    except ValueError as e:
        _LOGGER.debug("Sidebar panel already registered: %s", e)

    # ---- Сервисы ----
    async def update_config(call: ServiceCall) -> None:
        panel_id = call.data["panel_id"]
        config = call.data["config"]
        hass.data[DOMAIN]["configs"][panel_id] = config
        await _save()
        sensor = hass.data[DOMAIN]["panels"].get(panel_id)
        if sensor:
            sensor.update_config(config)

    async def reset_config(call: ServiceCall) -> None:
        panel_id = call.data["panel_id"]
        hass.data[DOMAIN]["configs"][panel_id] = copy.deepcopy(DEFAULT_CONFIG)
        await _save()
        sensor = hass.data[DOMAIN]["panels"].get(panel_id)
        if sensor:
            sensor.update_config(hass.data[DOMAIN]["configs"][panel_id])

    async def add_panel(call: ServiceCall) -> None:
        panel_id = (call.data.get("panel_id") or "").strip().lower()
        panel_name = (call.data.get("panel_name") or "").strip()
        if not panel_id:
            panel_id = _slug(panel_name)
        if not re.match(r"^[a-z0-9_]+$", panel_id):
            _LOGGER.warning("Invalid panel_id: %s", panel_id)
            return
        if panel_id in hass.data[DOMAIN]["panels"]:
            _LOGGER.info("Panel '%s' already exists", panel_id)
            return
        # Сохраняем meta + дефолтный конфиг
        hass.data[DOMAIN]["meta"][panel_id] = {"panel_name": panel_name or panel_id}
        if panel_id not in hass.data[DOMAIN]["configs"]:
            hass.data[DOMAIN]["configs"][panel_id] = copy.deepcopy(DEFAULT_CONFIG)
        await _save()
        # Создаём сущность через callback платформы
        from .sensor import BMSPanelSensor
        add_cb = hass.data[DOMAIN].get("add_entities")
        if add_cb:
            sensor = BMSPanelSensor(hass, panel_id, panel_name or panel_id)
            hass.data[DOMAIN]["panels"][panel_id] = sensor
            add_cb([sensor])
            _LOGGER.info("Added panel '%s'", panel_id)

    async def remove_panel(call: ServiceCall) -> None:
        panel_id = call.data["panel_id"]
        sensor = hass.data[DOMAIN]["panels"].pop(panel_id, None)
        if sensor:
            try:
                await sensor.async_remove(force_remove=True)
            except Exception as e:
                _LOGGER.debug("Remove sensor: %s", e)
            registry = er.async_get(hass)
            ent = registry.async_get(sensor.entity_id) if hasattr(sensor, "entity_id") else None
            if ent:
                registry.async_remove(ent.entity_id)
        hass.data[DOMAIN]["configs"].pop(panel_id, None)
        hass.data[DOMAIN]["meta"].pop(panel_id, None)
        await _save()
        _LOGGER.info("Removed panel '%s'", panel_id)

    hass.services.async_register(
        DOMAIN, SERVICE_UPDATE_CONFIG, update_config,
        schema=vol.Schema({vol.Required("panel_id"): cv.string, vol.Required("config"): dict}),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_RESET_CONFIG, reset_config,
        schema=vol.Schema({vol.Required("panel_id"): cv.string}),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_ADD_PANEL, add_panel,
        schema=vol.Schema({
            vol.Optional("panel_id"): cv.string,
            vol.Required("panel_name"): cv.string,
        }),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_REMOVE_PANEL, remove_panel,
        schema=vol.Schema({vol.Required("panel_id"): cv.string}),
    )

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Setup config entry — единственный entry на всю интеграцию."""
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
