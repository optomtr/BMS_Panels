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
CONFIG_SCHEMA_VERSION = 2

# ---- Экраны панели ----
# id → meta. Android читает по id; UI берёт label/icon отсюда.
SCREEN_KEYS = ["light", "curtain", "music", "ac", "heating", "floor", "convector", "ventilation"]

# ---- Иконки нижнего ряда главного экрана ----
HOME_NAV_OPTIONS = ["light", "curtain", "menu", "music", "ac", "heating", "ventilation"]
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
    "screen_timeout": 30,
    "language": "Русский",
    "entities": {k: ([] if v["multi"] else None) for k, v in BIND_KEYS.items()},
    # area_id привязки HA — для группировки entity автоматически
    "area_id": None,
    # Кастомные карточки в Menu — по умолчанию пусто, интегратор добавляет в UI.
    "custom_cards": [],
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
