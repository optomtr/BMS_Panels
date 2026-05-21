# BMS Smart Panel — Home Assistant Module

Полное управление настенными 4-дюймовыми BMS-панелями (Sonoff NS Panel Pro) прямо из Home Assistant.

После установки в сайдбаре HA появляется пункт **"BMS Panels"** — добавляйте панели, настраивайте экраны drag-and-drop, привязывайте устройства. Изменения применяются на панели через WebSocket за 0.5-3 секунды.

## Установка через HACS

1. HACS → Integrations → ⋮ → Custom repositories
2. Add: `https://github.com/optomtr/BMS_Panels` тип `Integration`
3. Install
4. Restart HA
5. Settings → Devices & Services → Add Integration → BMS Smart Panel

После этого в сайдбаре появится "BMS Panels".
