"""Constants for BMS Smart Panel integration.

Все имена ключей (`SCREEN_KEYS`, `BIND_KEYS`) — это контракт с Android-приложением.
Менять только синхронно с `android/.../data/config/PanelConfig.kt`.
"""

DOMAIN = "bms_panel"

CONF_PANEL_ID = "panel_id"
CONF_PANEL_NAME = "panel_name"

# ---- URL пути ----
SIDEBAR_URL_PATH = "bms-panels"
STATIC_URL_PATH = "/bms_panel_static"

# ---- Текущая версия схемы. Меняется когда добавляются/удаляются поля. ----
# Android знает свою минимальную поддерживаемую версию. Если APK старый и схема
# выше — интегратор увидит warning «обновите APK».
CONFIG_SCHEMA_VERSION = 3  # +climate_presets (v2.3.0)

# ---- Экраны панели ----
# id → meta. Android читает по id; UI берёт label/icon отсюда.
SCREEN_KEYS = ["light", "curtain", "music", "ac", "heating", "floor", "convector", "ventilation"]

# ---- Иконки нижнего ряда главного экрана ----
# Все 9 разделов (1-в-1 с APK NAV_DEFS и editor.js HOME_NAV_OPTIONS).
# Раньше отсутствовали floor/convector → voluptuous-схема (vol.In) отвергала их
# при сохранении и заменяла на default ('menu').
HOME_NAV_OPTIONS = ["light", "curtain", "menu", "music", "ac", "heating", "floor", "convector", "ventilation"]
HOME_NAV_REQUIRED_LEN = 5

# ---- Ключи привязок — Android pinnedOne/pinnedMany ----
# multi=True → массив entity_id, multi=False → один entity_id или null.
# `domain` — какие entity допустимы (ошибка если выбран другой).
# `requires_screen` — если экран выключен, ключ не имеет смысла (info).
BIND_KEYS = {
    # Свет / шторы / музыка
    "lights":          {"multi": True,  "domain": "light",        "requires_screen": "light"},
    "curtains":        {"multi": True,  "domain": "cover",        "requires_screen": "curtain"},
    "media_players":   {"multi": True,  "domain": "media_player", "requires_screen": "music"},

    # Климат — multi по типу
    "acs":             {"multi": True,  "domain": "climate",      "requires_screen": "ac"},
    "heatings":        {"multi": True,  "domain": "climate",      "requires_screen": "heating"},
    "floors":          {"multi": True,  "domain": "climate",      "requires_screen": "floor"},
    "convectors":      {"multi": True,  "domain": "climate",      "requires_screen": "convector"},

    # Вентиляция
    "ventilation_fans":{"multi": True,  "domain": "fan",          "requires_screen": "ventilation"},
    "co2_sensor":      {"multi": False, "domain": "sensor",       "requires_screen": "ventilation"},

    # Главный экран — датчики
    "temp_sensor":     {"multi": False, "domain": "sensor",       "requires_screen": None},
    "humidity_sensor": {"multi": False, "domain": "sensor",       "requires_screen": None},

    # Fallback-сенсоры для climate-экранов (когда сам термостат не отдаёт current_temperature).
    # Имена строго совпадают с APK pinnedOne() в ClimateMoodScreen.kt: <screen_plural>_current_temp.
    "acs_current_temp":        {"multi": False, "domain": "sensor", "requires_screen": "ac"},
    "heatings_current_temp":   {"multi": False, "domain": "sensor", "requires_screen": "heating"},
    "floors_current_temp":     {"multi": False, "domain": "sensor", "requires_screen": "floor"},
    "convectors_current_temp": {"multi": False, "domain": "sensor", "requires_screen": "convector"},

    # Отдельный вентилятор для конвектора (APK ConvectorScreen читает скорость отдельно).
    # NB: ac_fan убран — APK его не читает (управление вентилятором AC идёт через climate entity).
    "convector_fan":  {"multi": False, "domain": "fan", "requires_screen": "convector"},
}

# ---- Числовые границы ----
BG_DIM_MIN, BG_DIM_MAX = 0, 100
SCREEN_TIMEOUT_OPTIONS = [15, 30, 60, 120, 300, 600]  # секунды
LANGUAGES = ["English", "Русский"]

# ---- Climate Presets (3 сцены × 4 экрана) ----
# Интегратор может переопределить target/hvac_mode/fan_mode для каждой сцены.
# Если не задано — APK падает в DEFAULT_CLIMATE_PRESETS (mirror APK AppNav.kt).
#
# КОНТРАКТ: имена ключей экранов и сцен совпадают с APK ClimateMoodPreset.key
# (см. android/.../ui/nav/AppNav.kt:175-280). Изменение — breaking для APK.
CLIMATE_PRESET_SCREENS = ["ac", "heating", "floor", "convector"]
CLIMATE_PRESET_SCENES = ["turbo", "comfort", "eco"]  # «Ручной» динамический, не редактируется

# Допустимые HVAC modes (HA core climate domain).
# Если конкретный термостат не поддерживает выбранный mode — APK fallback'нёт
# на первый из climate.hvac_modes (нет краша).
CLIMATE_HVAC_MODES = ["off", "heat", "cool", "heat_cool", "auto", "dry", "fan_only"]

# Допустимые fan modes — стандартный набор HA. Конкретные термостаты могут
# поддерживать только подмножество (low/mid/high/auto или off/low/medium/high).
CLIMATE_FAN_MODES = ["off", "low", "mid", "medium", "high", "auto", "diffuse"]

