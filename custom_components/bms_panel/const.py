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

# ---- Загрузка фона кнопкой (v2.9.0) ----
# Файлы сохраняются в config/bms_panel_bg/ с УНИКАЛЬНЫМ именем на каждую загрузку
# (bg_<panel_id>_<timestamp>.<ext>) — кэш-проблемы «фото не меняется» исчезают
# в принципе: адрес всегда новый. Раздаём сами через свой static path — не
# зависим от существования config/www на момент старта HA.
BG_UPLOAD_URL_PREFIX = "/bms_panel_bg"
BG_UPLOAD_DIR = "bms_panel_bg"           # относительно config dir
BG_UPLOAD_MAX_BYTES = 10 * 1024 * 1024   # 10 МБ достаточно для фото фона
BG_UPLOAD_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
BG_UPLOAD_KEEP_PER_PANEL = 2             # хранить последние N файлов панели

# ---- Текущая версия схемы. Меняется когда добавляются/удаляются поля. ----
# Android знает свою минимальную поддерживаемую версию. Если APK старый и схема
# выше — интегратор увидит warning «обновите APK».
CONFIG_SCHEMA_VERSION = 3  # +climate_presets (v2.3.0)

# ---- Экраны панели ----
# id → meta. Android читает по id; UI берёт label/icon отсюда.
SCREEN_KEYS = [
    "light", "curtain", "window", "music", "ac", "heating", "floor", "convector", "ventilation",
    # Новые разделы (контракт SPEC-new-sections): у существующих панелей выключены
    # по умолчанию — после обновления у клиентов в меню ничего не появляется само.
    "energy", "pool", "irrigation", "garage", "automations",
]

# ---- Иконки нижнего ряда главного экрана ----
# Все разделы (1-в-1 с APK NAV_DEFS и validation.js HOME_NAV_OPTIONS — сверяет
# Android-тест NavListsInSyncTest; список держать В ОДНУ СТРОКУ, тест так его разбирает).
# Раньше отсутствовали floor/convector → voluptuous-схема (vol.In) отвергала их
# при сохранении и заменяла на default ('menu').
HOME_NAV_OPTIONS = ["light", "curtain", "window", "menu", "music", "ac", "heating", "floor", "convector", "ventilation", "energy", "pool", "irrigation", "garage", "automations"]
# Можно поставить от 1 до 5 иконок (APK рендерит ровно столько, сколько задано).
# Раньше жёстко требовалось 5 → лишние слоты заполнялись «menu» и на панели
# торчали кнопки «Ещё», даже когда добавлять было нечего.
HOME_NAV_MIN_LEN = 1
HOME_NAV_MAX_LEN = 5

