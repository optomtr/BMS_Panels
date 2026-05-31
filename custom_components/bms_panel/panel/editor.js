/**
 * BMS Smart Panel — полноэкранный редактор в сайдбаре HA.
 *
 * Web Component <bms-panel-editor>. hass инжектится автоматически.
 *
 * Архитектура:
 *   - Шапка: BMS Panels | search | help | Save (sticky, shows ⛔ N / ⚠ M)
 *   - Sidebar: список панелей со статусом (✓ / ⚠ N / ⛔ N), кнопка «Добавить»
 *   - Content: 4 таба для активной панели — Обзор / Экраны / Устройства / Главный экран
 *   - Bottom action bar — Save / Reset / Delete (destructive отделено)
 *   - Validation: validation.js → top-banner + inline + bind-card border
 */

import { validate, summary, hasErrors, BIND_KEYS, SEV_ERROR, SEV_WARN, SEV_INFO } from './validation.js';

// ---------- Метаданные экранов ----------

const SCREEN_META = {
  light:       { icon: 'mdi:lightbulb-outline',  ru: 'Свет',         en: 'Light',       hint: 'Лампы и светильники' },
  curtain:     { icon: 'mdi:curtains',           ru: 'Шторы',        en: 'Curtain',     hint: 'Шторы, рольставни, жалюзи' },
  music:       { icon: 'mdi:music',              ru: 'Музыка',       en: 'Music',       hint: 'Колонки, медиа-плееры' },
  // Short titles — соответствуют APK Menu/header (АС / Радиатор / Тёплый пол / Конвектор)
  ac:          { icon: 'mdi:air-conditioner',    ru: 'AC',           en: 'AC',          hint: 'Кондиционеры (cool/heat)' },
  heating:     { icon: 'mdi:radiator',           ru: 'Радиатор',     en: 'Heating',     hint: 'Радиаторы отопления' },
  floor:       { icon: 'mdi:heating-coil',       ru: 'Тёплый пол',   en: 'Floor heat',  hint: 'Электрический/водяной тёплый пол' },
  convector:   { icon: 'mdi:radiator-disabled',  ru: 'Конвектор',    en: 'Convector',   hint: 'Конвекторы с вентилятором' },
  ventilation: { icon: 'mdi:fan',                ru: 'Вентиляция',   en: 'Ventilation', hint: 'Приточная вентиляция, CO₂' },
};

// Все 9 разделов доступны для нижних иконок (1-в-1 с APK NAV_DEFS).
// Раньше отсутствовали floor/convector → их нельзя было выбрать, конфигуратор
// заменял их на 'menu'.
const HOME_NAV_OPTIONS = ['light','curtain','menu','music','ac','heating','floor','convector','ventilation'];

// Группы binding'ов для UI вкладки «Устройства».
// Каждая группа = карточка с заголовком, иконкой и набором ключей.
const BIND_GROUPS = [
  { key: 'light',       title: 'Свет',           icon: 'mdi:lightbulb-outline', screen: 'light',
    binds: [{ key: 'lights', label: 'Лампы и светильники' }] },
  { key: 'curtain',     title: 'Шторы',          icon: 'mdi:curtains',          screen: 'curtain',
    binds: [{ key: 'curtains', label: 'Шторы / жалюзи' }] },
  { key: 'music',       title: 'Музыка',         icon: 'mdi:music',             screen: 'music',
    binds: [{ key: 'media_players', label: 'Медиа-плееры' }] },
  { key: 'home',        title: 'Главный экран',  icon: 'mdi:home-thermometer',  screen: null,
    binds: [
      { key: 'temp_sensor',     label: 'Сенсор температуры' },
      { key: 'humidity_sensor', label: 'Сенсор влажности' },
    ] },
  { key: 'ac',          title: 'Кондиционер',    icon: 'mdi:air-conditioner',   screen: 'ac',
    binds: [
      { key: 'acs',               label: 'Термостаты AC' },
      { key: 'acs_current_temp',  label: 'Отдельный сенсор температуры (опц.)' },
    ] },
  { key: 'heating',     title: 'Радиаторы',      icon: 'mdi:radiator',          screen: 'heating',
    binds: [
      { key: 'heatings',              label: 'Термостаты радиаторов' },
      { key: 'heatings_current_temp', label: 'Отдельный сенсор температуры (опц.)' },
    ] },
  { key: 'floor',       title: 'Тёплый пол',     icon: 'mdi:heating-coil',      screen: 'floor',
    binds: [
      { key: 'floors',              label: 'Термостаты тёплого пола' },
      { key: 'floors_current_temp', label: 'Отдельный сенсор температуры (опц.)' },
    ] },
  { key: 'convector',   title: 'Конвектор',      icon: 'mdi:radiator-disabled', screen: 'convector',
    binds: [
      { key: 'convectors',              label: 'Термостаты конвекторов' },
      { key: 'convectors_current_temp', label: 'Отдельный сенсор температуры (опц.)' },
      { key: 'convector_fan',           label: 'Отдельный вентилятор (опц.)' },
    ] },
  { key: 'ventilation', title: 'Вентиляция',     icon: 'mdi:fan',               screen: 'ventilation',
    binds: [
      { key: 'ventilation_fans', label: 'Вентиляторы (приточные, вытяжные)' },
      { key: 'co2_sensor',       label: 'CO₂-сенсор (опц.)' },
    ] },
];

// ---------- Climate Presets ----------
// 1-в-1 с const.py DEFAULT_CLIMATE_PRESETS / APK ClimateMoodPreset.
// При расхождении — Python const.py источник истины (storage migration оттуда).
const CLIMATE_PRESET_DEFAULTS = {
  ac: {
    turbo:   { target: 22.0, hvac_mode: 'cool', fan_mode: 'high' },
    comfort: { target: 25.0, hvac_mode: 'cool', fan_mode: 'auto' },
    eco:     { target: 28.0, hvac_mode: 'dry',  fan_mode: 'low'  },
  },
  heating: {
    turbo:   { target: 23.0, hvac_mode: 'heat' },
    comfort: { target: 21.0, hvac_mode: 'heat' },
    eco:     { target: 18.0, hvac_mode: 'heat' },
  },
  floor: {
    turbo:   { target: 24.0, hvac_mode: 'heat' },
    comfort: { target: 22.0, hvac_mode: 'heat' },
    eco:     { target: 21.0, hvac_mode: 'heat' },
  },
  convector: {
    turbo:   { target: 24.0, hvac_mode: 'heat', fan_mode: 'high' },
    comfort: { target: 21.0, hvac_mode: 'heat', fan_mode: 'mid'  },
    eco:     { target: 18.0, hvac_mode: 'heat', fan_mode: 'low'  },
  },
};
// Сцены — три «характера». «Ручной» — runtime-only, тут не редактируется.
const CLIMATE_PRESET_SCENES = [
  { key: 'turbo',   label: 'Турбо',   icon: 'mdi:fire',                       sub: 'максимум' },
  { key: 'comfort', label: 'Комфорт', icon: 'mdi:alpha-a-circle-outline',     sub: 'повседневно' },
  { key: 'eco',     label: 'Эко',     icon: 'mdi:leaf',                       sub: 'экономия' },
];
const CLIMATE_PRESET_SCREEN_META = {
  ac:        { label: 'AC',        icon: 'mdi:air-conditioner',  hasFan: true  },
  heating:   { label: 'Радиатор',  icon: 'mdi:radiator',         hasFan: false },
  floor:     { label: 'Тёплый пол',icon: 'mdi:heating-coil',     hasFan: false },
  convector: { label: 'Конвектор', icon: 'mdi:radiator-disabled',hasFan: true  },
};
const CLIMATE_TARGET_MIN = 5.0;
const CLIMATE_TARGET_MAX = 35.0;
const CLIMATE_TARGET_STEP = 0.5;
// Стандартные HVAC modes HA. APK обработает любой, термостат может игнорить
// неподдерживаемые — это валидно с т.з. UX (выбор из его hvac_modes делается
// в момент рендера если есть привязка).
const CLIMATE_HVAC_MODE_LABELS = {
  off:       'Выкл',
  heat:      'Нагрев (heat)',
  cool:      'Охлаждение (cool)',
  heat_cool: 'Авто-нагрев/охл (heat_cool)',
  auto:      'Авто (auto)',
  dry:       'Осушение (dry)',
  fan_only:  'Только вентилятор (fan_only)',
};
const CLIMATE_FAN_MODE_LABELS = {
  off:    'Выкл',
  low:    'Низкая (low)',
  mid:    'Средняя (mid)',
  medium: 'Средняя (medium)',
  high:   'Высокая (high)',
  auto:   'Авто (auto)',
  diffuse:'Diffuse',
};
// Маппинг screen → bind-key (первый климат entity для UI «modes из устройства»)
const CLIMATE_BIND_KEY = { ac: 'acs', heating: 'heatings', floor: 'floors', convector: 'convectors' };

// Три таба — Обзор / Экраны / Устройства. «Главный экран» (нижние 5 иконок)
// объединён со списком экранов, потому что семантически это та же навигация.
const TABS = [
  { key: 'overview', icon: 'mdi:view-dashboard-outline', label: 'Обзор' },
  { key: 'screens',  icon: 'mdi:view-grid-outline',     label: 'Экраны' },
  { key: 'devices',  icon: 'mdi:devices',               label: 'Устройства' },
];

// ---------- Стили ----------

