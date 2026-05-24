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
  ac:          { icon: 'mdi:air-conditioner',    ru: 'Кондиционер',  en: 'AC',          hint: 'Кондиционеры (cool/heat)' },
  heating:     { icon: 'mdi:radiator',           ru: 'Радиаторы',    en: 'Heating',     hint: 'Радиаторы отопления' },
  floor:       { icon: 'mdi:heating-coil',       ru: 'Тёплый пол',   en: 'Floor heat',  hint: 'Электрический/водяной тёплый пол' },
  convector:   { icon: 'mdi:radiator-disabled',  ru: 'Конвектор',    en: 'Convector',   hint: 'Конвекторы с вентилятором' },
  ventilation: { icon: 'mdi:fan',                ru: 'Вентиляция',   en: 'Ventilation', hint: 'Приточная вентиляция, CO₂' },
};

const HOME_NAV_OPTIONS = ['light','curtain','menu','music','ac','heating','ventilation'];

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
      { key: 'acs',            label: 'Термостаты AC' },
      { key: 'ac_temp_sensor', label: 'Отдельный сенсор температуры (опц.)' },
      { key: 'ac_fan',         label: 'Отдельный вентилятор (опц.)' },
    ] },
  { key: 'heating',     title: 'Радиаторы',      icon: 'mdi:radiator',          screen: 'heating',
    binds: [
      { key: 'heatings',           label: 'Термостаты радиаторов' },
      { key: 'heating_temp_sensor', label: 'Отдельный сенсор температуры (опц.)' },
    ] },
  { key: 'floor',       title: 'Тёплый пол',     icon: 'mdi:heating-coil',      screen: 'floor',
    binds: [
      { key: 'floors',            label: 'Термостаты тёплого пола' },
      { key: 'floor_temp_sensor', label: 'Отдельный сенсор температуры (опц.)' },
    ] },
  { key: 'convector',   title: 'Конвектор',      icon: 'mdi:radiator-disabled', screen: 'convector',
    binds: [
      { key: 'convectors',            label: 'Термостаты конвекторов' },
      { key: 'convector_temp_sensor', label: 'Отдельный сенсор температуры (опц.)' },
      { key: 'convector_fan',         label: 'Отдельный вентилятор (опц.)' },
    ] },
  { key: 'ventilation', title: 'Вентиляция',     icon: 'mdi:fan',               screen: 'ventilation',
    binds: [
      { key: 'ventilation_fans', label: 'Вентиляторы (приточные, вытяжные)' },
      { key: 'co2_sensor',       label: 'CO₂-сенсор (опц.)' },
    ] },
];

// Три таба — Обзор / Экраны / Устройства. «Главный экран» (нижние 5 иконок)
// объединён со списком экранов, потому что семантически это та же навигация.
const TABS = [
  { key: 'overview', icon: 'mdi:view-dashboard-outline', label: 'Обзор' },
  { key: 'screens',  icon: 'mdi:view-grid-outline',     label: 'Экраны' },
  { key: 'devices',  icon: 'mdi:devices',               label: 'Устройства' },
];

// ---------- Стили ----------

const STYLES = `
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
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) {
      this._renderShell();
    }
    this._refresh();
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
      </div>
      <div id="modal-root"></div>
      <div id="toast-root"></div>
    `;
    this.shadowRoot.getElementById('btn-help').onclick = () => this._showHelp();
  }

  // ---------- Получение всех панелей из hass.states ----------

  _allPanels() {
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

  _extractConfig(attrs) {
    return {
      screens:        attrs.screens || {},
      home_nav:       attrs.home_nav || ['light','curtain','menu','music','ac'],
      background_dim: attrs.background_dim ?? 30,
      screen_timeout: attrs.screen_timeout ?? 30,
      language:       attrs.language || 'Русский',
      entities:       attrs.entities || {},
      area_id:        attrs.area_id || null,
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
      <div class="tabs">${tabsHtml}</div>
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
    content.querySelectorAll('.tab').forEach(t => {
      t.onclick = () => {
        this._activeTab = t.dataset.tab;
        this._renderContent();
        this._renderTopBar();
      };
    });

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

        return `
          <div class="bind-group ${groupClass}">
            <div class="bind-group-head">
              <ha-icon icon="${group.icon}"></ha-icon>
              <div class="bind-group-title">${group.title}</div>
            </div>
            ${group.binds.map(b => this._renderBind(b, cfg.entities, issues)).join('')}
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
            setTimeout(() => {
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
            setTimeout(() => {
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
    this._hass.callService('bms_panel', 'update_config', {
      panel_id: panel.panel_id,
      config: cfg,
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
}

customElements.define('bms-panel-editor', BMSPanelEditor);

console.info('%c BMS-PANEL %c 2.0.0 — modular ',
  'color:#fff;background:#3a5bff;padding:2px 6px;border-radius:3px 0 0 3px',
  'color:#3a5bff;background:#f0f4ff;padding:2px 6px;border-radius:0 3px 3px 0');