# ---- Ключи привязок — Android pinnedOne/pinnedMany ----
# multi=True → массив entity_id, multi=False → один entity_id или null.
# `domain` — какие entity допустимы (ошибка если выбран другой).
# `requires_screen` — если экран выключен, ключ не имеет смысла (info).
BIND_KEYS = {
    # Свет / шторы / музыка
    "lights":          {"multi": True,  "domain": "light",        "requires_screen": "light"},
    "curtains":        {"multi": True,  "domain": "cover",        "requires_screen": "curtain"},
    # Мансардные окна (крыша) — тоже cover, но отдельный экран «Окно»
    "windows":         {"multi": True,  "domain": "cover",        "requires_screen": "window"},
    "media_players":   {"multi": True,  "domain": "media_player", "requires_screen": "music"},

    # Климат — multi по типу.
    # extra_domains: кроме термостата разрешено привязать сам пускатель обогрева
    # (реле). Нужно, когда у тёплого пола нет датчика температуры или датчик умер:
    # термостат без датчика не включается вовсе, и обогрев было нечем поднять.
    # Панель в этом случае показывает простую кнопку «ВКЛ/ВЫКЛ».
    "acs":             {"multi": True,  "domain": "climate", "extra_domains": ["switch", "input_boolean"],      "requires_screen": "ac"},
    "heatings":        {"multi": True,  "domain": "climate", "extra_domains": ["switch", "input_boolean"],      "requires_screen": "heating"},
    "floors":          {"multi": True,  "domain": "climate", "extra_domains": ["switch", "input_boolean"],      "requires_screen": "floor"},
    "convectors":      {"multi": True,  "domain": "climate", "extra_domains": ["switch", "input_boolean"],      "requires_screen": "convector"},

    # Вентиляция
    "ventilation_fans":{"multi": True,  "domain": "fan",          "requires_screen": "ventilation"},
    "co2_sensor":      {"multi": False, "domain": "sensor",       "requires_screen": "ventilation"},

    # ---- Новые разделы. Порядок в массиве = порядок на экране панели
    # (для фаз: 1-й элемент = «Фаза 1»).
    # Энергия — только просмотр. Почасовой график и «пик за сутки» панель берёт
    # из статистики HA (recorder) по energy_total / energy_power.
    "energy_power":          {"multi": False, "domain": "sensor", "requires_screen": "energy"},
    "energy_phases_power":   {"multi": True,  "domain": "sensor", "requires_screen": "energy"},
    "energy_phases_voltage": {"multi": True,  "domain": "sensor", "requires_screen": "energy"},
    "energy_phases_current": {"multi": True,  "domain": "sensor", "requires_screen": "energy"},
    "energy_total":          {"multi": False, "domain": "sensor", "requires_screen": "energy"},
    "energy_month":          {"multi": False, "domain": "sensor", "requires_screen": "energy"},
    # Бассейн — любое оборудование, которое включается/выключается.
    "pool_devices":          {"multi": True,  "domain": "switch", "extra_domains": ["input_boolean", "light", "fan"], "requires_screen": "pool"},
    # Полив — зоны (реле, клапаны valve.*) + необязательные датчики почвы.
    "irrigation_zones":      {"multi": True,  "domain": "switch", "extra_domains": ["valve", "input_boolean"], "requires_screen": "irrigation"},
    "soil_temp_sensor":      {"multi": False, "domain": "sensor", "requires_screen": "irrigation"},
    "soil_moisture_sensor":  {"multi": False, "domain": "sensor", "requires_screen": "irrigation"},
    "soil_ec_sensor":        {"multi": False, "domain": "sensor", "requires_screen": "irrigation"},
    # Гараж — ворота/двери (cover) и электрозамки калиток (lock).
    "gates":                 {"multi": True,  "domain": "cover", "extra_domains": ["lock"], "requires_screen": "garage"},
    # Импульсные ворота: одна кнопка по кругу «открыть → стоп → закрыть».
    # gate_pulse_sensors — необязательные концевики, по ИНДЕКСУ к gate_pulses
    # (i-й датчик = i-е ворота, on = открыто).
    "gate_pulses":           {"multi": True,  "domain": "button", "extra_domains": ["input_button", "switch", "script"], "requires_screen": "garage"},
    # Концевиком может быть и сами ворота (cover): open/opening = открыто.
    "gate_pulse_sensors":    {"multi": True,  "domain": "binary_sensor", "extra_domains": ["cover"], "requires_screen": "garage"},
    # Автоматизации — сценарии (scene/script) и расписания (automation).
    "scenes":                {"multi": True,  "domain": "scene", "extra_domains": ["script"], "requires_screen": "automations"},
    # Расписания — automation, а также режимы «… Авто», сделанные флажками
    # (input_boolean) или реле (switch): панель переключает их своим доменом.
    "automations":           {"multi": True,  "domain": "automation", "extra_domains": ["input_boolean", "switch"], "requires_screen": "automations"},

    # Главный экран — датчики
    "temp_sensor":     {"multi": False, "domain": "sensor",       "requires_screen": None},
    "humidity_sensor": {"multi": False, "domain": "sensor",       "requires_screen": None},
    # Опциональный датчик температуры ТЁПЛОГО ПОЛА на главном экране (третья
    # колонка рядом с температурой/влажностью). Имя НЕ "floor_temp_sensor" —
    # тот ключ занят legacy-миграцией (schemas.py → floors_current_temp).
    "home_floor_temp_sensor": {"multi": False, "domain": "sensor", "requires_screen": None},
    # Опциональный датчик атмосферного давления — ещё одна колонка климат-строки.
    "pressure_sensor": {"multi": False, "domain": "sensor", "requires_screen": None},

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
# секунды; 0 = не гасить. 15 мин – 1 ч добавлены 23.09.2026: у технических
# панелей (энергия, бассейн) экран держат открытым надолго.
SCREEN_TIMEOUT_OPTIONS = [0, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
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
        "window":      {"enabled": False, "order": 9, "label": "Window"},
        # Новые разделы — выключены, пока интегратор сам не включит.
        "energy":      {"enabled": False, "order": 9,  "label": "Energy"},
        "pool":        {"enabled": False, "order": 10, "label": "Pool"},
        "irrigation":  {"enabled": False, "order": 11, "label": "Irrigation"},
        "garage":      {"enabled": False, "order": 12, "label": "Garage"},
        "automations": {"enabled": False, "order": 13, "label": "Automations"},
    },
    # home_nav по умолчанию: light (включён) + menu для доступа к остальным экранам.
    # Интегратор добавляет ещё иконки (до 5) под конкретный объект — лишние слоты
    # больше НЕ нужны (раньше дополняли «menu», и на панели висели кнопки «Ещё»).
    "home_nav": ["light", "menu"],
    # entity_id штор с инверсией направления (мотор подключён наоборот): для них
    # APK меняет местами Открыть/Закрыть и инвертирует статус. Per-curtain.
    "curtain_reverse": [],
    "background_dim": 30,
    # URL/путь к собственному фону вместо встроенного background.png.
    # None = использовать встроенный. APK кэширует загруженный URL локально
    # (offline-first) и автоматически переключается на встроенный при ошибке.
    "background_image_url": None,
    # Кадрирование кастомного фона (конструктор в редакторе). Модель общая с APK:
    # cover-фит в квадрат экрана + zoom (1..4) вокруг центра + сдвиг dx/dy в долях
    # стороны экрана. {zoom:1, dx:0, dy:0} = как раньше (просто cover).
    "background_transform": {"zoom": 1.0, "dx": 0.0, "dy": 0.0},
    # Cache-buster: панель качает фон с ?v=N. Инкрементится кнопкой «Обновить на
    # панели» — для случая «файл заменили по тому же URL» (иначе кэш отдаёт старое).
    "background_version": 0,
    "screen_timeout": 30,
    # Экран «при включении»: главный или ключ раздела из SCREEN_KEYS. На него
    # панель встаёт при старте и после каждого гашения экрана; «назад» — главный.
    "start_screen": "home",
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
SERVICE_UPDATE_CONFIG      = "update_config"
SERVICE_RESET_CONFIG       = "reset_config"
SERVICE_ADD_PANEL          = "add_panel"
SERVICE_REMOVE_PANEL       = "remove_panel"
SERVICE_CLONE_PANEL        = "clone_panel"
# Автоустановка на заводскую Linux-панель по сети — см. provisioning.py.
SERVICE_DISCOVER_PANELS    = "discover_factory_panels"
SERVICE_INSTALL_PANEL      = "install_panel"

# Событие HA с ходом автоустановки на заводскую панель (provisioning.py).
# Данные: {job, ip, step, text, done, error, panel_id}. Шаги — те же, что
# пишутся в уведомление: отдельного «языка шагов» для UI не заводим.
EVENT_INSTALL_PROGRESS = f"{DOMAIN}_install_progress"

# Сигналы dispatcher_send — service → sensor (избегаем race на async_added_to_hass)
SIGNAL_CONFIG_UPDATED = f"{DOMAIN}_config_updated"  # arg: panel_id

# ---- Storage ----
STORAGE_VERSION_MAJOR = 1
STORAGE_VERSION_MINOR = 3  # v3: переименование bind keys под APK plural-схему (acs_current_temp etc.)
STORAGE_KEY = "bms_panel.configs"

# ---- Slug — только ASCII, чтобы entity_id всегда был валидным ----
SLUG_REGEX = r"^[a-z0-9_-]{2,32}$"

# ---- Автоустановка на заводскую Linux-панель — файлы релиза (provisioning.py) ----
# Релизы (не исходники!) для скачивания провижининга: bmspanel/mtdflash/
# res_new.sqfs/assets.tar.gz + подписанный manifest.txt. Тот же паттерн, что
# у Android-обновлений (PANELAPK) — редирект releases/latest, не api.github.com
# (без лимита запросов).
PROVISION_REPO_OWNER = "optomtr"
PROVISION_REPO_NAME = "PANEL_LINUX"

# Публичный ключ Ed25519 (32 байта, base64) для проверки manifest.sig —
# приватная половина НИГДЕ, кроме машины разработчика (linux/.release_signing_
# key.pem, в git не попадает). Файлы принимаются, только если manifest.txt
# подписан именно этим ключом, а контрольная сумма файла совпадает со строкой
# в manifest.txt — иначе скомпрометированный релиз на GitHub означал бы root
# на панели любого клиента. Смена ключа — см. предупреждение в tools/release.py.
PROVISION_SIGNING_PUBKEY_B64 = "apwGUOIU8dvcmPCTO99InVVyrQ3LNcCThGveMQTJ/YY="
