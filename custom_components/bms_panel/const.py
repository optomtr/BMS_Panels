"""Constants for BMS Smart Panel integration."""

DOMAIN = "bms_panel"

CONF_PANEL_ID = "panel_id"
CONF_PANEL_NAME = "panel_name"

# Все экраны которые поддерживает панель
ALL_SCREENS = [
    "light",
    "curtain",
    "music",
    "ac",
    "heating",
    "floor",
    "convector",
    "ventilation",
]

# Иконки которые могут стоять в нижнем ряду главного экрана
HOME_NAV_OPTIONS = ["light", "curtain", "menu", "music", "ac", "heating", "ventilation"]

# Дефолтная конфигурация для свежесозданной панели
DEFAULT_CONFIG = {
    "screens": {
        "light":       {"enabled": True,  "order": 1, "label": "Light"},
        "curtain":     {"enabled": True,  "order": 2, "label": "Curtain"},
        "music":       {"enabled": True,  "order": 3, "label": "Music"},
        "ac":          {"enabled": True,  "order": 4, "label": "AC"},
        "heating":     {"enabled": True,  "order": 5, "label": "Heating"},
        "floor":       {"enabled": True,  "order": 6, "label": "Floor heat"},
        "convector":   {"enabled": True,  "order": 7, "label": "Convector"},
        "ventilation": {"enabled": True,  "order": 8, "label": "Ventilation"},
    },
    "home_nav": ["light", "curtain", "menu", "music", "ac"],
    "background_dim": 30,
    "screen_timeout": 30,
    "language": "English",
    # Привязки entity_id для индивидуальной настройки (опционально)
    "entities": {
        "temp_sensor": None,
        "humidity_sensor": None,
        "ac": None,
        "heating": None,
        "floor": None,
        "convector": None,
        "ventilation_fan": None,
        "co2_sensor": None,
        "media_player": None,
    },
}

SERVICE_UPDATE_CONFIG = "update_config"
SERVICE_RESET_CONFIG = "reset_config"
SERVICE_ADD_PANEL = "add_panel"
SERVICE_REMOVE_PANEL = "remove_panel"
