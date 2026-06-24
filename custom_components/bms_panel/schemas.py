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
    CLIMATE_FAN_MODES,
    CLIMATE_HVAC_MODES,
    CLIMATE_PRESET_SCENES,
    CLIMATE_PRESET_SCREENS,
    CLIMATE_TARGET_MAX,
    CLIMATE_TARGET_MIN,
    CONFIG_SCHEMA_VERSION,
    CUSTOM_CARD_ACTION_TYPES,
    CUSTOM_CARD_LABEL_LANGS,
    CUSTOM_CARD_MAX,
    DEFAULT_CONFIG,
    HOME_NAV_MAX_LEN,
    HOME_NAV_MIN_LEN,
    HOME_NAV_OPTIONS,
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
    vol.Length(min=HOME_NAV_MIN_LEN, max=HOME_NAV_MAX_LEN),
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


# ---------- Custom Cards (пользовательские плитки в Menu) ----------

CUSTOM_CARD_LABEL_SCHEMA = vol.Schema({
    vol.Required("ru"): vol.All(str, vol.Length(min=1, max=40)),
    vol.Optional("en", default=""): vol.All(str, vol.Length(max=40)),
    vol.Optional("uz", default=""): vol.All(str, vol.Length(max=40)),
}, extra=vol.REMOVE_EXTRA)


def _custom_card_action(value):
    """Action — диктует семантику нажатия на карточку.

    {"type":"service","service":"script.morning_routine","data":{...}}
    {"type":"entity","entity_id":"light.living_main"}
    {"type":"toggle","entity_id":"switch.kitchen_lights"}
    {"type":"dashboard","url":"/lovelace/0"}
    """
    if not isinstance(value, dict):
        raise vol.Invalid("Action должен быть объектом")
    t = value.get("type")
    if t not in CUSTOM_CARD_ACTION_TYPES:
        raise vol.Invalid(f"Неизвестный type='{t}', допустимы: {CUSTOM_CARD_ACTION_TYPES}")
    out: dict = {"type": t}
    if t == "service":
        svc = value.get("service") or ""
        if not isinstance(svc, str) or "." not in svc or len(svc) > 80:
            raise vol.Invalid("service должен быть строкой формата 'domain.service'")
        out["service"] = svc
        data = value.get("data")
        if data is not None:
            if not isinstance(data, dict):
                raise vol.Invalid("data сервиса должен быть объектом")
            out["data"] = data
    elif t in ("entity", "toggle"):
        eid = value.get("entity_id") or ""
        if not isinstance(eid, str) or "." not in eid:
            raise vol.Invalid("entity_id должен быть строкой 'domain.name'")
        out["entity_id"] = eid
    elif t == "dashboard":
        url = value.get("url") or ""
        if not isinstance(url, str) or not url:
            raise vol.Invalid("url не может быть пустым")
        out["url"] = url
    return out


CUSTOM_CARD_SCHEMA = vol.Schema({
    vol.Required("id"):     vol.All(str, vol.Length(min=1, max=64)),
    vol.Required("label"):  CUSTOM_CARD_LABEL_SCHEMA,
    vol.Required("icon"):   vol.All(str, vol.Length(min=1, max=64)),
    vol.Required("action"): _custom_card_action,
}, extra=vol.REMOVE_EXTRA)


def _custom_cards_value(value):
    """Список карточек: уникальные id, max=CUSTOM_CARD_MAX."""
    if value is None:
        return []
    if not isinstance(value, list):
        raise vol.Invalid("custom_cards должен быть списком")
    if len(value) > CUSTOM_CARD_MAX:
        raise vol.Invalid(f"Слишком много карточек (>{CUSTOM_CARD_MAX})")
    out = []
    seen_ids = set()
    for item in value:
        try:
            card = CUSTOM_CARD_SCHEMA(item)
        except vol.Invalid:
            # Пропускаем битую карточку — другие пусть сохранятся.
            continue
        if card["id"] in seen_ids:
            continue
        seen_ids.add(card["id"])
        out.append(card)
    return out