CLIMATE_TARGET_MIN, CLIMATE_TARGET_MAX = 5.0, 35.0

# Дефолты — 1-в-1 с APK AppNav.kt ClimateMoodPreset (источник истины).
# AC: cool/cool/dry — eco в dry mode для экономии. Heating/floor — only heat.
# Convector — три fan speeds (high/mid/low) потому что у него отдельный вент.
DEFAULT_CLIMATE_PRESETS = {
    "ac": {
        "turbo":   {"target": 22.0, "hvac_mode": "cool", "fan_mode": "high"},
        "comfort": {"target": 25.0, "hvac_mode": "cool", "fan_mode": "auto"},
        "eco":     {"target": 28.0, "hvac_mode": "dry",  "fan_mode": "low"},
    },
    "heating": {
        "turbo":   {"target": 23.0, "hvac_mode": "heat"},
        "comfort": {"target": 21.0, "hvac_mode": "heat"},
        "eco":     {"target": 18.0, "hvac_mode": "heat"},
    },
    "floor": {
        "turbo":   {"target": 24.0, "hvac_mode": "heat"},
        "comfort": {"target": 22.0, "hvac_mode": "heat"},
        "eco":     {"target": 21.0, "hvac_mode": "heat"},
    },
    "convector": {
        "turbo":   {"target": 24.0, "hvac_mode": "heat", "fan_mode": "high"},
        "comfort": {"target": 21.0, "hvac_mode": "heat", "fan_mode": "mid"},
        "eco":     {"target": 18.0, "hvac_mode": "heat", "fan_mode": "low"},
    },
}

# ---- Custom Cards (пользовательские плитки в Меню) ----
# Интегратор может добавить свои карточки в 3×3 Menu — каждая со своим действием.
# Поддерживаемые типы action:
#   service   → вызвать HA service (domain.service)
#   entity    → открыть детальный bottom-sheet для одного entity
#   toggle    → быстро переключить single entity (homeassistant.toggle)
#   dashboard → открыть произвольный HA URL (для перехода между дашбордами)
CUSTOM_CARD_ACTION_TYPES = ["service", "entity", "toggle", "dashboard"]
CUSTOM_CARD_MAX = 16  # практический предел — 16 кастомных + 8 системных = 24 плитки
CUSTOM_CARD_LABEL_LANGS = ["ru", "en", "uz"]

# ---- Дефолтная конфигурация ----
DEFAULT_CONFIG = {
    "schema_version": CONFIG_SCHEMA_VERSION,
    "screens": {
        # По умолчанию включён только Light — самое универсальное (есть везде).
        # Интегратор/владелец включит то что есть в этой комнате — это явный
        # opt-in вместо «выключите 5 ненужных вручную». В UI экраны со снятым
        # флажком скрыты на табе «Устройства» как «выключенные».
        "light":       {"enabled": True,  "order": 1, "label": "Light"},
        "curtain":     {"enabled": False, "order": 2, "label": "Curtain"},
        "music":       {"enabled": False, "order": 3, "label": "Music"},
        "ac":          {"enabled": False, "order": 4, "label": "AC"},
        "heating":     {"enabled": False, "order": 5, "label": "Heating"},
        "floor":       {"enabled": False, "order": 6, "label": "Floor heat"},
        "convector":   {"enabled": False, "order": 7, "label": "Convector"},
        "ventilation": {"enabled": False, "order": 8, "label": "Ventilation"},
    },
    # home_nav по умолчанию: только light (включен) + menu. Остальные слоты —
    # menu заполнители (4 «menu» лучше чем 4 ссылки на выключенные экраны).
    "home_nav": ["light", "menu", "menu", "menu", "menu"],
    "background_dim": 30,
    # URL/путь к собственному фону вместо встроенного background.png.
    # None = использовать встроенный. APK кэширует загруженный URL локально
    # (offline-first) и автоматически переключается на встроенный при ошибке.
    "background_image_url": None,
    "screen_timeout": 30,
    "language": "Русский",
    "entities": {k: ([] if v["multi"] else None) for k, v in BIND_KEYS.items()},
    # area_id привязки HA — для группировки entity автоматически
    "area_id": None,
    # Кастомные карточки в Menu — по умолчанию пусто, интегратор добавляет в UI.
    "custom_cards": [],
    # Climate-пресеты — пусто по умолчанию (APK использует свои hardcoded дефолты).
    # Интегратор переопределяет в UI: climate_presets.ac.turbo.target = 19.0 etc.
    # Хранится только то что явно отличается от дефолтов — keeps storage clean.
    "climate_presets": {},
}

# ---- Сервисы ----
SERVICE_UPDATE_CONFIG = "update_config"
SERVICE_RESET_CONFIG  = "reset_config"
SERVICE_ADD_PANEL     = "add_panel"
SERVICE_REMOVE_PANEL  = "remove_panel"
SERVICE_CLONE_PANEL   = "clone_panel"

# Сигналы dispatcher_send — service → sensor (избегаем race на async_added_to_hass)
SIGNAL_CONFIG_UPDATED = f"{DOMAIN}_config_updated"  # arg: panel_id

# ---- Storage ----
STORAGE_VERSION_MAJOR = 1
STORAGE_VERSION_MINOR = 3  # v3: переименование bind keys под APK plural-схему (acs_current_temp etc.)
STORAGE_KEY = "bms_panel.configs"

# ---- Slug — только ASCII, чтобы entity_id всегда был валидным ----
SLUG_REGEX = r"^[a-z0-9_-]{2,32}$"
