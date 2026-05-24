"""Validation engine — что не так с конфигом ДО того, как Android упадёт.

Зеркало клиентской validation.js. Все правила имеют id, severity и сообщение.
Фронт показывает inline + баннер; бэк блокирует save при `error`.

Архитектура: чистая функция, без побочных эффектов.
    validate(config, panel_id, all_panels, hass_states) -> list[Issue]
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Iterable

from .const import (
    BG_DIM_MAX,
    BG_DIM_MIN,
    BIND_KEYS,
    HOME_NAV_OPTIONS,
    HOME_NAV_REQUIRED_LEN,
    LANGUAGES,
    SCREEN_KEYS,
    SCREEN_TIMEOUT_OPTIONS,
    SLUG_REGEX,
)

import re

SEV_ERROR = "error"
SEV_WARN = "warning"
SEV_INFO = "info"


@dataclass
class Issue:
    """Один найденный недочёт. Сериализуется в JSON для UI."""
    id: str              # "V12"
    severity: str        # error/warning/info
    message: str
    fix_hint: str = ""
    anchor: dict = field(default_factory=dict)  # {"type":"bind_card","key":"lights"}

    def to_dict(self) -> dict:
        return asdict(self)


def _has_state(states: dict | None, eid: str) -> bool:
    return bool(states) and eid in states


def _state(states: dict | None, eid: str):
    return (states or {}).get(eid)


def _attrs(states: dict | None, eid: str) -> dict:
    s = _state(states, eid)
    if not s:
        return {}
    # hass.states[eid].attributes — может быть mapping
    return getattr(s, "attributes", None) or (s.get("attributes", {}) if isinstance(s, dict) else {})


def _state_str(states: dict | None, eid: str) -> str:
    s = _state(states, eid)
    if not s:
        return ""
    return getattr(s, "state", None) or (s.get("state", "") if isinstance(s, dict) else "")


# ---------- Правила ----------

def validate(
    cfg: dict,
    panel_id: str = "",
    all_panels: Iterable[dict] | None = None,
    states: dict | None = None,
) -> list[Issue]:
    """Прогон всех правил по конфигу. Возвращает список Issue.

    Параметры:
      cfg — нормализованный конфиг (через schemas.normalize_config)
      panel_id — текущая панель (для дубликатов)
      all_panels — [{panel_id, config}] для всех панелей (дубликаты entity)
      states — словарь hass.states (для проверки entity_id существования)
    """
    issues: list[Issue] = []
    all_panels = list(all_panels or [])

    # --- A. Конфиг панели ---
    if panel_id and not re.match(SLUG_REGEX, panel_id):
        issues.append(Issue(
            "V01", SEV_ERROR,
            f"Panel ID «{panel_id}» содержит недопустимые символы.",
            "Разрешены латиница, цифры, `_` и `-` (2–32 символа). На самой панели в Settings вы введёте этот же код.",
            {"type": "field", "key": "panel_id"},
        ))

    bg = cfg.get("background_dim", 30)
    if not (BG_DIM_MIN <= bg <= BG_DIM_MAX):
        issues.append(Issue(
            "V06", SEV_ERROR,
            f"Затемнение фона = {bg}, допустимо {BG_DIM_MIN}–{BG_DIM_MAX}.",
            "Подвиньте слайдер в допустимый диапазон.",
            {"type": "field", "key": "background_dim"},
        ))
    elif bg == 0:
        issues.append(Issue(
            "V07", SEV_WARN,
            "Фон полностью прозрачный — текст может быть нечитаемым.",
            "Рекомендуется 30–60%.",
            {"type": "field", "key": "background_dim"},
        ))

    if cfg.get("screen_timeout") not in SCREEN_TIMEOUT_OPTIONS:
        issues.append(Issue(
            "V08", SEV_ERROR,
            f"Lock screen после: значение «{cfg.get('screen_timeout')}» не поддерживается.",
            f"Выберите из: {', '.join(str(x) for x in SCREEN_TIMEOUT_OPTIONS)} сек.",
            {"type": "field", "key": "screen_timeout"},
        ))

    if cfg.get("language") not in LANGUAGES:
        issues.append(Issue(
            "V09", SEV_ERROR,
            f"Язык «{cfg.get('language')}» не поддерживается.",
            f"Доступны: {', '.join(LANGUAGES)}.",
            {"type": "field", "key": "language"},
        ))

    # --- B. Экраны / home_nav ---
    screens = cfg.get("screens", {})
    if all(not s.get("enabled", False) for s in screens.values()):
        issues.append(Issue(
            "V10", SEV_ERROR,
            "Все экраны выключены — на панели будет только главный экран без меню.",
            "Включите хотя бы один экран (Свет, Шторы, AC и т.д.).",
            {"type": "card", "key": "screens"},
        ))

    entities = cfg.get("entities", {}) or {}

    # для каждого экрана с привязками — если включён, но привязок 0 → warn
    screen_to_bindkeys = {}
    for bk, meta in BIND_KEYS.items():
        rs = meta.get("requires_screen")
        if rs:
            screen_to_bindkeys.setdefault(rs, []).append(bk)

    for screen, bind_keys in screen_to_bindkeys.items():
        if not screens.get(screen, {}).get("enabled", False):
            continue
        any_bound = any(
            (entities.get(bk) if not BIND_KEYS[bk]["multi"] else (entities.get(bk) or []))
            for bk in bind_keys
        )
        if not any_bound:
            issues.append(Issue(
                f"V_screen_{screen}_empty", SEV_WARN,
                f"Экран «{screen}» включён, но устройства не привязаны.",
                "Либо выберите устройства ниже, либо выключите экран — на панели будет пусто.",
                {"type": "screen_warning", "key": screen},
            ))

    # home_nav
    nav = cfg.get("home_nav") or []
    if len(nav) != HOME_NAV_REQUIRED_LEN:
        issues.append(Issue(
            "V19", SEV_ERROR,
            f"В нижнем ряду главного экрана должно быть ровно {HOME_NAV_REQUIRED_LEN} иконок (сейчас: {len(nav)}).",
            "",
            {"type": "card", "key": "home_nav"},
        ))
    for idx, item in enumerate(nav):
        if item not in HOME_NAV_OPTIONS:
            issues.append(Issue(
                f"V20_{idx}", SEV_ERROR,
                f"Иконка «{item}» неизвестна Android-приложению.",
                f"Допустимые: {', '.join(HOME_NAV_OPTIONS)}.",
                {"type": "home_nav_item", "index": idx},
            ))
        elif item != "menu" and not screens.get(item, {}).get("enabled", False):
            issues.append(Issue(
                f"V17_{idx}", SEV_ERROR,
                f"Иконка «{item}» в нижнем ряду главного экрана, но соответствующий экран выключен.",
                "Либо включите экран, либо замените иконку.",
                {"type": "home_nav_item", "index": idx},
            ))
    if nav and "menu" not in nav:
        issues.append(Issue(
            "V21", SEV_WARN,
            "В нижнем ряду нет «menu».",
            "Пользователь не сможет открыть остальные экраны иначе как через свайп. Рекомендуется добавить.",
            {"type": "card", "key": "home_nav"},
        ))
    # menu может повторяться (это plain-заполнитель), для остальных дубликат — баг
    non_menu = [n for n in nav if n != "menu"]
    if len(non_menu) != len(set(non_menu)):
        issues.append(Issue(
            "V18", SEV_WARN,
            "В нижнем ряду главного экрана есть дубликаты иконок (кроме «menu»).",
            "Каждый раздел должен встречаться один раз — лишние слоты можно занять «menu».",
            {"type": "card", "key": "home_nav"},
        ))

    # --- C. Entity — формат, существование, домен, состояние ---
    entity_format = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
    for bk, meta in BIND_KEYS.items():
        val = entities.get(bk)
        ids = (val if isinstance(val, list) else [val]) if val else []
        ids = [x for x in ids if x]
        for eid in ids:
            # V11 — формат entity_id
            if not entity_format.match(eid):
                issues.append(Issue(
                    f"V11_{bk}_{eid}", SEV_ERROR,
                    f"«{eid}» — невалидный entity_id.",
                    "Допустимы только латиница, цифры и _. Формат: domain.object_name.",
                    {"type": "bind_card", "key": bk, "entity_id": eid},
                ))
                continue

            # домен
            domain = meta["domain"]
            if not eid.startswith(domain + "."):
                issues.append(Issue(
                    f"V_domain_{bk}_{eid}", SEV_ERROR,
                    f"«{eid}» не из домена `{domain}.*`.",
                    f"Выберите entity из `{domain}.*` — иначе функция не будет работать.",
                    {"type": "bind_card", "key": bk, "entity_id": eid},
                ))
                continue

            if states is not None and not _has_state(states, eid):
                issues.append(Issue(
                    f"V22_{bk}_{eid}", SEV_ERROR,
                    f"Устройство «{eid}» больше не существует в Home Assistant.",
                    "Возможно его удалили или переименовали. Уберите из списка или замените.",
                    {"type": "bind_card", "key": bk, "entity_id": eid},
                ))
                continue

            st = _state_str(states, eid)
            if st == "unavailable":
                issues.append(Issue(
                    f"V23_{bk}_{eid}", SEV_WARN,
                    f"«{eid}» сейчас недоступен (unavailable).",
                    "На панели устройство будет показано серым. Проверьте интеграцию-источник.",
                    {"type": "bind_card", "key": bk, "entity_id": eid},
                ))

            # ---- Более глубокие проверки атрибутов по доменам ----
            attrs = _attrs(states, eid)

            if domain == "climate":
                modes = attrs.get("hvac_modes") if attrs else None
                if not modes:
                    issues.append(Issue(
                        f"V26_{eid}", SEV_ERROR,
                        f"«{eid}» не сообщает поддерживаемые режимы.",
                        "Кнопки HEAT/COOL/AUTO не появятся. Возможно интеграция термостата сломана — проверьте источник.",
                        {"type": "bind_card", "key": bk, "entity_id": eid},
                    ))
                else:
                    if bk == "acs" and "cool" not in modes:
                        issues.append(Issue(
                            f"V27_{eid}", SEV_WARN,
                            f"«{eid}» привязан как AC, но не поддерживает охлаждение.",
                            "Если это радиатор — привяжите его к Heating.",
                            {"type": "bind_card", "key": bk, "entity_id": eid},
                        ))
                    if bk in ("heatings", "floors", "convectors") and "heat" not in modes:
                        issues.append(Issue(
                            f"V28_{bk}_{eid}", SEV_WARN,
                            f"«{eid}» привязан к отопительному экрану, но не поддерживает heat.",
                            "Сцены «Тёплый/Турбо» работать не будут.",
                            {"type": "bind_card", "key": bk, "entity_id": eid},
                        ))
                # V37 — узкий диапазон температур
                try:
                    min_t = float(attrs.get("min_temp"))
                    max_t = float(attrs.get("max_temp"))
                    if max_t - min_t < 5:
                        issues.append(Issue(
                            f"V37_{eid}", SEV_WARN,
                            f"«{eid}» — диапазон температур узкий ({min_t:.0f}–{max_t:.0f}°).",
                            "Регулировка с панели будет работать только в этом диапазоне.",
                            {"type": "bind_card", "key": bk, "entity_id": eid},
                        ))
                except (TypeError, ValueError):
                    pass

            # V41 — media_player без volume/play
            elif domain == "media_player":
                sf = int(attrs.get("supported_features") or 0)
                if not (sf & 4):
                    issues.append(Issue(
                        f"V41_{eid}", SEV_WARN,
                        f"«{eid}» не поддерживает регулировку громкости.",
                        "Слайдер volume на экране Music работать не будет.",
                        {"type": "bind_card", "key": bk, "entity_id": eid},
                    ))
                if not (sf & 16384) and not (sf & 1):
                    issues.append(Issue(
                        f"V41play_{eid}", SEV_WARN,
                        f"«{eid}» не поддерживает Play/Pause.",
                        "Главная кнопка плеера не сработает.",
                        {"type": "bind_card", "key": bk, "entity_id": eid},
                    ))

            # V44 — cover без позиционирования (для штор)
            elif domain == "cover" and bk == "curtains":
                sf = int(attrs.get("supported_features") or 0)
                if not (sf & 4):
                    issues.append(Issue(
                        f"V44_{eid}", SEV_INFO,
                        f"«{eid}» не поддерживает установку процента открытия.",
                        "Кнопки 25/50/75% будут просто открывать/закрывать полностью.",
                        {"type": "bind_card", "key": bk, "entity_id": eid},
                    ))

            elif domain == "sensor" and bk == "co2_sensor":
                unit = attrs.get("unit_of_measurement")
                if unit and unit != "ppm":
                    issues.append(Issue(
                        f"V50_{eid}", SEV_WARN,
                        f"CO₂-сенсор использует «{attrs.get('unit_of_measurement') or '—'}», а не ppm.",
                        "Пороги индикатора (Свежий <800, Душновато <1200) рассчитаны на ppm.",
                        {"type": "bind_card", "key": bk, "entity_id": eid},
                    ))

            elif domain == "sensor" and bk in ("temp_sensor", "ac_temp_sensor", "heating_temp_sensor", "floor_temp_sensor", "convector_temp_sensor"):
                if attrs.get("device_class") not in (None, "temperature"):
                    issues.append(Issue(
                        f"V45_{bk}_{eid}", SEV_WARN,
                        f"«{eid}» не помечен как температурный (`device_class={attrs.get('device_class')}`).",
                        "Проверьте — возможно это другой тип сенсора.",
                        {"type": "bind_card", "key": bk, "entity_id": eid},
                    ))

    # --- D. Дубликаты ---
    # одна entity в 2-х панелях — dedup по (eid, other_panel) чтоб один и тот же
    # entity не висел в 5 issues если он есть в 5 других панелях.
    if all_panels:
        my_entities = set()
        for bk, meta in BIND_KEYS.items():
            val = entities.get(bk)
            ids = (val if isinstance(val, list) else [val]) if val else []
            for eid in ids:
                if eid:
                    my_entities.add(eid)

        seen_dups: set[tuple[str, str]] = set()
        # Sensor-подобные entity на нескольких панелях — НОРМА (один уличный
        # термометр, две панели). Дублирование актуально только для actuator-ов.
        _read_only = {
            "sensor", "binary_sensor", "weather", "person", "zone",
            "sun", "device_tracker", "input_text", "input_number",
        }
        for p in all_panels:
            if p.get("panel_id") == panel_id:
                continue
            other_ents = p.get("config", {}).get("entities", {}) or {}
            other_pname = p.get("panel_name") or p.get("panel_id")
            for bk, val in other_ents.items():
                ids = (val if isinstance(val, list) else [val]) if val else []
                for eid in ids:
                    if eid in my_entities and (eid, other_pname) not in seen_dups:
                        domain = eid.split(".", 1)[0] if "." in eid else ""
                        if domain in _read_only:
                            continue
                        seen_dups.add((eid, other_pname))
                        issues.append(Issue(
                            f"V55_{eid}_{other_pname}", SEV_WARN,
                            f"«{eid}» уже привязан к панели «{other_pname}».",
                            "Если специально — ок. Если случайно — отвяжите от одной из панелей.",
                            {"type": "duplicate", "entity_id": eid, "other_panel": other_pname},
                        ))

    # одна entity в нескольких слотах одной панели (например AC ↔ Heating)
    # ВАЖНО: read-only домены (sensor, binary_sensor, weather, …) делить — НОРМА.
    # Один датчик температуры комнаты может питать AC + Heating + Floor одновременно —
    # это валидный кейс «одна комната, несколько обогревателей».
    # Дублирование запрещаем только для actuator-доменов, где состояние команды
    # одного экрана затрёт другое (light/cover/fan/media_player/climate/switch).
    READ_ONLY_DOMAINS = {
        "sensor", "binary_sensor", "weather", "person", "zone",
        "sun", "device_tracker", "input_text", "input_number",
    }
    seen_in_keys: dict[str, list[str]] = {}
    for bk, val in entities.items():
        ids = (val if isinstance(val, list) else [val]) if val else []
        for eid in ids:
            if eid:
                seen_in_keys.setdefault(eid, []).append(bk)
    for eid, keys in seen_in_keys.items():
        if len(keys) <= 1:
            continue
        domain = eid.split(".", 1)[0] if "." in eid else ""
        if domain in READ_ONLY_DOMAINS:
            # Sensor-подобный entity в нескольких слотах — валидно. Молча пропускаем.
            continue
        issues.append(Issue(
            f"V56_{eid}", SEV_WARN,
            f"«{eid}» привязан одновременно к: {', '.join(keys)}.",
            "Один и тот же исполнитель в нескольких слотах — команды экранов будут конфликтовать.",
            {"type": "duplicate_self", "entity_id": eid},
        ))

    return issues


def has_errors(issues: list[Issue]) -> bool:
    return any(i.severity == SEV_ERROR for i in issues)


def summary(issues: list[Issue]) -> dict:
    return {
        "error":   sum(1 for i in issues if i.severity == SEV_ERROR),
        "warning": sum(1 for i in issues if i.severity == SEV_WARN),
        "info":    sum(1 for i in issues if i.severity == SEV_INFO),
        "total":   len(issues),
    }