const STYLES = `
/* Inter font — same as APK. Falls back to system if blocked (e.g. self-hosted
   HA without Internet). The preview will still render — just slightly different
   metrics. Note: Google Fonts is permissible from HA frontend (no strict CSP). */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500&display=swap');

:host {
  display: block;
  background: var(--primary-background-color);
  min-height: 100vh;
  font-family: var(--paper-font-body1_-_font-family, -apple-system, system-ui, sans-serif);
  color: var(--primary-text-color);
  --bms-error:   #F44336;
  --bms-warn:    #FF9800;
  --bms-info:    #2196F3;
  --bms-success: #4CAF50;
  --bms-radius: 10px;
}
.toolbar {
  display: flex; align-items: center; gap: 12px;
  padding: 0 16px;
  height: var(--header-height, 56px);
  background: var(--app-header-background-color, var(--primary-color));
  color: var(--app-header-text-color, #fff);
  position: sticky; top: 0; z-index: 20;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}
.toolbar-title { font-size: 18px; font-weight: 500; flex: 1; }
.toolbar .icon-btn {
  width: 40px; height: 40px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; color: inherit; border: none; border-radius: 50%;
  cursor: pointer; font-size: 18px;
}
.toolbar .icon-btn:hover { background: rgba(255,255,255,0.15); }
.toolbar .save-btn {
  padding: 6px 16px; border-radius: 18px;
  background: rgba(255,255,255,0.15); color: #fff; border: 1px solid rgba(255,255,255,0.3);
  cursor: pointer; font-size: 14px; font-weight: 500;
  display: inline-flex; align-items: center; gap: 8px;
}
.toolbar .save-btn:hover { background: rgba(255,255,255,0.25); }
.toolbar .save-btn.dirty { background: var(--bms-warn); border-color: var(--bms-warn); }
.toolbar .save-btn.has-error { background: var(--bms-error); border-color: var(--bms-error); cursor: not-allowed; }
.toolbar .save-btn[disabled] { opacity: 0.6; cursor: not-allowed; }
.sev-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 10px; border-radius: 999px;
  font-size: 12px; font-weight: 500;
  background: rgba(255,255,255,0.15);
}
.sev-chip ha-icon { --mdc-icon-size: 14px; }

.bind-group-collapsed {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px;
  background: var(--secondary-background-color);
  border-radius: 8px;
  margin-bottom: 8px;
  font-size: 13px;
}

.screen-row .btn.ghost { padding: 4px; min-width: 28px; }
.screen-row .btn.ghost[disabled] { opacity: 0.3; }
.screen-row .btn.ghost ha-icon { --mdc-icon-size: 18px; }

.layout { display: flex; min-height: calc(100vh - 56px); }
.sidebar {
  width: 280px; flex-shrink: 0;
  background: var(--card-background-color);
  border-right: 1px solid var(--divider-color);
  padding: 12px 0;
  overflow-y: auto;
  position: sticky; top: 56px;
  height: calc(100vh - 56px);
}
.sidebar-header {
  padding: 0 16px 6px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--secondary-text-color);
}
.panel-list-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px;
  cursor: pointer;
  border-left: 3px solid transparent;
  font-size: 14px;
  user-select: none;
}
.panel-list-item:hover { background: var(--secondary-background-color); }
.panel-list-item.active {
  background: var(--secondary-background-color);
  border-left-color: var(--primary-color);
  font-weight: 500;
}
.panel-list-item .name { flex: 1; line-height: 1.3; }
.panel-list-item .meta { font-size: 11px; color: var(--secondary-text-color); margin-top: 2px; }
.panel-list-item .status-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--bms-success); flex-shrink: 0;
}
.panel-list-item .status-dot.warn { background: var(--bms-warn); }
.panel-list-item .status-dot.error { background: var(--bms-error); }
.panel-list-item .status-count {
  font-size: 11px; font-weight: 600;
  color: var(--bms-error);
  background: rgba(244, 67, 54, 0.1);
  padding: 2px 6px; border-radius: 8px;
}
.panel-list-item .status-count.warn {
  color: var(--bms-warn);
  background: rgba(255, 152, 0, 0.1);
}
.sidebar-add {
  margin: 12px 16px 6px;
  display: flex; gap: 8px; align-items: center; justify-content: center;
  padding: 12px;
  border: 1.5px dashed var(--divider-color);
  border-radius: var(--bms-radius);
  cursor: pointer;
  color: var(--primary-color);
  font-size: 14px; font-weight: 500;
}
.sidebar-add:hover { background: var(--secondary-background-color); border-color: var(--primary-color); }

.content {
  flex: 1;
  padding: 0;
  display: flex; flex-direction: column;
  min-width: 0;
}

.empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-height: 60vh; text-align: center; gap: 16px;
  color: var(--secondary-text-color);
  padding: 32px;
}
.empty-state ha-icon { --mdc-icon-size: 64px; opacity: 0.4; }
.empty-state h2 { color: var(--primary-text-color); margin: 0; font-weight: 500; }
.empty-state p { max-width: 480px; margin: 0; line-height: 1.5; }
.empty-state .btn-primary {
  margin-top: 8px;
}

/* ---- Tabs ---- */
.tabs {
  display: flex;
  background: var(--card-background-color);
  border-bottom: 1px solid var(--divider-color);
  position: sticky; top: 56px; z-index: 10;
  overflow-x: auto;
}
.tab {
  display: flex; align-items: center; gap: 6px;
  padding: 14px 18px;
  cursor: pointer;
  font-size: 14px;
  color: var(--secondary-text-color);
  border-bottom: 3px solid transparent;
  white-space: nowrap;
  user-select: none;
}
.tab:hover { background: var(--secondary-background-color); }
.tab.active {
  color: var(--primary-color);
  border-bottom-color: var(--primary-color);
  font-weight: 500;
}
.tab .badge {
  background: var(--bms-error); color: white;
  font-size: 11px; padding: 0 6px;
  height: 16px; min-width: 16px;
  border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
}
.tab .badge.warn { background: var(--bms-warn); }

.tab-content {
  padding: 20px 24px 100px;
  max-width: 920px;
  flex: 1;
}

/* ---- Validation banner ---- */
.issues-banner {
  margin-bottom: 16px;
  border-radius: var(--bms-radius);
  border: 1px solid var(--divider-color);
  background: var(--card-background-color);
  overflow: hidden;
}
.issues-banner.has-error { border-color: var(--bms-error); }
.issues-banner.has-warn  { border-color: var(--bms-warn); }
.issues-banner.empty {
  border-color: var(--bms-success);
  background: rgba(76, 175, 80, 0.05);
}
.issues-banner-head {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px;
  font-size: 14px; font-weight: 500;
  cursor: pointer;
  user-select: none;
}
.issues-banner.empty .issues-banner-head { cursor: default; }
.issues-banner-head .chev { margin-left: auto; transition: transform 0.15s; }
.issues-banner.expanded .issues-banner-head .chev { transform: rotate(180deg); }
.issues-list {
  border-top: 1px solid var(--divider-color);
  max-height: 0; overflow: hidden; transition: max-height 0.2s;
}
.issues-banner.expanded .issues-list { max-height: 400px; overflow-y: auto; }
.issue-row {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--divider-color);
  font-size: 13px;
  cursor: pointer;
}
.issue-row:last-child { border-bottom: none; }
.issue-row:hover { background: var(--secondary-background-color); }
.issue-row .sev-icon { flex-shrink: 0; }
.issue-row.error .sev-icon { color: var(--bms-error); }
.issue-row.warning .sev-icon { color: var(--bms-warn); }
.issue-row.info .sev-icon { color: var(--bms-info); }
.issue-row .body { flex: 1; line-height: 1.4; }
.issue-row .body .hint {
  color: var(--secondary-text-color);
  font-size: 12px; margin-top: 2px;
}

/* ---- Cards ---- */
.card {
  background: var(--card-background-color);
  border-radius: var(--bms-radius);
  padding: 18px 20px;
  margin-bottom: 16px;
  border: 1px solid var(--divider-color);
}
.card-title {
  font-size: 15px; font-weight: 500;
  margin: 0 0 4px;
  color: var(--primary-text-color);
  display: flex; align-items: center; gap: 8px;
}
.card-sub {
  font-size: 13px;
  color: var(--secondary-text-color);
  margin: 0 0 14px;
  line-height: 1.45;
}

.field-row {
  display: flex; align-items: center; gap: 12px;
  margin: 12px 0;
}
.field-row label {
  width: 180px; flex-shrink: 0;
  font-size: 14px; color: var(--secondary-text-color);
}
.field-row .control { flex: 1; }
.field-row .val {
  width: 60px; text-align: right;
  color: var(--secondary-text-color);
  font-variant-numeric: tabular-nums;
}
.inline-issue {
  font-size: 12px; margin-top: 4px;
  padding: 6px 10px;
  border-radius: 6px;
  display: flex; gap: 6px; align-items: flex-start;
}
.inline-issue.error { background: rgba(244,67,54,0.1); color: var(--bms-error); }
.inline-issue.warning { background: rgba(255,152,0,0.1); color: #C77700; }
.inline-issue.info { background: rgba(33,150,243,0.1); color: var(--bms-info); }

select, input[type=text], input[type=number] {
  background: var(--card-background-color);
  border: 1px solid var(--divider-color);
  color: var(--primary-text-color);
  padding: 8px 10px; border-radius: 6px; font-size: 14px;
  font-family: inherit;
  width: 100%; box-sizing: border-box;
}
input[type=range] { width: 100%; }

/* ---- Screens list ---- */
.screen-list { display: flex; flex-direction: column; gap: 8px; }
.screen-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  background: var(--secondary-background-color);
  border: 1px solid var(--divider-color);
  border-radius: var(--bms-radius);
  user-select: none;
}
.screen-row[draggable] { cursor: grab; }
.screen-row.dragging { opacity: 0.4; }
.screen-row.drag-over { border-color: var(--primary-color); border-width: 2px; padding: 11px 13px; }
.screen-row.disabled .name,
.screen-row.disabled .hint { opacity: 0.4; }
.screen-row .handle {
  color: var(--secondary-text-color);
  --mdc-icon-size: 18px;
  cursor: grab;
}
.screen-row .name { flex: 1; font-size: 15px; }
.screen-row .hint { font-size: 12px; color: var(--secondary-text-color); margin-top: 2px; }
.screen-row .text-block { flex: 1; }
.screen-row .warn-icon { color: var(--bms-warn); --mdc-icon-size: 18px; }

/* ---- Bind cards ---- */
.bind-group {
  background: var(--card-background-color);
  border-radius: var(--bms-radius);
  padding: 16px 18px;
  margin-bottom: 14px;
  border: 1px solid var(--divider-color);
}
.bind-group.has-error   { border-color: var(--bms-error); }
.bind-group.has-warn    { border-color: var(--bms-warn); }
.bind-group-head {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 4px;
}
.bind-group-head ha-icon { --mdc-icon-size: 22px; color: var(--primary-color); }
.bind-group-title { font-size: 16px; font-weight: 500; flex: 1; }
.bind-group-sub {
  font-size: 12px;
  color: var(--secondary-text-color);
  margin-bottom: 12px;
}
.bind-card {
  border: 1px solid var(--divider-color);
  border-radius: 8px;
  padding: 10px 14px;
  margin: 8px 0;
  background: var(--secondary-background-color);
}
.bind-card-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 6px;
  font-size: 13px;
}
.bind-card-title { font-weight: 500; }
.bind-card-meta { font-size: 12px; color: var(--secondary-text-color); }
.bind-card-meta.error { color: var(--bms-error); font-weight: 500; }
.bind-card-meta.warn  { color: var(--bms-warn); font-weight: 500; }
.bind-list {
  max-height: 240px; overflow-y: auto;
  background: var(--card-background-color);
  border-radius: 6px;
  padding: 4px;
}
.bind-item {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 8px;
  cursor: pointer; font-size: 13px;
  border-radius: 4px;
  user-select: none;
}
.bind-item:hover { background: var(--secondary-background-color); }
.bind-item .nm { flex: 1; }
.bind-item .eid {
  font-size: 11px; color: var(--secondary-text-color);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
.bind-item.unavailable .nm { color: var(--bms-warn); }
.bind-item.unavailable .nm::after { content: ' (offline)'; font-size: 11px; }
.bind-item-search {
  padding: 6px 8px;
  position: sticky; top: 0;
  background: var(--card-background-color);
}
.bind-item-search input {
  font-size: 13px; padding: 6px 8px;
}
.bind-empty {
  padding: 14px; text-align: center;
  color: var(--secondary-text-color); font-size: 13px;
}

.entity-select-wrap {
  display: flex; gap: 8px; align-items: center;
  flex-wrap: wrap;
}
.entity-select-wrap select { flex: 1; min-width: 200px; }

/* ---- Climate Presets (вложенная секция в bind-group) ---- */
/* Redesigned for integrators on wide screens: large cards, big touch targets,
   expanded-by-default, no text overflow. Responsive: stacks at <900px. */
.climate-presets {
  margin-top: 18px;
  padding: 18px 16px 16px;
  background: linear-gradient(180deg, rgba(33,150,243,0.05), transparent 80%);
  border: 1px solid var(--divider-color);
  border-radius: var(--bms-radius);
}
.climate-presets-head {
  display: flex; align-items: center; gap: 12px;
  cursor: pointer; user-select: none;
  padding: 4px 2px 10px;
  border-bottom: 1px solid var(--divider-color);
  margin-bottom: 14px;
  min-width: 0;
}
.climate-presets-head .cp-head-icon {
  --mdc-icon-size: 28px;
  color: var(--primary-color);
  flex-shrink: 0;
}
.climate-presets-head .cp-head-text {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; gap: 2px;
}
.climate-presets-head .cp-title {
  font-size: 20px; font-weight: 500;
  line-height: 1.2;
  color: var(--primary-text-color);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.climate-presets-head .cp-subtitle {
  font-size: 13px; color: var(--secondary-text-color);
  line-height: 1.3;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.climate-presets-head .cp-state-badge {
  font-size: 11px; padding: 3px 10px; border-radius: 999px;
  text-transform: uppercase; letter-spacing: 0.4px; font-weight: 500;
  flex-shrink: 0;
  background: var(--secondary-background-color);
  color: var(--secondary-text-color);
}
.climate-presets-head .cp-state-badge.modified {
  background: rgba(255,152,0,0.15);
  color: var(--bms-warn);
}
.climate-presets-head ha-icon.chev {
  --mdc-icon-size: 24px;
  transition: transform 0.2s;
  color: var(--secondary-text-color);
  flex-shrink: 0;
}
.climate-presets.expanded .climate-presets-head ha-icon.chev { transform: rotate(180deg); }
.climate-presets-body {
  display: none;
}
.climate-presets.expanded .climate-presets-body { display: block; }

/* Card grid: 3 wide cards on >=900px, 1 col when narrower. */
.climate-preset-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
@media (max-width: 900px) {
  .climate-preset-cards { grid-template-columns: 1fr; }
}

.cp-card {
  background: var(--card-background-color);
  border: 1px solid var(--divider-color);
  border-radius: var(--bms-radius);
  padding: 16px;
  display: flex; flex-direction: column; gap: 12px;
  min-width: 0;
  position: relative;
}
.cp-card.is-modified { border-color: var(--bms-info); }
.cp-card-head {
  display: flex; align-items: center; gap: 10px;
  min-width: 0;
}
.cp-card-head ha-icon { --mdc-icon-size: 32px; color: #C99A55; flex-shrink: 0; }
.cp-card-head .cp-card-titles { flex: 1; min-width: 0; }
.cp-card-head .cp-card-name {
  font-size: 18px; font-weight: 500; line-height: 1.2;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cp-card-head .cp-card-sub {
  font-size: 12px; color: var(--secondary-text-color); line-height: 1.3;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cp-card-head .cp-modified-pill {
  font-size: 10px; padding: 3px 8px; border-radius: 999px;
  background: rgba(33,150,243,0.15); color: var(--bms-info);
  text-transform: uppercase; letter-spacing: 0.4px;
  flex-shrink: 0;
}

/* Big temperature stepper */
.cp-temp-row {
  display: flex; flex-direction: column; gap: 6px;
}
.cp-temp-label {
  font-size: 11px; color: var(--secondary-text-color);
  text-transform: uppercase; letter-spacing: 0.4px;
}
.cp-temp-stepper {
  display: flex; align-items: center; justify-content: space-between;
  background: var(--secondary-background-color);
  border-radius: 10px;
  padding: 6px;
  gap: 8px;
}
.cp-temp-stepper button {
  width: 48px; height: 48px; min-width: 48px;
  border: 1px solid var(--divider-color);
  border-radius: 10px;
  background: var(--card-background-color);
  color: var(--primary-text-color);
  cursor: pointer;
  font-size: 24px; font-weight: 500;
  display: inline-flex; align-items: center; justify-content: center;
  user-select: none;
  flex-shrink: 0;
}
.cp-temp-stepper button:hover:not([disabled]) { background: var(--primary-color); color: #fff; border-color: var(--primary-color); }
.cp-temp-stepper button:active:not([disabled]) { transform: scale(0.95); }
.cp-temp-stepper button[disabled] { opacity: 0.35; cursor: not-allowed; }
.cp-temp-value {
  flex: 1; text-align: center;
  font-size: 32px; font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  min-width: 0;
  overflow: hidden;
}
.cp-temp-value.overridden { color: var(--bms-info); }

/* Mode dropdowns */
.cp-field {
  display: flex; flex-direction: column; gap: 6px;
  min-width: 0;
}
.cp-field-label {
  font-size: 11px; color: var(--secondary-text-color);
  text-transform: uppercase; letter-spacing: 0.4px;
}
.climate-preset-select {
  width: 100%; box-sizing: border-box;
  height: 40px; padding: 0 10px;
  font-size: 14px; font-family: inherit;
  background: var(--secondary-background-color);
  border: 1px solid var(--divider-color);
  border-radius: 8px;
  color: var(--primary-text-color);
  min-width: 0;
}
.climate-preset-select.overridden { border-color: var(--bms-info); border-width: 2px; padding: 0 9px; }

/* Footer: hint + reset button */
.climate-presets-footer {
  display: flex; justify-content: space-between; align-items: center;
  gap: 12px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--divider-color);
  font-size: 13px; color: var(--secondary-text-color);
  flex-wrap: wrap;
}
.climate-presets-footer .cp-hint { min-width: 0; flex: 1; }
.climate-presets-footer .reset-btn {
  background: transparent;
  border: 1px solid var(--divider-color);
  color: var(--secondary-text-color);
  padding: 8px 16px;
  min-height: 40px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px; font-family: inherit;
  display: inline-flex; align-items: center; gap: 6px;
  flex-shrink: 0;
}
.climate-presets-footer .reset-btn:hover:not([disabled]) {
  border-color: var(--bms-warn);
  color: var(--bms-warn);
}
.climate-presets-footer .reset-btn[disabled] { opacity: 0.4; cursor: not-allowed; }
.climate-presets-footer .reset-btn ha-icon { --mdc-icon-size: 16px; }

/* ---- Home nav ---- */
.home-nav-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
  margin-top: 8px;
}
.home-nav-slot {
  background: var(--secondary-background-color);
  border: 1px solid var(--divider-color);
  border-radius: var(--bms-radius);
  padding: 10px 8px;
  text-align: center;
}
.home-nav-slot.has-error { border-color: var(--bms-error); }
.home-nav-slot .num {
  font-size: 11px; color: var(--secondary-text-color); margin-bottom: 4px;
}
.home-nav-slot select {
  padding: 6px 4px; font-size: 13px;
  text-align: center;
  text-align-last: center;
}

/* ---- Buttons ---- */
.btn {
  padding: 8px 16px; border-radius: 6px;
  border: 1px solid var(--divider-color);
  background: var(--card-background-color);
  color: var(--primary-text-color);
  cursor: pointer; font-size: 14px; font-family: inherit;
  display: inline-flex; align-items: center; gap: 6px;
}
.btn:hover { background: var(--secondary-background-color); }
.btn.primary { background: var(--primary-color); color: white; border-color: var(--primary-color); }
.btn.primary:hover { filter: brightness(0.95); }
.btn.danger { color: var(--bms-error); border-color: rgba(244, 67, 54, 0.3); }
.btn.danger:hover { background: rgba(244, 67, 54, 0.08); }
.btn.ghost { background: transparent; border-color: transparent; }
.btn.ghost:hover { background: var(--secondary-background-color); }
.btn[disabled] { opacity: 0.5; cursor: not-allowed; }

.bottom-bar {
  position: sticky; bottom: 0;
  background: var(--card-background-color);
  border-top: 1px solid var(--divider-color);
  padding: 12px 24px;
  display: flex; align-items: center; gap: 8px;
  z-index: 9;
}
.bottom-bar .left { flex: 1; display: flex; gap: 8px; }
.bottom-bar .right { display: flex; gap: 8px; }

/* ---- Modal ---- */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 100;
  animation: fadeIn 0.15s;
}
@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
.modal {
  background: var(--card-background-color);
  border-radius: 14px;
  padding: 24px;
  width: 460px; max-width: 92vw;
  max-height: 90vh; overflow-y: auto;
  box-shadow: 0 12px 48px rgba(0,0,0,0.4);
}
.modal h3 { margin: 0 0 12px; font-weight: 500; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }

/* ---- Toast ---- */
.toast {
  position: fixed; bottom: 24px; right: 24px;
  background: var(--card-background-color);
  color: var(--primary-text-color);
  border-radius: 10px;
  padding: 12px 16px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.2);
  display: flex; gap: 10px; align-items: center;
  font-size: 14px;
  z-index: 200;
  border-left: 4px solid var(--bms-success);
  animation: slideUp 0.2s;
}
.toast.error { border-left-color: var(--bms-error); }
.toast.warn  { border-left-color: var(--bms-warn); }
@keyframes slideUp { from { transform: translateY(20px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }

@media (max-width: 700px) {
  .layout { flex-direction: column; }
  .sidebar { width: 100%; height: auto; position: static; border-right: none; border-bottom: 1px solid var(--divider-color); }
  .field-row { flex-direction: column; align-items: stretch; }
  .field-row label { width: auto; }
  .home-nav-grid { grid-template-columns: repeat(2, 1fr); }
}

/* ============ LIVE PREVIEW PANE ============
 *
 * Pixel-perfect preview of the BMS Panel APK. The CSS below is a
 * 1:1 port of ~/bms-panel-app/index.html — the same web prototype the
 * APK was built from. All sizes/colors/spacing match the real device.
 *
 * Class names are namespaced with '.pv-' (preview) so they cannot leak
 * to the outer HA editor CSS.
 *
 * Panel container: .pv-panel — 480×480 square (true device size).
 * No CSS transforms — what you see is what's on the panel.
 *
 * Background:
 *   .pv-panel        — sub-screens (Light/Curtain/...) — uses blurred backdrop
 *   .pv-panel.pv-home — Home screen — uses sharp background image, dimmed
 *                       per '--pv-home-dim' (set inline from background_dim).
 *   Background source: /bms_panel_static/background.png (built-in) or
 *                       integrator-supplied URL via background_image_url.
 */
.preview-pane {
  width: 540px;
  flex-shrink: 0;
  background: #0a0a0a;
  border-left: 1px solid var(--divider-color);
  padding: 20px 14px;
  position: sticky;
  top: 56px;
  height: calc(100vh - 56px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
}
.preview-pane.collapsed { width: 56px; padding: 16px 0; align-items: center; background: var(--card-background-color); }
.preview-pane.collapsed .preview-body,
.preview-pane.collapsed .preview-head-title,
.preview-pane.collapsed .preview-screen-picker { display: none; }
.preview-head {
  display: flex; align-items: center; gap: 8px;
  font-size: 11px; text-transform: uppercase; letter-spacing: 1px;
  color: rgba(255,255,255,0.55);
  width: 100%; max-width: 480px;
}
.preview-head .preview-head-title { flex: 1; }
.preview-head .icon-btn {
  padding: 4px; border-radius: 6px; cursor: pointer;
  color: rgba(255,255,255,0.7);
}
.preview-head .icon-btn:hover { background: rgba(255,255,255,0.1); }
.preview-screen-picker {
  display: flex; gap: 4px; flex-wrap: wrap; padding: 4px 0;
  width: 100%; max-width: 480px;
}
.preview-screen-picker .ps-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 8px; font-size: 11px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 12px; cursor: pointer;
  color: rgba(255,255,255,0.8);
}
.preview-screen-picker .ps-btn ha-icon { --mdc-icon-size: 14px; pointer-events: none; }
.preview-screen-picker .ps-btn span { pointer-events: none; }
.preview-screen-picker .ps-btn.active {
  background: #C99A55;
  color: #1A1612; border-color: #C99A55;
}
.preview-screen-picker .ps-btn.disabled { opacity: 0.35; cursor: not-allowed; }
.preview-body {
  display: flex; justify-content: center; align-items: flex-start;
  width: 100%;
}

/* ============ The actual 480×480 panel mockup ============ */
.pv-panel {
  width: 480px; height: 480px;
  position: relative; overflow: hidden;
  isolation: isolate;
  /* Visible if background fails to load — matches index.html fallback */
  background: linear-gradient(135deg, #d8d4ce 0%, #aea99e 50%, #8a8378 100%);
  box-shadow: 0 30px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.05);
  border-radius: 14px;
  color: #fff;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display',
               'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}
.pv-panel * { box-sizing: border-box; margin: 0; padding: 0; }
/* Blurred backdrop for sub-screens (same as index.html .panel::before) */
.pv-panel::before {
  content: ''; position: absolute; inset: -30px;
  background: var(--pv-bg-img, url('/bms_panel_static/background.png?v=2.2.3')) center/cover no-repeat;
  filter: blur(18px); transform: scale(1.1);
  z-index: -1;
}
.pv-panel::after {
  content: ''; position: absolute; inset: 0;
  background: rgba(0,0,0,0.55); z-index: -1;
}
/* Home screen: sharp background, dim controlled by --pv-home-dim */
.pv-panel.pv-home::before {
  filter: none; transform: scale(1); inset: 0;
}
.pv-panel.pv-home::after {
  background: rgba(0,0,0, var(--pv-home-dim, 0.3));
}

/* ============ Header (sub-screens) ============ */
.pv-header {
  position: absolute; top: 0; left: 0; right: 0;
  height: 64px;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 20px; z-index: 3;
}
.pv-header-btn {
  width: 44px; height: 44px; position: relative;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
}
.pv-header-btn:active { opacity: 0.5; transform: scale(0.9); }
.pv-header-btn svg {
  width: 30px; height: 30px;
  fill: none; stroke: #fff; stroke-width: 2.4;
  stroke-linecap: round; stroke-linejoin: round;
}
.pv-header-title {
  font-size: 24px; font-weight: 500; color: #fff;
  text-shadow: 0 1px 4px rgba(0,0,0,0.5);
}
.pv-header-spacer { width: 44px; }
.pv-divider {
  position: absolute; top: 64px; left: 0; right: 0;
  height: 1px; background: rgba(255,255,255,0.15);
  z-index: 2;
}

/* Scrollable list area below header (used by Light/Curtain) */
.pv-list {
  position: absolute; top: 65px; left: 0; right: 0; bottom: 0;
  overflow-y: auto; overflow-x: hidden; padding-bottom: 16px;
  z-index: 2;
}
.pv-list::-webkit-scrollbar { width: 0; }

/* Empty state for sub-screens */
.pv-empty {
  position: absolute; top: 64px; left: 0; right: 0; bottom: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 30px;
  color: rgba(255,255,255,0.55); font-size: 14px; line-height: 1.5; text-align: center;
  z-index: 2;
}
.pv-empty ha-icon { --mdc-icon-size: 56px; opacity: 0.45; margin-bottom: 14px; }
.pv-empty .hint { margin-top: 8px; font-size: 12px; opacity: 0.7; }

/* ============ HOME ============ */
.pv-panel .pv-home-climate {
  position: absolute; top: 20px; left: 0; right: 0; height: 140px;
  display: flex; justify-content: space-around; align-items: center;
  padding: 0 40px; z-index: 2;
}
.pv-home-climate .cli {
  display: flex; flex-direction: column; align-items: center; color: #fff;
}
.pv-home-climate .cli-icon {
  width: 50px; height: 50px;
  display: flex; align-items: center; justify-content: center;
}
.pv-home-climate .cli-icon svg, .pv-home-climate .cli-icon ha-icon {
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
}
.pv-home-climate .cli-icon ha-icon { --mdc-icon-size: 44px; color: #fff; }
.pv-home-climate .cli-val {
  font-size: 38px; font-weight: 300; line-height: 1;
  margin-top: 6px; color: #fff; font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 4px rgba(0,0,0,0.5);
}
.pv-home-climate .cli-val .unit { font-size: 22px; font-weight: 300; margin-left: 2px; }
.pv-home-climate .cli-lbl {
  font-size: 14px; margin-top: 4px; font-weight: 400;
  color: #fff; letter-spacing: 0.5px; text-shadow: 0 1px 3px rgba(0,0,0,0.5);
}
.pv-home-band {
  position: absolute; top: 160px; left: 0; right: 0;
  height: 150px; background: rgba(20,18,16,0.82);
  pointer-events: none; z-index: 1;
}
.pv-home-clock {
  position: absolute; top: 180px; left: 0; right: 0; text-align: center; z-index: 2;
}
.pv-home-clock .t {
  font-size: 68px; font-weight: 200; letter-spacing: 1px; line-height: 1;
  text-shadow: 0 2px 12px rgba(0,0,0,0.5); font-variant-numeric: tabular-nums;
  color: #fff;
}
.pv-home-clock .d {
  font-size: 17px; font-weight: 300; margin-top: 8px;
  text-shadow: 0 1px 4px rgba(0,0,0,0.6); color: #fff;
}
.pv-home-clock .comfort {
  font-size: 13px; font-weight: 300; margin-top: 6px;
  color: rgba(255,255,255,0.7); letter-spacing: 0.3px;
  text-shadow: 0 1px 3px rgba(0,0,0,0.5);
}
.pv-home-nav {
  position: absolute; bottom: 28px; left: 0; right: 0;
  display: flex; justify-content: space-around; padding: 0 8px; z-index: 2;
}
.pv-home-nav .nv {
  display: flex; flex-direction: column; align-items: center;
  cursor: pointer; width: 88px;
}
.pv-home-nav .nv:active { opacity: 0.55; transform: scale(0.92); }
.pv-home-nav .nv-icon {
  width: 80px; height: 80px;
  display: flex; align-items: center; justify-content: center;
}
.pv-home-nav .nv-icon ha-icon {
  --mdc-icon-size: 56px; color: #fff;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
  pointer-events: none;
}
.pv-home-nav .nv .lbl {
  font-size: 15px; margin-top: 4px; font-weight: 400; color: #fff;
  text-shadow: 0 1px 3px rgba(0,0,0,0.5);
  pointer-events: none;
}

/* ============ MENU (3×3 grid) ============ */
.pv-menu-grid {
  position: absolute; top: 86px; left: 20px; right: 20px; bottom: 18px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 12px; z-index: 2;
}
.pv-menu-grid .tl {
  background: rgba(20,20,22,0.55);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 16px;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  cursor: pointer; padding: 6px;
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
}
.pv-menu-grid .tl:active { background: rgba(40,40,44,0.75); transform: scale(0.96); }
.pv-menu-grid .tl.empty,
.pv-menu-grid .tl.disabled {
  opacity: 0.35; cursor: not-allowed;
}
.pv-menu-grid .tl-icon {
  width: 54px; height: 54px; display: flex; align-items: center; justify-content: center;
  margin-bottom: 6px;
}
.pv-menu-grid .tl-icon ha-icon {
  --mdc-icon-size: 50px; color: #fff;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
  pointer-events: none;
}
.pv-menu-grid .tl .lb {
  font-size: 15px; font-weight: 400; color: #fff;
  text-shadow: 0 1px 3px rgba(0,0,0,0.5);
  text-align: center; line-height: 1.2;
  pointer-events: none;
}
.pv-menu-grid .tl.tl-custom {
  border-color: rgba(201,154,85,0.45);
}
.pv-menu-grid .tl.tl-custom .tl-icon ha-icon { color: #C99A55; }

/* ============ CURTAIN ============ */
.pv-curtain-device {
  padding: 16px 22px 18px;
  border-bottom: 1px solid rgba(255,255,255,0.15);
}
.pv-curtain-device:last-child { border-bottom: none; }
.pv-curtain-device .head {
  display: flex; align-items: center; gap: 12px; margin-bottom: 8px;
}
.pv-curtain-device .head ha-icon {
  --mdc-icon-size: 24px; color: #fff;
}
.pv-curtain-device .head .nm { flex: 1; font-size: 17px; color: #fff; }
.pv-curtain-device .head .pct {
  font-size: 14px; color: rgba(255,255,255,0.7);
  font-variant-numeric: tabular-nums;
}
/* APK CurtainScreen.kt: 5 preset pills (0/25/50/75/100%) — без slider */
.pv-curtain-device .preset-row {
  display: flex; gap: 6px; margin: 4px 0 8px;
}
.pv-curtain-device .preset-row .pv-curtain-preset {
  flex: 1; height: 36px;
  border: 1px solid rgba(255,255,255,0.22);
  border-radius: 8px; background: rgba(26,22,18,0.5);
  color: rgba(255,255,255,0.85); font-size: 13px;
  font-variant-numeric: tabular-nums;
  font-family: inherit; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.12s, border-color 0.12s;
}
.pv-curtain-device .preset-row .pv-curtain-preset:active {
  background: rgba(255,255,255,0.10); transform: scale(0.97);
}
.pv-curtain-device .preset-row .pv-curtain-preset.active {
  border-color: #C99A55; border-width: 1.5px;
  background: rgba(201,154,85,0.15); color: #fff;
}
.pv-curtain-device .btn-row {
  display: flex; justify-content: space-between; gap: 10px; margin-top: 4px;
}
.pv-curtain-device .btn {
  flex: 1; height: 42px;
  border: 1px solid rgba(255,255,255,0.25);
  border-radius: 10px; background: rgba(26,22,18,0.5);
  color: #fff; font-size: 15px; cursor: pointer;
  font-family: inherit;
  display: flex; align-items: center; justify-content: center;
}
.pv-curtain-device .btn:active { background: rgba(255,255,255,0.10); transform: scale(0.98); }
.pv-curtain-device .btn.active {
  border-color: #C99A55; border-width: 1.5px;
  background: rgba(201,154,85,0.18); color: #fff;
}

/* Status label под header (Light/Curtain) */
.pv-status-label {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 22px 12px;
  font-size: 13px; color: rgba(255,255,255,0.55);
  letter-spacing: 0.2px;
}
.pv-status-label .dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: rgba(255,255,255,0.3);
  display: inline-block;
}
.pv-status-label .dot.on { background: #C99A55; box-shadow: 0 0 6px rgba(201,154,85,0.7); }

/* ============ LIGHT ============ */
.pv-light-device {
  padding: 16px 22px 18px;
  border-bottom: 1px solid rgba(255,255,255,0.15);
}
.pv-light-device:last-child { border-bottom: none; }
.pv-light-device .device-row {
  display: flex; align-items: center; gap: 12px;
  cursor: pointer;
  padding: 4px 0; margin: -4px 0;
  border-radius: 6px;
  transition: background 0.12s;
}
.pv-light-device .device-row:active { background: rgba(255,255,255,0.06); }
.pv-light-device .device-icon {
  width: 30px; height: 30px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.pv-light-device .device-icon ha-icon { --mdc-icon-size: 26px; color: #fff; }
.pv-light-device.off .device-icon ha-icon { color: rgba(255,255,255,0.45); }
.pv-light-device .device-name { flex: 1; font-size: 17px; color: #fff; }
.pv-light-device.off .device-name { color: rgba(255,255,255,0.5); }
.pv-light-device .color-swatch {
  width: 32px; height: 24px; border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.2); cursor: pointer;
  transition: opacity 0.15s;
}
.pv-light-device.off .color-swatch { opacity: 0.35; filter: saturate(0.4); }
.pv-light-device .brightness { margin-top: 14px; }
.pv-light-device .brightness-label {
  font-size: 13px; color: rgba(255,255,255,0.5); margin-bottom: 8px;
}
.pv-light-device .light-slider {
  position: relative; height: 44px; cursor: pointer;
}
.pv-light-device .light-slider .track-bg {
  position: absolute; left: 0; right: 0; top: 20px;
  height: 5px; background: rgba(255,255,255,0.22);
  border-radius: 3px;
}
.pv-light-device .light-slider .track-fill {
  position: absolute; left: 0; top: 20px;
  height: 5px; background: rgba(255,255,255,0.9);
  border-radius: 3px;
  pointer-events: none;
}
.pv-light-device .light-slider .percent {
  position: absolute; top: -3px;
  font-size: 12px; color: #fff; font-weight: 500;
  transform: translateX(-50%);
  background: rgba(0,0,0,0.55);
  padding: 2px 8px; border-radius: 10px;
  white-space: nowrap;
  border: 1px solid rgba(255,255,255,0.1);
  pointer-events: none;
}
.pv-light-device .light-slider .handle {
  position: absolute; top: 13px;
  width: 22px; height: 22px; background: #fff;
  border-radius: 50%;
  transform: translateX(-50%);
  box-shadow: 0 2px 5px rgba(0,0,0,0.5);
  z-index: 2; pointer-events: none;
}

/* iOS-style toggle (used in light row). Matches index.html .toggle-sm */
.pv-toggle-sm {
  position: relative; width: 48px; height: 28px;
  background: rgba(120,120,128,0.4);
  border-radius: 14px;
  flex-shrink: 0;
  pointer-events: none;
}
.pv-toggle-sm.on { background: rgba(255,255,255,0.85); }
.pv-toggle-sm .thumb {
  position: absolute; top: 2px; left: 2px;
  width: 24px; height: 24px; background: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
  transition: transform 0.15s, background 0.15s;
}
.pv-toggle-sm.on .thumb { transform: translateX(20px); background: #1a1a1a; }

/* Master toggle in light/curtain header */
.pv-header-btn.power-on svg { stroke: #C99A55; }

/* ============ CLIMATE (AC/Heating/Floor/Convector) ============ */
/* APK layout: большая центральная температура → «сейчас» → 4 vertical pill-row */
.pv-climate-cur {
  position: absolute; top: 78px; left: 0; right: 0;
  display: flex; flex-direction: column; align-items: center;
  z-index: 2; pointer-events: none;
}
.pv-climate-cur .big {
  font-size: 78px; font-weight: 200; line-height: 1;
  color: #fff; font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 6px rgba(0,0,0,0.4);
}
.pv-climate-cur .big .deg {
  vertical-align: top; font-size: 36px; font-weight: 300; margin-left: 2px;
}
.pv-climate-cur .lbl {
  font-size: 13px; color: rgba(255,255,255,0.55); margin-top: 6px;
}
.pv-climate-cur.disabled { opacity: 0.45; }

/* Smart context line: «● Прогрев до 25° · ≈20 мин» */
.pv-climate-context {
  display: flex; align-items: center; gap: 8px;
  margin-top: 10px;
  font-size: 14px; font-weight: 300;
  color: rgba(255,255,255,0.8);
  text-shadow: 0 1px 4px rgba(0,0,0,0.4);
}
.pv-climate-context .dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: rgba(255,255,255,0.5);
  display: inline-block;
}
.pv-climate-context .dot.pulse {
  background: #C99A55;
  animation: pv-climate-pulse 1.5s ease-in-out infinite;
}
@keyframes pv-climate-pulse {
  0%, 100% { opacity: 0.35; }
  50%      { opacity: 1; }
}
.pv-climate-scene.pv-climate-manual .t .manual-dot {
  display: inline-block;
  width: 5px; height: 5px; border-radius: 50%;
  background: #C99A55; margin-left: 6px;
  vertical-align: middle;
  animation: pv-climate-pulse 2s ease-in-out infinite;
}

/* 4 vertical scene rows (Турбо / Комфорт / Эко / Ручной) */
.pv-climate-scenes {
  position: absolute; left: 16px; right: 16px; top: 230px; bottom: 12px;
  display: flex; flex-direction: column; gap: 6px; z-index: 2;
}
.pv-climate-scene {
  flex: 1; min-height: 50px;
  display: flex; align-items: center; gap: 12px;
  padding: 0 16px;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 10px;
  background: rgba(255,255,255,0.05);
  color: rgba(255,255,255,0.85);
  cursor: pointer; font-family: inherit;
  text-align: left;
}
.pv-climate-scene:active { background: rgba(255,255,255,0.10); transform: scale(0.985); }
.pv-climate-scene.active {
  background: rgba(201,154,85,0.18);
  border-color: rgba(201,154,85,0.85);
  color: #fff;
}
.pv-climate-scene.disabled { opacity: 0.42; cursor: not-allowed; }
.pv-climate-scene .ico {
  flex-shrink: 0; width: 28px; display: flex; align-items: center; justify-content: center;
}
.pv-climate-scene .ico ha-icon {
  --mdc-icon-size: 22px; color: rgba(255,255,255,0.85); pointer-events: none;
}
.pv-climate-scene.active .ico ha-icon { color: #C99A55; }
.pv-climate-scene .txt {
  flex: 1; display: flex; flex-direction: column; gap: 1px; pointer-events: none;
  min-width: 0;
}
.pv-climate-scene .txt .nm {
  font-size: 15px; font-weight: 500; color: #fff; line-height: 1.15;
}
.pv-climate-scene .txt .sub {
  font-size: 11px; color: rgba(255,255,255,0.55); line-height: 1.15;
}
.pv-climate-scene .t {
  font-size: 18px; font-weight: 300; color: rgba(255,255,255,0.85);
  font-variant-numeric: tabular-nums; pointer-events: none;
  flex-shrink: 0;
}
.pv-climate-scene.active .t { color: #C99A55; }

/* ============ VENTILATION ============ */
/* APK VentScreen.kt: «Качество воздуха» (13sp grey) → большой статус словом
 * (28sp Light, цветной) → «CO₂ 850 ppm» (14sp 55% white). Никакого pill-status. */
.pv-vent-quality {
  position: absolute; top: 78px; left: 0; right: 0; height: 200px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  z-index: 2; gap: 4px;
}
.pv-vent-quality .label {
  font-size: 13px; color: rgba(255,255,255,0.65); letter-spacing: 0.3px;
}
.pv-vent-quality .status-big {
  font-size: 36px; font-weight: 300;
  text-shadow: 0 1px 6px rgba(0,0,0,0.4);
  margin-top: 4px;
}
.pv-vent-quality .status-big.good     { color: #6ce0a3; }
.pv-vent-quality .status-big.moderate { color: #ffd166; }
.pv-vent-quality .status-big.poor     { color: #ff7a7a; }
.pv-vent-quality .co2-line {
  font-size: 14px; color: rgba(255,255,255,0.55);
  font-variant-numeric: tabular-nums; margin-top: 4px;
}

/* Vent fan speed tiles — 2×2 grid, иконка + label (APK VentTile) */
.pv-vent-fan {
  position: absolute; left: 18px; right: 18px; bottom: 16px; z-index: 2;
}
.pv-vent-fan .label {
  font-size: 13px; color: rgba(255,255,255,0.65);
  letter-spacing: 0.3px; margin-bottom: 8px;
}
.pv-vent-fan .grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
}
.pv-vent-fan .pv-vent-tile {
  height: 74px;
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 14px;
  background: rgba(26,22,18,0.6);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 4px;
  color: rgba(255,255,255,0.9); font-family: inherit;
  cursor: pointer; transition: background 0.12s, border-color 0.12s, transform 0.08s;
}
.pv-vent-fan .pv-vent-tile:active {
  background: rgba(255,255,255,0.08); transform: scale(0.97);
}
.pv-vent-fan .pv-vent-tile.active {
  background: #2A2018;
  border-color: #C99A55; border-width: 1.5px;
  color: #fff;
}
.pv-vent-fan .pv-vent-tile .ico {
  display: flex; align-items: center; justify-content: center;
}
.pv-vent-fan .pv-vent-tile .ico ha-icon {
  --mdc-icon-size: 26px; color: rgba(255,255,255,0.75);
}
.pv-vent-fan .pv-vent-tile.active .ico ha-icon { color: #E2A66B; }
.pv-vent-fan .pv-vent-tile .lbl {
  font-size: 15px; font-weight: 400;
}
.pv-vent-fan .pv-vent-tile.active .lbl { font-weight: 500; }

/* ============ Background-URL field (Overview tab) ============ */
.bg-url-row {
  display: flex; align-items: center; gap: 8px;
}
.bg-url-row input {
  flex: 1;
}
.bg-url-thumb {
  width: 56px; height: 42px; border-radius: 4px;
  background: #1a1a1a center/cover no-repeat;
  border: 1px solid var(--divider-color);
  flex-shrink: 0;
}
.bg-url-reset {
  padding: 6px 10px; border-radius: 6px;
  border: 1px solid var(--divider-color);
  background: var(--card-background-color);
  color: var(--secondary-text-color);
  cursor: pointer; font-size: 12px;
  white-space: nowrap;
}
.bg-url-reset:hover { background: var(--secondary-background-color); }
.bg-url-hint {
  font-size: 11px; color: var(--secondary-text-color);
  margin-top: 4px; line-height: 1.4;
}

/* ---- Custom Cards editor (in Screens tab) ---- */
.cc-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.cc-row {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px;
  background: var(--card-background-color); border: 1px solid var(--divider-color);
  border-radius: 8px;
}
.cc-row.has-error { border-color: var(--bms-error, #d33); background: rgba(211,47,47,0.05); }
.cc-row .handle { cursor: grab; opacity: 0.45; }
.cc-row.dragging { opacity: 0.55; }
.cc-row.drag-over { border-color: var(--primary-color); }
.cc-row .cc-icon { --mdc-icon-size: 28px; color: var(--primary-color); }
.cc-row .cc-info { flex: 1; min-width: 0; }
.cc-row .cc-info .nm { font-weight: 500; font-size: 14px; }
.cc-row .cc-info .meta {
  font-size: 11px; color: var(--secondary-text-color); margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cc-row .cc-actions { display: flex; gap: 4px; }
.cc-empty {
  padding: 20px; text-align: center; opacity: 0.6; font-size: 13px;
  border: 1px dashed var(--divider-color); border-radius: 8px; margin-top: 12px;
}
.cc-add-btn {
  margin-top: 12px; display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 6px; cursor: pointer;
  background: var(--primary-color); color: var(--text-primary-color);
  border: none; font-weight: 500;
}
.cc-add-btn:hover { opacity: 0.92; }

/* Modal for editing one card */
.cc-modal-body { display: flex; flex-direction: column; gap: 14px; padding: 4px; }
.cc-modal-body label { font-size: 13px; opacity: 0.85; }
.cc-modal-body input, .cc-modal-body select, .cc-modal-body textarea {
  width: 100%; padding: 8px 10px; border-radius: 6px;
  border: 1px solid var(--divider-color); background: var(--card-background-color);
  color: var(--primary-text-color); font-size: 14px; box-sizing: border-box;
}
.cc-modal-body textarea { font-family: monospace; font-size: 12px; min-height: 64px; resize: vertical; }
.cc-action-tabs { display: flex; gap: 4px; margin-bottom: 8px; flex-wrap: wrap; }
.cc-action-tab {
  padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px;
  background: var(--card-background-color); border: 1px solid var(--divider-color);
}
.cc-action-tab.active {
  background: var(--primary-color); color: var(--text-primary-color);
  border-color: var(--primary-color);
}
.cc-lang-row { display: grid; grid-template-columns: 60px 1fr; gap: 8px; align-items: center; }
.cc-lang-row .l { font-size: 12px; opacity: 0.7; text-transform: uppercase; }

.pv-empty a { color: #C99A55; cursor: pointer; text-decoration: underline; }
.pv-pending { opacity: 0.65; pointer-events: none; }

@media (max-width: 1320px) {
  .preview-pane { width: 56px; padding: 16px 0; align-items: center; background: var(--card-background-color); }
  .preview-pane .preview-body,
  .preview-pane .preview-head-title,
  .preview-pane .preview-screen-picker { display: none; }
  .preview-pane.expanded {
    width: 540px; padding: 20px 14px; align-items: center; background: #0a0a0a;
  }
  .preview-pane.expanded .preview-body { display: flex; }
  .preview-pane.expanded .preview-head-title { display: block; }
  .preview-pane.expanded .preview-screen-picker { display: flex; }
}
@media (max-width: 900px) {
  .preview-pane { display: none; }
  .preview-pane.modal {
    display: flex; position: fixed; inset: 0; z-index: 2000;
    width: 100vw; height: 100vh; background: rgba(0,0,0,0.85);
    align-items: center; justify-content: center;
    padding: 16px;
  }
}
`;