# ---------- Climate Presets ----------
# Шаг 0.5° — APK округляет до этого. Любые .25 / .75 нормализуются.
def _climate_target(value):
    if value is None or value == "":
        return None
    try:
        v = float(value)
    except (TypeError, ValueError) as exc:
        raise vol.Invalid(f"target должен быть числом, получено: {value!r}") from exc
    if not (CLIMATE_TARGET_MIN <= v <= CLIMATE_TARGET_MAX):
        raise vol.Invalid(
            f"target {v}° вне диапазона [{CLIMATE_TARGET_MIN}, {CLIMATE_TARGET_MAX}]"
        )
    # Округляем до 0.5° — APK всё равно сделает это, а так storage остаётся чистый.
    return round(v * 2) / 2


CLIMATE_PRESET_SCENE_SCHEMA = vol.Schema({
    vol.Optional("target"):    _climate_target,
    vol.Optional("hvac_mode"): vol.Any(None, vol.In(CLIMATE_HVAC_MODES)),
    vol.Optional("fan_mode"):  vol.Any(None, vol.In(CLIMATE_FAN_MODES)),
}, extra=vol.REMOVE_EXTRA)


def _climate_presets_value(value):
    """Нормализовать climate_presets: пустой dict если что-то странное.

    Все ключи опциональны — интегратор задаёт только то что хочет переопределить.
    Поля валидируются ПОПОЛЕВО: невалидный hvac_mode выкидывается, но target
    остаётся. Это важно — иначе одна опечатка в YAML стирает всю сцену.
    """
    if not isinstance(value, dict):
        return {}
    out: dict = {}
    for screen, scenes in value.items():
        if screen not in CLIMATE_PRESET_SCREENS:
            continue
        if not isinstance(scenes, dict):
            continue
        screen_out: dict = {}
        for scene, preset in scenes.items():
            if scene not in CLIMATE_PRESET_SCENES:
                continue
            if not isinstance(preset, dict):
                continue
            cleaned: dict = {}
            # Per-field валидация — каждое поле независимо. Невалидное игнорим
            # (logged-as-warning через voluptuous behavior было бы лишним noise).
            if "target" in preset:
                try:
                    t = _climate_target(preset["target"])
                    if t is not None:
                        cleaned["target"] = t
                except vol.Invalid:
                    pass
            if preset.get("hvac_mode") in CLIMATE_HVAC_MODES:
                cleaned["hvac_mode"] = preset["hvac_mode"]
            if preset.get("fan_mode") in CLIMATE_FAN_MODES:
                cleaned["fan_mode"] = preset["fan_mode"]
            if cleaned:
                screen_out[scene] = cleaned
        if screen_out:
            out[screen] = screen_out
    return out


# ---------- Карта переименований bind-ключей (для миграции старых storage) ----------
# v1.2 → v1.3: APK ожидает plural-имена для fallback-сенсоров температуры и
# не использует ac_fan. Сюда же кладём «исторические» имена на случай если
# какой-то ранний билд писал их в storage (light_master, ac_climate и т.д.).
# Если new_key=None — ключ просто удаляется (APK его больше не читает).
LEGACY_BIND_KEY_MAP: dict[str, str | None] = {
    # Old singular → new plural (fallback-сенсоры climate-экранов)
    "ac_temp_sensor":        "acs_current_temp",
    "heating_temp_sensor":   "heatings_current_temp",
    "floor_temp_sensor":     "floors_current_temp",
    "convector_temp_sensor": "convectors_current_temp",

    # Удалённые ключи: APK ими не пользуется.
    "ac_fan": None,

    # Гипотетические очень-старые имена — на случай legacy storage с pre-v2 билдов.
    # Если их в проде нет — миграция просто пройдёт мимо (idempotent).
    "light_master":   "lights",
    "curtain_master": "curtains",
    "ac_climate":     "acs",
    "heating_climate":   "heatings",
    "floor_climate":     "floors",
    "convector_climate": "convectors",
    "vent_fan":          "ventilation_fans",
    "media_player":      "media_players",
}


