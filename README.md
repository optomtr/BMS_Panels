# BMS Smart Panel — Home Assistant Module

Полное управление настенными 4-дюймовыми BMS-панелями (Sonoff NS Panel Pro) прямо из Home Assistant — **в одном модуле**.

После установки в сайдбаре HA появляется пункт **"BMS Panels"** с собственным интерфейсом, где можно:
- 📋 **Добавлять и удалять** панели (от 5 до 30+ в одном доме)
- 🎚 **Настраивать каждую**: затемнение фона, таймаут lock screen, язык
- 🔀 **Переставлять и скрывать** экраны меню (drag-and-drop)
- 🏠 **Конфигурировать главный экран** — какие 5 иконок снизу
- 🎯 **Привязывать конкретные устройства** к экранам (или использовать автодетект)

Изменения применяются **мгновенно** на любой панели через WebSocket — даже когда у вас 30 панелей одновременно.

---

## 📦 Установка — 3 шага (5 минут)

### Шаг 1. Скопировать модуль в HA

Через **File Editor** или SSH скопировать всю папку:
```
<HA config>/custom_components/bms_panel/
```
(целиком, со всеми вложенными файлами и подпапкой `panel/`)

### Шаг 2. Перезапустить HA

`Settings → System → Restart`

### Шаг 3. Включить модуль

`Settings → Devices & Services → Add Integration → BMS Smart Panel → Submit`

**Готово.** В сайдбаре HA появится пункт **"BMS Panels"** — туда и заходите. Все настройки делаются изнутри этого интерфейса.

---

## 🎬 Использование

### Добавить первую панель

1. Открываете сайдбар → **BMS Panels**
2. Слева кнопка **"Добавить панель"** → вводите название (например, "Панель кухни") → получаете `panel_id` (например, `kitchen`)
3. На самой панели (после установки APK): **Settings → Panel ID** → вписать тот же код `kitchen`

Через 0.5–3 секунды панель применит конфиг.

### Настройка панели

В сайдбарном меню "BMS Panels" слева список всех ваших панелей. Выбираете любую — справа:

**Дисплей:**
- Затемнение фона главного экрана (0–100%)
- Таймаут lock screen (15 сек … 10 мин)
- Язык интерфейса (English / Русский)

**Экраны меню:**
- Свитч "вкл/выкл" каждого экрана: `Light, Curtain, Music, AC, Heating, Floor heat, Convector, Ventilation`
- Drag-and-drop ⋮⋮ для смены порядка

**Главный экран — 5 нижних иконок:**
- 5 dropdown-ов: выбираете что показывать в нижнем ряду главного экрана

**Привязки entity_id (опционально):**
- Если в доме 3 кондиционера — указываете для этой панели какой конкретно её "кондей"
- Точно так же для Heating, Floor, Convector, Ventilation, Music, температуры/влажности
- Если оставить `— auto —`, панель сама найдёт устройство по ключевым словам

**Внизу кнопки:**
- ✅ **Сохранить** (но всё и так сохраняется автоматически через 0.5 сек после изменения)
- 🔄 **Перезагрузить из HA** — откатить несохранённые изменения
- ↩️ **Сбросить к дефолту** — все экраны включены, порядок по умолчанию
- 🗑 **Удалить панель** — удаляет из HA полностью

---

## ⚡ Сервисы (для автоматизаций)

Доступны через `Developer Tools → Services`:

- `bms_panel.add_panel` — создать новую панель (`panel_name`, опционально `panel_id`)
- `bms_panel.remove_panel` — удалить (`panel_id`)
- `bms_panel.update_config` — программно обновить конфиг (`panel_id`, `config`)
- `bms_panel.reset_config` — сбросить к дефолту (`panel_id`)

---

## 🏗 Архитектура

```
custom_components/bms_panel/
├── manifest.json          # Метаданные интеграции
├── const.py
├── __init__.py            # Setup + регистрация сайдбара + сервисы
├── config_flow.py         # Просто кнопка установки (без полей)
├── sensor.py              # sensor.bms_panel_<id> с конфигом
├── services.yaml
├── translations/
│   ├── en.json
│   └── ru.json
└── panel/
    └── editor.js          # Web Component для сайдбар-меню
```

**Поток данных:**
```
[Sidebar Editor UI]
       │
       │ bms_panel.update_config service
       ▼
[Integration backend]
       │ saves to .storage/bms_panel.configs
       │ updates sensor entity state
       ▼
[sensor.bms_panel_<id>]
       │ state_changed event via WebSocket
       ▼
[Panel App on Sonoff]
       │ applies config:
       │  • screens visibility & order
       │  • home nav icons
       │  • bg dim, timeout, language
       │  • entity bindings
       ▼
    [User sees updated UI on wall]
```

---

## 🧪 Совместимость

- ✅ Home Assistant **Core, Container, Supervised, OS** — works everywhere (не Docker-аддон, а custom_component)
- ✅ Multi-panel — protected against race conditions
- ✅ Удалённый HA через домен/Cloudflare — WebSocket + REST fallback
- ✅ Mobile-friendly — UI редактора адаптивен под телефон

---

## 🐛 Troubleshooting

**"BMS Panels" не появилось в сайдбаре**
→ Очистите кэш браузера (Ctrl+Shift+R), перезапустите HA.

**Панель не подхватывает конфиг**
→ Проверьте что Panel ID на самой панели точно совпадает с тем что в редакторе.
→ Откройте Developer Tools → States → найдите `sensor.bms_panel_<id>` — должен быть.

**Изменения не применяются**
→ В Settings → Home Assistant на самой панели проверьте Connected (зелёный, без красной рамки).
→ Через REST polling задержка до 3 сек, через WebSocket — мгновенно.

---

**Версия:** 1.0.0
**Лицензия:** MIT
