"""Sensor platform — entity на каждую зарегистрированную панель.

Конфиг лежит в `hass.data[DOMAIN]["configs"][panel_id]` и экспонируется
наружу через `extra_state_attributes`. Android-приложение подписывается
на изменения и слушает их через WebSocket subscribe_trigger.
"""
from __future__ import annotations

import copy
import logging

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.entity import DeviceInfo
from .const import CONFIG_SCHEMA_VERSION, DEFAULT_CONFIG, DOMAIN, SIDEBAR_URL_PATH, SIGNAL_CONFIG_UPDATED

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """При запуске восстанавливаем все панели из storage."""
    hass.data[DOMAIN]["add_entities"] = async_add_entities

    sensors = []
    for panel_id, meta in hass.data[DOMAIN].get("meta", {}).items():
        if panel_id in hass.data[DOMAIN]["panels"]:
            continue
        sensor = BMSPanelSensor(hass, panel_id, meta.get("panel_name", panel_id))
        hass.data[DOMAIN]["panels"][panel_id] = sensor
        sensors.append(sensor)
    if sensors:
        async_add_entities(sensors)


class BMSPanelSensor(SensorEntity):
    """Entity = одна BMS-панель. Конфиг в extra_state_attributes."""

    _attr_should_poll = False
    _attr_icon = "mdi:tablet-dashboard"

    def __init__(self, hass: HomeAssistant, panel_id: str, panel_name: str) -> None:
        self._hass = hass
        self._panel_id = panel_id
        self._panel_name = panel_name
        self._attr_unique_id = f"bms_panel_{panel_id}"
        self._attr_name = f"BMS Panel — {panel_name}"
        # Фиксируем entity_id явно — иначе HA сгенерит по panel_name
        # (кириллица, дубликаты и т.п. сломают Android).
        self.entity_id = f"sensor.bms_panel_{panel_id}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, panel_id)},
            name=f"BMS Panel — {panel_name}",
            manufacturer="BMS Smart",
            model="NS Panel Pro (4\")",
            sw_version=self._hass.data.get(DOMAIN, {}).get("addon_version"),
            configuration_url=f"/{SIDEBAR_URL_PATH}",
        )

    async def async_added_to_hass(self) -> None:
        """Подписываемся на dispatcher — service может попросить refresh."""
        @callback
        def _on_signal(panel_id: str) -> None:
            if panel_id == self._panel_id:
                self.async_write_ha_state()

        self.async_on_remove(
            async_dispatcher_connect(self._hass, SIGNAL_CONFIG_UPDATED, _on_signal)
        )

    @property
    def native_value(self) -> str:
        cfg = self._stored_config()
        return cfg.get("_updated", "configured")

    @property
    def extra_state_attributes(self) -> dict:
        cfg = self._stored_config()
        return {
            "panel_id":             self._panel_id,
            "panel_name":           self._panel_name,
            "config_schema_version": cfg.get("schema_version", CONFIG_SCHEMA_VERSION),
            **cfg,
        }

    def _stored_config(self) -> dict:
        """Достать конфиг из storage без сайд-эффектов.

        Если конфига нет — возвращаем дефолт копией, без записи. Запись
        делает только add_panel/update_config через сервисы.
        """
        store = self._hass.data[DOMAIN].get("configs", {})
        return store.get(self._panel_id) or copy.deepcopy(DEFAULT_CONFIG)