// ---------- Утилиты ----------

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const translit = (s) => String(s || '').toLowerCase().replace(/[а-яёқғҳў]/g, ch => ({
  а:'a', б:'b', в:'v', г:'g', д:'d', е:'e', ё:'e',
  ж:'zh', з:'z', и:'i', й:'y', к:'k', л:'l', м:'m',
  н:'n', о:'o', п:'p', р:'r', с:'s', т:'t', у:'u',
  ф:'f', х:'h', ц:'ts', ч:'ch', ш:'sh', щ:'sch',
  ъ:'', ы:'y', ь:'', э:'e', ю:'yu', я:'ya',
  қ:'q', ғ:'g', ҳ:'h', ў:'o',
}[ch] ?? ch));
const slug = (name) =>
  translit(name)
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_').replace(/^_|_$/g, '')
    .substring(0, 32) || 'panel';

// ---------- Web Component ----------

class BMSPanelEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._activePanelId = null;
    this._activeTab = 'overview';
    this._workingCache = new Map();   // panel_id → working cfg
    this._issueCache = new Map();     // panel_id → issues[]
    this._dirty = false;
    this._bannerExpanded = false;
    this._toastTimer = null;
    this._storedPanels = [];
    this._loadingPanels = false;

    // ---- Live Preview state ----
    this._previewScreen = 'home';          // home/light/curtain/ac/heating/floor/convector/ventilation/menu
    this._previewExpanded = true;          // mid-width — collapsed by default until user opens
    this._previewModalOpen = false;        // narrow screens
    this._previewPending = new Map();      // entity_id → { state, expires_at } optimistic UI
    this._previewClockTimer = null;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) {
      this._renderShell();
      this._loadPanels();
      this._refresh();
      return;
    }
    // hass-update (state change у одного из entity) — НЕ перетряхиваем
    // весь UI. Sidebar и content (где правят конфиг) обновляются только при
    // явных user-actions; здесь только мягко перерисовываем превью, чтобы
    // лампочки/градусы дотягивались до новой реальности без race с кликом
    // юзера по табам preview.
    this._softRefreshPreview();
    // Top-bar — недорогой, дёргает validate() который полезно прогнать на новых
    // states (V22/V23 — entity исчезла/unavailable).
    this._renderTopBar();
  }
  set narrow(_) {}
  set route(_) {}
  set panel(_) {}

  _renderShell() {
    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <div class="toolbar">
        <div class="toolbar-title">BMS Panels</div>
        <span id="save-counts"></span>
        <span id="save-label" style="font-size: 13px; opacity: 0.85;">Сохранено</span>
        <button class="icon-btn" id="btn-help" title="Помощь">
          <ha-icon icon="mdi:help-circle-outline"></ha-icon>
        </button>
      </div>
      <div class="layout">
        <aside class="sidebar" id="sidebar"></aside>
        <main class="content" id="content"></main>
        <!-- preview-pane убрана по запросу владельца — редактор на всю ширину.
             Методы _renderPreviewPane/_softRefreshPreview остаются null-safe
             (early-return когда #preview-pane отсутствует). -->
      </div>
      <div id="modal-root"></div>
      <div id="toast-root"></div>
    `;
    this.shadowRoot.getElementById('btn-help').onclick = () => this._showHelp();
  }

  // ---------- Получение всех панелей из hass.states ----------

  _allPanels() {
    if (!this._hass) return this._storedPanels || [];
    const byId = new Map((this._storedPanels || []).map(p => [p.panel_id, p]));
    for (const [id, s] of Object.entries(this._hass.states)) {
      if (!id.startsWith('sensor.bms_panel_')) continue;
      const panelId = s.attributes.panel_id || id.replace(/^sensor\.bms_panel_/, '');
      byId.set(panelId, {
        entity_id: id,
        panel_id: panelId,
        panel_name: s.attributes.panel_name || s.attributes.friendly_name || id,
        config: this._extractConfig(s.attributes),
        last_updated: s.last_updated,
        state: s.state,
      });
    }
    return [...byId.values()]
      .sort((a, b) => (a.panel_name || '').localeCompare(b.panel_name || ''));
  }

  _statePanels() {
    if (!this._hass) return [];
    return Object.entries(this._hass.states)
      .filter(([id]) => id.startsWith('sensor.bms_panel_'))
      .map(([id, s]) => ({
        entity_id: id,
        panel_id: s.attributes.panel_id || id.replace(/^sensor\.bms_panel_/, ''),
        panel_name: s.attributes.panel_name || s.attributes.friendly_name || id,
        config: this._extractConfig(s.attributes),
        last_updated: s.last_updated,
        state: s.state,
      }))
      .sort((a, b) => (a.panel_name || '').localeCompare(b.panel_name || ''));
  }

  async _loadPanels() {
    if (!this._hass?.callWS || this._loadingPanels) return;
    this._loadingPanels = true;
    try {
      const panels = await this._hass.callWS({ type: 'bms_panel/list_panels' });
      this._storedPanels = (panels || []).map(p => ({
        ...p,
        config: this._extractConfig(p.config || {}),
      }));
      this._refresh();
    } catch (err) {
      // Старые версии integration без WS API всё ещё работают через hass.states.
      console.warn('BMS Panels: storage list unavailable', err);
    } finally {
      this._loadingPanels = false;
    }
  }

  _extractConfig(attrs) {
    return {
      screens:        attrs.screens || {},
      home_nav:       attrs.home_nav || ['light','curtain','menu','music','ac'],
      background_dim: attrs.background_dim ?? 30,
      background_image_url: attrs.background_image_url ?? null,
      screen_timeout: attrs.screen_timeout ?? 30,
      language:       attrs.language || 'Русский',
      entities:       attrs.entities || {},
      area_id:        attrs.area_id || null,
      custom_cards:   Array.isArray(attrs.custom_cards) ? attrs.custom_cards : [],
    };
  }

  _activePanel() {
    const all = this._allPanels();
    if (!all.length) return null;
    if (!this._activePanelId || !all.find(p => p.panel_id === this._activePanelId)) {
      this._activePanelId = all[0].panel_id;
    }
    return all.find(p => p.panel_id === this._activePanelId);
  }

  _selectCreatedPanel(name, fallbackId) {
    const created = this._allPanels()
      .filter(p => p.panel_name === name)
      .sort((a, b) => new Date(b.last_updated || 0) - new Date(a.last_updated || 0))[0];
    this._activePanelId = created?.panel_id || fallbackId;
  }

  _workingConfig(panel) {
    if (!this._workingCache.has(panel.panel_id)) {
      this._workingCache.set(panel.panel_id, JSON.parse(JSON.stringify(panel.config)));
    }
    return this._workingCache.get(panel.panel_id);
  }

  _validateActive() {
    const panel = this._activePanel();
    if (!panel) return [];
    const cfg = this._workingConfig(panel);
    const all = this._allPanels().map(p => ({
      panel_id: p.panel_id,
      panel_name: p.panel_name,
      config: this._workingCache.get(p.panel_id) || p.config,
    }));
    const issues = validate(cfg, panel.panel_id, all, this._hass.states);
    this._issueCache.set(panel.panel_id, issues);
    return issues;
  }

  _validateAll() {
    // нужно для счётчиков статусов в sidebar
    const all = this._allPanels();
    const result = new Map();
    const allPanelsCfg = all.map(p => ({
      panel_id: p.panel_id,
      panel_name: p.panel_name,
      config: this._workingCache.get(p.panel_id) || p.config,
    }));
    for (const p of all) {
      const cfg = this._workingCache.get(p.panel_id) || p.config;
      result.set(p.panel_id, validate(cfg, p.panel_id, allPanelsCfg, this._hass.states));
    }
    return result;
  }

  // ---------- Рендер ----------

  _refresh() {
    this._renderSidebar();
    this._renderContent();
    this._renderTopBar();
    this._renderPreviewPane();
  }

  _refreshPreviewOnly() {
    this._renderPreviewPane();
  }

  // Лёгкий апдейт превью под входящие state-changes из hass.
  // Не пересоздаёт скелет панели (head + screen-picker), только перерисовывает
  // содержимое выбранного экрана. Это исключает race-condition когда юзер
  // кликает по «Свет» а в следующий тик `set hass` сбрасывает HTML pane и
  // его click-handler ещё не успел отработать.
  _softRefreshPreview() {
    const pane = this.shadowRoot.getElementById('preview-pane');
    if (!pane || !this._previewExpanded) return;
    // Если ещё не было полного рендера (нет body div) — делаем полный рендер.
    const body = pane.querySelector('.preview-body');
    const picker = pane.querySelector('.preview-screen-picker');
    if (!body || !picker) {
      this._renderPreviewPane();
      return;
    }
    const panel = this._activePanel();
    if (!panel) return;
    const cfg = this._workingConfig(panel);
    const enabled = this._enabledScreens(cfg);
    // Если выбранный экран теперь выключен — отщёлкиваем на home.
    if (this._previewScreen !== 'home' && this._previewScreen !== 'menu' &&
        !enabled.includes(this._previewScreen)) {
      this._previewScreen = 'home';
    }
    // Re-render только body, без перетряхивания screen-picker и head.
    body.innerHTML = this._renderPreviewScreen(panel, cfg);
    // Обновляем active class на picker — без innerHTML, иначе click-handler потеряется.
    picker.querySelectorAll('[data-pv-screen]').forEach(el => {
      el.classList.toggle('active', el.dataset.pvScreen === this._previewScreen);
    });
    // Перепривязываем только body-локальные события (не picker — они уже привязаны).
    this._wirePreviewBodyEvents(panel, cfg);
    this._ensurePreviewClock();
  }

  _renderTopBar() {
    const issues = this._validateActive();
    const sum = summary(issues);
    const saveLabel = this.shadowRoot.getElementById('save-label');
    const saveCounts = this.shadowRoot.getElementById('save-counts');
    if (!saveLabel) return;

    if (!this._activePanel()) {
      saveLabel.textContent = '';
      saveCounts.textContent = '';
      return;
    }

    if (sum.error > 0) {
      saveLabel.textContent = 'Есть ошибки';
      saveLabel.style.color = 'rgba(255,255,255,0.85)';
    } else if (this._dirty) {
      saveLabel.textContent = '● несохранено';
      saveLabel.style.color = '#FFD166';
    } else {
      saveLabel.textContent = '✓ Сохранено';
      saveLabel.style.color = 'rgba(255,255,255,0.85)';
    }

    const chips = [];
    if (sum.error) {
      chips.push(`<span class="sev-chip" title="Ошибок ${sum.error} — сохранение заблокировано"><ha-icon icon="mdi:alert-circle" style="--mdc-icon-size: 14px;"></ha-icon> ${sum.error} ${this._plural(sum.error, 'ошибка','ошибки','ошибок')}</span>`);
    }
    if (sum.warning) {
      chips.push(`<span class="sev-chip" title="Предупреждений ${sum.warning}"><ha-icon icon="mdi:alert" style="--mdc-icon-size: 14px;"></ha-icon> ${sum.warning}</span>`);
    }
    saveCounts.innerHTML = chips.join(' ');
  }

  _renderSidebar() {
    const sidebar = this.shadowRoot.getElementById('sidebar');
    if (!sidebar) return;
    const panels = this._allPanels();
    const allIssues = this._validateAll();
    const totalIssues = [...allIssues.values()].reduce((acc, arr) => {
      const s = summary(arr);
      acc.error += s.error;
      acc.warning += s.warning;
      return acc;
    }, { error: 0, warning: 0 });

    sidebar.innerHTML = `
      <div class="sidebar-header">Панели (${panels.length})</div>
      ${panels.length > 1 ? `
        <div class="panel-list-item ${this._activeView === 'all' ? 'active' : ''}" data-view="all">
          <ha-icon icon="mdi:view-list-outline"></ha-icon>
          <div class="name">
            Все панели
            <div class="meta">${totalIssues.error ? `${totalIssues.error} ошибок · ` : ''}${totalIssues.warning ? `${totalIssues.warning} пред.` : ''}</div>
          </div>
        </div>
        <div style="border-bottom: 1px solid var(--divider-color); margin: 6px 0;"></div>
      ` : ''}
      ${panels.map(p => {
        const sum = summary(allIssues.get(p.panel_id) || []);
        const dotClass = sum.error ? 'error' : (sum.warning ? 'warn' : '');
        let statusHtml = '';
        if (sum.error) {
          statusHtml = `<span class="status-count">${sum.error}</span>`;
        } else if (sum.warning) {
          statusHtml = `<span class="status-count warn">${sum.warning}</span>`;
        }
        return `
          <div class="panel-list-item ${p.panel_id === this._activePanelId ? 'active' : ''}"
               data-id="${esc(p.panel_id)}">
            <span class="status-dot ${dotClass}"></span>
            <div class="name">
              ${esc(p.panel_name)}
              <div class="meta">${esc(p.panel_id)}</div>
            </div>
            ${statusHtml}
          </div>
        `;
      }).join('')}
      <div class="sidebar-add" id="btn-add-panel">
        <ha-icon icon="mdi:plus"></ha-icon>
        <span>Добавить панель</span>
      </div>
    `;
    sidebar.querySelectorAll('.panel-list-item').forEach(item => {
      item.onclick = () => {
        if (item.dataset.view === 'all') {
          this._activeView = 'all';
          this._activePanelId = null;
        } else {
          this._activeView = null;
          this._activePanelId = item.dataset.id;
        }
        this._refresh();
      };
    });
    sidebar.querySelector('#btn-add-panel').onclick = () => this._showAddPanel();
  }

  _renderContent() {
    const content = this.shadowRoot.getElementById('content');
    if (!content) return;

    // Bulk-view "Все панели"
    if (this._activeView === 'all') {
      this._renderAllPanelsView(content);
      return;
    }

    const panel = this._activePanel();

    if (!panel) {
      content.innerHTML = `
        <div class="empty-state">
          <ha-icon icon="mdi:tablet-dashboard"></ha-icon>
          <h2>Пока нет ни одной панели</h2>
          <p>Нажмите <b>«Добавить панель»</b> слева, чтобы начать.<br>
             Каждая панель = один настенный планшет в одной комнате.</p>
          <button class="btn primary btn-primary" id="btn-add-empty">
            <ha-icon icon="mdi:plus"></ha-icon> Добавить первую панель
          </button>
        </div>
      `;
      const btn = this.shadowRoot.getElementById('btn-add-empty');
      if (btn) btn.onclick = () => this._showAddPanel();
      return;
    }

    const issues = this._validateActive();
    const sum = summary(issues);
    const tabsHtml = TABS.map(t => `
      <div class="tab ${this._activeTab === t.key ? 'active' : ''}" data-tab="${t.key}">
        <ha-icon icon="${t.icon}"></ha-icon>
        <span>${t.label}</span>
        ${this._tabBadge(t.key, issues)}
      </div>
    `).join('');

    if (this._activeTab === 'home_nav') this._activeTab = 'screens';  // legacy fallback
    let tabContentHtml = '';
    if (this._activeTab === 'overview') tabContentHtml = this._renderOverview(panel, issues);
    if (this._activeTab === 'screens')  tabContentHtml = this._renderScreens(panel, issues);
    if (this._activeTab === 'devices')  tabContentHtml = this._renderDevices(panel, issues);

    content.innerHTML = `
      <div class="tabs">
        ${tabsHtml}
      </div>
      <div class="tab-content">${tabContentHtml}</div>
      <div class="bottom-bar">
        <div class="left">
          <button class="btn" id="btn-clone">
            <ha-icon icon="mdi:content-copy"></ha-icon> Дублировать
          </button>
          <button class="btn ghost" id="btn-more" title="Ещё действия">
            <ha-icon icon="mdi:dots-vertical"></ha-icon>
          </button>
        </div>
        <div class="right">
          ${this._dirty ? `
            <button class="btn" id="btn-discard">Отменить мои правки</button>
          ` : ''}
          <button class="btn primary" id="btn-save" ${sum.error > 0 ? 'disabled' : ''}>
            <ha-icon icon="mdi:content-save"></ha-icon> Сохранить
          </button>
        </div>
      </div>
    `;

    // ---- Tab navigation ----
    content.querySelectorAll('.tab[data-tab]').forEach(t => {
      t.onclick = () => {
        this._activeTab = t.dataset.tab;
        this._renderContent();
        this._renderTopBar();
        this._renderPreviewPane();
      };
    });

    // ---- Preview toggle (header button) ----
    const btnTogglePreview = content.querySelector('#btn-toggle-preview');
    if (btnTogglePreview) btnTogglePreview.onclick = () => this._togglePreview();

    // ---- Bottom bar actions ----
    content.querySelector('#btn-save').onclick = () => this._save();
    const btnDiscard = content.querySelector('#btn-discard');
    if (btnDiscard) btnDiscard.onclick = () => {
      this._workingCache.delete(panel.panel_id);
      this._dirty = false;
      this._refresh();
    };
    content.querySelector('#btn-clone').onclick = () => this._showClonePanel(panel);
    content.querySelector('#btn-more').onclick = (e) => this._showMoreMenu(e, panel);

    this._wireTabEvents(panel, issues);
  }

  _tabBadge(tabKey, issues) {
    // Один issue принадлежит одному табу. Single-owner mapping по anchor.type:
    //   field/card(screens)    → screens
    //   card(home_nav), home_nav_item → screens (объединили)
    //   bind_card/duplicate/screen_warning → devices
    //   field/card(other)      → overview
    const ownerOf = (issue) => {
      const a = issue.anchor || {};
      if (a.type === 'bind_card' || a.type === 'duplicate' || a.type === 'duplicate_self') return 'devices';
      if (a.type === 'screen_warning') return 'devices';
      if (a.type === 'home_nav_item') return 'screens';
      if (a.type === 'card' && a.key === 'screens') return 'screens';
      if (a.type === 'card' && a.key === 'home_nav') return 'screens';
      if (a.type === 'field' && ['background_dim','screen_timeout','language','panel_id'].includes(a.key)) return 'overview';
      return 'overview';
    };
    let sevError = 0, sevWarn = 0;
    for (const i of issues) {
      if (ownerOf(i) !== tabKey) continue;
      if (i.severity === SEV_ERROR) sevError++;
      else if (i.severity === SEV_WARN) sevWarn++;
    }
    if (sevError) return `<span class="badge">${sevError}</span>`;
    if (sevWarn)  return `<span class="badge warn">${sevWarn}</span>`;
    return '';
  }

  // Найти таб, к которому относится issue (тот же mapping что в _tabBadge).
  _tabOfIssue(issue) {
    const a = issue.anchor || {};
    if (a.type === 'bind_card' || a.type === 'duplicate' || a.type === 'duplicate_self') return 'devices';
    if (a.type === 'screen_warning') return 'devices';
    if (a.type === 'home_nav_item') return 'screens';
    if (a.type === 'card' && a.key === 'screens') return 'screens';
    if (a.type === 'card' && a.key === 'home_nav') return 'screens';
    return 'overview';
  }

  // ============ TAB: OVERVIEW ============

  _renderOverview(panel, issues) {
    const cfg = this._workingConfig(panel);
    const areas = this._hassAreas();
    const lastSeenStr = this._formatLastSeen(panel.last_updated);

    return `
      ${this._renderIssuesBanner(issues, panel)}

      <div class="card">
        <h3 class="card-title">
          <ha-icon icon="mdi:tablet-dashboard"></ha-icon>
          ${esc(panel.panel_name)}
        </h3>
        <div class="card-sub">
          Код панели:
          <code id="panel-id-text">${esc(panel.panel_id)}</code>
          <button class="btn ghost" data-action="copy-id" title="Скопировать код" style="padding: 2px 8px;">
            <ha-icon icon="mdi:content-copy" style="--mdc-icon-size: 14px;"></ha-icon>
          </button>
          <br>На планшете в Settings → Panel ID введите этот же код.
        </div>
        <div class="field-row">
          <label>Последний контакт</label>
          <div class="control" style="color: var(--secondary-text-color);">${lastSeenStr}</div>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">Комната (HA Area)</h3>
        <div class="card-sub">
          Если вы выберете комнату — на вкладке «Устройства» появится кнопка «Заполнить из этой комнаты»,
          которая автоматически привяжет все лампы, шторы, термостаты из выбранной HA Area.
        </div>
        <div class="field-row">
          <label>Area для этой панели</label>
          <select id="area-pick" class="control">
            <option value="">— не выбрано —</option>
            ${areas.map(a => `<option value="${esc(a.area_id)}" ${cfg.area_id === a.area_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">Дисплей</h3>
        <div class="card-sub">Базовые настройки внешнего вида планшета.</div>

        <div class="field-row">
          <label>Затемнение фона</label>
          <input type="range" id="bg-dim" min="0" max="100" value="${cfg.background_dim}" class="control">
          <div class="val"><span id="bg-dim-val">${cfg.background_dim}</span>%</div>
        </div>
        ${this._inlineIssue(issues, i => i.anchor.key === 'background_dim')}

        <div class="field-row" style="align-items: flex-start;">
          <label>Фон панели</label>
          <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
            <div class="bg-url-row">
              <div class="bg-url-thumb" id="bg-url-thumb"
                   style="background-image: url('${esc(cfg.background_image_url || '/bms_panel_static/background.png')}');"></div>
              <input type="text" id="bg-url" class="control"
                     placeholder="https://… или /local/myroom.jpg (пусто = встроенный)"
                     value="${esc(cfg.background_image_url || '')}">
              <button class="bg-url-reset" id="bg-url-reset" title="Использовать встроенный фон">Сброс</button>
            </div>
            <div class="bg-url-hint">
              Пусто — встроенный luxury-фон. Для своего: URL картинки (https://…) или файл из папки HA <code>config/www/</code> (путь <code>/local/имя.jpg</code>). Панель скачает и закэширует (offline-ready).
            </div>
          </div>
        </div>
        ${this._inlineIssue(issues, i => i.anchor.key === 'background_image_url')}

        <div class="field-row">
          <label>Гасить экран через</label>
          <select id="timeout" class="control">
            ${[15,30,60,120,300,600].map(s => `
              <option value="${s}" ${cfg.screen_timeout===s?'selected':''}>
                ${s < 60 ? s + ' сек' : (s/60) + ' мин'}
              </option>`).join('')}
          </select>
        </div>
        ${this._inlineIssue(issues, i => i.anchor.key === 'screen_timeout')}

        <div class="field-row">
          <label>Язык интерфейса</label>
          <select id="lang" class="control">
            ${['Русский','English'].map(l => `<option value="${l}" ${cfg.language===l?'selected':''}>${l}</option>`).join('')}
          </select>
        </div>
        ${this._inlineIssue(issues, i => i.anchor.key === 'language')}
      </div>
    `;
  }

  // ============ TAB: SCREENS (+ home nav) ============

  _renderScreens(panel, issues) {
    const cfg = this._workingConfig(panel);
    const sortedScreens = Object.keys(SCREEN_META)
      .map(id => ({
        id,
        ...SCREEN_META[id],
        enabled: cfg.screens[id]?.enabled ?? false,
        order:   cfg.screens[id]?.order ?? 99,
      }))
      // Stable sort: при равном order — по id (иначе JS sort нестабилен)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

    return `
      <div class="card">
        <h3 class="card-title">Экраны меню</h3>
        <div class="card-sub">
          Включите только те разделы, которые есть в этой комнате. На <b>Устройства</b> вы потом
          выберете лампы, шторы и термостаты для каждого включённого раздела.<br>
          Порядок можно менять кнопками ↑↓ или перетаскиванием.
        </div>
        <div class="screen-list" id="screens">
          ${sortedScreens.map((s, idx) => `
            <div class="screen-row ${s.enabled ? '' : 'disabled'}" draggable="true" data-id="${s.id}" data-idx="${idx}">
              <button class="btn ghost mv-up" data-id="${s.id}" data-dir="up" title="Выше" ${idx === 0 ? 'disabled' : ''}>
                <ha-icon icon="mdi:chevron-up"></ha-icon>
              </button>
              <button class="btn ghost mv-down" data-id="${s.id}" data-dir="down" title="Ниже" ${idx === sortedScreens.length - 1 ? 'disabled' : ''}>
                <ha-icon icon="mdi:chevron-down"></ha-icon>
              </button>
              <ha-icon class="handle" icon="mdi:drag-horizontal-variant" title="Перетащите"></ha-icon>
              <ha-icon icon="${s.icon}"></ha-icon>
              <div class="text-block">
                <div class="name">${s.ru}</div>
                <div class="hint">${s.hint}</div>
              </div>
              <ha-switch ${s.enabled ? 'checked' : ''} data-id="${s.id}"></ha-switch>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">Нижние иконки главного экрана</h3>
        <div class="card-sub">
          Эти 5 иконок показываются на главном экране всегда. <b>menu</b> открывает список остальных экранов — рекомендуется оставить.
          Слоты которые не нужны заполните «menu».
        </div>
        <div class="home-nav-grid">
          ${cfg.home_nav.map((id, i) => {
            const itemIssue = issues.find(it => it.anchor.type === 'home_nav_item' && it.anchor.index === i);
            return `
              <div class="home-nav-slot ${itemIssue ? 'has-error' : ''}">
                <div class="num">№ ${i+1}</div>
                <select class="home-nav-select" data-idx="${i}">
                  ${HOME_NAV_OPTIONS.map(o => `<option value="${o}" ${o===id?'selected':''}>${o === 'menu' ? '☰ Меню' : (SCREEN_META[o]?.ru || o)}</option>`).join('')}
                </select>
              </div>
            `;
          }).join('')}
        </div>
        ${issues.filter(i => i.anchor.type === 'home_nav_item' || (i.anchor.type === 'card' && i.anchor.key === 'home_nav'))
          .map(i => `
            <div class="inline-issue ${i.severity}" style="margin-top:12px;">
              <ha-icon icon="${i.severity === 'error' ? 'mdi:alert-circle' : 'mdi:alert'}"></ha-icon>
              <div>${esc(i.message)} ${i.fix_hint ? `<span style="opacity:0.8;">${esc(i.fix_hint)}</span>` : ''}</div>
            </div>
          `).join('')}
      </div>

      ${this._renderCustomCardsCard(panel, issues)}
    `;
  }

  // ---- Custom Cards UI ----
  _renderCustomCardsCard(panel, issues) {
    const cfg = this._workingConfig(panel);
    const cards = Array.isArray(cfg.custom_cards) ? cfg.custom_cards : [];
    const cardIssues = issues.filter(i => i.anchor.type === 'custom_card' || (i.anchor.type === 'card' && i.anchor.key === 'custom_cards'));

    const rows = cards.map((c, i) => {
      const label = c.label?.ru || c.id;
      const icon = c.icon || 'mdi:card-text-outline';
      const action = c.action || {};
      let meta = '—';
      if (action.type === 'service')   meta = `Сервис: ${action.service || '—'}`;
      else if (action.type === 'entity')   meta = `Открыть: ${action.entity_id || '—'}`;
      else if (action.type === 'toggle')   meta = `Toggle: ${action.entity_id || '—'}`;
      else if (action.type === 'dashboard') meta = `URL: ${action.url || '—'}`;
      const rowHasErr = cardIssues.some(it => it.severity === 'error' && it.anchor.card_id === c.id);
      return `
        <div class="cc-row ${rowHasErr ? 'has-error' : ''}" draggable="true" data-cc-id="${esc(c.id)}" data-cc-idx="${i}">
          <ha-icon class="handle" icon="mdi:drag-horizontal-variant" title="Перетащите"></ha-icon>
          <ha-icon class="cc-icon" icon="${esc(icon)}"></ha-icon>
          <div class="cc-info">
            <div class="nm">${esc(label)}</div>
            <div class="meta">${esc(meta)}</div>
          </div>
          <div class="cc-actions">
            <button class="btn ghost" data-cc-action="edit" data-cc-id="${esc(c.id)}" title="Редактировать">
              <ha-icon icon="mdi:pencil"></ha-icon>
            </button>
            <button class="btn ghost" data-cc-action="delete" data-cc-id="${esc(c.id)}" title="Удалить">
              <ha-icon icon="mdi:delete-outline"></ha-icon>
            </button>
          </div>
        </div>`;
    }).join('');

    const emptyHtml = !cards.length
      ? `<div class="cc-empty">
           Кастомных карточек пока нет.<br>
           Добавьте свою — она появится в Меню рядом со стандартными плитками
           (Свет / Шторы / Кондиционер / …).
         </div>`
      : '';

    const issueHtml = cardIssues.length
      ? cardIssues.map(i => `
        <div class="inline-issue ${i.severity}" style="margin-top:8px;">
          <ha-icon icon="${i.severity === 'error' ? 'mdi:alert-circle' : 'mdi:alert'}"></ha-icon>
          <div>${esc(i.message)} ${i.fix_hint ? `<span style="opacity:0.8;">${esc(i.fix_hint)}</span>` : ''}</div>
        </div>
      `).join('')
      : '';

    return `
      <div class="card">
        <h3 class="card-title">Кастомные карточки в Меню</h3>
        <div class="card-sub">
          Свои плитки в Меню (3×3 grid) — каждая со своим названием, иконкой и действием:
          вызов сервиса (script.morning_routine), быстрый toggle устройства, открытие entity
          или переход на дашборд. На устройстве они появятся <b>после</b> стандартных плиток.
        </div>
        <div class="cc-list" id="cc-list">${rows}</div>
        ${emptyHtml}
        ${issueHtml}
        <button class="cc-add-btn" id="btn-add-card">
          <ha-icon icon="mdi:plus"></ha-icon> Добавить карточку
        </button>
      </div>
    `;
  }

  // ============ TAB: DEVICES ============

  _renderDevices(panel, issues) {
    const cfg = this._workingConfig(panel);
    const enabledScreens = cfg.screens || {};
    const areaName = cfg.area_id ? this._areaName(cfg.area_id) : null;

    return `
      ${this._renderIssuesBanner(issues, panel, { onlyDevices: true })}

      ${cfg.area_id ? `
        <div class="card" style="background: linear-gradient(135deg, rgba(33,150,243,0.08), transparent); border-color: var(--bms-info);">
          <div style="display:flex; align-items:center; gap:12px;">
            <ha-icon icon="mdi:home-outline" style="--mdc-icon-size:32px; color: var(--bms-info);"></ha-icon>
            <div style="flex:1;">
              <div style="font-weight:500;">Комната: ${esc(areaName || cfg.area_id)}</div>
              <div style="font-size:12px; color:var(--secondary-text-color);">Можно одной кнопкой привязать все устройства из этой комнаты.</div>
            </div>
            <button class="btn primary" data-action="area-fill">
              <ha-icon icon="mdi:auto-fix"></ha-icon> Заполнить из комнаты
            </button>
          </div>
        </div>
      ` : ''}

      ${BIND_GROUPS.map(group => {
        // Экран выключен — компактная ссылка, не полноценная карточка.
        if (group.screen && !enabledScreens[group.screen]?.enabled) {
          return `
            <div class="bind-group-collapsed" data-screen="${group.screen}">
              <ha-icon icon="${group.icon}" style="--mdc-icon-size: 18px; opacity: 0.45;"></ha-icon>
              <span style="opacity: 0.65;">${group.title}</span>
              <span style="font-size: 12px; opacity: 0.5; flex: 1;">экран выключен</span>
              <button class="btn ghost" data-action="enable-screen" data-screen="${group.screen}" style="font-size: 12px; padding: 4px 8px;">
                включить
              </button>
            </div>`;
        }
        // Метка severity группы (если внутри есть issue)
        const groupIssues = issues.filter(i =>
          i.anchor.type === 'bind_card' && group.binds.some(b => b.key === i.anchor.key)
        );
        const groupClass = groupIssues.some(i => i.severity === SEV_ERROR) ? 'has-error'
          : groupIssues.some(i => i.severity === SEV_WARN) ? 'has-warn' : '';

        // Climate-пресеты (Турбо/Комфорт/Эко) скрыты — APK больше не показывает
        // сцены на климат-экранах (только прямой ручной режим). Редактор не нужен.
        // Методы _renderClimatePresets/_effectiveClimatePresets оставлены как
        // dead-code на случай возврата фичи.
        const climatePresetsHtml = '';

        return `
          <div class="bind-group ${groupClass}">
            <div class="bind-group-head">
              <ha-icon icon="${group.icon}"></ha-icon>
              <div class="bind-group-title">${group.title}</div>
            </div>
            ${group.binds.map(b => this._renderBind(b, cfg.entities, issues)).join('')}
            ${climatePresetsHtml}
          </div>
        `;
      }).join('')}
    `;
  }

  _renderBind(bindDef, entities, issues) {
    const meta = BIND_KEYS[bindDef.key];
    const bindIssues = issues.filter(i => i.anchor.type === 'bind_card' && i.anchor.key === bindDef.key);
    if (meta.multi) return this._renderBindMulti(bindDef, entities, bindIssues);
    return this._renderBindOne(bindDef, entities, bindIssues);
  }

  _renderBindOne(bindDef, entities, bindIssues) {
    const meta = BIND_KEYS[bindDef.key];
    const current = entities[bindDef.key] || '';
    const opts = Object.entries(this._hass.states)
      .filter(([eid]) => eid.startsWith(meta.domain + '.'))
      .map(([eid, s]) => ({ id: eid, name: s.attributes.friendly_name || eid, state: s.state }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const sev = bindIssues.length ? bindIssues[0].severity : null;
    const cardClass = sev === SEV_ERROR ? 'error' : sev === SEV_WARN ? 'warn' : '';

    return `
      <div class="bind-card ${cardClass}">
        <div class="bind-card-head">
          <div class="bind-card-title">${esc(bindDef.label)}</div>
        </div>
        <div class="entity-select-wrap">
          <select class="entity-select" data-key="${bindDef.key}">
            <option value="">— не привязано —</option>
            ${opts.map(o => `
              <option value="${esc(o.id)}" ${current===o.id?'selected':''}>
                ${esc(o.name)} ${o.state === 'unavailable' ? '(офлайн)' : ''}
              </option>`).join('')}
          </select>
          ${current ? `
            <button class="btn ghost" data-action="test-entity" data-entity="${esc(current)}" title="Проверить устройство">
              <ha-icon icon="mdi:flash"></ha-icon>
            </button>
            <button class="btn ghost" data-action="clear-one" data-key="${bindDef.key}" title="Очистить">×</button>
          ` : ''}
        </div>
        ${bindIssues.map(i => `
          <div class="inline-issue ${i.severity}">
            <ha-icon icon="${i.severity === 'error' ? 'mdi:alert-circle' : 'mdi:alert'}"></ha-icon>
            <div>${esc(i.message)} <span style="opacity:0.8;">${esc(i.fix_hint)}</span></div>
          </div>
        `).join('')}
      </div>
    `;
  }

  _renderBindMulti(bindDef, entities, bindIssues) {
    const meta = BIND_KEYS[bindDef.key];
    const selected = Array.isArray(entities[bindDef.key]) ? entities[bindDef.key] : [];
    // Карта занятости entity_id другими панелями
    const occupied = this._entityOccupiedMap();
    const all = Object.entries(this._hass.states)
      .filter(([eid]) => eid.startsWith(meta.domain + '.'))
      .map(([eid, s]) => ({
        id: eid,
        name: s.attributes.friendly_name || eid,
        state: s.state,
        occupiedBy: occupied.get(eid),  // имя другой панели или undefined
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const sev = bindIssues.length ? bindIssues[0].severity : null;
    const cardClass = sev === SEV_ERROR ? 'error' : sev === SEV_WARN ? 'warn' : (selected.length === 0 ? 'warn' : '');

    let metaText, metaClass;
    if (selected.length === 0) {
      metaText = `⚠ Не выбрано — если экран включён, на панели будет пусто`;
      metaClass = 'warn';
    } else {
      metaText = `Выбрано: ${selected.length} из ${all.length}`;
      metaClass = '';
    }

    return `
      <div class="bind-card ${cardClass}">
        <div class="bind-card-head">
          <div class="bind-card-title">${esc(bindDef.label)}</div>
          <div class="bind-card-meta ${metaClass}">${metaText}</div>
        </div>
        ${all.length === 0
          ? `<div class="bind-empty">В Home Assistant нет ни одного <code>${meta.domain}.*</code>. Установите интеграцию-источник.</div>`
          : `<div class="bind-list">
              <div class="bind-item-search">
                <input type="text" placeholder="Поиск..." data-search="${bindDef.key}">
              </div>
              ${all.map(o => `
                <label class="bind-item ${o.state === 'unavailable' ? 'unavailable' : ''}" data-name="${esc(o.name).toLowerCase()} ${esc(o.id).toLowerCase()}" title="${o.occupiedBy ? 'Уже привязано к панели ' + esc(o.occupiedBy) : ''}">
                  <input type="checkbox" class="entity-multi-cb" data-key="${bindDef.key}" value="${esc(o.id)}" ${selected.includes(o.id) ? 'checked' : ''}>
                  <span class="nm">${esc(o.name)}</span>
                  ${o.occupiedBy && !selected.includes(o.id) ? `<span style="font-size:11px; color:var(--bms-warn); margin-left:4px;">занято</span>` : ''}
                  <span class="eid">${esc(o.id)}</span>
                  <button class="btn ghost" data-action="test-entity" data-entity="${esc(o.id)}" title="Проверить" style="padding:2px 6px;">
                    <ha-icon icon="mdi:flash" style="--mdc-icon-size:16px;"></ha-icon>
                  </button>
                </label>
              `).join('')}
            </div>`
        }
        ${bindIssues.map(i => `
          <div class="inline-issue ${i.severity}">
            <ha-icon icon="${i.severity === 'error' ? 'mdi:alert-circle' : 'mdi:alert'}"></ha-icon>
            <div>${esc(i.message)} <span style="opacity:0.8;">${esc(i.fix_hint)}</span></div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // ============ Climate Presets (Турбо/Комфорт/Эко editing) ============

  /** Эффективные пресеты: overrides поверх defaults. */
  _effectiveClimatePresets(screen, cfg) {
    const defaults = CLIMATE_PRESET_DEFAULTS[screen] || {};
    const overrides = (cfg.climate_presets && cfg.climate_presets[screen]) || {};
    const out = {};
    for (const sc of CLIMATE_PRESET_SCENES) {
      const d = defaults[sc.key] || {};
      const o = overrides[sc.key] || {};
      out[sc.key] = { ...d, ...o };
    }
    return out;
  }

  /** Возможные hvac/fan modes для UI dropdown.
   *  Если есть привязанный climate entity и у него заполнены `hvac_modes` /
   *  `fan_modes` в attributes — берём из устройства (точнее). Иначе fallback.
   */
  _climateEntityCaps(screen, cfg) {
    const bk = CLIMATE_BIND_KEY[screen];
    const ids = Array.isArray(cfg.entities?.[bk]) ? cfg.entities[bk] : [];
    let hvac = ['heat', 'cool', 'auto', 'dry', 'fan_only', 'off', 'heat_cool'];
    let fan  = ['low', 'mid', 'medium', 'high', 'auto', 'off', 'diffuse'];
    if (ids.length && this._hass?.states?.[ids[0]]) {
      const a = this._hass.states[ids[0]].attributes || {};
      if (Array.isArray(a.hvac_modes) && a.hvac_modes.length) hvac = a.hvac_modes.slice();
      if (Array.isArray(a.fan_modes)  && a.fan_modes.length)  fan  = a.fan_modes.slice();
    }
    return { hvac, fan };
  }

  _renderClimatePresets(screen, cfg) {
    const screenMeta = CLIMATE_PRESET_SCREEN_META[screen];
    if (!screenMeta) return '';
    // Раскрыта ли секция (по-screen state). Default = expanded — интегратору
    // важно сразу видеть, что эти настройки тут есть. Свернуть он может сам.
    this._climatePresetsExpanded = this._climatePresetsExpanded || {};
    if (this._climatePresetsExpanded[screen] === undefined) {
      this._climatePresetsExpanded[screen] = true;
    }
    const expanded = this._climatePresetsExpanded[screen] !== false;

    const eff = this._effectiveClimatePresets(screen, cfg);
    const caps = this._climateEntityCaps(screen, cfg);
    const showFan = screenMeta.hasFan;
    const overrides = (cfg.climate_presets && cfg.climate_presets[screen]) || {};
    const hasAny = CLIMATE_PRESET_SCENES.some(sc => overrides[sc.key] && Object.keys(overrides[sc.key]).length);

    // Более длинные подписи к сценам для крупных карточек.
    const SCENE_SUBTITLES = {
      turbo:   'Быстрое достижение цели — мощность на максимум',
      comfort: 'Повседневный режим — баланс комфорта и тишины',
      eco:     'Экономия энергии — минимальная нагрузка',
    };

    const cards = CLIMATE_PRESET_SCENES.map(sc => {
      const v = eff[sc.key];
      const ov = overrides[sc.key] || {};
      const tempOverridden = ov.target !== undefined;
      const hvacOverridden = ov.hvac_mode !== undefined;
      const fanOverridden  = ov.fan_mode !== undefined;
      const cardModified = tempOverridden || hvacOverridden || fanOverridden;

      // HVAC select options
      const hvacOpts = caps.hvac.map(m => `
        <option value="${esc(m)}" ${v.hvac_mode === m ? 'selected' : ''}>
          ${esc(CLIMATE_HVAC_MODE_LABELS[m] || m)}
        </option>
      `).join('');
      const hvacExtra = !caps.hvac.includes(v.hvac_mode) && v.hvac_mode
        ? `<option value="${esc(v.hvac_mode)}" selected>${esc(CLIMATE_HVAC_MODE_LABELS[v.hvac_mode] || v.hvac_mode)} (не в устр.)</option>`
        : '';

      const fanFieldHtml = !showFan ? '' : (() => {
        const fanOpts = caps.fan.map(m => `
          <option value="${esc(m)}" ${v.fan_mode === m ? 'selected' : ''}>
            ${esc(CLIMATE_FAN_MODE_LABELS[m] || m)}
          </option>
        `).join('');
        const fanExtra = v.fan_mode && !caps.fan.includes(v.fan_mode)
          ? `<option value="${esc(v.fan_mode)}" selected>${esc(CLIMATE_FAN_MODE_LABELS[v.fan_mode] || v.fan_mode)} (не в устр.)</option>`
          : '';
        return `
          <div class="cp-field">
            <label class="cp-field-label">Вентилятор</label>
            <select class="climate-preset-select ${fanOverridden ? 'overridden' : ''}"
                    data-cp-screen="${screen}" data-cp-scene="${sc.key}" data-cp-field="fan_mode">
              <option value="">— не задавать —</option>
              ${fanExtra}
              ${fanOpts}
            </select>
          </div>
        `;
      })();

      const targetVal = (v.target ?? 22).toFixed(1).replace(/\.0$/, '');
      const decMin = v.target <= CLIMATE_TARGET_MIN;
      const incMax = v.target >= CLIMATE_TARGET_MAX;
      const subtitle = SCENE_SUBTITLES[sc.key] || sc.sub;

      return `
        <div class="cp-card ${cardModified ? 'is-modified' : ''}">
          <div class="cp-card-head">
            <ha-icon icon="${esc(sc.icon)}"></ha-icon>
            <div class="cp-card-titles">
              <div class="cp-card-name">${esc(sc.label)}</div>
              <div class="cp-card-sub">${esc(subtitle)}</div>
            </div>
            ${cardModified ? '<span class="cp-modified-pill">изменено</span>' : ''}
          </div>
          <div class="cp-temp-row">
            <label class="cp-temp-label">Целевая температура</label>
            <div class="cp-temp-stepper">
              <button data-cp-screen="${screen}" data-cp-scene="${sc.key}" data-cp-action="temp-dec" ${decMin ? 'disabled' : ''} title="−${CLIMATE_TARGET_STEP}°" aria-label="Уменьшить">−</button>
              <span class="cp-temp-value ${tempOverridden ? 'overridden' : ''}">${targetVal}°</span>
              <button data-cp-screen="${screen}" data-cp-scene="${sc.key}" data-cp-action="temp-inc" ${incMax ? 'disabled' : ''} title="+${CLIMATE_TARGET_STEP}°" aria-label="Увеличить">+</button>
            </div>
          </div>
          <div class="cp-field">
            <label class="cp-field-label">Режим работы (HVAC)</label>
            <select class="climate-preset-select ${hvacOverridden ? 'overridden' : ''}"
                    data-cp-screen="${screen}" data-cp-scene="${sc.key}" data-cp-field="hvac_mode">
              ${hvacExtra}
              ${hvacOpts}
            </select>
          </div>
          ${fanFieldHtml}
        </div>
      `;
    }).join('');

    const stateBadge = hasAny
      ? '<span class="cp-state-badge modified">изменено</span>'
      : '<span class="cp-state-badge">по умолчанию</span>';

    return `
      <div class="climate-presets ${expanded ? 'expanded' : ''}" data-cp-section="${screen}">
        <div class="climate-presets-head" data-cp-toggle="${screen}">
          <ha-icon class="cp-head-icon" icon="mdi:thermometer-lines"></ha-icon>
          <div class="cp-head-text">
            <div class="cp-title">Пресеты сценариев — Турбо / Комфорт / Эко</div>
            <div class="cp-subtitle">Кастомизация температуры и режимов для каждой сцены</div>
          </div>
          ${stateBadge}
          <ha-icon class="chev" icon="mdi:chevron-down"></ha-icon>
        </div>
        <div class="climate-presets-body">
          <div class="climate-preset-cards">
            ${cards}
          </div>
          <div class="climate-presets-footer">
            <span class="cp-hint">Поля и карточки <span style="color:var(--bms-info); font-weight:500;">синие</span> — переопределены интегратором.</span>
            <button class="reset-btn" data-cp-reset="${screen}" ${hasAny ? '' : 'disabled'}>
              <ha-icon icon="mdi:restore"></ha-icon> Сбросить на дефолт
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // (Home Nav теперь часть _renderScreens — вторая карточка)

  // ============ Issues banner ============

  _renderIssuesBanner(issues, panel, opts = {}) {
    const onlyDevices = opts.onlyDevices;
    const filtered = onlyDevices
      ? issues.filter(i => ['bind_card','screen_warning','duplicate','duplicate_self'].includes(i.anchor.type))
      : issues;
    const sum = summary(filtered);

    if (sum.total === 0) {
      return `
        <div class="issues-banner empty">
          <div class="issues-banner-head">
            <ha-icon icon="mdi:check-circle" style="color: var(--bms-success);"></ha-icon>
            <span>Всё проверено — на панели не будет ошибок.</span>
          </div>
        </div>
      `;
    }

    const cls = sum.error ? 'has-error' : (sum.warning ? 'has-warn' : '');
    const expanded = this._bannerExpanded;
    const headIcon = sum.error
      ? '<ha-icon icon="mdi:alert-circle" style="color: var(--bms-error);"></ha-icon>'
      : '<ha-icon icon="mdi:alert" style="color: var(--bms-warn);"></ha-icon>';
    const headText = sum.error
      ? `${sum.error} ${this._plural(sum.error, 'ошибка','ошибки','ошибок')} — сохранение заблокировано`
      : `${sum.warning} ${this._plural(sum.warning, 'предупреждение','предупреждения','предупреждений')}`;

    return `
      <div class="issues-banner ${cls} ${expanded ? 'expanded' : ''}" data-banner>
        <div class="issues-banner-head" data-toggle-banner>
          ${headIcon}
          <span>${headText}${sum.warning && sum.error ? ` · ${sum.warning} предупр.` : ''}</span>
          <ha-icon class="chev" icon="mdi:chevron-down"></ha-icon>
        </div>
        <div class="issues-list">
          ${filtered.map((i, idx) => `
            <div class="issue-row ${i.severity}" data-issue-id="${i.id}" data-issue-idx="${idx}">
              <ha-icon class="sev-icon" icon="${i.severity === 'error' ? 'mdi:alert-circle' : i.severity === 'warning' ? 'mdi:alert' : 'mdi:information'}"></ha-icon>
              <div class="body">
                ${esc(i.message)}
                ${i.fix_hint ? `<div class="hint">${esc(i.fix_hint)}</div>` : ''}
              </div>
              <ha-icon icon="mdi:chevron-right" style="color: var(--secondary-text-color); flex-shrink: 0;"></ha-icon>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  _plural(n, one, few, many) {
    n = Math.abs(n) % 100;
    if (n >= 11 && n <= 14) return many;
    n = n % 10;
    if (n === 1) return one;
    if (n >= 2 && n <= 4) return few;
    return many;
  }

  _inlineIssue(issues, filterFn) {
    const matches = issues.filter(filterFn);
    if (!matches.length) return '';
    return matches.map(i => `
      <div class="inline-issue ${i.severity}">
        <ha-icon icon="${i.severity === 'error' ? 'mdi:alert-circle' : 'mdi:alert'}"></ha-icon>
        <div>${esc(i.message)} ${i.fix_hint ? `<span style="opacity:0.8;">${esc(i.fix_hint)}</span>` : ''}</div>
      </div>
    `).join('');
  }

  // ============ Event wiring ============

  _wireTabEvents(panel, issues) {
    const cfg = this._workingConfig(panel);
    const $ = (sel) => this.shadowRoot.querySelector(sel);
    const $$ = (sel) => this.shadowRoot.querySelectorAll(sel);

    // ---- Banner toggle ----
    const bannerHead = $('[data-toggle-banner]');
    if (bannerHead) {
      bannerHead.onclick = () => {
        this._bannerExpanded = !this._bannerExpanded;
        const banner = $('[data-banner]');
        if (banner) banner.classList.toggle('expanded');
      };
    }

    // ---- Issue-row click → переключение таба + scroll к anchor ----
    $$('.issue-row').forEach(row => {
      row.onclick = (e) => {
        e.stopPropagation();
        const idx = parseInt(row.dataset.issueIdx, 10);
        // Найти issue по DOM-индексу (filtered баннер передаёт их по порядку)
        const allRows = [...$$('.issue-row')];
        const issueId = row.dataset.issueId;
        const issue = issues.find(i => i.id === issueId);
        if (!issue) return;
        const targetTab = this._tabOfIssue(issue);
        if (targetTab !== this._activeTab) {
          this._activeTab = targetTab;
          this._renderContent();
          this._renderTopBar();
          // Дать DOM время отрисоваться, потом скролл
          setTimeout(() => this._scrollToAnchor(issue), 50);
        } else {
          this._scrollToAnchor(issue);
        }
      };
    });

    // ---- Move up/down кнопки для экранов (touch-friendly fallback к drag) ----
    $$('.mv-up, .mv-down').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const dir = btn.dataset.dir;
        const rows = [...$$('.screen-row')];
        const idx = rows.findIndex(r => r.dataset.id === id);
        const newIdx = dir === 'up' ? idx - 1 : idx + 1;
        if (newIdx < 0 || newIdx >= rows.length) return;
        // Перемешать DOM и пересчитать order
        const parent = rows[idx].parentNode;
        if (dir === 'up') parent.insertBefore(rows[idx], rows[newIdx]);
        else parent.insertBefore(rows[newIdx], rows[idx]);
        [...$$('.screen-row')].forEach((r, i) => {
          if (!cfg.screens[r.dataset.id]) cfg.screens[r.dataset.id] = { enabled: false, order: 99 };
          cfg.screens[r.dataset.id].order = i + 1;
        });
        this._markDirty();
        this._renderContent();
      };
    });

    // ---- Тест устройства (мигнуть лампой / штора / fan) ----
    // Важно: кнопка тест-entity находится внутри <label class="bind-item">,
    // и клик по ней по умолчанию триггерит <input type=checkbox> родителя.
    // stopPropagation+preventDefault — иначе тест случайно (от)привяжет.
    $$('[data-action="test-entity"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const eid = btn.dataset.entity;
        this._testEntity(eid);
      });
      // Также блокируем mousedown — некоторые браузеры триггерят checkbox на нём
      btn.addEventListener('mousedown', (e) => e.stopPropagation());
    });

    // ---- Copy panel_id ----
    const copyBtn = $('[data-action="copy-id"]');
    if (copyBtn) copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(panel.panel_id);
        this._toast(`Код «${panel.panel_id}» скопирован`, 'success', { duration: 2000 });
      } catch (e) {
        this._toast('Не получилось скопировать. Выделите и скопируйте вручную.', 'warn');
      }
    };

    // ---- Area auto-fill ----
    const areaBtn = $('[data-action="area-fill"]');
    if (areaBtn) areaBtn.onclick = () => this._showAreaFill(panel);
    const areaPick = $('#area-pick');
    if (areaPick) areaPick.onchange = (e) => {
      cfg.area_id = e.target.value || null;
      this._markDirty();
    };

    // ---- Overview ----
    const bgDim = $('#bg-dim');
    if (bgDim) {
      bgDim.oninput = e => {
        cfg.background_dim = parseInt(e.target.value);
        $('#bg-dim-val').textContent = cfg.background_dim;
        this._markDirty();
        // Live-update preview dim
        this._softRefreshPreview();
      };
    }
    // ---- background_image_url ----
    const bgUrl = $('#bg-url');
    const bgThumb = $('#bg-url-thumb');
    const bgReset = $('#bg-url-reset');
    const _applyBgThumb = (val) => {
      if (!bgThumb) return;
      bgThumb.style.backgroundImage = `url('${val || '/bms_panel_static/background.png'}')`;
    };
    if (bgUrl) {
      bgUrl.oninput = e => {
        const v = e.target.value.trim();
        cfg.background_image_url = v || null;
        _applyBgThumb(v);
        this._markDirty();
        this._softRefreshPreview();
      };
    }
    if (bgReset) {
      bgReset.onclick = () => {
        cfg.background_image_url = null;
        if (bgUrl) bgUrl.value = '';
        _applyBgThumb('');
        this._markDirty();
        this._softRefreshPreview();
        this._toast('Фон сброшен на встроенный', 'info', { duration: 1600 });
      };
    }
    const tmout = $('#timeout');
    if (tmout) tmout.onchange = e => { cfg.screen_timeout = parseInt(e.target.value); this._markDirty(); };
    const lang = $('#lang');
    if (lang) lang.onchange = e => { cfg.language = e.target.value; this._markDirty(); };

    // ---- Screens: switches ----
    $$('.screen-list ha-switch').forEach(sw => {
      sw.addEventListener('change', () => {
        const id = sw.dataset.id;
        if (!cfg.screens[id]) cfg.screens[id] = { enabled: true, order: 99 };
        cfg.screens[id].enabled = sw.checked;
        sw.closest('.screen-row').classList.toggle('disabled', !sw.checked);
        this._markDirty();
      });
    });

    // ---- Screens: drag and drop ----
    let dragRow = null;
    $$('.screen-row').forEach(row => {
      row.ondragstart = e => {
        dragRow = row;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      };
      row.ondragend = () => {
        row.classList.remove('dragging');
        $$('.screen-row').forEach(r => r.classList.remove('drag-over'));
        const ids = [...$$('.screen-row')].map(r => r.dataset.id);
        ids.forEach((id, i) => {
          if (!cfg.screens[id]) cfg.screens[id] = { enabled: true, order: 99 };
          cfg.screens[id].order = i + 1;
        });
        this._markDirty();
      };
      row.ondragover = e => { e.preventDefault(); row.classList.add('drag-over'); };
      row.ondragleave = () => row.classList.remove('drag-over');
      row.ondrop = e => {
        e.preventDefault();
        row.classList.remove('drag-over');
        if (!dragRow || dragRow === row) return;
        const parent = row.parentNode;
        const dragIdx = [...parent.children].indexOf(dragRow);
        const dropIdx = [...parent.children].indexOf(row);
        if (dragIdx < dropIdx) parent.insertBefore(dragRow, row.nextSibling);
        else parent.insertBefore(dragRow, row);
      };
    });

    // ---- Home nav ----
    $$('.home-nav-select').forEach(sel => {
      sel.onchange = () => {
        cfg.home_nav[parseInt(sel.dataset.idx)] = sel.value;
        this._markDirty();
      };
    });

    // ---- Devices: single selects ----
    $$('.entity-select').forEach(sel => {
      sel.onchange = () => {
        cfg.entities[sel.dataset.key] = sel.value || null;
        this._markDirty();
      };
    });

    // ---- Devices: multi checkboxes ----
    $$('.entity-multi-cb').forEach(cb => {
      cb.onchange = () => {
        const key = cb.dataset.key;
        const cur = Array.isArray(cfg.entities[key]) ? cfg.entities[key].slice() : [];
        const idx = cur.indexOf(cb.value);
        if (cb.checked && idx < 0) cur.push(cb.value);
        if (!cb.checked && idx >= 0) cur.splice(idx, 1);
        cfg.entities[key] = cur;
        this._markDirty();
      };
    });

    // ---- Devices: search inside bind-list ----
    $$('.bind-item-search input').forEach(inp => {
      inp.oninput = () => {
        const q = inp.value.trim().toLowerCase();
        const list = inp.closest('.bind-list');
        list.querySelectorAll('.bind-item').forEach(it => {
          const haystack = it.dataset.name || '';
          it.style.display = !q || haystack.includes(q) ? '' : 'none';
        });
      };
    });

    // ---- Bind: clear single ----
    $$('[data-action="clear-one"]').forEach(btn => {
      btn.onclick = () => {
        const key = btn.dataset.key;
        cfg.entities[key] = null;
        this._markDirty();
        this._renderContent();
      };
    });

    // ---- Climate Presets: toggle expand ----
    $$('[data-cp-toggle]').forEach(head => {
      head.onclick = () => {
        const screen = head.dataset.cpToggle;
        this._climatePresetsExpanded = this._climatePresetsExpanded || {};
        this._climatePresetsExpanded[screen] = !this._climatePresetsExpanded[screen];
        const sec = head.closest('.climate-presets');
        if (sec) sec.classList.toggle('expanded');
      };
    });

    // ---- Climate Presets: helpers ----
    const setPreset = (screen, scene, field, value) => {
      if (!cfg.climate_presets) cfg.climate_presets = {};
      if (!cfg.climate_presets[screen]) cfg.climate_presets[screen] = {};
      if (!cfg.climate_presets[screen][scene]) cfg.climate_presets[screen][scene] = {};
      const defaults = CLIMATE_PRESET_DEFAULTS[screen]?.[scene] || {};
      if (value === null || value === undefined || value === '' || value === defaults[field]) {
        // Если возвращаем к дефолту — удаляем override (storage чище).
        delete cfg.climate_presets[screen][scene][field];
        if (!Object.keys(cfg.climate_presets[screen][scene]).length) {
          delete cfg.climate_presets[screen][scene];
        }
        if (!Object.keys(cfg.climate_presets[screen]).length) {
          delete cfg.climate_presets[screen];
        }
      } else {
        cfg.climate_presets[screen][scene][field] = value;
      }
      this._markDirty();
      this._softRefreshPreview();
    };

    // ---- Climate Presets: temp +/− ----
    $$('[data-cp-action="temp-inc"], [data-cp-action="temp-dec"]').forEach(btn => {
      btn.onclick = () => {
        if (btn.disabled) return;
        const screen = btn.dataset.cpScreen;
        const scene = btn.dataset.cpScene;
        const dir = btn.dataset.cpAction === 'temp-inc' ? 1 : -1;
        const eff = this._effectiveClimatePresets(screen, cfg);
        const cur = eff[scene]?.target ?? 22;
        let next = Math.round((cur + dir * CLIMATE_TARGET_STEP) * 2) / 2;
        if (next < CLIMATE_TARGET_MIN) next = CLIMATE_TARGET_MIN;
        if (next > CLIMATE_TARGET_MAX) next = CLIMATE_TARGET_MAX;
        setPreset(screen, scene, 'target', next);
        this._renderContent();
      };
    });

    // ---- Climate Presets: hvac/fan dropdown ----
    $$('.climate-preset-select').forEach(sel => {
      sel.onchange = () => {
        const screen = sel.dataset.cpScreen;
        const scene = sel.dataset.cpScene;
        const field = sel.dataset.cpField;
        setPreset(screen, scene, field, sel.value);
        // Минимальный re-render — обновляем CSS class «overridden» без полного перерендера.
        this._renderContent();
      };
    });

    // ---- Climate Presets: reset to defaults ----
    $$('[data-cp-reset]').forEach(btn => {
      btn.onclick = () => {
        const screen = btn.dataset.cpReset;
        this._confirmModal(
          `Сбросить пресеты «${CLIMATE_PRESET_SCREEN_META[screen]?.label || screen}»?`,
          'Все три сцены вернутся к дефолтным значениям. Это действие нельзя отменить.',
          () => {
            if (cfg.climate_presets) delete cfg.climate_presets[screen];
            this._markDirty();
            this._renderContent();
            this._softRefreshPreview();
          });
      };
    });

    // ---- Hidden bind groups → enable screen button ----
    $$('[data-action="enable-screen"]').forEach(btn => {
      btn.onclick = () => {
        const screen = btn.dataset.screen;
        if (!cfg.screens[screen]) cfg.screens[screen] = { enabled: false, order: 99 };
        cfg.screens[screen].enabled = true;
        this._markDirty();
        this._renderContent();
      };
    });

    // ---- Custom Cards: add ----
    const btnAddCard = $('#btn-add-card');
    if (btnAddCard) btnAddCard.onclick = () => this._showCustomCardEditor(panel, null);

    // ---- Custom Cards: edit / delete ----
    $$('[data-cc-action="edit"]').forEach(btn => {
      btn.onclick = () => {
        const cid = btn.dataset.ccId;
        this._showCustomCardEditor(panel, cid);
      };
    });
    $$('[data-cc-action="delete"]').forEach(btn => {
      btn.onclick = () => {
        const cid = btn.dataset.ccId;
        const card = (cfg.custom_cards || []).find(c => c.id === cid);
        const label = card?.label?.ru || cid;
        this._confirmModal(
          `Удалить карточку «${label}»?`,
          'Действие нельзя отменить.',
          () => {
            cfg.custom_cards = (cfg.custom_cards || []).filter(c => c.id !== cid);
            this._markDirty();
            this._renderContent();
            this._softRefreshPreview();
          });
      };
    });

    // ---- Custom Cards: drag-drop reorder ----
    let ccDrag = null;
    $$('.cc-row').forEach(row => {
      row.ondragstart = e => {
        ccDrag = row;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      };
      row.ondragend = () => {
        row.classList.remove('dragging');
        $$('.cc-row').forEach(r => r.classList.remove('drag-over'));
        const ids = [...this.shadowRoot.querySelectorAll('#cc-list .cc-row')].map(r => r.dataset.ccId);
        cfg.custom_cards = ids
          .map(id => (cfg.custom_cards || []).find(c => c.id === id))
          .filter(Boolean);
        this._markDirty();
        this._softRefreshPreview();
      };
      row.ondragover = e => { e.preventDefault(); row.classList.add('drag-over'); };
      row.ondragleave = () => row.classList.remove('drag-over');
      row.ondrop = e => {
        e.preventDefault();
        row.classList.remove('drag-over');
        if (!ccDrag || ccDrag === row) return;
        const parent = row.parentNode;
        const dragIdx = [...parent.children].indexOf(ccDrag);
        const dropIdx = [...parent.children].indexOf(row);
        if (dragIdx < dropIdx) parent.insertBefore(ccDrag, row.nextSibling);
        else parent.insertBefore(ccDrag, row);
      };
    });
  }

  // -------- Reusable simple confirm modal --------
  _confirmModal(title, msg, onYes) {
    this._showModal(`
      <div class="modal">
        <h3>${esc(title)}</h3>
        ${msg ? `<p style="color: var(--secondary-text-color); font-size: 13px; margin: 0 0 16px;">${esc(msg)}</p>` : ''}
        <div class="modal-actions">
          <button class="btn" id="cancel">Отмена</button>
          <button class="btn primary" id="ok">OK</button>
        </div>
      </div>
    `, (root, close) => {
      root.querySelector('#cancel').onclick = close;
      root.querySelector('#ok').onclick = () => { close(); onYes && onYes(); };
    });
  }

  // -------- Custom Card editor (add / edit) --------
  _showCustomCardEditor(panel, editId) {
    const cfg = this._workingConfig(panel);
    if (!Array.isArray(cfg.custom_cards)) cfg.custom_cards = [];

    const existing = editId ? cfg.custom_cards.find(c => c.id === editId) : null;
    // Default skeleton for new card
    const card = existing ? JSON.parse(JSON.stringify(existing)) : {
      id: 'cc_' + Math.random().toString(36).slice(2, 10),
      label: { ru: '', en: '', uz: '' },
      icon: 'mdi:star-outline',
      action: { type: 'service', service: '' },
    };

    const allEntities = this._hass ? Object.keys(this._hass.states).sort() : [];

    const renderActionFields = (a) => {
      if (a.type === 'service') {
        return `
          <label>HA service (domain.service)</label>
          <input type="text" id="cc-service" value="${esc(a.service || '')}"
                 placeholder="script.morning_routine" autocomplete="off">
          <label style="margin-top:8px;">Доп. данные (опц., JSON)</label>
          <textarea id="cc-service-data" placeholder='{"brightness": 100}'>${esc(a.data ? JSON.stringify(a.data) : '')}</textarea>
        `;
      }
      if (a.type === 'entity' || a.type === 'toggle') {
        const opts = ['<option value="">— выберите —</option>']
          .concat(allEntities.map(e => `<option value="${esc(e)}" ${e===a.entity_id?'selected':''}>${esc(e)}</option>`))
          .join('');
        const hint = a.type === 'toggle'
          ? 'Один тап — переключит entity (homeassistant.toggle). Для лампы/розетки/выключателя.'
          : 'Один тап — откроет детальную карточку (more-info dialog) с управлением.';
        return `
          <label>Entity</label>
          <select id="cc-entity">${opts}</select>
          <div style="font-size:11px; opacity:0.65; margin-top:4px;">${esc(hint)}</div>
        `;
      }
      if (a.type === 'dashboard') {
        return `
          <label>Путь к дашборду</label>
          <input type="text" id="cc-url" value="${esc(a.url || '')}" placeholder="/lovelace/0">
          <div style="font-size:11px; opacity:0.65; margin-top:4px;">
            Например: /lovelace/0, /dashboard-energy. Реальный переход выполнит APK.
          </div>
        `;
      }
      return '';
    };

    const initialActionHtml = renderActionFields(card.action);

    this._showModal(`
      <div class="modal" style="max-width: 520px;">
        <h3>${editId ? 'Редактировать карточку' : 'Новая карточка'}</h3>
        <div class="cc-modal-body">
          <div>
            <label>Иконка (Material Design Icon)</label>
            <input type="text" id="cc-icon" value="${esc(card.icon)}" placeholder="mdi:weather-sunny">
            <div style="font-size:11px; opacity:0.65; margin-top:4px;">
              Список: <a href="https://pictogrammers.com/library/mdi/" target="_blank" rel="noopener">pictogrammers.com</a> (префикс <code>mdi:</code>).
            </div>
          </div>

          <div>
            <label>Название</label>
            <div class="cc-lang-row">
              <div class="l">RU *</div>
              <input type="text" id="cc-label-ru" value="${esc(card.label?.ru || '')}" placeholder="Утро" maxlength="40">
            </div>
            <div class="cc-lang-row" style="margin-top:6px;">
              <div class="l">EN</div>
              <input type="text" id="cc-label-en" value="${esc(card.label?.en || '')}" placeholder="Morning" maxlength="40">
            </div>
            <div class="cc-lang-row" style="margin-top:6px;">
              <div class="l">UZ</div>
              <input type="text" id="cc-label-uz" value="${esc(card.label?.uz || '')}" placeholder="Ertalab" maxlength="40">
            </div>
          </div>

          <div>
            <label>Действие при тапе</label>
            <div class="cc-action-tabs" id="cc-action-tabs">
              <div class="cc-action-tab ${card.action.type === 'service' ? 'active' : ''}" data-at="service">
                <ha-icon icon="mdi:script-text-play-outline" style="--mdc-icon-size:16px;"></ha-icon> Сервис
              </div>
              <div class="cc-action-tab ${card.action.type === 'toggle' ? 'active' : ''}" data-at="toggle">
                <ha-icon icon="mdi:toggle-switch-outline" style="--mdc-icon-size:16px;"></ha-icon> Toggle
              </div>
              <div class="cc-action-tab ${card.action.type === 'entity' ? 'active' : ''}" data-at="entity">
                <ha-icon icon="mdi:information-outline" style="--mdc-icon-size:16px;"></ha-icon> Открыть entity
              </div>
              <div class="cc-action-tab ${card.action.type === 'dashboard' ? 'active' : ''}" data-at="dashboard">
                <ha-icon icon="mdi:view-dashboard-outline" style="--mdc-icon-size:16px;"></ha-icon> Дашборд
              </div>
            </div>
            <div id="cc-action-fields">${initialActionHtml}</div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="cancel">Отмена</button>
          <button class="btn primary" id="ok">${editId ? 'Сохранить' : 'Добавить'}</button>
        </div>
      </div>
    `, (root, close) => {
      const $ = (s) => root.querySelector(s);

      // Action-type tab switcher — переключает форму, не сохраняет ничего пока юзер не нажмёт OK.
      root.querySelectorAll('#cc-action-tabs .cc-action-tab').forEach(tab => {
        tab.onclick = () => {
          root.querySelectorAll('#cc-action-tabs .cc-action-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          const t = tab.dataset.at;
          // Replace action object skeleton for the new type (preserve nothing — это новые поля)
          card.action = { type: t };
          $('#cc-action-fields').innerHTML = renderActionFields(card.action);
        };
      });

      $('#cancel').onclick = close;
      $('#ok').onclick = () => {
        // Собираем данные
        const ru = $('#cc-label-ru').value.trim();
        if (!ru) {
          this._toast('Заполните русское название', 'warn', { duration: 2200 });
          return;
        }
        card.icon = $('#cc-icon').value.trim() || 'mdi:star-outline';
        card.label = {
          ru,
          en: $('#cc-label-en').value.trim(),
          uz: $('#cc-label-uz').value.trim(),
        };
        const activeTab = root.querySelector('#cc-action-tabs .cc-action-tab.active');
        const atype = activeTab ? activeTab.dataset.at : card.action.type;
        if (atype === 'service') {
          const svc = ($('#cc-service')?.value || '').trim();
          if (!svc.includes('.')) {
            this._toast('Сервис должен быть в формате domain.service', 'warn', { duration: 2400 });
            return;
          }
          const dataRaw = ($('#cc-service-data')?.value || '').trim();
          let data = null;
          if (dataRaw) {
            try { data = JSON.parse(dataRaw); }
            catch (e) {
              this._toast('Поле «Доп. данные» — невалидный JSON', 'error', { duration: 2800 });
              return;
            }
          }
          card.action = { type: 'service', service: svc };
          if (data) card.action.data = data;
        } else if (atype === 'entity' || atype === 'toggle') {
          const eid = $('#cc-entity')?.value || '';
          if (!eid.includes('.')) {
            this._toast('Выберите entity', 'warn', { duration: 2200 });
            return;
          }
          card.action = { type: atype, entity_id: eid };
        } else if (atype === 'dashboard') {
          const url = ($('#cc-url')?.value || '').trim();
          if (!url) {
            this._toast('Введите URL дашборда', 'warn', { duration: 2200 });
            return;
          }
          card.action = { type: 'dashboard', url };
        }

        // Save in cfg
        if (editId) {
          const idx = cfg.custom_cards.findIndex(c => c.id === editId);
          if (idx >= 0) cfg.custom_cards[idx] = card;
          else cfg.custom_cards.push(card);
        } else {
          cfg.custom_cards.push(card);
        }
        this._markDirty();
        close();
        this._renderContent();
        this._softRefreshPreview();
      };
    });
  }

  _markDirty() {
    this._dirty = true;
    // Дебаунс — для slider'а bg-dim не пере-валидировать на каждом сэмпле.
    if (this._dirtyDebounce) clearTimeout(this._dirtyDebounce);
    this._dirtyDebounce = setTimeout(() => {
      this._renderTopBar();
      this._refreshBannerOnly();
      this._dirtyDebounce = null;
    }, 80);
  }

  _refreshBannerOnly() {
    const banner = this.shadowRoot.querySelector('[data-banner]');
    if (!banner) return;
    const panel = this._activePanel();
    if (!panel) return;
    const issues = this._validateActive();
    const opts = this._activeTab === 'devices' ? { onlyDevices: true } : {};
    const html = this._renderIssuesBanner(issues, panel, opts);
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    banner.replaceWith(wrap.firstElementChild);

    // Re-wire banner toggle
    const newHead = this.shadowRoot.querySelector('[data-toggle-banner]');
    if (newHead) {
      newHead.onclick = () => {
        this._bannerExpanded = !this._bannerExpanded;
        const b = this.shadowRoot.querySelector('[data-banner]');
        if (b) b.classList.toggle('expanded');
      };
    }
  }

  // ============ MODALS ============

  _showModal(html, onMount) {
    const root = this.shadowRoot.getElementById('modal-root');
    root.innerHTML = `<div class="modal-backdrop" id="bk">${html}</div>`;
    const close = () => { root.innerHTML = ''; };
    root.querySelector('#bk').onclick = e => { if (e.target.id === 'bk') close(); };
    if (onMount) onMount(root, close);
    return close;
  }

  _showAddPanel() {
    this._showModal(`
      <div class="modal">
        <h3>Добавить панель</h3>
        <p style="color: var(--secondary-text-color); font-size: 13px; margin: 0 0 16px; line-height: 1.45;">
          Каждая панель = один настенный планшет в одной комнате. Имя — просто чтобы вы её узнавали в списке.
        </p>
        <div class="field-row">
          <label>Имя панели</label>
          <input type="text" id="add-name" placeholder="Панель кухни" class="control" autofocus>
        </div>
        <div class="field-row">
          <label>Код (Panel ID)</label>
          <input type="text" id="add-id" placeholder="Будет создан автоматически" class="control">
        </div>
        <p style="font-size: 12px; color: var(--secondary-text-color); margin: 8px 0 0;">
          На самой панели в Settings → Panel ID введите этот же код. Только латиница, цифры, _ и -.
        </p>
        <div class="modal-actions">
          <button class="btn" id="cancel">Отмена</button>
          <button class="btn primary" id="ok">Создать</button>
        </div>
      </div>
    `, (root, close) => {
      root.querySelector('#cancel').onclick = close;
      const nameInp = root.querySelector('#add-name');
      const idInp = root.querySelector('#add-id');
      nameInp.oninput = () => {
        if (!idInp.value) idInp.placeholder = slug(nameInp.value) || 'panel';
      };
      root.querySelector('#ok').onclick = () => {
        const name = nameInp.value.trim();
        const typedId = idInp.value.trim().toLowerCase();
        const previewId = typedId || slug(name);
        if (!name) { this._toast('Введите имя панели', 'error'); return; }
        if (typedId && !/^[a-z0-9_-]{2,32}$/.test(typedId)) {
          this._toast('Код должен быть из латиницы, цифр, _ или - (2–32 символа)', 'error');
          return;
        }
        const payload = { panel_name: name };
        if (typedId) payload.panel_id = typedId;
        this._hass.callService('bms_panel', 'add_panel', payload)
          .then(() => {
            close();
            // Persistent — это важная инструкция, не должна исчезать через 3 сек
            this._toast(
              `Панель «${name}» создана. Теперь установите APK на планшет и в нём впишите код из списка панелей в Settings → Panel ID.`,
              'success',
              { duration: 0 },
            );
            setTimeout(async () => {
              await this._loadPanels();
              this._selectCreatedPanel(name, previewId);
              this._refresh();
            }, 400);
          })
          .catch(err => this._toast('Ошибка: ' + (err.message || err), 'error'));
      };
      setTimeout(() => nameInp.focus(), 50);
    });
  }

  _showClonePanel(srcPanel) {
    this._showModal(`
      <div class="modal">
        <h3>Дублировать панель</h3>
        <p style="color: var(--secondary-text-color); font-size: 13px; margin: 0 0 16px; line-height: 1.45;">
          Будут скопированы экраны, нижний ряд, язык, таймауты. <b>Привязки устройств не копируются</b> — выберите их для новой панели отдельно.
        </p>
        <div class="field-row">
          <label>Имя новой панели</label>
          <input type="text" id="cl-name" value="${esc(srcPanel.panel_name)} (копия)" class="control" autofocus>
        </div>
        <div class="field-row">
          <label>Код (Panel ID)</label>
          <input type="text" id="cl-id" placeholder="Будет создан автоматически" class="control">
        </div>
        <div class="modal-actions">
          <button class="btn" id="cancel">Отмена</button>
          <button class="btn primary" id="ok">Создать копию</button>
        </div>
      </div>
    `, (root, close) => {
      root.querySelector('#cancel').onclick = close;
      const nameInp = root.querySelector('#cl-name');
      const idInp = root.querySelector('#cl-id');
      nameInp.oninput = () => {
        if (!idInp.value) idInp.placeholder = slug(nameInp.value) || 'panel';
      };
      root.querySelector('#ok').onclick = () => {
        const name = nameInp.value.trim();
        const typedId = idInp.value.trim().toLowerCase();
        const previewId = typedId || slug(name);
        if (!name) { this._toast('Введите имя новой панели', 'error'); return; }
        if (typedId && !/^[a-z0-9_-]{2,32}$/.test(typedId)) {
          this._toast('Код должен быть из латиницы, цифр, _ или - (2–32 символа)', 'error');
          return;
        }
        const payload = {
          source_panel_id: srcPanel.panel_id,
          panel_name: name,
        };
        if (typedId) payload.panel_id = typedId;
        this._hass.callService('bms_panel', 'clone_panel', payload)
          .then(() => {
            close();
            this._toast(`Панель скопирована.`, 'success');
            setTimeout(async () => {
              await this._loadPanels();
              this._selectCreatedPanel(name, previewId);
              this._refresh();
            }, 400);
          })
          .catch(err => this._toast('Ошибка: ' + (err.message || err), 'error'));
      };
      setTimeout(() => nameInp.focus(), 50);
    });
  }

  _showMoreMenu(event, panel) {
    // Контекстное меню — destructive actions отделены от основного flow,
    // чтобы пользователь не промахнулся на «Save».
    this._showModal(`
      <div class="modal" style="width: 360px;">
        <h3>Ещё действия</h3>
        <div style="display:flex; flex-direction:column; gap: 6px; margin-top: 8px;">
          <button class="btn" id="act-reset" style="justify-content: flex-start;">
            <ha-icon icon="mdi:restart"></ha-icon> Стереть всё и начать заново
          </button>
          <button class="btn danger" id="act-remove" style="justify-content: flex-start;">
            <ha-icon icon="mdi:delete-outline"></ha-icon> Удалить эту панель
          </button>
        </div>
        <div class="modal-actions">
          <button class="btn" id="cancel">Закрыть</button>
        </div>
      </div>
    `, (root, close) => {
      root.querySelector('#cancel').onclick = close;
      root.querySelector('#act-reset').onclick = () => { close(); this._showResetConfirm(panel); };
      root.querySelector('#act-remove').onclick = () => { close(); this._showRemoveConfirm(panel); };
    });
  }

  _showResetConfirm(panel) {
    this._showModal(`
      <div class="modal">
        <h3>Вернуть к дефолту?</h3>
        <p style="font-size: 14px; line-height: 1.5;">
          Конфиг панели <b>${esc(panel.panel_name)}</b> вернётся к заводским настройкам.<br>
          Все привязки устройств будут сброшены.
        </p>
        <div class="modal-actions">
          <button class="btn" id="cancel">Отмена</button>
          <button class="btn danger" id="ok">Да, сбросить</button>
        </div>
      </div>
    `, (root, close) => {
      root.querySelector('#cancel').onclick = close;
      root.querySelector('#ok').onclick = () => {
        this._hass.callService('bms_panel', 'reset_config', { panel_id: panel.panel_id })
          .then(() => {
            close();
            this._workingCache.delete(panel.panel_id);
            this._dirty = false;
            this._toast('Конфиг сброшен', 'success');
            setTimeout(() => this._refresh(), 300);
          })
          .catch(err => this._toast('Ошибка: ' + (err.message || err), 'error'));
      };
    });
  }

  _showRemoveConfirm(panel) {
    this._showModal(`
      <div class="modal">
        <h3>Удалить панель?</h3>
        <p style="font-size: 14px; line-height: 1.5;">
          Панель <b>${esc(panel.panel_name)}</b> и все её настройки удалятся из Home Assistant.<br>
          Это действие <b>необратимо</b>. На самой стенке планшет продолжит работать, пока вы не очистите Panel ID или не установите другой APK.
        </p>
        <div class="modal-actions">
          <button class="btn" id="cancel">Отмена</button>
          <button class="btn danger" id="ok">Удалить</button>
        </div>
      </div>
    `, (root, close) => {
      root.querySelector('#cancel').onclick = close;
      root.querySelector('#ok').onclick = () => {
        this._hass.callService('bms_panel', 'remove_panel', { panel_id: panel.panel_id })
          .then(() => {
            close();
            this._workingCache.delete(panel.panel_id);
            this._activePanelId = null;
            this._toast('Панель удалена', 'success');
            setTimeout(() => this._refresh(), 300);
          })
          .catch(err => this._toast('Ошибка: ' + (err.message || err), 'error'));
      };
    });
  }

  _showHelp() {
    this._showModal(`
      <div class="modal" style="width: 560px;">
        <h3>Как настроить BMS-панель</h3>
        <div style="font-size: 14px; line-height: 1.6; color: var(--primary-text-color);">
          <p><b>1. Создайте панель.</b> Слева «Добавить панель» → имя (например, «Кухня»). Получите короткий код, например <code>kitchen</code>.</p>
          <p><b>2. На самом планшете</b> (после установки APK): Settings → Panel ID → введите тот же код.</p>
          <p><b>3. Вкладка «Экраны»</b> — выключите экраны, которых нет в этой комнате (тёплый пол, конвектор и т.д.).</p>
          <p><b>4. Вкладка «Устройства»</b> — выберите лампы / шторы / термостаты, которыми эта панель будет управлять.</p>
          <p><b>5. Вкладка «Главный экран»</b> — какие 5 иконок показывать в нижнем ряду.</p>
          <p><b>Зелёная плашка «всё проверено»</b> означает, что на панели гарантированно не будет ошибок. Красные и жёлтые предупреждения покажут что починить.</p>
          <p>Изменения применяются на панели за 0.5–3 секунды после нажатия «Сохранить».</p>
        </div>
        <div class="modal-actions">
          <button class="btn primary" id="ok">Понятно</button>
        </div>
      </div>
    `, (root, close) => {
      root.querySelector('#ok').onclick = close;
    });
  }

  // ============ TOAST ============

  _toast(message, severity = 'success', opts = {}) {
    // opts.duration — мс (или 0 = persistent с крестиком)
    const root = this.shadowRoot.getElementById('toast-root');
    if (!root) return;
    if (this._toastTimer) clearTimeout(this._toastTimer);
    const cls = severity === 'error' ? 'error' : severity === 'warn' ? 'warn' : '';
    const icon = severity === 'error' ? 'mdi:alert-circle' : severity === 'warn' ? 'mdi:alert' : 'mdi:check-circle';
    const duration = opts.duration === undefined
      ? (severity === 'error' ? 6000 : 3000)
      : opts.duration;
    const persistent = duration === 0;
    root.innerHTML = `
      <div class="toast ${cls}">
        <ha-icon icon="${icon}" style="color: var(--bms-${severity === 'success' ? 'success' : severity});"></ha-icon>
        <div style="flex:1;">${esc(message)}</div>
        ${persistent ? '<button class="btn ghost" id="toast-close" style="padding:2px 6px;">×</button>' : ''}
      </div>
    `;
    if (persistent) {
      root.querySelector('#toast-close').onclick = () => { root.innerHTML = ''; };
    } else {
      this._toastTimer = setTimeout(() => { root.innerHTML = ''; }, duration);
    }
  }

  // entity_id → имя другой панели где оно уже привязано (или undefined)
  _entityOccupiedMap() {
    const me = this._activePanelId;
    const map = new Map();
    for (const p of this._allPanels()) {
      if (p.panel_id === me) continue;
      const cfg = this._workingCache.get(p.panel_id) || p.config;
      for (const [bk, val] of Object.entries(cfg.entities || {})) {
        const ids = (val && (Array.isArray(val) ? val : [val])) || [];
        for (const eid of ids) {
          if (eid && !map.has(eid)) map.set(eid, p.panel_name || p.panel_id);
        }
      }
    }
    return map;
  }

  // ============ Bulk-view все панели ============

  _renderAllPanelsView(content) {
    const panels = this._allPanels();
    const allIssues = this._validateAll();
    const rows = panels.map(p => {
      const cfg = this._workingCache.get(p.panel_id) || p.config;
      const issues = allIssues.get(p.panel_id) || [];
      const sum = summary(issues);
      const enabledScreens = Object.entries(cfg.screens || {}).filter(([, s]) => s?.enabled).map(([k]) => SCREEN_META[k]?.ru || k);
      const totalEntities = Object.values(cfg.entities || {}).reduce((acc, v) => {
        if (Array.isArray(v)) return acc + v.length;
        if (v) return acc + 1;
        return acc;
      }, 0);
      const lastSeen = this._formatLastSeen(p.last_updated);
      const areaName = cfg.area_id ? this._areaName(cfg.area_id) : '—';
      return {
        p, sum, enabledScreens, totalEntities, lastSeen, areaName,
      };
    });

    content.innerHTML = `
      <div class="tab-content">
        <div class="card">
          <h3 class="card-title">Все панели (${panels.length})</h3>
          <div class="card-sub">Сводка по всем настроенным панелям. Жёлтое — предупреждения, красное — ошибки. Кликните строку для перехода в детали.</div>
          <div style="overflow-x: auto;">
            <table style="width:100%; border-collapse: collapse; font-size: 13px;">
              <thead>
                <tr style="background: var(--secondary-background-color); text-align: left;">
                  <th style="padding: 10px 8px;">Имя</th>
                  <th style="padding: 10px 8px;">Код</th>
                  <th style="padding: 10px 8px;">Комната</th>
                  <th style="padding: 10px 8px;">Экраны</th>
                  <th style="padding: 10px 8px; text-align: right;">Устройств</th>
                  <th style="padding: 10px 8px;">Контакт</th>
                  <th style="padding: 10px 8px;">Состояние</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(r => `
                  <tr style="border-bottom: 1px solid var(--divider-color); cursor: pointer;" data-panel-id="${esc(r.p.panel_id)}" class="bulk-row">
                    <td style="padding: 10px 8px; font-weight: 500;">${esc(r.p.panel_name)}</td>
                    <td style="padding: 10px 8px; font-family: monospace; font-size: 12px; color: var(--secondary-text-color);">${esc(r.p.panel_id)}</td>
                    <td style="padding: 10px 8px;">${esc(r.areaName)}</td>
                    <td style="padding: 10px 8px; font-size: 12px;">${r.enabledScreens.length ? r.enabledScreens.join(', ') : '—'}</td>
                    <td style="padding: 10px 8px; text-align: right; font-variant-numeric: tabular-nums;">${r.totalEntities}</td>
                    <td style="padding: 10px 8px; font-size: 12px; color: var(--secondary-text-color);">${r.lastSeen}</td>
                    <td style="padding: 10px 8px;">
                      ${r.sum.error ? `<span class="sev-chip" style="background: rgba(244,67,54,0.15); color: var(--bms-error);"><ha-icon icon="mdi:alert-circle" style="--mdc-icon-size:14px;"></ha-icon> ${r.sum.error}</span>` : ''}
                      ${r.sum.warning ? `<span class="sev-chip" style="background: rgba(255,152,0,0.15); color: var(--bms-warn);"><ha-icon icon="mdi:alert" style="--mdc-icon-size:14px;"></ha-icon> ${r.sum.warning}</span>` : ''}
                      ${!r.sum.error && !r.sum.warning ? `<span style="color: var(--bms-success);">✓</span>` : ''}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    content.querySelectorAll('.bulk-row').forEach(row => {
      row.onclick = () => {
        this._activeView = null;
        this._activePanelId = row.dataset.panelId;
        this._refresh();
      };
    });
  }

  // ============ HA Areas integration ============

  _hassAreas() {
    // hass.areas — frontend connection экспонирует areas через hass.areas или hass.connection
    // В новых HA — hass.areas (registry collection). Fallback: пустой массив.
    if (!this._hass) return [];
    if (this._hass.areas) {
      return Object.values(this._hass.areas).map(a => ({
        area_id: a.area_id,
        name: a.name || a.area_id,
      })).sort((a, b) => a.name.localeCompare(b.name));
    }
    return [];
  }

  _areaName(areaId) {
    const a = this._hassAreas().find(x => x.area_id === areaId);
    return a?.name || areaId;
  }

  // entity → area через entity_registry (с fallback на device)
  _entityArea(entityId) {
    if (!this._hass) return null;
    const entReg = this._hass.entities?.[entityId];
    if (entReg?.area_id) return entReg.area_id;
    if (entReg?.device_id) {
      const dev = this._hass.devices?.[entReg.device_id];
      return dev?.area_id || null;
    }
    return null;
  }

  _entitiesInArea(areaId, domain) {
    if (!this._hass) return [];
    return Object.keys(this._hass.states)
      .filter(eid => eid.startsWith(domain + '.'))
      .filter(eid => this._entityArea(eid) === areaId);
  }

  _showAreaFill(panel) {
    const cfg = this._workingConfig(panel);
    const areaId = cfg.area_id;
    if (!areaId) {
      this._toast('Сначала выберите Area на вкладке «Обзор»', 'warn');
      return;
    }
    const areaName = this._areaName(areaId);
    // Группируем по bind-keys
    const proposal = {};
    let totalEntities = 0;
    for (const [bk, meta] of Object.entries(BIND_KEYS)) {
      const inArea = this._entitiesInArea(areaId, meta.domain);
      if (!inArea.length) continue;
      proposal[bk] = inArea;
      totalEntities += inArea.length;
    }
    if (totalEntities === 0) {
      this._toast(`В комнате «${areaName}» нет ни одного устройства`, 'warn');
      return;
    }

    // Превью с per-entity чекбоксами. По умолчанию всё включено,
    // пользователь снимает галки с того что не подходит этой панели.
    const friendlyName = (eid) => {
      const s = this._hass.states[eid];
      return s?.attributes?.friendly_name || eid;
    };

    this._showModal(`
      <div class="modal" style="width: 580px;">
        <h3>Заполнить из комнаты «${esc(areaName)}»</h3>
        <p style="font-size: 13px; line-height: 1.5; color: var(--secondary-text-color);">
          Снимите галочки с тех устройств, которые не относятся к этой панели.
          Уже привязанные дубли не создаются.
        </p>
        <div style="max-height: 380px; overflow-y: auto; margin: 12px 0;">
          ${Object.entries(proposal).map(([bk, ids]) => {
            const meta = BIND_KEYS[bk];
            const groupTitle = (BIND_GROUPS.find(g => g.binds.some(b => b.key === bk))?.title) || bk;
            return `
              <div style="padding: 10px 12px; border-bottom: 1px solid var(--divider-color);">
                <div style="font-weight: 500; margin-bottom: 6px; font-size: 13px;">
                  ${esc(groupTitle)} <span style="color:var(--secondary-text-color); font-weight: 400;">(${ids.length})</span>
                </div>
                ${ids.map(eid => `
                  <label style="display:flex; align-items:center; gap: 8px; padding: 4px 0; font-size: 13px;">
                    <input type="checkbox" class="area-fill-cb" data-bk="${bk}" value="${esc(eid)}" checked>
                    <span style="flex:1;">${esc(friendlyName(eid))}</span>
                    <span style="font-family: monospace; font-size: 11px; opacity: 0.6;">${esc(eid)}</span>
                  </label>
                `).join('')}
              </div>
            `;
          }).join('')}
        </div>
        <div class="modal-actions">
          <button class="btn" id="cancel">Отмена</button>
          <button class="btn primary" id="ok">Заполнить</button>
        </div>
      </div>
    `, (root, close) => {
      root.querySelector('#cancel').onclick = close;
      root.querySelector('#ok').onclick = () => {
        // Собираем по bind-key то что осталось отмечено
        const finalProposal = {};
        root.querySelectorAll('.area-fill-cb:checked').forEach(cb => {
          (finalProposal[cb.dataset.bk] ||= []).push(cb.value);
        });
        let totalAdded = 0;
        for (const [bk, ids] of Object.entries(finalProposal)) {
          const meta = BIND_KEYS[bk];
          if (meta.multi) {
            const existing = Array.isArray(cfg.entities[bk]) ? cfg.entities[bk] : [];
            const merged = [...new Set([...existing, ...ids])];
            totalAdded += (merged.length - existing.length);
            cfg.entities[bk] = merged;
          } else {
            if (!cfg.entities[bk] && ids.length > 0) {
              cfg.entities[bk] = ids[0];
              totalAdded += 1;
            }
          }
          // Включаем экран — устройства найдены
          if (meta.requiresScreen) {
            if (!cfg.screens[meta.requiresScreen]) {
              cfg.screens[meta.requiresScreen] = { enabled: false, order: 99 };
            }
            cfg.screens[meta.requiresScreen].enabled = true;
          }
        }
        close();
        this._markDirty();
        this._renderContent();
        this._toast(`Добавлено ${totalAdded} устройств из «${areaName}»`, 'success', { duration: 4000 });
      };
    });
  }

  // ============ Test device — мигнуть лампой ============

  _testEntity(eid) {
    if (!eid || !this._hass) return;
    const domain = eid.split('.', 1)[0];
    const st = this._hass.states[eid];
    const name = st?.attributes?.friendly_name || eid;

    // climate/sensor — read-only тест (показать текущее состояние)
    if (domain === 'climate') {
      this._toast(
        `${name}: ${st?.state || '?'} · режимы ${st?.attributes?.hvac_modes?.join('/') || '?'}`,
        'success',
      );
      return;
    }
    if (domain === 'sensor') {
      this._toast(
        `${name}: ${st?.state || '?'} ${st?.attributes?.unit_of_measurement || ''}`,
        'success',
      );
      return;
    }

    // light — безопасно для теста (toggle мигнёт, юзер сразу видит результат).
    if (domain === 'light') {
      this._hass.callService('light', 'toggle', { entity_id: eid })
        .then(() => this._toast(`${name}: мигнул`, 'success'))
        .catch(err => this._toast('Ошибка: ' + (err.message || err), 'error'));
      return;
    }

    // Опасные домены — switch/cover/fan/media_player — требуют подтверждения.
    // Нельзя случайно открыть ворота или включить бойлер.
    const labels = {
      switch: ['Переключить', 'выключатель'],
      cover:  ['Открыть/закрыть', 'шторы/ворота'],
      fan:    ['Переключить', 'вентилятор'],
      media_player: ['Play/Pause', 'плеер'],
    };
    const [verbLabel, kind] = labels[domain] || ['Действие', domain];
    this._showModal(`
      <div class="modal" style="width: 420px;">
        <h3>Подтвердите тест устройства</h3>
        <p style="font-size: 14px; line-height: 1.5;">
          ${verbLabel} <b>${esc(name)}</b>?<br>
          <span style="color: var(--secondary-text-color); font-size: 13px;">
            Это реально дернёт ${kind} — убедитесь что сейчас можно.
          </span>
        </p>
        <div class="modal-actions">
          <button class="btn" id="cancel">Отмена</button>
          <button class="btn primary" id="ok">${verbLabel}</button>
        </div>
      </div>
    `, (root, close) => {
      root.querySelector('#cancel').onclick = close;
      root.querySelector('#ok').onclick = () => {
        close();
        const service = domain === 'media_player' ? 'media_play_pause' : 'toggle';
        this._hass.callService(domain, service, { entity_id: eid })
          .then(() => this._toast(`${name}: команда отправлена`, 'success'))
          .catch(err => this._toast('Ошибка: ' + (err.message || err), 'error'));
      };
    });
  }

  // ============ Last-seen formatter ============

  _formatLastSeen(iso) {
    if (!iso) return 'нет данных';
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return `${Math.round(diff)} сек назад`;
    if (diff < 3600) return `${Math.round(diff/60)} мин назад`;
    if (diff < 86400) return `${Math.round(diff/3600)} ч назад`;
    return `${Math.round(diff/86400)} дн назад`;
  }

  // ============ Scroll to issue anchor ============

  _scrollToAnchor(issue) {
    const a = issue.anchor || {};
    let selector = null;
    if (a.type === 'field') {
      // Поле → конкретный input/select. Маппинг ключей на ID в DOM.
      const fieldId = ({
        background_dim: 'bg-dim',
        screen_timeout: 'timeout',
        language: 'lang',
        panel_id: 'add-id',  // только если модалка add открыта
        area_id: 'area-pick',
      })[a.key] || a.key;
      selector = `#${fieldId}`;
    }
    if (a.type === 'bind_card')     selector = `.bind-card [data-key="${a.key}"]`;
    if (a.type === 'home_nav_item') selector = `.home-nav-select[data-idx="${a.index}"]`;
    if (a.type === 'card')          selector = a.key === 'home_nav' ? '.home-nav-grid' : '.screen-list';
    if (a.type === 'screen_warning')selector = `.bind-group [data-key]`; // first one
    if (a.type === 'duplicate' || a.type === 'duplicate_self') {
      selector = `[value="${a.entity_id}"]`;  // checkbox or option в multi
    }
    if (!selector) return;
    const el = this.shadowRoot.querySelector(selector);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const card = el.closest('.bind-card, .card, .home-nav-slot, .bind-group');
      if (card) {
        const colorVar = issue.severity === 'error' ? '--bms-error' : '--bms-warn';
        card.style.transition = 'box-shadow 0.3s';
        card.style.boxShadow = `0 0 0 3px var(${colorVar})`;
        setTimeout(() => { card.style.boxShadow = ''; }, 1500);
      }
    }
  }

  // ============ SAVE ============

  _save() {
    const panel = this._activePanel();
    if (!panel) return;
    const issues = this._validateActive();
    if (hasErrors(issues)) {
      this._toast('Сначала исправьте красные ошибки', 'error');
      this._bannerExpanded = true;
      this._refreshBannerOnly();
      return;
    }
    const cfg = this._workingConfig(panel);
    // merge=false — editor.js всегда сохраняет ПОЛНЫЙ working config,
    // partial-merge (default true) предназначен только для внешних вызовов
    // через automation/script (например пользователь скриптом меняет один screen_timeout).
    this._hass.callService('bms_panel', 'update_config', {
      panel_id: panel.panel_id,
      config: cfg,
      merge: false,
    })
      .then(() => {
        this._dirty = false;
        this._toast('Сохранено — отправлено на панель', 'success');
        // Принудительно обновить UI чтобы убрать «dirty»
        this._refresh();
      })
      .catch(err => {
        this._toast('Ошибка сохранения: ' + (err.message || err), 'error');
      });
  }

  // ===========================================================================
  // ============== LIVE PREVIEW PANE (v2.1.0) ================================
  // ===========================================================================
  //
  // Renders 480×480 mock of the APK panel showing the configured screens with
  // real entity state from `this._hass.states`. Taps call `hass.callService(...)`
  // → state changes flow back through `set hass` → next refresh shows new state.
  //
  // Screens covered: home / light / curtain / ac / heating / floor / convector
  //                  / ventilation / menu. (music skipped — disabled in BMS).
  //
  // Optimistic UI: when user taps a control we put entity_id into
  // `_previewPending` with the expected value + 3s TTL. Next render uses the
  // pending value until real state catches up or TTL expires.

  _togglePreview() {
    this._previewExpanded = !this._previewExpanded;
    const pane = this.shadowRoot.getElementById('preview-pane');
    if (pane) {
      pane.classList.toggle('expanded', this._previewExpanded);
      pane.classList.toggle('collapsed', !this._previewExpanded);
    }
    this._renderPreviewPane();
  }

  _renderPreviewPane() {
    const pane = this.shadowRoot.getElementById('preview-pane');
    if (!pane) return;
    const panel = this._activePanel();
    if (!panel) {
      pane.innerHTML = `
        <div class="preview-head">
          <ha-icon icon="mdi:cellphone-screenshot"></ha-icon>
          <div class="preview-head-title">Превью</div>
        </div>
        <div class="preview-body" style="opacity:0.5; text-align:center; padding:20px;">
          Создайте панель, чтобы увидеть превью.
        </div>`;
      return;
    }

    if (!this._previewExpanded) {
      // Collapsed sidebar — vertical icon stack only.
      pane.innerHTML = `
        <div class="icon-btn" title="Развернуть превью" id="btn-preview-expand"
             style="padding:8px; cursor:pointer;">
          <ha-icon icon="mdi:cellphone-screenshot" style="--mdc-icon-size:24px;"></ha-icon>
        </div>`;
      const btn = pane.querySelector('#btn-preview-expand');
      if (btn) btn.onclick = () => this._togglePreview();
      return;
    }

    const cfg = this._workingConfig(panel);
    const enabled = this._enabledScreens(cfg);
    // If selected screen is now disabled, snap to home.
    if (this._previewScreen !== 'home' && this._previewScreen !== 'menu' &&
        !enabled.includes(this._previewScreen)) {
      this._previewScreen = 'home';
    }

    pane.innerHTML = `
      <div class="preview-head">
        <ha-icon icon="mdi:cellphone-screenshot" style="color: var(--primary-color);"></ha-icon>
        <div class="preview-head-title">
          Превью · ${esc(panel.panel_name)}
          <div style="font-size:10px; opacity:0.6; text-transform:none; letter-spacing:0; margin-top:2px;">
            Тапы реально отправляют команды в HA
          </div>
        </div>
        <div class="icon-btn" id="btn-preview-collapse" title="Свернуть">
          <ha-icon icon="mdi:chevron-right"></ha-icon>
        </div>
      </div>
      <div class="preview-screen-picker">
        ${this._renderPreviewScreenPicker(cfg, enabled)}
      </div>
      <div class="preview-body">
        ${this._renderPreviewScreen(panel, cfg)}
      </div>
    `;

    pane.querySelector('#btn-preview-collapse').onclick = () => this._togglePreview();
    this._wirePreviewEvents(panel, cfg);
    this._ensurePreviewClock();
  }

  _renderPreviewScreenPicker(cfg, enabled) {
    const items = [
      { key: 'home', icon: 'mdi:home-outline', label: 'Дом', always: true },
      ...['light','curtain','ac','heating','floor','convector','ventilation'].map(k => ({
        key: k, icon: SCREEN_META[k].icon, label: SCREEN_META[k].ru,
      })),
      { key: 'menu', icon: 'mdi:view-grid', label: 'Меню', always: true },
    ];
    return items.map(it => {
      const isOn = it.always || enabled.includes(it.key);
      const active = this._previewScreen === it.key;
      return `
        <div class="ps-btn ${active?'active':''} ${!isOn?'disabled':''}" data-pv-screen="${it.key}">
          <ha-icon icon="${it.icon}"></ha-icon><span>${it.label}</span>
        </div>`;
    }).join('');
  }

  _enabledScreens(cfg) {
    return Object.entries(cfg.screens || {})
      .filter(([_, v]) => v && v.enabled)
      .map(([k]) => k);
  }

  _renderPreviewScreen(panel, cfg) {
    const sc = this._previewScreen;
    if (sc === 'home') return this._pvHome(cfg);
    if (sc === 'menu') return this._pvMenu(cfg);
    if (sc === 'light') return this._pvLight(cfg);
    if (sc === 'curtain') return this._pvCurtain(cfg);
    if (sc === 'ventilation') return this._pvVentilation(cfg);
    if (['ac','heating','floor','convector'].includes(sc)) return this._pvClimate(cfg, sc);
    return this._pvEmpty('Этот экран пока без превью');
  }

  // Wrap panel content. Adds CSS vars for backgound (built-in or custom URL)
  // and home-screen dim. Sub-screens use blurred backdrop, home uses sharp image.
  _pvWrap(inner, opts = {}) {
    const cfg = opts.cfg || {};
    const customBg = (cfg.background_image_url || '').trim();
    // ВАЖНО: для built-in PNG добавляем cache-bust ?v=2.2.3 — без этого
    // браузер может закэшировать 404 от старой инсталляции и preview будет чёрный.
    const bgUrl = customBg || '/bms_panel_static/background.png?v=2.2.3';
    const homeDim = ((cfg.background_dim ?? 30) / 100).toFixed(2);
    const cls = opts.home ? 'pv-home' : 'pv-sub';
    const climateCls = opts.climate ? `pv-climate ${esc(opts.climate)}` : '';
    return `<div class="pv-panel ${cls} ${climateCls}"
                 style="--pv-bg-img: url('${esc(bgUrl)}'); --pv-home-dim: ${homeDim};">${inner}</div>`;
  }

  // Back-arrow chevron header. Inline SVG (no ha-icon — to match APK look).
  _pvHeader(title, opts = {}) {
    const rightBtn = opts.rightBtn || `<div class="pv-header-spacer"></div>`;
    return `
      <div class="pv-header">
        <div class="pv-header-btn" data-pv-action="nav-home" title="На главный">
          <svg viewBox="0 0 32 32"><path d="M20 6 L10 16 L20 26"/></svg>
        </div>
        <div class="pv-header-title">${esc(title)}</div>
        ${rightBtn}
      </div>
      <div class="pv-divider"></div>`;
  }

  // "Power" toggle button in header (right side). Used by Light/Curtain/Climate.
  _pvHeaderPower(action, eid, isOn) {
    const cls = isOn ? 'power-on' : '';
    return `
      <div class="pv-header-btn ${cls}" data-pv-action="${esc(action)}" data-entity="${esc(eid || '')}" title="Питание">
        <svg viewBox="0 0 32 32">
          <path d="M16 4 v12"/>
          <path d="M9 9 a10 10 0 1 0 14 0"/>
        </svg>
      </div>`;
  }

  _pvEmpty(msg, hint = '') {
    return `
      <div class="pv-empty">
        <ha-icon icon="mdi:link-variant-off"></ha-icon>
        <div>${esc(msg)}</div>
        ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}
      </div>`;
  }

  // ------ entity state with optimistic overrides ------

  _pvEntState(eid) {
    if (!this._hass || !this._hass.states[eid]) return null;
    const s = this._hass.states[eid];
    const pending = this._previewPending.get(eid);
    if (pending && Date.now() < pending.expires_at) {
      return { ...s, state: pending.state ?? s.state, attributes: { ...s.attributes, ...pending.attrs } };
    }
    if (pending) this._previewPending.delete(eid);
    return s;
  }

  _pvSetPending(eid, state, attrs = {}) {
    this._previewPending.set(eid, { state, attrs, expires_at: Date.now() + 3000 });
    // Soft refresh — без перерисовки picker'а, чтобы не порвать click handlers.
    setTimeout(() => this._softRefreshPreview(), 30);
  }

  // ============ HOME ============
  // Layout matches index.html #screen-home (climate band 20..160, dark band 160..310,
  // clock at 180, nav at bottom with 80px icons).
  _pvHome(cfg) {
    const tempEid = cfg.entities?.temp_sensor;
    const humEid = cfg.entities?.humidity_sensor;
    const tempState = tempEid ? this._pvEntState(tempEid) : null;
    const humState = humEid ? this._pvEntState(humEid) : null;
    const tempVal = tempState && tempState.state !== 'unavailable' && tempState.state !== 'unknown'
      ? Math.round(parseFloat(tempState.state)) : '24';
    const humVal = humState && humState.state !== 'unavailable' && humState.state !== 'unknown'
      ? Math.round(parseFloat(humState.state)) : '45';

    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const weekdays = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
    const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    const dateStr = `${weekdays[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]}`;

    // Comfort message — 1-в-1 с APK HomeScreen.kt buildComfortMessage()
    // tempLabel: <18 прохладно / <22 комфортно / <26 тепло / иначе жарко
    // humLabel:  <30 сухо / <60 влажность в норме / иначе влажно
    // Формат: «Дома {tempLabel} · {humLabel}»
    let comfortMsg = '';
    const tNum = parseFloat(tempVal);
    const hNum = parseFloat(humVal);
    const tempLabel = !isNaN(tNum)
      ? (tNum < 18 ? 'прохладно' : tNum < 22 ? 'комфортно' : tNum < 26 ? 'тепло' : 'жарко')
      : null;
    const humLabel = !isNaN(hNum)
      ? (hNum < 30 ? 'сухо' : hNum < 60 ? 'влажность в норме' : 'влажно')
      : null;
    if (tempLabel && humLabel) comfortMsg = `Дома ${tempLabel}, ${humLabel}`;
    else if (tempLabel) comfortMsg = `Дома ${tempLabel}`;
    else if (humLabel) comfortMsg = humLabel.charAt(0).toUpperCase() + humLabel.slice(1);

    const nav = (cfg.home_nav || []).slice(0, 5);
    const navHtml = nav.map(key => {
      if (!key) return `<div class="nv" style="visibility:hidden;"></div>`;
      const m = SCREEN_META[key];
      const isMenu = key === 'menu';
      const icon = isMenu ? 'mdi:view-grid' : (m?.icon || 'mdi:help-circle-outline');
      // APK использует «Ещё» для menu — соответствуем для нижней nav
      const lbl = isMenu ? 'Ещё' : (m?.ru || key);
      return `
        <div class="nv" data-pv-action="nav-to" data-target="${esc(key)}">
          <div class="nv-icon"><ha-icon icon="${icon}"></ha-icon></div>
          <div class="lbl">${esc(lbl)}</div>
        </div>`;
    }).join('');

    // Inline SVG icons matching index.html (thermometer + droplet)
    const tempIcon = `<svg viewBox="0 0 64 64" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" width="44" height="44">
      <path d="M28 8a6 6 0 0 1 12 0v32a10 10 0 1 1-12 0V8z"/>
      <circle cx="34" cy="46" r="5" fill="white"/>
      <path d="M34 18v22"/>
    </svg>`;
    const humIcon = `<svg viewBox="0 0 64 64" fill="white" width="44" height="44">
      <path d="M32 4c-2 8-18 22-18 36a18 18 0 1 0 36 0c0-14-16-28-18-36z"/>
    </svg>`;

    return this._pvWrap(`
      <div class="pv-home-climate">
        <div class="cli">
          <div class="cli-icon">${tempIcon}</div>
          <div class="cli-val">${tempVal}°<span class="unit">C</span></div>
          <div class="cli-lbl">Температура</div>
        </div>
        <div class="cli">
          <div class="cli-icon">${humIcon}</div>
          <div class="cli-val">${humVal}<span class="unit">%</span></div>
          <div class="cli-lbl">Влажность</div>
        </div>
      </div>
      <div class="pv-home-band"></div>
      <div class="pv-home-clock">
        <div class="t" data-pv-clock>${hh}:${mm}</div>
        <div class="d">${dateStr}</div>
        <div class="comfort">${esc(comfortMsg)}</div>
      </div>
      <div class="pv-home-nav">${navHtml}</div>
    `, { home: true, cfg });
  }

  _ensurePreviewClock() {
    // Live-update clock once a minute
    if (this._previewClockTimer) return;
    this._previewClockTimer = setInterval(() => {
      const el = this.shadowRoot.querySelector('[data-pv-clock]');
      if (!el) return;
      const now = new Date();
      el.textContent = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    }, 10_000);
  }

  // ============ MENU ============
  // 3×3 grid из системных + кастомных tiles. Соответствует index.html #screen-menu.
  _pvMenu(cfg) {
    const enabled = this._enabledScreens(cfg);
    // Только включённые системные — выключенные не светятся в реальном APK
    const systemTiles = ['light','curtain','music','ac','heating','floor','convector','ventilation']
      .filter(k => enabled.includes(k));
    const customCards = Array.isArray(cfg.custom_cards) ? cfg.custom_cards : [];

    const sysHtml = systemTiles.map(key => {
      const m = SCREEN_META[key];
      return `
        <div class="tl" data-pv-action="nav-to" data-target="${key}">
          <div class="tl-icon"><ha-icon icon="${m.icon}"></ha-icon></div>
          <div class="lb">${esc(m.ru)}</div>
        </div>`;
    }).join('');

    const customHtml = customCards.map(card => {
      const label = card.label?.ru || card.id;
      const icon = card.icon || 'mdi:card-text-outline';
      return `
        <div class="tl tl-custom" data-pv-action="custom-card" data-card-id="${esc(card.id)}"
             title="${esc(card.action?.type || '')}">
          <div class="tl-icon"><ha-icon icon="${esc(icon)}"></ha-icon></div>
          <div class="lb">${esc(label)}</div>
        </div>`;
    }).join('');

    // Pad до 9 ячеек чтобы grid выглядел чисто
    const total = systemTiles.length + customCards.length;
    const padCount = Math.max(0, 9 - total);
    const padHtml = '<div class="tl empty"></div>'.repeat(Math.min(padCount, 9));

    // Lock icon в правом верхнем углу (APK: short tap = lock screen, hold 4s = installer).
    // В preview — декоративная, не кликается.
    const lockBtn = `
      <div class="pv-header-btn pv-header-lock" title="Блокировка">
        <svg viewBox="0 0 32 32"><rect x="9" y="14" width="14" height="12" rx="2"/><path d="M12 14 v-3 a4 4 0 0 1 8 0 v3"/></svg>
      </div>`;
    return this._pvWrap(`
      ${this._pvHeader('Управление', { rightBtn: lockBtn })}
      <div class="pv-menu-grid">${sysHtml}${customHtml}${padHtml}</div>
    `, { cfg });
  }

  // ============ LIGHT ============
  // index.html: вертикальный list с device-row (icon+name+swatch+toggle)
  // и под ним brightness slider если включена и поддерживает.
  // Master power toggle в header — toggles ВСЕ лампы.
  _pvLight(cfg) {
    const ids = Array.isArray(cfg.entities?.lights) ? cfg.entities.lights : [];
    const anyOn = ids.some(eid => this._pvEntState(eid)?.state === 'on');
    const headerRight = ids.length
      ? this._pvHeaderPower('light-master', '', anyOn)
      : `<div class="pv-header-spacer"></div>`;
    if (!ids.length) {
      return this._pvWrap(`
        ${this._pvHeader('Свет', { rightBtn: headerRight })}
        ${this._pvEmpty('Лампы не привязаны', 'Откройте «Устройства» и выберите свет')}
      `, { cfg });
    }
    const rows = ids.map(eid => {
      const s = this._pvEntState(eid);
      if (!s) return `
        <div class="pv-light-device off">
          <div class="device-row">
            <div class="device-icon"><ha-icon icon="mdi:lightbulb-outline"></ha-icon></div>
            <div class="device-name">${esc(eid)} (недоступно)</div>
          </div>
        </div>`;
      const isOn = s.state === 'on';
      const supportsBrightness = (s.attributes.supported_color_modes || []).some(
        m => ['brightness','color_temp','hs','rgb','rgbw','rgbww','xy'].includes(m)
      ) || s.attributes.brightness !== undefined;
      const brightnessPct = isOn && s.attributes.brightness
        ? Math.max(1, Math.round((s.attributes.brightness / 255) * 100))
        : (isOn ? 100 : 0);
      const fname = s.attributes.friendly_name || eid;
      const supportsColor = (s.attributes.supported_color_modes || []).some(
        m => ['hs','rgb','rgbw','rgbww','xy'].includes(m)
      );
      const rgb = s.attributes.rgb_color;
      const swatch = rgb ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : '#fff5e0';
      return `
        <div class="pv-light-device ${isOn?'':'off'}">
          <div class="device-row" data-pv-action="light-toggle" data-entity="${esc(eid)}">
            <div class="device-icon">
              <ha-icon icon="${isOn?'mdi:lightbulb-on':'mdi:lightbulb-outline'}"></ha-icon>
            </div>
            <div class="device-name">${esc(fname)}</div>
            ${supportsColor ? `<div class="color-swatch" style="background:${swatch};"></div>` : ''}
            <div class="pv-toggle-sm ${isOn?'on':''}">
              <div class="thumb"></div>
            </div>
          </div>
          ${supportsBrightness && isOn ? `
            <div class="brightness">
              <div class="brightness-label">Яркость · ${brightnessPct}%</div>
              <div class="light-slider" data-pv-action="light-brightness" data-entity="${esc(eid)}">
                <div class="track-bg"></div>
                <div class="track-fill" style="width:${brightnessPct}%"></div>
                <div class="percent" style="left:${brightnessPct}%">${brightnessPct}%</div>
                <div class="handle" style="left:${brightnessPct}%"></div>
              </div>
            </div>
          ` : ''}
        </div>`;
    }).join('');
    const onCount = ids.filter(eid => this._pvEntState(eid)?.state === 'on').length;
    const statusText = onCount === 0 ? 'Все выключены'
      : onCount === ids.length ? 'Все включены'
      : `Включено ${onCount} из ${ids.length}`;

    return this._pvWrap(`
      ${this._pvHeader('Свет', { rightBtn: headerRight })}
      <div class="pv-list">
        <div class="pv-status-label">
          <span class="dot ${onCount > 0 ? 'on' : ''}"></span>${esc(statusText)}
        </div>
        ${rows}
      </div>
    `, { cfg });
  }

  // ============ CURTAIN ============
  // index.html #screen-curtain: каждый device с slider-track и Open/Close/50% кнопками.
  _pvCurtain(cfg) {
    const ids = Array.isArray(cfg.entities?.curtains) ? cfg.entities.curtains : [];
    const anyOpen = ids.some(eid => {
      const st = this._pvEntState(eid);
      const p = st?.attributes?.current_position;
      return (typeof p === 'number' ? p > 5 : st?.state === 'open');
    });
    const headerRight = ids.length
      ? this._pvHeaderPower('curtain-master', '', anyOpen)
      : `<div class="pv-header-spacer"></div>`;
    if (!ids.length) {
      return this._pvWrap(`
        ${this._pvHeader('Шторы', { rightBtn: headerRight })}
        ${this._pvEmpty('Шторы не привязаны', 'Откройте «Устройства» и добавьте cover.*')}
      `, { cfg });
    }
    // APK layout (CurtainScreen.kt): НЕ slider — а 5 preset pills (0/25/50/75/100%) +
    // 2 крупные кнопки Открыть/Закрыть half/half.
    const blocks = ids.map(eid => {
      const s = this._pvEntState(eid);
      const fname = s?.attributes?.friendly_name || eid;
      const pos = s?.attributes?.current_position;
      const posVal = typeof pos === 'number' ? pos : (s?.state === 'open' ? 100 : 0);
      const offline = !s;
      const stateText = offline ? '—'
        : s?.state === 'open' ? 'Открыто'
        : s?.state === 'closed' ? 'Закрыто'
        : s?.state === 'opening' ? 'Открывается…'
        : s?.state === 'closing' ? 'Закрывается…'
        : s?.state;
      const isOpen = !offline && (s?.state === 'open' || s?.state === 'opening');
      const isClosed = !offline && (s?.state === 'closed' || s?.state === 'closing');
      const presets = [0, 25, 50, 75, 100];
      const presetsHtml = presets.map(pct => `
        <button class="pv-curtain-preset ${posVal >= pct - 12 && posVal <= pct + 12 ? 'active' : ''}"
                data-pv-action="curtain-set" data-entity="${esc(eid)}" data-pos="${pct}">${pct}%</button>
      `).join('');
      return `
        <div class="pv-curtain-device ${offline?'off':''}">
          <div class="head">
            <ha-icon icon="mdi:curtains"></ha-icon>
            <span class="nm">${esc(fname)}</span>
            <span class="pct">${offline ? '—' : posVal + '% · ' + stateText}</span>
          </div>
          <div class="preset-row">${presetsHtml}</div>
          <div class="btn-row">
            <button class="btn ${isOpen ? 'active' : ''}"
                    data-pv-action="curtain-set" data-entity="${esc(eid)}" data-pos="100">Открыть</button>
            <button class="btn ${isClosed ? 'active' : ''}"
                    data-pv-action="curtain-set" data-entity="${esc(eid)}" data-pos="0">Закрыть</button>
          </div>
        </div>`;
    }).join('');
    return this._pvWrap(`
      ${this._pvHeader('Шторы', { rightBtn: headerRight })}
      <div class="pv-list">${blocks}</div>
    `, { cfg });
  }

  // ============ CLIMATE (ac/heating/floor/convector) ============
  // 1-в-1 с APK: большая центральная температура «23°» / «сейчас»,
  // затем 4 vertical pill-row сценарии (Турбо / Комфорт / Эко / Ручной).
  // Каждый row = icon слева + название + сабтайтл + target temp справа.
  _pvClimate(cfg, screen) {
    const bindKeyMap = { ac: 'acs', heating: 'heatings', floor: 'floors', convector: 'convectors' };
    const tempKeyMap = {
      ac: 'acs_current_temp', heating: 'heatings_current_temp',
      floor: 'floors_current_temp', convector: 'convectors_current_temp',
    };
    const ids = Array.isArray(cfg.entities?.[bindKeyMap[screen]]) ? cfg.entities[bindKeyMap[screen]] : [];
    const meta = SCREEN_META[screen];

    // Power-on state — на основе первого климат-entity
    const firstSt = ids.length ? this._pvEntState(ids[0]) : null;
    const isOff = !firstSt || firstSt.state === 'off' || firstSt.state === 'unavailable';
    const headerRight = ids.length
      ? this._pvHeaderPower(`climate-power`, ids[0], !isOff)
      : `<div class="pv-header-spacer"></div>`;

    if (!ids.length) {
      return this._pvWrap(`
        ${this._pvHeader(meta.ru, { rightBtn: headerRight })}
        ${this._pvEmpty('Не привязано', `Выберите термостаты в «Устройства → ${meta.ru}»`)}
      `, { cfg, climate: screen });
    }

    // Current temp (для большого «23°» по центру). Берём из current_temp_sensor
    // или из attributes.current_temperature первого климата.
    const tempEid = cfg.entities?.[tempKeyMap[screen]];
    let curTemp = null;
    if (tempEid) {
      const ts = this._pvEntState(tempEid);
      if (ts && ts.state !== 'unavailable' && ts.state !== 'unknown') curTemp = parseFloat(ts.state);
    }
    if (curTemp === null && firstSt?.attributes?.current_temperature !== undefined) {
      curTemp = parseFloat(firstSt.attributes.current_temperature);
    }
    if (curTemp === null || isNaN(curTemp)) curTemp = 23;
    const curStr = Math.round(curTemp);
    const target = firstSt?.attributes?.temperature ?? 22;

    // Сцены — по 4 row vertical (Турбо / Комфорт / Эко / Ручной) — 1-в-1 с APK.
    // Subtitles per-screen (см. ClimateMoodScreen.kt) — отличаются для AC vs heating
    // потому что физика разная (охлаждение vs нагрев).
    //
    // Иконки: APK использует ic_mode_cool / ic_mode_fire / ic_mode_dry / ic_mode_auto /
    // ic_set_clock. Соответствие MDI: snowflake (cool) / fire (heat) / leaf (eco) /
    // alpha-a-circle (комфорт=auto) / timer-outline (ручной).
    //
    // ВАЖНО: t / mode берутся из cfg.climate_presets[screen][scene] если задано,
    // иначе из CLIMATE_PRESET_DEFAULTS. Preview обновляется live при правке в UI.
    const SUBS_BY_SCREEN = {
      ac: { turbo: 'быстрое охлаждение', comfort: 'повседневный режим', eco: 'экономия энергии' },
      heating: { turbo: 'быстрый прогрев', comfort: 'повседневный режим', eco: 'никого дома' },
      floor: { turbo: 'тёплая поверхность', comfort: 'повседневный режим', eco: 'стяжка не остынет' },
      convector: { turbo: 'быстрый догрев', comfort: 'тихий режим', eco: 'экономия, frost-guard' },
    };
    const ICON_BY_SCENE = {
      turbo:   { ac: 'mdi:snowflake', _default: 'mdi:fire' },
      comfort: { _default: 'mdi:alpha-a-circle-outline' },
      eco:     { _default: 'mdi:leaf' },
    };
    const eff = this._effectiveClimatePresets(screen, cfg);
    const subs = SUBS_BY_SCREEN[screen] || SUBS_BY_SCREEN.ac;
    const SCENES = ['turbo', 'comfort', 'eco'].map(k => {
      const p = eff[k] || {};
      const iconMap = ICON_BY_SCENE[k] || {};
      return {
        key: k,
        lbl: k === 'turbo' ? 'Турбо' : k === 'comfort' ? 'Комфорт' : 'Эко',
        sub: subs[k] || '',
        t: p.target ?? 22,
        mode: p.hvac_mode || 'auto',
        icon: iconMap[screen] || iconMap._default,
      };
    });
    // Active scene detection: совпадает по target temp ±0.5° (mode не проверяем —
    // в реальном APK active state хранится отдельно в App.state.climateActiveScenes,
    // но preview без state так что fallback на target match).
    const targetNum = parseFloat(target);
    const activeScene = !isOff && !isNaN(targetNum)
      ? (SCENES.find(sc => Math.abs(targetNum - sc.t) < 0.5)?.key || null)
      : null;
    // Manual active = ни одна сцена не подошла (либо OFF).
    const manualActive = !isOff && activeScene === null;
    const manualTarget = !isNaN(targetNum) ? Math.round(targetNum) : null;

    // Smart context line под «сейчас»: «Прогрев до 25° · ≈20 мин» / «Охлаждение до 18° · ≈45 мин» /
    // «Поддерживает 21°» (из ClimateMoodScreen.kt:240-281).
    let contextHtml = '';
    if (!isOff && !isNaN(targetNum)) {
      const delta = targetNum - curTemp;
      const absDelta = Math.abs(delta);
      let txt;
      let active = false;
      if (absDelta < 0.5) {
        txt = `Поддерживает ${Math.round(targetNum)}°`;
      } else if (delta > 0) {
        // Нагрев — 8 мин/град (APK ClimateMoodScreen.kt:251)
        const mins = Math.max(1, Math.min(120, Math.round(absDelta * 8)));
        txt = `Прогрев до ${Math.round(targetNum)}° · ≈${mins} мин`;
        active = true;
      } else {
        // Охлаждение — 10 мин/град (APK :255)
        const mins = Math.max(1, Math.min(120, Math.round(absDelta * 10)));
        txt = `Охлаждение до ${Math.round(targetNum)}° · ≈${mins} мин`;
        active = true;
      }
      contextHtml = `
        <div class="pv-climate-context">
          <span class="dot ${active ? 'pulse' : ''}"></span>
          <span class="txt">${esc(txt)}</span>
        </div>`;
    }

    const scenesHtml = SCENES.map(sc => `
      <button class="pv-climate-scene ${activeScene === sc.key ? 'active' : ''} ${isOff?'disabled':''}"
              data-pv-action="climate-scene" data-entity="${esc(ids[0])}"
              data-temp="${sc.t}" data-mode="${sc.mode}">
        <div class="ico"><ha-icon icon="${sc.icon}"></ha-icon></div>
        <div class="txt">
          <div class="nm">${esc(sc.lbl)}</div>
          ${sc.sub ? `<div class="sub">${esc(sc.sub)}</div>` : ''}
        </div>
        <div class="t">${Number.isInteger(sc.t) ? sc.t : sc.t.toFixed(1)}°</div>
      </button>
    `).join('');
    // «Ручной» row — отдельный (APK ManualPill), показывает текущий target когда active.
    const manualHtml = `
      <button class="pv-climate-scene pv-climate-manual ${manualActive?'active':''} ${isOff?'disabled':''}"
              data-pv-action="climate-manual" data-entity="${esc(ids[0])}">
        <div class="ico"><ha-icon icon="mdi:timer-outline"></ha-icon></div>
        <div class="txt"><div class="nm">Ручной</div></div>
        ${manualActive && manualTarget !== null
          ? `<div class="t">${manualTarget}°<span class="manual-dot"></span></div>`
          : `<div class="t">›</div>`}
      </button>`;

    return this._pvWrap(`
      ${this._pvHeader(meta.ru, { rightBtn: headerRight })}
      <div class="pv-climate-cur ${isOff?'disabled':''}">
        <div class="big">${curStr}<span class="deg">°</span></div>
        <div class="lbl">сейчас</div>
        ${contextHtml}
      </div>
      <div class="pv-climate-scenes">${scenesHtml}${manualHtml}</div>
    `, { cfg, climate: screen });
  }

  // ============ VENTILATION ============
  // Air quality CO₂ display + 2×2 fan speed grid (после VENT-FIXES в APK).
  _pvVentilation(cfg) {
    const fanIds = Array.isArray(cfg.entities?.ventilation_fans) ? cfg.entities.ventilation_fans : [];
    const firstFan = fanIds.length ? this._pvEntState(fanIds[0]) : null;
    const fanOn = firstFan && firstFan.state !== 'off' && firstFan.state !== 'unavailable';
    const headerRight = fanIds.length
      ? this._pvHeaderPower('vent-power', fanIds[0], fanOn)
      : `<div class="pv-header-spacer"></div>`;

    if (!fanIds.length) {
      return this._pvWrap(`
        ${this._pvHeader('Вентиляция', { rightBtn: headerRight })}
        ${this._pvEmpty('Вентиляторы не привязаны', '«Устройства» → Вентиляция')}
      `, { cfg });
    }

    // APK VentScreen.kt: маленький «Качество воздуха» (13sp grey), большой статус
    // (28sp Light, цвет по уровню), под ним «CO₂ 850 ppm» (14sp 55% white).
    const co2Eid = cfg.entities?.co2_sensor;
    const co2State = co2Eid ? this._pvEntState(co2Eid) : null;
    const co2Val = co2State && co2State.state !== 'unavailable' && co2State.state !== 'unknown'
      ? Math.round(parseFloat(co2State.state)) : 850;
    // Пороги из VentScreen.kt:81-85: <800 свежий / <1200 душновато / >=1200 откройте окно
    const co2Cls = co2Val < 800 ? 'good' : co2Val < 1200 ? 'moderate' : 'poor';
    const co2Status = co2Val < 800 ? 'Воздух свежий' : co2Val < 1200 ? 'Душновато' : 'Откройте окно';

    // 2×2 fan grid — APK labels: Мин / Средняя / Макс / Авто (VentScreen.kt:215-224).
    // Иконки из APK drawable: ic_mode_dry (Мин) / ic_nav_ventilation (Средняя) /
    // ic_mode_fan (Макс) / ic_mode_auto (Авто=буква A) — соответствие MDI ниже.
    const eid = fanIds[0];
    const preset = firstFan?.attributes?.preset_mode;
    const curPct = firstFan?.attributes?.percentage ?? (fanOn ? 50 : 0);
    let activeSpeed;
    if (!fanOn) activeSpeed = null;
    else if ((preset || '').toLowerCase() === 'auto') activeSpeed = 'auto';
    else if (curPct <= 40) activeSpeed = 'low';
    else if (curPct <= 75) activeSpeed = 'mid';
    else activeSpeed = 'high';
    const speeds = [
      { key: 'low',  pct: 33,  lbl: 'Мин',     icon: 'mdi:water-outline' },
      { key: 'mid',  pct: 66,  lbl: 'Средняя', icon: 'mdi:air-filter' },
      { key: 'high', pct: 100, lbl: 'Макс',    icon: 'mdi:fan' },
      { key: 'auto', pct: null, lbl: 'Авто',   icon: 'mdi:alpha-a-circle-outline' },
    ];
    const speedsHtml = speeds.map(s => `
      <button class="pv-vent-tile ${activeSpeed === s.key ? 'active' : ''}"
              data-pv-action="vent-speed" data-entity="${esc(eid)}"
              data-pct="${s.pct === null ? '' : s.pct}" data-preset="${s.key === 'auto' ? 'auto' : ''}">
        <div class="ico"><ha-icon icon="${s.icon}"></ha-icon></div>
        <div class="lbl">${esc(s.lbl)}</div>
      </button>`).join('');

    return this._pvWrap(`
      ${this._pvHeader('Вентиляция', { rightBtn: headerRight })}
      <div class="pv-vent-quality">
        <div class="label">Качество воздуха</div>
        <div class="status-big ${co2Cls}">${esc(co2Status)}</div>
        <div class="co2-line">CO₂ ${co2Val} ppm</div>
      </div>
      <div class="pv-vent-fan">
        <div class="label">Скорость</div>
        <div class="grid">${speedsHtml}</div>
      </div>
    `, { cfg });
  }

  // ============ EVENT WIRING ============
  _wirePreviewEvents(panel, cfg) {
    const pane = this.shadowRoot.getElementById('preview-pane');
    if (!pane) return;
    const $$ = (sel) => pane.querySelectorAll(sel);

    // Screen picker (top of pane) — навешиваем ОДИН раз при полном рендере pane.
    // Дальше state-changes hass идут через _softRefreshPreview() который не
    // трогает HTML picker'а — значит и handler не теряется.
    $$('[data-pv-screen]').forEach(el => {
      el.onclick = () => {
        if (el.classList.contains('disabled')) {
          this._toast('Экран выключен — включите его в «Экраны»', 'warn', { duration: 2200 });
          return;
        }
        // Меняем _previewScreen МГНОВЕННО, без debounce. Soft refresh
        // обновляет body + active-class на picker — это дёшево.
        this._previewScreen = el.dataset.pvScreen;
        this._softRefreshPreview();
      };
    });

    // События внутри body (home-nav, menu tiles, кнопки экранов и т.д.).
    this._wirePreviewBodyEvents(panel, cfg);
  }

  // Все события которые внутри .preview-body. Вынесено отдельно, потому что
  // soft refresh пере-рендерит только body и должен перепривязать только эти.
  _wirePreviewBodyEvents(panel, cfg) {
    const pane = this.shadowRoot.getElementById('preview-pane');
    if (!pane) return;
    const body = pane.querySelector('.preview-body');
    if (!body) return;
    const $$ = (sel) => body.querySelectorAll(sel);

    // Nav inside preview (home-nav + menu tiles + back button)
    $$('[data-pv-action="nav-home"]').forEach(el => {
      el.onclick = () => {
        this._previewScreen = 'home';
        this._softRefreshPreview();
      };
    });
    $$('[data-pv-action="nav-to"]').forEach(el => {
      el.onclick = () => {
        const tgt = el.dataset.target;
        const enabled = this._enabledScreens(cfg);
        if (tgt !== 'menu' && !enabled.includes(tgt)) {
          this._toast(`Экран «${SCREEN_META[tgt]?.ru || tgt}» выключен`, 'warn', { duration: 2200 });
          return;
        }
        this._previewScreen = tgt;
        this._softRefreshPreview();
      };
    });

    // ---- Custom card actions in Menu preview ----
    $$('[data-pv-action="custom-card"]').forEach(el => {
      el.onclick = () => {
        const cid = el.dataset.cardId;
        const card = (cfg.custom_cards || []).find(c => c.id === cid);
        if (!card) return;
        this._runCustomCardAction(card);
      };
    });

    // ---- Light toggle ----
    $$('[data-pv-action="light-toggle"]').forEach(el => {
      el.onclick = () => {
        const eid = el.dataset.entity;
        const cur = this._pvEntState(eid);
        const newState = cur && cur.state === 'on' ? 'off' : 'on';
        this._pvSetPending(eid, newState);
        this._pvCallService('light', 'toggle', { entity_id: eid });
      };
    });

    // ---- Light brightness slider (click on track sets % directly) ----
    $$('[data-pv-action="light-brightness"]').forEach(el => {
      el.onclick = (e) => {
        const rect = el.getBoundingClientRect();
        const pct = Math.max(1, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
        const eid = el.dataset.entity;
        this._pvSetPending(eid, 'on', { brightness: Math.round((pct / 100) * 255) });
        this._pvCallService('light', 'turn_on', { entity_id: eid, brightness_pct: pct });
      };
    });

    // ---- Curtain set position ----
    $$('[data-pv-action="curtain-set"]').forEach(el => {
      el.onclick = () => {
        const eid = el.dataset.entity;
        const pos = parseInt(el.dataset.pos, 10);
        this._pvSetPending(eid, pos === 0 ? 'closed' : 'open', { current_position: pos });
        if (pos === 0) this._pvCallService('cover', 'close_cover', { entity_id: eid });
        else if (pos === 100) this._pvCallService('cover', 'open_cover', { entity_id: eid });
        else this._pvCallService('cover', 'set_cover_position', { entity_id: eid, position: pos });
      };
    });

    // ---- Climate scene ----
    $$('[data-pv-action="climate-scene"]').forEach(el => {
      el.onclick = async () => {
        const eid = el.dataset.entity;
        const t = parseFloat(el.dataset.temp);
        const mode = el.dataset.mode;
        this._pvSetPending(eid, mode, { temperature: t });
        try {
          // Set mode first, then temperature (some climate entities reject set_temp when off)
          await this._hass.callService('climate', 'set_hvac_mode', { entity_id: eid, hvac_mode: mode });
          await this._hass.callService('climate', 'set_temperature', { entity_id: eid, temperature: t });
          this._toast(`Сцена применена: ${t}° / ${mode}`, 'success', { duration: 1800 });
        } catch (err) {
          this._toast('Ошибка: ' + (err.message || err), 'error');
        }
      };
    });

    // ---- Fan / ventilation speed (Мин/Средняя/Макс/Авто) ----
    $$('[data-pv-action="vent-speed"]').forEach(el => {
      el.onclick = () => {
        const eid = el.dataset.entity;
        const preset = el.dataset.preset;
        if (preset === 'auto') {
          this._pvSetPending(eid, 'on', { preset_mode: 'auto' });
          this._pvCallService('fan', 'set_preset_mode', { entity_id: eid, preset_mode: 'auto' });
          return;
        }
        const pct = parseInt(el.dataset.pct, 10);
        this._pvSetPending(eid, pct === 0 ? 'off' : 'on', { percentage: pct });
        if (pct === 0) this._pvCallService('fan', 'turn_off', { entity_id: eid });
        else this._pvCallService('fan', 'turn_on', { entity_id: eid, percentage: pct });
      };
    });

    // ---- Climate manual (Ручной pill) — в preview только toast, real APK
    // открывает ManualDialog. В preview мы не имеем dialog overlay. ----
    $$('[data-pv-action="climate-manual"]').forEach(el => {
      el.onclick = () => {
        this._toast('Ручной режим — настройка через APK', 'info', { duration: 1800 });
      };
    });

    // ---- Light master toggle (header power button) ----
    $$('[data-pv-action="light-master"]').forEach(el => {
      el.onclick = () => {
        const ids = Array.isArray(cfg.entities?.lights) ? cfg.entities.lights : [];
        if (!ids.length) return;
        const anyOn = ids.some(e => this._pvEntState(e)?.state === 'on');
        const target = anyOn ? 'off' : 'on';
        ids.forEach(e => this._pvSetPending(e, target));
        this._pvCallService('light', anyOn ? 'turn_off' : 'turn_on', { entity_id: ids });
      };
    });

    // ---- Curtain master toggle ----
    $$('[data-pv-action="curtain-master"]').forEach(el => {
      el.onclick = () => {
        const ids = Array.isArray(cfg.entities?.curtains) ? cfg.entities.curtains : [];
        if (!ids.length) return;
        const anyOpen = ids.some(e => {
          const st = this._pvEntState(e);
          const p = st?.attributes?.current_position;
          return (typeof p === 'number' ? p > 5 : st?.state === 'open');
        });
        ids.forEach(e => this._pvSetPending(
          e, anyOpen ? 'closed' : 'open', { current_position: anyOpen ? 0 : 100 }
        ));
        this._pvCallService('cover', anyOpen ? 'close_cover' : 'open_cover', { entity_id: ids });
      };
    });

    // ---- Climate power toggle (header) ----
    $$('[data-pv-action="climate-power"]').forEach(el => {
      el.onclick = () => {
        const eid = el.dataset.entity;
        if (!eid) return;
        const s = this._pvEntState(eid);
        const isOff = !s || s.state === 'off';
        const newMode = isOff ? (this._previewScreen === 'ac' ? 'cool' : 'heat') : 'off';
        this._pvSetPending(eid, newMode);
        this._pvCallService('climate', 'set_hvac_mode',
          { entity_id: eid, hvac_mode: newMode });
      };
    });

    // ---- Climate temp ± ----
    $$('[data-pv-action="climate-temp"]').forEach(el => {
      el.onclick = () => {
        const eid = el.dataset.entity;
        const delta = parseInt(el.dataset.delta, 10);
        const s = this._pvEntState(eid);
        const cur = s?.attributes?.temperature ?? 22;
        const newT = Math.max(10, Math.min(35, cur + delta));
        this._pvSetPending(eid, s?.state || 'heat', { temperature: newT });
        this._pvCallService('climate', 'set_temperature',
          { entity_id: eid, temperature: newT });
      };
    });

    // ---- Climate fan mode ----
    $$('[data-pv-action="climate-fan"]').forEach(el => {
      el.onclick = () => {
        const eid = el.dataset.entity;
        const fan = el.dataset.fan;
        const s = this._pvEntState(eid);
        this._pvSetPending(eid, s?.state || 'heat', { fan_mode: fan });
        this._pvCallService('climate', 'set_fan_mode',
          { entity_id: eid, fan_mode: fan });
      };
    });

    // ---- Vent power (header) ----
    $$('[data-pv-action="vent-power"]').forEach(el => {
      el.onclick = () => {
        const eid = el.dataset.entity;
        if (!eid) return;
        const s = this._pvEntState(eid);
        const isOn = s && s.state !== 'off' && s.state !== 'unavailable';
        this._pvSetPending(eid, isOn ? 'off' : 'on');
        this._pvCallService('fan', isOn ? 'turn_off' : 'turn_on', { entity_id: eid });
      };
    });
  }

  _pvCallService(domain, service, data) {
    if (!this._hass) return;
    this._hass.callService(domain, service, data)
      .then(() => {
        // Subtle confirmation — could become annoying; only show on errors.
      })
      .catch(err => {
        this._toast(`Ошибка ${domain}.${service}: ${err.message || err}`, 'error', { duration: 3500 });
        // Roll back pending on error
        if (data.entity_id) this._previewPending.delete(data.entity_id);
        this._softRefreshPreview();
      });
  }

  // ========== CUSTOM CARD ACTION DISPATCH ==========
  // Вызывается при клике на custom card в превью Menu. Реальный side-effect в HA.
  _runCustomCardAction(card) {
    if (!this._hass) return;
    const action = card.action || {};
    const label = card.label?.ru || card.id;
    try {
      if (action.type === 'service') {
        const [dom, svc] = (action.service || '').split('.');
        if (!dom || !svc) {
          this._toast(`Карточка «${label}»: сервис не задан`, 'error', { duration: 2200 });
          return;
        }
        this._hass.callService(dom, svc, action.data || {})
          .then(() => this._toast(`Запущено: ${label}`, 'success', { duration: 1500 }))
          .catch(e => this._toast(`Ошибка ${dom}.${svc}: ${e.message || e}`, 'error', { duration: 3500 }));
      } else if (action.type === 'toggle') {
        const eid = action.entity_id;
        if (!eid) {
          this._toast(`Карточка «${label}»: устройство не выбрано`, 'error', { duration: 2200 });
          return;
        }
        const dom = eid.split('.')[0];
        // homeassistant.toggle работает для большинства доменов
        this._hass.callService('homeassistant', 'toggle', { entity_id: eid })
          .then(() => this._toast(`${label}: toggle`, 'success', { duration: 1500 }))
          .catch(e => this._toast(`Ошибка toggle: ${e.message || e}`, 'error', { duration: 3500 }));
      } else if (action.type === 'entity') {
        const eid = action.entity_id;
        if (!eid) {
          this._toast(`Карточка «${label}»: устройство не выбрано`, 'error', { duration: 2200 });
          return;
        }
        // Открываем стандартный HA more-info dialog. На устройстве это будет
        // bottom-sheet с управлением entity.
        this.dispatchEvent(new CustomEvent('hass-more-info', {
          detail: { entityId: eid },
          bubbles: true,
          composed: true,
        }));
      } else if (action.type === 'dashboard') {
        const url = action.url;
        if (!url) {
          this._toast(`Карточка «${label}»: URL не задан`, 'error', { duration: 2200 });
          return;
        }
        // В превью просто покажем toast — реальный переход делается в APK.
        // Если URL начинается с / — это HA-локальный путь.
        this._toast(`Открыть: ${url}`, 'info', { duration: 2500 });
      }
    } catch (err) {
      this._toast(`Ошибка действия: ${err.message || err}`, 'error', { duration: 3500 });
    }
  }
}

customElements.define('bms-panel-editor', BMSPanelEditor);

console.info('%c BMS-PANEL %c 2.1.1 — custom cards + preview fix ',
  'color:#fff;background:#3a5bff;padding:2px 6px;border-radius:3px 0 0 3px',
  'color:#3a5bff;background:#f0f4ff;padding:2px 6px;border-radius:0 3px 3px 0');
