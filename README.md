# BMS Smart Panel — Home Assistant Integration

Полное управление настенными 4-дюймовыми BMS-панелями (Sonoff NS Panel Pro) прямо из Home Assistant — в одном модуле.

После установки в сайдбаре HA появляется пункт **«BMS Panels»** — визуальный конфигуратор, в котором:

- Управляете списком панелей (от 1 до 50+ в одном доме)
- Включаете нужные экраны (свет / шторы / AC / тёплый пол / вентиляция / музыка), скрываете ненужные
- Привязываете устройства из HA — поштучно или одним кликом из HA Area («комнаты»)
- Дублируете панели для одинаковых комнат, видите все панели в bulk-таблице
- Получаете предупреждения до того, как пользователь нажмёт что-то на стене

Все изменения применяются на панели **за 0.5–3 секунды** через WebSocket.

---

## ✨ Что нового в 2.0

- **Валидация конфига**: красные/жёлтые подсказки сразу в редакторе. На стене ошибок не будет, если редактор показывает «всё проверено».
- **HA Area integration**: выбрал комнату → «Заполнить из комнаты» → все лампы, шторы, термостаты автоматически в нужных слотах с превью.
- **Тест устройства**: молния-кнопка рядом с устройством мигнёт лампой / откроет штору (с подтверждением для опасных команд).
- **Bulk-view**: одна таблица со всеми панелями — где красное, где жёлтое, последний контакт, число привязок.
- **Clone panel**: создать копию настроек для соседней комнаты в один клик (опционально с привязками).
- **Безопасность**: storage с миграциями, atomic save с lock, rollback при failure диска, schema validation на бэке.

---

## 📦 Установка

### Через HACS (рекомендуется)

1. HACS → Integrations → ⋮ → Custom repositories
2. URL: `https://github.com/optomtr/BMS_Panels`, Category: Integration
3. Install BMS Smart Panel
4. Restart Home Assistant
5. Settings → Devices & Services → Add Integration → BMS Smart Panel

### Вручную

1. Скопировать `custom_components/bms_panel/` целиком в `<HA config>/custom_components/bms_panel/`
2. Перезапустить HA
3. Settings → Devices & Services → Add Integration → BMS Smart Panel

**Требования:** Home Assistant **2024.7+**.

---

## 🧑‍🔧 Быстрый старт для интегратора (1 минута)

1. **Сайдбар → BMS Panels → «Добавить панель»**: введите имя «Панель кухни», код сгенерируется автоматически (`kitchen`).
2. **Установите APK** на планшет, в Settings → Panel ID впишите этот код (`kitchen`).
3. **Вкладка «Обзор»**: выберите HA Area «Кухня».
4. **Вкладка «Устройства» → «Заполнить из комнаты»**: проверьте превью, снимите галочки с того что не подходит, нажмите «Заполнить».
5. **Сохранить**. Готово — за 30 секунд.

Для одинаковых комнат — **«Дублировать»** в bottom-bar.

---

## 🛠 Сервисы

| Сервис | Описание |
|---|---|
| `bms_panel.add_panel` | Создать панель. Required: `panel_name`. Optional: `panel_id` (иначе из имени). |
| `bms_panel.remove_panel` | Удалить панель и её sensor. Required: `panel_id`. |
| `bms_panel.update_config` | Записать полный конфиг (используется UI). Required: `panel_id`, `config`. |
| `bms_panel.reset_config` | Сбросить к дефолту. Required: `panel_id`. |
| `bms_panel.clone_panel` | Скопировать конфиг. Required: `source_panel_id`, `panel_name`. Optional: `panel_id`, `copy_entities` (default false). |

---

## 🔌 Контракт с Android-приложением

Конфиг лежит в `sensor.bms_panel_<panel_id>.attributes`. Android-приложение читает:

- `screens.<key>.enabled` / `order` / `label` — какие экраны видны
- `home_nav[5]` — нижние 5 иконок главного экрана (значения из `HOME_NAV_OPTIONS`)
- `background_dim` (0–100), `screen_timeout` (15/30/60/120/300/600), `language` («Русский» | «English»)
- `entities[<bind_key>]` — entity_id или массив entity_id
- `area_id` — HA area для группировки
- `config_schema_version` — номер версии схемы (для совместимости со старыми APK)

**Контракт BIND_KEYS** (см. `const.py`):
| ключ | domain | multi |
|---|---|---|
| lights, curtains, media_players, acs, heatings, floors, convectors, ventilation_fans | light/cover/media_player/climate/fan | yes |
| co2_sensor, temp_sensor, humidity_sensor, ac_temp_sensor, heating_temp_sensor, floor_temp_sensor, convector_temp_sensor | sensor | no |
| ac_fan, convector_fan | fan | no |

**Менять контракт только синхронно с `android/.../data/config/PanelConfig.kt`. Bump `CONFIG_SCHEMA_VERSION` в `const.py` при изменении.**

---

## 🐛 Troubleshooting

**Editor открывается пустым.** Проверьте Developer Tools → Console на JS-ошибки. Возможно кэш — добавьте `?v=2.0` к URL или Ctrl+Shift+R.

**Sensor.bms_panel_X не создаётся.** Перезагрузите HA после первого `add_panel` если он был вызван сразу после установки.

**`update_config` возвращает HomeAssistantError.** Это валидация — посмотрите сообщение, исправьте конфиг и попробуйте снова.

**Конфиг потерялся после апгрейда HA.** Storage в `.storage/bms_panel.configs`. Schema-миграция применяется автоматически — если структура поменялась, старые ключи дополнятся дефолтами, неизвестные — удалятся.

---

## 🔒 Безопасность

По умолчанию редактор доступен всем HA-пользователям (включая гостевых). Если нужна строгая защита:
1. В `__init__.py` поменяйте `require_admin=False` → `True`.
2. В `services.yaml` добавьте `admin_only: true` каждому сервису.

---

## 📂 Структура

```
custom_components/bms_panel/
├── __init__.py          # сервисы, регистрация sidebar, storage
├── sensor.py            # entity на каждую панель
├── const.py             # SCREEN_KEYS, BIND_KEYS, DEFAULT_CONFIG, версии
├── schemas.py           # voluptuous + migrate_storage + normalize_config
├── validation.py        # server-side pre-save validation (mirror JS)
├── config_flow.py       # single-instance entry
├── services.yaml        # описание сервисов
├── manifest.json        # HA-метаданные
├── translations/{en,ru}.json
└── panel/
    ├── editor.js        # Web Component <bms-panel-editor>
    └── validation.js    # client-side validation (mirror Python)
```

---

## License

MIT
