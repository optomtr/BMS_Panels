"""BMS Smart Panel — единый модуль для управления настенными панелями.

- Регистрирует пункт в сайдбаре HA (visual editor).
- Хранит конфиги панелей в HA Storage с миграциями.
- На каждую панель создаёт sensor.bms_panel_<id> с конфигом в attributes.
- Сервисы: add_panel, remove_panel, update_config, reset_config, clone_panel.
- Серверная валидация конфига перед сохранением (mirror клиентской).
"""
from __future__ import annotations

import asyncio
import copy
import json
import logging
import os
import re

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components import panel_custom
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import (
    config_validation as cv,
    entity_registry as er,
    storage,
)
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .const import (
    DEFAULT_CONFIG,
    DOMAIN,
    SERVICE_ADD_PANEL,
    SERVICE_CLONE_PANEL,
    SERVICE_REMOVE_PANEL,
    SERVICE_RESET_CONFIG,
    SERVICE_UPDATE_CONFIG,
    SIDEBAR_URL_PATH,
    SIGNAL_CONFIG_UPDATED,
    SLUG_REGEX,
    STATIC_URL_PATH,
    STORAGE_KEY,
    STORAGE_VERSION_MAJOR,
    STORAGE_VERSION_MINOR,
)
from .schemas import migrate_storage, normalize_config
from .validation import has_errors, summary as validation_summary, validate

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.SENSOR]

SIDEBAR_TITLE = "BMS Panels"
SIDEBAR_ICON = "mdi:tablet-dashboard"


_CYRILLIC_TRANSLIT = str.maketrans({
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    "қ": "q", "ғ": "g", "ҳ": "h", "ў": "o",
})


def _slug(s: str) -> str:
    """Сгенерировать panel_id из имени.

    Только ASCII: кириллица транслитерируется, остальные символы становятся
    разделителями. Иначе entity_id `sensor.bms_panel_кухня` будет невалидным.
    """
    s = (s or "").lower().translate(_CYRILLIC_TRANSLIT)
    s = re.sub(r"[^a-z0-9_-]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_-")
    s = s[:32].strip("_-")
    if not s or not re.match(SLUG_REGEX, s):
        return "panel"
    return s


def _unique_panel_id(base: str, existing) -> str:
    """Вернуть свободный panel_id на основе base: kitchen, kitchen_2, ..."""
    base = _slug(base)
    if base not in existing:
        return base
    for n in range(2, 1000):
        suffix = f"_{n}"
        candidate = f"{base[:32 - len(suffix)].rstrip('_-')}{suffix}"
        if candidate not in existing:
            return candidate
    raise HomeAssistantError("Не удалось подобрать свободный Panel ID.")


def _taken_panel_ids(hass: HomeAssistant) -> set[str]:
    """Все занятые ID, включая частично сохранённые записи после старых ошибок."""
    data = hass.data.get(DOMAIN, {})
    return (
        set(data.get("meta", {}))
        | set(data.get("configs", {}))
        | set(data.get("panels", {}))
    )


