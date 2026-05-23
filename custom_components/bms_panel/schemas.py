"""Voluptuous schemas + storage migrations.

Главная цель — гарантировать что в storage и на sensor.extra_state_attributes
всегда лежит конфиг ожидаемой формы. Без этого Android может упасть на типах
(например `screens.light` = строка вместо dict).
"""
from __future__ import annotations

import copy
import voluptuous as vol

from .const import (
    BG_DIM_MAX,
    BG_DIM_MIN,
    BIND_KEYS,
    CONFIG_SCHEMA_VERSION,
    DEFAULT_CONFIG,
    HOME_NAV_OPTIONS,
    HOME_NAV_REQUIRED_LEN,
    LANGUAGES,
    SCREEN_KEYS,
    SCREEN_TIMEOUT_OPTIONS,
)

# ---------- Под-схемы ----------

SCREEN_ITEM_SCHEMA = vol.Schema({
    vol.Required("enabled"): bool,
    vol.Required("order"):   vol.All(int, vol.Range(min=1, max=99)),
    vol.Optional("label"):   str,
})

SCREENS_SCHEMA = vol.Schema({k: SCREEN_ITEM_SCHEMA for k in SCREEN_KEYS})

HOME_NAV_SCHEMA = vol.All(
    list,
    vol.Length(min=HOME_NAV_REQUIRED_LEN, max=HOME_NAV_REQUIRED_LEN),
    [vol.In(HOME_NAV_OPTIONS)],
)


def _entity_value(value):
    """None или строка вида 'domain.name' (один entity)."""
    if value in (None, ""):
        return None
    if isinstance(value, str) and "." in value:
        return value
    raise vol.Invalid(f"Невалидный entity_id: {value!r}")


def _entity_list(value):
    """Список entity_id. Пустой список = ничего не выбрано."""
    if value is None:
        return []
    if not isinstance(value, list):
        raise vol.Invalid("Ожидался список entity_id")
    out = []
    for v in value:
        if v in (None, ""):
            continue
        if not (isinstance(v, str) and "." in v):
            raise vol.Invalid(f"Невалидный entity_id в списке: {v!r}")
        out.append(v)
    # dedup сохраняя порядок
    seen = set()
    return [x for x in out if not (x in seen or seen.add(x))]


def _bind_value(meta):
    return _entity_list if meta["multi"] else _entity_value


ENTITIES_SCHEMA = vol.Schema({
    vol.Optional(key): _bind_value(meta) for key, meta in BIND_KEYS.items()
})


# ---------- Главная схема конфига ----------

CONFIG_SCHEMA = vol.Schema({
    vol.Optional("schema_version", default=CONFIG_SCHEMA_VERSION):
        vol.All(int, vol.Range(min=1)),
    vol.Optional("screens",        default=lambda: copy.deepcopy(DEFAULT_CONFIG["screens"])):
        SCREENS_SCHEMA,
    vol.Optional("home_nav",       default=lambda: list(DEFAULT_CONFIG["home_nav"])):
        HOME_NAV_SCHEMA,
    vol.Optional("background_dim", default=DEFAULT_CONFIG["background_dim"]):
        vol.All(int, vol.Range(min=BG_DIM_MIN, max=BG_DIM_MAX)),
    vol.Optional("screen_timeout", default=DEFAULT_CONFIG["screen_timeout"]):
        vol.In(SCREEN_TIMEOUT_OPTIONS),
    vol.Optional("language",       default=DEFAULT_CONFIG["language"]):
        vol.In(LANGUAGES),
    vol.Optional("entities",       default=lambda: copy.deepcopy(DEFAULT_CONFIG["entities"])):
        ENTITIES_SCHEMA,
    vol.Optional("area_id",        default=None):
        vol.Any(None, str),
    # Внутреннее, проставляется автоматически
    vol.Optional("_updated"):      str,
}, extra=vol.REMOVE_EXTRA)  # лишние ключи дропаются — защита от старых полей


def _autofix_home_nav(cfg: dict) -> None:
    """Авто-фикс home_nav: если иконка ссылается на выключенный экран — заменить на «menu».

    Иначе пользователь, выключив экран (например Light), не сможет сохранить
    из-за V17 — самосогласованность дефолтов важнее «строгости» валидации.
    """
    if "home_nav" not in cfg or not isinstance(cfg["home_nav"], list):
        return
    screens = cfg.get("screens", {}) or {}
    fixed = []
    for item in cfg["home_nav"]:
        if item == "menu":
            fixed.append("menu")
        elif item in HOME_NAV_OPTIONS and screens.get(item, {}).get("enabled"):
            fixed.append(item)
        else:
            fixed.append("menu")
    cfg["home_nav"] = fixed


def normalize_config(raw: dict | None) -> dict:
    """Прогнать конфиг через схему: добавить недостающие дефолты, выкинуть мусор,
    автоматически починить простые рассинхроны.

    Никогда не падает (raises) — worst-case возвращает DEFAULT_CONFIG.
    Это критично, потому что Android-приложение должно переваривать любой конфиг.
    """
    try:
        cfg = CONFIG_SCHEMA(raw or {})
    except vol.Invalid:
        return copy.deepcopy(DEFAULT_CONFIG)
    _autofix_home_nav(cfg)
    return cfg


# ---------- Storage migrations ----------

def migrate_storage(old_data: dict) -> dict:
    """Привести storage любой старой версии к текущей форме.

    Storage shape:
      { "configs": { panel_id: cfg }, "meta": { panel_id: {panel_name} } }

    v1.1 → v1.2: добавлены ключи в entities (ac_temp_sensor и т.д.).
    Решается просто прогоном через CONFIG_SCHEMA — дефолты сами проставятся.

    Pure sync функция — нет I/O. Если в будущем понадобятся awaitable шаги
    (например очистка orphan registry entries), сделаем async-обёртку.
    """
    if not isinstance(old_data, dict):
        return {"configs": {}, "meta": {}}

    configs = old_data.get("configs", {}) or {}
    meta = old_data.get("meta", {}) or {}

    new_configs = {}
    for panel_id, cfg in configs.items():
        new_configs[panel_id] = normalize_config(cfg)

    return {"configs": new_configs, "meta": dict(meta)}
