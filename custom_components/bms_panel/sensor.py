"""Sensor platform — entity на каждую зарегистрированную панель."""
from __future__ import annotations

import copy
from datetime import datetime

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.entity import DeviceInfo

from .const import DOMAIN, DEFAULT_CONFIG


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """При запуске восстанавливаем все панели из storage."""
    # Сохраняем callback для динамического добавления новых панелей
    hass.data[DOMAIN]["add_entities"] = async_add_entities

    # Восстанавливаем все панели которые были созданы ранее
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
    """Entity = одна BMS-панель. Конфиг хранится в extra_state_attributes."""

    _attr_should_poll = False
    _attr_icon = "mdi:tablet-dashboard"

    def __init__(self, hass: HomeAssistant, panel_id: str, panel_name: str) -> None:
        self._hass = hass
        self._panel_id = panel_id
        self._panel_name = panel_name
        self._attr_unique_id = f"bms_panel_{panel_id}"
        self._attr_name = f"BMS Panel — {panel_name}"
        # ВАЖНО: фиксируем entity_id явно, чтобы он всегда был sensor.bms_panel_<id>
        # независимо от panel_name (кириллица, спецсимволы и т.п.)
        self.entity_id = f"sensor.bms_panel_{panel_id}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, panel_id)},
            name=f"BMS Panel — {panel_name}",
            manufacturer="BMS Smart",
            model="NS Panel Pro (4\")",
        )

    @property
    def native_value(self) -> str:
        return self._config().get("_updated", "configured")

    @property
    def extra_state_attributes(self) -> dict:
        cfg = self._config()
        return {
            "panel_id": self._panel_id,
            "panel_name": self._panel_name,
            **cfg,
        }

    def _config(self) -> dict:
        store = self._hass.data[DOMAIN]["configs"]
        if self._panel_id not in store:
            store[self._panel_id] = copy.deepcopy(DEFAULT_CONFIG)
        return store[self._panel_id]

    def update_config(self, new_config: dict) -> None:
        new_config = dict(new_config)
        new_config["_updated"] = datetime.utcnow().isoformat()
        self._hass.data[DOMAIN]["configs"][self._panel_id] = new_config
        self.async_write_ha_state()