async def _async_load_storage(hass: HomeAssistant) -> tuple[storage.Store, dict, dict]:
    """Загрузить storage с миграцией."""
    store = storage.Store(
        hass,
        STORAGE_VERSION_MAJOR,
        STORAGE_KEY,
        minor_version=STORAGE_VERSION_MINOR,
    )
    raw = await store.async_load() or {}
    # Прогон через миграцию (всегда — она идемпотентна для актуальной версии).
    migrated = migrate_storage(raw)
    configs = migrated.get("configs", {})
    meta = migrated.get("meta", {})
    return store, configs, meta


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Базовая инициализация — storage, статика, сервисы."""
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN].setdefault("panels", {})  # panel_id -> sensor entity

    # ---- Storage ----
    store, configs, meta = await _async_load_storage(hass)
    hass.data[DOMAIN]["store"] = store
    hass.data[DOMAIN]["configs"] = configs
    hass.data[DOMAIN]["meta"] = meta
    hass.data[DOMAIN]["save_lock"] = asyncio.Lock()

    async def _save():
        """Атомарно сохранить storage (snapshot+lock).

        - snapshot защищает от мутаций между сериализацией и записью
        - asyncio.Lock сериализует параллельные вызовы (две одновременных
          update_config с разных browser-табов не теряют друг друга)
        """
        async with hass.data[DOMAIN]["save_lock"]:
            snapshot = {
                "configs": copy.deepcopy(hass.data[DOMAIN]["configs"]),
                "meta":    copy.deepcopy(hass.data[DOMAIN]["meta"]),
            }
            await store.async_save(snapshot)

    hass.data[DOMAIN]["save"] = _save

    # ---- Static path для editor.js / валидации / превью ----
    panel_dir = os.path.join(os.path.dirname(__file__), "panel")
    if not hass.data[DOMAIN].get("static_registered"):
        try:
            await hass.http.async_register_static_paths([
                type("StaticPathConfig", (), {
                    "url_path": STATIC_URL_PATH,
                    "path": panel_dir,
                    "cache_headers": False,
                })()
            ])
        except (AttributeError, TypeError):
            hass.http.register_static_path(STATIC_URL_PATH, panel_dir, cache_headers=False)
        hass.data[DOMAIN]["static_registered"] = True

    # ---- Cache-busting: version из manifest.json ----
    # async-friendly: HA не любит open() в event loop (выдаёт WARNING про blocking call).
    # Читаем через executor — то же самое, но не блокирует loop.
    addon_version = "unknown"
    manifest_path = os.path.join(os.path.dirname(__file__), "manifest.json")
    def _read_manifest() -> str:
        try:
            with open(manifest_path, "r") as f:
                return json.load(f).get("version", "unknown")
        except Exception:  # noqa: BLE001
            return "unknown"
    try:
        addon_version = await hass.async_add_executor_job(_read_manifest)
    except Exception:  # noqa: BLE001
        pass
    hass.data[DOMAIN]["addon_version"] = addon_version

    # ---- Сайдбар-панель ----
    if not hass.data[DOMAIN].get("sidebar_registered"):
        try:
            await panel_custom.async_register_panel(
                hass,
                webcomponent_name="bms-panel-editor",
                sidebar_title=SIDEBAR_TITLE,
                sidebar_icon=SIDEBAR_ICON,
                frontend_url_path=SIDEBAR_URL_PATH,
                module_url=f"{STATIC_URL_PATH}/editor.js?v={addon_version}",
                embed_iframe=False,
                require_admin=False,
            )
            hass.data[DOMAIN]["sidebar_registered"] = True
            _LOGGER.info("BMS Panel sidebar registered (v%s)", addon_version)
        except ValueError as e:
            # Уже зарегистрирован — например после reload integration. Это OK.
            _LOGGER.debug("Sidebar already registered: %s", e)
            hass.data[DOMAIN]["sidebar_registered"] = True

    # ---- Сервисы ----
    await _async_register_services(hass)
    _async_register_websocket_api(hass)

    return True


def _panel_payload(hass: HomeAssistant, panel_id: str) -> dict:
    """Единый payload для UI: storage-first, sensor state как дополнительный слой."""
    meta = hass.data[DOMAIN].get("meta", {}).get(panel_id, {})
    cfg = copy.deepcopy(
        hass.data[DOMAIN].get("configs", {}).get(panel_id, DEFAULT_CONFIG)
    )
    state = hass.states.get(f"sensor.bms_panel_{panel_id}")
    return {
        "entity_id": f"sensor.bms_panel_{panel_id}",
        "panel_id": panel_id,
        "panel_name": meta.get("panel_name", panel_id),
        "config": cfg,
        "last_updated": state.last_updated.isoformat() if state else None,
        "state": state.state if state else "configured",
    }


def _async_register_websocket_api(hass: HomeAssistant) -> None:
    """WebSocket API для редактора. Не зависит от наличия sensor в hass.states."""
    if hass.data[DOMAIN].get("websocket_registered"):
        return

    @websocket_api.websocket_command({
        vol.Required("type"): "bms_panel/list_panels",
    })
    @websocket_api.async_response
    async def websocket_list_panels(
        hass: HomeAssistant,
        connection: websocket_api.ActiveConnection,
        msg: dict,
    ) -> None:
        panel_ids = sorted(_taken_panel_ids(hass))
        panels = [_panel_payload(hass, panel_id) for panel_id in panel_ids]
        connection.send_result(msg["id"], panels)

    websocket_api.async_register_command(hass, websocket_list_panels)
    hass.data[DOMAIN]["websocket_registered"] = True


async def _async_register_services(hass: HomeAssistant) -> None:
    """Регистрирует все сервисы. Идемпотентно — повторный вызов перерегистрирует."""

    async def _save():
        await hass.data[DOMAIN]["save"]()

    async def update_config(call: ServiceCall) -> None:
        panel_id = (call.data["panel_id"] or "").strip().lower()
        raw_cfg = call.data.get("config") or {}

        if panel_id not in hass.data[DOMAIN]["meta"]:
            raise HomeAssistantError(f"Panel '{panel_id}' not found. Используйте add_panel сначала.")

        # 1. Schema-normalize (отбрасывает мусор, проставляет дефолты)
        cfg = normalize_config(raw_cfg)

        # 2. Полный validation — оборачиваем чтобы баг в правиле не стал 500
        try:
            all_panels = [
                {"panel_id": pid, "panel_name": hass.data[DOMAIN]["meta"].get(pid, {}).get("panel_name", pid), "config": c}
                for pid, c in hass.data[DOMAIN]["configs"].items()
            ]
            states_dict = {s.entity_id: s for s in hass.states.async_all()}
            issues = validate(cfg, panel_id, all_panels, states_dict)
        except Exception as exc:  # noqa: BLE001
            _LOGGER.exception("Validation engine crashed")
            raise HomeAssistantError(
                "Внутренняя ошибка валидации — конфиг не сохранён. "
                "Сообщите разработчику с логом HA."
            ) from exc

        if has_errors(issues):
            error_msgs = [i.message for i in issues if i.severity == "error"][:3]
            raise HomeAssistantError(
                "Конфиг не сохранён — есть ошибки: " + " | ".join(error_msgs)
            )

        # 3. Атомарная запись с rollback: сохраняем старый, ставим новый,
        # при ошибке _save — откатываем in-memory.
        old_cfg = hass.data[DOMAIN]["configs"].get(panel_id)
        hass.data[DOMAIN]["configs"][panel_id] = cfg
        try:
            await _save()
        except Exception as exc:  # noqa: BLE001
            # Откат — иначе диск-память разойдутся до рестарта HA
            if old_cfg is not None:
                hass.data[DOMAIN]["configs"][panel_id] = old_cfg
            else:
                hass.data[DOMAIN]["configs"].pop(panel_id, None)
            _LOGGER.exception("Save failed, rolled back in-memory")
            raise HomeAssistantError(f"Не удалось сохранить на диск: {exc}") from exc

        async_dispatcher_send(hass, SIGNAL_CONFIG_UPDATED, panel_id)
        _LOGGER.debug("Config updated '%s' (issues=%s)", panel_id, validation_summary(issues))

    async def reset_config(call: ServiceCall) -> None:
        panel_id = call.data["panel_id"]
        if panel_id not in hass.data[DOMAIN]["meta"]:
            raise HomeAssistantError(f"Panel '{panel_id}' not found.")
        old_cfg = hass.data[DOMAIN]["configs"].get(panel_id)
        hass.data[DOMAIN]["configs"][panel_id] = copy.deepcopy(DEFAULT_CONFIG)
        try:
            await _save()
        except Exception as exc:  # noqa: BLE001
            if old_cfg is not None:
                hass.data[DOMAIN]["configs"][panel_id] = old_cfg
            else:
                hass.data[DOMAIN]["configs"].pop(panel_id, None)
            _LOGGER.exception("reset_config save failed, rolled back")
            raise HomeAssistantError(f"Не удалось сохранить: {exc}") from exc
        async_dispatcher_send(hass, SIGNAL_CONFIG_UPDATED, panel_id)

    async def add_panel(call: ServiceCall) -> None:
        raw_id = (call.data.get("panel_id") or "").strip().lower()
        explicit_id = bool(raw_id)
        # Принимаем оба ключа — panel_name (документированный) и name (интуитивно
        # ожидаемый интегратором по аналогии с другими HA сервисами).
        panel_name = (call.data.get("panel_name") or call.data.get("name") or "").strip()
        if not panel_name:
            raise HomeAssistantError(
                "Имя панели не задано. Передайте panel_name (или name) — "
                "например «Кухня» или «Спальня»."
            )
        if not raw_id:
            raw_id = _unique_panel_id(panel_name, _taken_panel_ids(hass))
        if not re.match(SLUG_REGEX, raw_id):
            raise HomeAssistantError(
                f"Panel ID «{raw_id}» невалиден. Разрешены латиница, цифры, _ и - (2–32 символа)."
            )
        if explicit_id and raw_id in _taken_panel_ids(hass):
            raise HomeAssistantError(f"Panel ID «{raw_id}» уже занят.")

        # КРИТИЧНО: если sensor platform не загружена через config entry —
        # add_entities callback отсутствует и панель не появится. Раньше тут
        # был молчаливый warning — интегратор видел успех но пустой результат.
        # Теперь падаем сразу с понятным сообщением.
        add_cb = hass.data[DOMAIN].get("add_entities")
        if not add_cb:
            raise HomeAssistantError(
                "Интеграция BMS Smart Panel установлена, но не настроена. "
                "Откройте Settings → Devices & Services → Add Integration → "
                "найдите «BMS Smart Panel» и нажмите Submit. После этого "
                "повторите add_panel."
            )

        # In-memory сначала, потом save. Если sensor-create упадёт — откатим всё.
        hass.data[DOMAIN]["meta"][raw_id] = {"panel_name": panel_name}
        is_new_config = raw_id not in hass.data[DOMAIN]["configs"]
        if is_new_config:
            hass.data[DOMAIN]["configs"][raw_id] = copy.deepcopy(DEFAULT_CONFIG)
        try:
            await _save()
        except Exception as exc:  # noqa: BLE001
            hass.data[DOMAIN]["meta"].pop(raw_id, None)
            if is_new_config:
                hass.data[DOMAIN]["configs"].pop(raw_id, None)
            raise HomeAssistantError(f"Не удалось сохранить: {exc}") from exc

        from .sensor import BMSPanelSensor
        try:
            sensor = BMSPanelSensor(hass, raw_id, panel_name)
            hass.data[DOMAIN]["panels"][raw_id] = sensor
            add_cb([sensor])
            _LOGGER.info("Added panel '%s' (%s)", raw_id, panel_name)
        except Exception as exc:  # noqa: BLE001
            # add_cb оказался stale (после unload). Чистим in-memory и storage
            # чтобы не оставлять zombie. Интегратор увидит реальную причину.
            _LOGGER.exception("Failed to add sensor via callback")
            hass.data[DOMAIN]["panels"].pop(raw_id, None)
            hass.data[DOMAIN]["meta"].pop(raw_id, None)
            if is_new_config:
                hass.data[DOMAIN]["configs"].pop(raw_id, None)
            try:
                await _save()
            except Exception:  # noqa: BLE001
                pass
            raise HomeAssistantError(
                "Не удалось создать sensor для панели. Попробуйте перезагрузить "
                f"интеграцию: Settings → Devices & Services → BMS Smart Panel → "
                f"⋮ → Reload. Техническая причина: {exc}"
            ) from exc

    async def remove_panel(call: ServiceCall) -> None:
        panel_id = call.data["panel_id"]
        if panel_id not in hass.data[DOMAIN]["meta"] and panel_id not in hass.data[DOMAIN]["configs"]:
            raise HomeAssistantError(f"Panel '{panel_id}' not found.")

        sensor = hass.data[DOMAIN]["panels"].pop(panel_id, None)
        if sensor:
            try:
                await sensor.async_remove(force_remove=True)
            except Exception as e:  # noqa: BLE001
                _LOGGER.warning("Remove sensor failed for '%s' (continuing cleanup): %s", panel_id, e)
            registry = er.async_get(hass)
            ent = registry.async_get(sensor.entity_id) if hasattr(sensor, "entity_id") else None
            if ent:
                registry.async_remove(ent.entity_id)
        old_cfg = hass.data[DOMAIN]["configs"].pop(panel_id, None)
        old_meta = hass.data[DOMAIN]["meta"].pop(panel_id, None)
        try:
            await _save()
        except Exception as exc:  # noqa: BLE001
            # Rollback in-memory (sensor уже удалён — переживёт следующий setup)
            if old_cfg is not None:
                hass.data[DOMAIN]["configs"][panel_id] = old_cfg
            if old_meta is not None:
                hass.data[DOMAIN]["meta"][panel_id] = old_meta
            _LOGGER.exception("remove_panel save failed, rolled back in-memory")
            raise HomeAssistantError(f"Не удалось сохранить: {exc}") from exc
        _LOGGER.info("Removed panel '%s'", panel_id)

    async def clone_panel(call: ServiceCall) -> None:
        """Создать копию существующей панели. Удобно для одинаковых комнат."""
        src_id = call.data["source_panel_id"]
        new_name = (call.data["panel_name"] or "").strip()
        if not new_name:
            raise HomeAssistantError("panel_name не может быть пустым.")
        raw_new_id = (call.data.get("panel_id") or "").strip().lower()
        explicit_id = bool(raw_new_id)
        if not raw_new_id:
            raw_new_id = _unique_panel_id(new_name, _taken_panel_ids(hass))
        copy_entities = bool(call.data.get("copy_entities", False))

        if src_id not in hass.data[DOMAIN]["configs"]:
            raise HomeAssistantError(f"Source panel '{src_id}' not found.")
        if explicit_id and raw_new_id in _taken_panel_ids(hass):
            raise HomeAssistantError(f"Panel ID «{raw_new_id}» уже занят.")
        if not re.match(SLUG_REGEX, raw_new_id):
            raise HomeAssistantError(f"Panel ID «{raw_new_id}» невалиден.")

        # Та же гарантия что и в add_panel — без add_cb клон не появится.
        add_cb = hass.data[DOMAIN].get("add_entities")
        if not add_cb:
            raise HomeAssistantError(
                "Интеграция BMS Smart Panel установлена, но не настроена. "
                "Откройте Settings → Devices & Services → Add Integration → "
                "найдите «BMS Smart Panel» и нажмите Submit."
            )

        cloned = copy.deepcopy(hass.data[DOMAIN]["configs"][src_id])
        if not copy_entities:
            # По умолчанию обнуляем entities — нельзя дублировать оборудование
            # между панелями. Интегратор включил copy_entities=True если хочет.
            cloned["entities"] = copy.deepcopy(DEFAULT_CONFIG["entities"])
            cloned["area_id"] = None
        # Нормализация — миграция могла уйти вперёд между исходником и клоном
        cloned = normalize_config(cloned)

        hass.data[DOMAIN]["meta"][raw_new_id] = {"panel_name": new_name or raw_new_id}
        hass.data[DOMAIN]["configs"][raw_new_id] = cloned
        try:
            await _save()
        except Exception as exc:  # noqa: BLE001
            hass.data[DOMAIN]["meta"].pop(raw_new_id, None)
            hass.data[DOMAIN]["configs"].pop(raw_new_id, None)
            raise HomeAssistantError(f"Не удалось сохранить клон: {exc}") from exc

        from .sensor import BMSPanelSensor
        try:
            sensor = BMSPanelSensor(hass, raw_new_id, new_name or raw_new_id)
            hass.data[DOMAIN]["panels"][raw_new_id] = sensor
            add_cb([sensor])
            _LOGGER.info("Cloned '%s' → '%s'", src_id, raw_new_id)
        except Exception as exc:  # noqa: BLE001
            # add_cb stale — откатим storage чтобы не оставлять zombie
            _LOGGER.exception("Failed to add cloned sensor")
            hass.data[DOMAIN]["panels"].pop(raw_new_id, None)
            hass.data[DOMAIN]["meta"].pop(raw_new_id, None)
            hass.data[DOMAIN]["configs"].pop(raw_new_id, None)
            try:
                await _save()
            except Exception:  # noqa: BLE001
                pass
            raise HomeAssistantError(
                "Не удалось создать sensor для клона. Перезагрузите интеграцию: "
                f"Settings → Devices & Services → BMS Smart Panel → ⋮ → Reload. "
                f"Техническая причина: {exc}"
            ) from exc

    services = [
        (SERVICE_UPDATE_CONFIG, update_config, vol.Schema({
            vol.Required("panel_id"): cv.string,
            vol.Required("config"):   dict,
        })),
        (SERVICE_RESET_CONFIG,  reset_config,  vol.Schema({vol.Required("panel_id"): cv.string})),
        (SERVICE_ADD_PANEL,     add_panel,     vol.Schema({
            vol.Optional("panel_id"):   cv.string,
            vol.Optional("panel_name"): cv.string,
            vol.Optional("name"):       cv.string,
        })),
        (SERVICE_REMOVE_PANEL,  remove_panel,  vol.Schema({vol.Required("panel_id"): cv.string})),
        (SERVICE_CLONE_PANEL,   clone_panel,   vol.Schema({
            vol.Required("source_panel_id"): cv.string,
            vol.Required("panel_name"):      cv.string,
            vol.Optional("panel_id"):        cv.string,
            vol.Optional("copy_entities"):   cv.boolean,
        })),
    ]
    for name, func, schema in services:
        # async_register идемпотентен — повторная регистрация перезаписывает.
        hass.services.async_register(DOMAIN, name, func, schema=schema)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Setup config entry — единственный entry на всю интеграцию."""
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Чистый teardown: убираем платформу, очищаем callbacks. Сайдбар оставляем —
    panel_custom не имеет публичного async_unregister до HA 2025.x.

    Сервисы оставляем — они принадлежат yaml-setup, не entry.
    """
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        # Не трогаем panels/configs/meta — они переживут reload.
        hass.data[DOMAIN].pop("add_entities", None)
    return ok