def _migrate_entities(entities: dict | None) -> dict:
    """Переименовать legacy bind keys на новые plural-имена.

    - singular строка → массив (если новый ключ multi)
    - конфликт (старый + новый одновременно): merge с dedup, новый — приоритет
    - удалённые ключи (map → None): просто выбрасываем
    Идемпотентно: повторный вызов на уже-мигрированном dict ничего не меняет.
    """
    if not isinstance(entities, dict):
        return {}

    out: dict = dict(entities)  # копия, чтобы не мутировать вход

    for old_key, new_key in LEGACY_BIND_KEY_MAP.items():
        if old_key not in out:
            continue
        old_val = out.pop(old_key)
        if new_key is None:
            # Удалить — APK не использует.
            continue
        new_meta = BIND_KEYS.get(new_key)
        if not new_meta:
            # Целевого ключа нет в текущей схеме — игнор
            continue

        if new_meta["multi"]:
            existing = out.get(new_key) or []
            if not isinstance(existing, list):
                existing = [existing] if existing else []
            extra = []
            if isinstance(old_val, list):
                extra = [x for x in old_val if x]
            elif isinstance(old_val, str) and old_val:
                extra = [old_val]
            seen = set(existing)
            for x in extra:
                if x not in seen:
                    existing.append(x)
                    seen.add(x)
            out[new_key] = existing
        else:
            # single: новый ключ выигрывает если уже задан непустым
            if not out.get(new_key) and old_val:
                if isinstance(old_val, list):
                    old_val = next((x for x in old_val if x), None)
                out[new_key] = old_val

    return out


# ---------- Главная схема конфига ----------

CONFIG_SCHEMA = vol.Schema({
    vol.Optional("schema_version", default=CONFIG_SCHEMA_VERSION):
        vol.All(int, vol.Range(min=1)),
    vol.Optional("screens",        default=lambda: copy.deepcopy(DEFAULT_CONFIG["screens"])):
        SCREENS_SCHEMA,
    vol.Optional("home_nav",       default=lambda: list(DEFAULT_CONFIG["home_nav"])):
        HOME_NAV_SCHEMA,
    # Список entity_id штор с инверсией направления (мотор наоборот). Дедуп + валидация
    # формата через _entity_list. APK меняет open↔close для этих штор.
    vol.Optional("curtain_reverse", default=list):
        _entity_list,
    vol.Optional("background_dim", default=DEFAULT_CONFIG["background_dim"]):
        vol.All(int, vol.Range(min=BG_DIM_MIN, max=BG_DIM_MAX)),
    # Если задан — APK подменяет встроенный фон. Допустимые формы:
    #   None / "" — встроенный
    #   "http(s)://..." — HA скачает и закэширует
    #   "/local/..."   — путь в HA www (через HA media)
    vol.Optional("background_image_url", default=None):
        vol.Any(None, str),
    vol.Optional("screen_timeout", default=DEFAULT_CONFIG["screen_timeout"]):
        vol.In(SCREEN_TIMEOUT_OPTIONS),
    vol.Optional("language",       default=DEFAULT_CONFIG["language"]):
        vol.In(LANGUAGES),
    vol.Optional("entities",       default=lambda: copy.deepcopy(DEFAULT_CONFIG["entities"])):
        ENTITIES_SCHEMA,
    vol.Optional("area_id",        default=None):
        vol.Any(None, str),
    vol.Optional("custom_cards",   default=list):
        _custom_cards_value,
    vol.Optional("climate_presets", default=dict):
        _climate_presets_value,
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
                 Решается простым прогоном через CONFIG_SCHEMA — дефолты сами проставятся.
    v1.2 → v1.3: APK перешёл на plural bind keys. Переименовываем старые ключи
                 в entities ДО schema normalize (иначе REMOVE_EXTRA их выкинет).

    Pure sync функция — нет I/O. Если в будущем понадобятся awaitable шаги
    (например очистка orphan registry entries), сделаем async-обёртку.
    """
    if not isinstance(old_data, dict):
        return {"configs": {}, "meta": {}}

    configs = old_data.get("configs", {}) or {}
    meta = old_data.get("meta", {}) or {}

    new_configs = {}
    for panel_id, cfg in configs.items():
        cfg = cfg or {}
        # 1) Pre-migrate entities — переименовать legacy ключи до того как
        # CONFIG_SCHEMA выкинет их как REMOVE_EXTRA.
        if isinstance(cfg, dict) and isinstance(cfg.get("entities"), dict):
            cfg = dict(cfg)
            cfg["entities"] = _migrate_entities(cfg["entities"])
        # 2) Прогон через схему: дефолты, типы, выкинуть мусор
        new_configs[panel_id] = normalize_config(cfg)

    return {"configs": new_configs, "meta": dict(meta)}
