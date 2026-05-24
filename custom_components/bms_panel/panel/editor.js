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

/* ============ LIVE PREVIEW PANE ============ */
.preview-pane {
  width: 520px;
  flex-shrink: 0;
  background: var(--card-background-color);
  border-left: 1px solid var(--divider-color);
  padding: 16px;
  position: sticky;
  top: 56px;
  height: calc(100vh - 56px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.preview-pane.collapsed { width: 56px; padding: 16px 0; align-items: center; }
.preview-pane.collapsed .preview-body,
.preview-pane.collapsed .preview-head-title,
.preview-pane.collapsed .preview-screen-picker { display: none; }
.preview-head {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;
  color: var(--secondary-text-color);
}
.preview-head .preview-head-title { flex: 1; }
.preview-head .icon-btn { padding: 4px; border-radius: 6px; cursor: pointer; }
.preview-head .icon-btn:hover { background: var(--secondary-background-color); }
.preview-screen-picker {
  display: flex; gap: 4px; flex-wrap: wrap; padding: 4px 0;
}
.preview-screen-picker .ps-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 8px; font-size: 11px;
  background: var(--secondary-background-color);
  border: 1px solid var(--divider-color);
  border-radius: 12px; cursor: pointer;
  color: var(--secondary-text-color);
}
.preview-screen-picker .ps-btn ha-icon { --mdc-icon-size: 14px; pointer-events: none; }
.preview-screen-picker .ps-btn span { pointer-events: none; }
.preview-screen-picker .ps-btn.active {
  background: var(--primary-color);
  color: white; border-color: var(--primary-color);
}
.preview-screen-picker .ps-btn.disabled { opacity: 0.4; cursor: not-allowed; }

/* The 480x480 panel mockup */
.pv-panel {
  width: 480px; height: 480px;
  position: relative; overflow: hidden;
  isolation: isolate;
  border-radius: 14px;
  background: linear-gradient(135deg, #2a2620 0%, #1A1612 50%, #0a0808 100%);
  box-shadow: 0 20px 50px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04);
  color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.pv-panel.scaled { transform: scale(0.95); transform-origin: top center; }
.pv-panel * { box-sizing: border-box; }
.pv-panel::before {
  content: ''; position: absolute; inset: -30px;
  background: radial-gradient(circle at 30% 20%, rgba(201,154,85,0.18), transparent 55%),
              radial-gradient(circle at 80% 90%, rgba(60,40,30,0.4), transparent 60%);
  z-index: 0;
}
.pv-panel.home-bg::before {
  background:
    linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.45) 60%, rgba(0,0,0,0.7) 100%),
    radial-gradient(ellipse at 50% 30%, rgba(201,154,85,0.25), transparent 60%),
    linear-gradient(135deg, #3a2a1a 0%, #1a1411 50%, #0a0807 100%);
}

/* Header bar (sub-screens) */
.pv-header {
  position: absolute; top: 0; left: 0; right: 0;
  height: 64px; padding: 0 20px; z-index: 5;
  display: flex; align-items: center; justify-content: space-between;
}
.pv-header-btn {
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; border-radius: 8px;
  background: rgba(255,255,255,0.06);
}
.pv-header-btn:hover { background: rgba(255,255,255,0.12); }
.pv-header-btn:active { transform: scale(0.9); }
.pv-header-title { font-size: 22px; font-weight: 500; }
.pv-header-spacer { width: 44px; }
.pv-divider {
  position: absolute; top: 64px; left: 0; right: 0;
  height: 1px; background: rgba(255,255,255,0.12); z-index: 4;
}

.pv-content {
  position: absolute; top: 64px; left: 0; right: 0; bottom: 0;
  padding: 16px 20px; z-index: 2;
  overflow-y: auto;
}

/* Home screen */
.pv-home-climate {
  position: absolute; top: 28px; left: 0; right: 0;
  display: flex; justify-content: space-around;
  z-index: 4;
}
.pv-home-climate .cli {
  display: flex; flex-direction: column; align-items: center;
}
.pv-home-climate .cli-icon { font-size: 24px; opacity: 0.85; }
.pv-home-climate .cli-val {
  font-size: 36px; font-weight: 200;
  font-variant-numeric: tabular-nums;
}
.pv-home-climate .cli-val .unit { font-size: 18px; font-weight: 300; margin-left: 2px; }
.pv-home-climate .cli-lbl { font-size: 11px; opacity: 0.6; letter-spacing: 1px; }

.pv-home-clock {
  position: absolute; top: 180px; left: 0; right: 0; text-align: center; z-index: 3;
}
.pv-home-clock .t {
  font-size: 80px; font-weight: 200;
  font-variant-numeric: tabular-nums;
  letter-spacing: 2px;
}
.pv-home-clock .d {
  font-size: 13px; opacity: 0.65;
  margin-top: 4px; letter-spacing: 0.5px;
}
.pv-home-comfort {
  position: absolute; top: 295px; left: 0; right: 0;
  text-align: center; z-index: 3;
  font-size: 12px; opacity: 0.75; padding: 0 30px;
}
.pv-home-nav {
  position: absolute; bottom: 0; left: 0; right: 0;
  height: 92px;
  display: flex; align-items: center; justify-content: space-around;
  background: linear-gradient(180deg, transparent, rgba(0,0,0,0.65));
  z-index: 4;
}
.pv-home-nav .nv {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  cursor: pointer; padding: 6px 8px; border-radius: 8px;
  min-width: 60px;
}
.pv-home-nav .nv:hover { background: rgba(255,255,255,0.06); }
.pv-home-nav .nv:active { transform: scale(0.92); opacity: 0.65; }
.pv-home-nav .nv ha-icon { --mdc-icon-size: 30px; color: rgba(255,255,255,0.95); pointer-events: none; }
.pv-home-nav .nv .lbl { font-size: 11px; opacity: 0.85; letter-spacing: 0.3px; pointer-events: none; }
.pv-menu-grid .tl ha-icon, .pv-menu-grid .tl .lb { pointer-events: none; }
.pv-vent-grid .sp, .pv-vent-grid .sp * { }
.pv-vent-grid .sp .pct { pointer-events: none; }
.pv-cur-presets .pst { user-select: none; }
.pv-climate-list .clm .scn { user-select: none; }
.pv-light-row .pv-toggle .thumb { pointer-events: none; }
.pv-light-row .pv-slider .fill, .pv-light-row .pv-slider .knob { pointer-events: none; }
.pv-header-btn ha-icon { pointer-events: none; }

/* Light screen */
.pv-light-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 4px;
  border-bottom: 1px solid rgba(255,255,255,0.07);
}
.pv-light-row .lr-icon { --mdc-icon-size: 24px; color: #C99A55; }
.pv-light-row.off .lr-icon { color: rgba(255,255,255,0.4); }
.pv-light-row .lr-name { flex: 1; font-size: 15px; }
.pv-light-row .lr-name .lr-state { font-size: 11px; opacity: 0.55; display: block; }
.pv-light-row .pv-toggle {
  width: 44px; height: 26px; border-radius: 13px;
  background: rgba(120,120,128,0.4); position: relative; cursor: pointer;
  transition: background 0.15s;
}
.pv-light-row .pv-toggle.on { background: #C99A55; }
.pv-light-row .pv-toggle .thumb {
  width: 22px; height: 22px; background: #fff; border-radius: 50%;
  position: absolute; top: 2px; left: 2px;
  transition: transform 0.15s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}
.pv-light-row .pv-toggle.on .thumb { transform: translateX(18px); }
.pv-light-row .pv-slider {
  width: 110px; height: 5px; background: rgba(255,255,255,0.18);
  border-radius: 3px; position: relative; cursor: pointer;
}
.pv-light-row .pv-slider .fill {
  position: absolute; top: 0; left: 0; bottom: 0;
  background: #C99A55; border-radius: 3px;
}
.pv-light-row .pv-slider .knob {
  width: 14px; height: 14px; background: #fff; border-radius: 50%;
  position: absolute; top: -4.5px; transform: translateX(-7px);
  box-shadow: 0 1px 3px rgba(0,0,0,0.5);
}

/* Curtain screen */
.pv-cur-block { margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.07); }
.pv-cur-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.pv-cur-head ha-icon { --mdc-icon-size: 22px; color: rgba(255,255,255,0.85); }
.pv-cur-head .nm { flex: 1; font-size: 15px; }
.pv-cur-head .pos { font-size: 12px; opacity: 0.7; font-variant-numeric: tabular-nums; }
.pv-cur-presets { display: flex; gap: 6px; flex-wrap: wrap; }
.pv-cur-presets .pst {
  flex: 1; min-width: 50px; text-align: center;
  padding: 8px 4px; font-size: 12px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px; cursor: pointer;
}
.pv-cur-presets .pst:hover { background: rgba(255,255,255,0.12); }
.pv-cur-presets .pst:active { transform: scale(0.95); }
.pv-cur-presets .pst.active { background: rgba(201,154,85,0.25); border-color: #C99A55; }

/* Climate (ac/heating/floor/convector) */
.pv-climate-head {
  text-align: center; margin-bottom: 14px;
}
.pv-climate-head .cur-t {
  font-size: 56px; font-weight: 200;
  font-variant-numeric: tabular-nums;
}
.pv-climate-head .cur-t .unit { font-size: 22px; opacity: 0.7; margin-left: 4px; }
.pv-climate-head .lbl { font-size: 11px; opacity: 0.55; letter-spacing: 1px; }
.pv-climate-list { display: flex; flex-direction: column; gap: 6px; }
.pv-climate-list .clm {
  padding: 10px 14px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  display: flex; align-items: center; gap: 10px;
  font-size: 14px;
}
.pv-climate-list .clm.off { opacity: 0.5; }
.pv-climate-list .clm .nm { flex: 1; }
.pv-climate-list .clm .scenes { display: flex; gap: 4px; }
.pv-climate-list .clm .scn {
  padding: 4px 8px; font-size: 11px; border-radius: 12px;
  background: rgba(255,255,255,0.07); cursor: pointer;
  border: 1px solid transparent;
}
.pv-climate-list .clm .scn:hover { background: rgba(255,255,255,0.14); }
.pv-climate-list .clm .scn.active { background: rgba(201,154,85,0.25); border-color: #C99A55; color: #C99A55; }
.pv-climate-list .clm .target { font-size: 13px; opacity: 0.75; font-variant-numeric: tabular-nums; min-width: 36px; text-align: right; }

/* Ventilation */
.pv-vent-co2 {
  text-align: center; margin-bottom: 16px;
  padding: 12px;
  background: rgba(255,255,255,0.05);
  border-radius: 10px;
}
.pv-vent-co2 .v { font-size: 42px; font-weight: 200; font-variant-numeric: tabular-nums; }
.pv-vent-co2 .v .unit { font-size: 14px; opacity: 0.7; margin-left: 4px; }
.pv-vent-co2 .lbl { font-size: 11px; opacity: 0.55; letter-spacing: 1px; margin-top: 2px; }
.pv-vent-co2.bad { background: rgba(244,67,54,0.15); }
.pv-vent-co2.mid { background: rgba(255,152,0,0.15); }
.pv-vent-co2.good { background: rgba(76,175,80,0.15); }
.pv-vent-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
}
.pv-vent-grid .sp {
  padding: 14px 8px; text-align: center;
  background: rgba(255,255,255,0.05);
  border: 1.5px solid rgba(255,255,255,0.08);
  border-radius: 10px; cursor: pointer;
  font-size: 13px;
}
.pv-vent-grid .sp.active { background: rgba(201,154,85,0.2); border-color: #C99A55; color: #C99A55; }
.pv-vent-grid .sp:hover { background: rgba(255,255,255,0.10); }
.pv-vent-grid .sp .pct { font-size: 22px; font-weight: 300; display: block; margin-top: 4px; }

/* Menu */
.pv-menu-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
  padding: 4px;
}
.pv-menu-grid .tl {
  aspect-ratio: 1; border-radius: 12px;
  background: rgba(20,20,22,0.55);
  border: 1px solid rgba(255,255,255,0.08);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  cursor: pointer; gap: 6px;
}
.pv-menu-grid .tl:hover { background: rgba(40,40,44,0.75); }
.pv-menu-grid .tl:active { transform: scale(0.95); }
.pv-menu-grid .tl ha-icon { --mdc-icon-size: 42px; color: #fff; }
.pv-menu-grid .tl .lb { font-size: 12px; opacity: 0.85; }
.pv-menu-grid .tl.disabled { opacity: 0.3; cursor: not-allowed; }

/* Empty hint when binding missing */
.pv-empty {
  text-align: center; padding: 40px 16px;
  color: rgba(255,255,255,0.5); font-size: 13px; line-height: 1.5;
}
.pv-empty ha-icon { --mdc-icon-size: 48px; opacity: 0.4; display: block; margin: 0 auto 12px; }
.pv-empty a { color: #C99A55; cursor: pointer; text-decoration: underline; }

.pv-pending { opacity: 0.65; pointer-events: none; }

@media (max-width: 1280px) {
  .preview-pane { width: 56px; padding: 16px 0; align-items: center; }
  .preview-pane .preview-body,
  .preview-pane .preview-head-title,
  .preview-pane .preview-screen-picker { display: none; }
  .preview-pane.expanded {
    width: 520px; padding: 16px; align-items: stretch;
  }
  .preview-pane.expanded .preview-body,
  .preview-pane.expanded .preview-head-title,
  .preview-pane.expanded .preview-screen-picker { display: revert; }
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
        <aside class="preview-pane ${this._previewExpanded ? 'expanded' : 'collapsed'}" id="preview-pane"></aside>
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
    this._renderPreviewPane();
  }

  _refreshPreviewOnly() {
    this._renderPreviewPane();
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
        <div style="flex:1;"></div>
        <div class="tab" id="btn-toggle-preview" title="Показать / скрыть превью">
          <ha-icon icon="mdi:cellphone-screenshot"></ha-icon>
          <span>Превью</span>
        </div>
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

  _pvWrap(inner, opts = {}) {
    const cls = opts.home ? 'home-bg' : '';
    return `<div class="pv-panel ${cls}">${inner}</div>`;
  }

  _pvHeader(title) {
    return `
      <div class="pv-header">
        <div class="pv-header-btn" data-pv-action="nav-home" title="На главный">
          <ha-icon icon="mdi:chevron-left" style="--mdc-icon-size:28px; color:#fff;"></ha-icon>
        </div>
        <div class="pv-header-title">${esc(title)}</div>
        <div class="pv-header-spacer"></div>
      </div>
      <div class="pv-divider"></div>`;
  }

  _pvEmpty(msg, hint = '') {
    return `
      <div class="pv-empty">
        <ha-icon icon="mdi:link-variant-off"></ha-icon>
        <div>${esc(msg)}</div>
        ${hint ? `<div style="margin-top:8px; font-size:11px; opacity:0.7;">${esc(hint)}</div>` : ''}
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
    // Trigger re-render so user sees instant feedback
    setTimeout(() => this._renderPreviewPane(), 30);
  }

  // ============ HOME ============
  _pvHome(cfg) {
    const tempEid = cfg.entities?.temp_sensor;
    const humEid = cfg.entities?.humidity_sensor;
    const tempState = tempEid ? this._pvEntState(tempEid) : null;
    const humState = humEid ? this._pvEntState(humEid) : null;
    const tempVal = tempState && tempState.state !== 'unavailable' && tempState.state !== 'unknown'
      ? Math.round(parseFloat(tempState.state)) : '–';
    const humVal = humState && humState.state !== 'unavailable' && humState.state !== 'unknown'
      ? Math.round(parseFloat(humState.state)) : '–';
    const tempUnit = tempState?.attributes?.unit_of_measurement || '°C';

    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const weekdays = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
    const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    const dateStr = `${weekdays[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]}`;

    // Comfort
    let comfortMsg = 'Все системы в норме';
    if (tempVal !== '–') {
      if (tempVal < 19) comfortMsg = 'Дома прохладно — может включить отопление?';
      else if (tempVal > 27) comfortMsg = 'Дома жарко — кондиционер?';
      else comfortMsg = 'Дома тепло и комфортно';
    }

    const nav = (cfg.home_nav || []).slice(0, 5);

    const navHtml = nav.map(key => {
      if (!key) return `<div class="nv" style="visibility:hidden;"></div>`;
      const m = SCREEN_META[key];
      const isMenu = key === 'menu';
      const icon = isMenu ? 'mdi:view-grid' : (m?.icon || 'mdi:help-circle-outline');
      const lbl = isMenu ? 'Меню' : (m?.ru || key);
      return `
        <div class="nv" data-pv-action="nav-to" data-target="${esc(key)}">
          <ha-icon icon="${icon}"></ha-icon>
          <div class="lbl">${esc(lbl)}</div>
        </div>`;
    }).join('');

    return this._pvWrap(`
      <div class="pv-home-climate">
        <div class="cli">
          <ha-icon class="cli-icon" icon="mdi:thermometer" style="--mdc-icon-size:24px; color:#fff;"></ha-icon>
          <div class="cli-val">${tempVal}<span class="unit">${esc(tempUnit)}</span></div>
          <div class="cli-lbl">ТЕМПЕРАТУРА</div>
        </div>
        <div class="cli">
          <ha-icon class="cli-icon" icon="mdi:water-percent" style="--mdc-icon-size:24px; color:#fff;"></ha-icon>
          <div class="cli-val">${humVal}<span class="unit">%</span></div>
          <div class="cli-lbl">ВЛАЖНОСТЬ</div>
        </div>
      </div>
      <div class="pv-home-clock">
        <div class="t" data-pv-clock>${hh}:${mm}</div>
        <div class="d">${dateStr}</div>
      </div>
      <div class="pv-home-comfort">${esc(comfortMsg)}</div>
      <div class="pv-home-nav">${navHtml}</div>
    `, { home: true });
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
  _pvMenu(cfg) {
    const enabled = this._enabledScreens(cfg);
    const tiles = ['light','curtain','music','ac','heating','floor','convector','ventilation','menu_dummy'];
    const grid = tiles.map(key => {
      if (key === 'menu_dummy') return `<div class="tl disabled" style="visibility:hidden;"></div>`;
      const m = SCREEN_META[key];
      const on = enabled.includes(key);
      return `
        <div class="tl ${!on?'disabled':''}" ${on?`data-pv-action="nav-to" data-target="${key}"`:''}>
          <ha-icon icon="${m.icon}"></ha-icon>
          <div class="lb">${esc(m.ru)}</div>
        </div>`;
    }).join('');
    return this._pvWrap(`
      ${this._pvHeader('Меню')}
      <div class="pv-content">
        <div class="pv-menu-grid">${grid}</div>
      </div>
    `);
  }

  // ============ LIGHT ============
  _pvLight(cfg) {
    const ids = Array.isArray(cfg.entities?.lights) ? cfg.entities.lights : [];
    if (!ids.length) {
      return this._pvWrap(`${this._pvHeader('Свет')}<div class="pv-content">${this._pvEmpty('Лампы не привязаны', 'Откройте «Устройства» и выберите свет')}</div>`);
    }
    const rows = ids.map(eid => {
      const s = this._pvEntState(eid);
      if (!s) return `<div class="pv-light-row off"><span class="lr-name">${esc(eid)} <span class="lr-state">недоступно</span></span></div>`;
      const isOn = s.state === 'on';
      const brightnessPct = isOn && s.attributes.brightness
        ? Math.round((s.attributes.brightness / 255) * 100)
        : (isOn ? 100 : 0);
      const supportsBrightness = (s.attributes.supported_color_modes || []).some(
        m => ['brightness','color_temp','hs','rgb','rgbw','rgbww','xy'].includes(m)
      ) || s.attributes.brightness !== undefined;
      const fname = s.attributes.friendly_name || eid;
      return `
        <div class="pv-light-row ${isOn?'':'off'}">
          <ha-icon class="lr-icon" icon="${isOn?'mdi:lightbulb-on':'mdi:lightbulb-outline'}"></ha-icon>
          <div class="lr-name">${esc(fname)}<span class="lr-state">${isOn ? (supportsBrightness ? brightnessPct + '%' : 'вкл') : 'выкл'}</span></div>
          ${supportsBrightness && isOn ? `
            <div class="pv-slider" data-pv-action="light-brightness" data-entity="${esc(eid)}">
              <div class="fill" style="width:${brightnessPct}%"></div>
              <div class="knob" style="left:${brightnessPct}%"></div>
            </div>
          ` : ''}
          <div class="pv-toggle ${isOn?'on':''}" data-pv-action="light-toggle" data-entity="${esc(eid)}">
            <div class="thumb"></div>
          </div>
        </div>`;
    }).join('');
    return this._pvWrap(`
      ${this._pvHeader('Свет')}
      <div class="pv-content">${rows}</div>
    `);
  }

  // ============ CURTAIN ============
  _pvCurtain(cfg) {
    const ids = Array.isArray(cfg.entities?.curtains) ? cfg.entities.curtains : [];
    if (!ids.length) {
      return this._pvWrap(`${this._pvHeader('Шторы')}<div class="pv-content">${this._pvEmpty('Шторы не привязаны','Откройте «Устройства» и добавьте cover.*')}</div>`);
    }
    const presets = [0, 25, 50, 75, 100];
    const blocks = ids.map(eid => {
      const s = this._pvEntState(eid);
      if (!s) return `<div class="pv-cur-block"><div class="pv-cur-head"><span class="nm">${esc(eid)}</span><span class="pos">недоступно</span></div></div>`;
      const pos = s.attributes.current_position;
      const posVal = typeof pos === 'number' ? pos : (s.state === 'open' ? 100 : 0);
      const fname = s.attributes.friendly_name || eid;
      return `
        <div class="pv-cur-block">
          <div class="pv-cur-head">
            <ha-icon icon="mdi:curtains"></ha-icon>
            <span class="nm">${esc(fname)}</span>
            <span class="pos">${posVal}%</span>
          </div>
          <div class="pv-cur-presets">
            ${presets.map(p => `
              <div class="pst ${Math.abs(posVal - p) < 6 ? 'active' : ''}"
                   data-pv-action="curtain-set" data-entity="${esc(eid)}" data-pos="${p}">
                ${p === 0 ? 'Закр' : p === 100 ? 'Откр' : p+'%'}
              </div>
            `).join('')}
          </div>
        </div>`;
    }).join('');
    return this._pvWrap(`
      ${this._pvHeader('Шторы')}
      <div class="pv-content">${blocks}</div>
    `);
  }

  // ============ CLIMATE (ac/heating/floor/convector) ============
  _pvClimate(cfg, screen) {
    const bindKeyMap = { ac: 'acs', heating: 'heatings', floor: 'floors', convector: 'convectors' };
    const tempKeyMap = {
      ac: 'acs_current_temp', heating: 'heatings_current_temp',
      floor: 'floors_current_temp', convector: 'convectors_current_temp',
    };
    const ids = Array.isArray(cfg.entities?.[bindKeyMap[screen]]) ? cfg.entities[bindKeyMap[screen]] : [];
    const meta = SCREEN_META[screen];

    if (!ids.length) {
      return this._pvWrap(`${this._pvHeader(meta.ru)}<div class="pv-content">${this._pvEmpty('Не привязано',`Выберите термостаты в «Устройства → ${meta.ru}»`)}</div>`);
    }

    // Current temp display
    const tempEid = cfg.entities?.[tempKeyMap[screen]];
    let curTemp = null;
    if (tempEid) {
      const ts = this._pvEntState(tempEid);
      if (ts && ts.state !== 'unavailable' && ts.state !== 'unknown') curTemp = parseFloat(ts.state);
    } else if (ids.length) {
      // Fall back to first climate's current_temperature attribute
      const cs = this._pvEntState(ids[0]);
      if (cs && cs.attributes.current_temperature !== undefined) curTemp = cs.attributes.current_temperature;
    }

    // Scenes table (target temperature for each)
    const SCENES = screen === 'ac'
      ? [{ key:'turbo', lbl:'Турбо', t:18, mode:'cool', icon:'mdi:snowflake' },
         { key:'comfort', lbl:'Комфорт', t:22, mode:'cool', icon:'mdi:sofa-outline' },
         { key:'eco', lbl:'Эко', t:25, mode:'cool', icon:'mdi:leaf' }]
      : [{ key:'turbo', lbl:'Турбо', t:24, mode:'heat', icon:'mdi:fire' },
         { key:'comfort', lbl:'Комфорт', t:22, mode:'heat', icon:'mdi:sofa-outline' },
         { key:'eco', lbl:'Эко', t:19, mode:'heat', icon:'mdi:leaf' }];

    const list = ids.map(eid => {
      const s = this._pvEntState(eid);
      if (!s) return `<div class="clm off"><span class="nm">${esc(eid)}</span><span class="target">офлайн</span></div>`;
      const fname = s.attributes.friendly_name || eid;
      const isOff = s.state === 'off' || s.state === 'unavailable';
      const target = s.attributes.temperature;
      // Detect active scene by matching target temp + mode
      const activeScene = !isOff ? SCENES.find(sc =>
        Math.abs((target || -999) - sc.t) < 0.5 && (s.state === sc.mode || s.state === 'auto')
      )?.key : null;
      return `
        <div class="clm ${isOff?'off':''}">
          <span class="nm">${esc(fname)}</span>
          <span class="scenes">
            ${SCENES.map(sc => `
              <span class="scn ${activeScene === sc.key ? 'active' : ''}"
                    data-pv-action="climate-scene" data-entity="${esc(eid)}"
                    data-temp="${sc.t}" data-mode="${sc.mode}">
                ${esc(sc.lbl)}
              </span>
            `).join('')}
          </span>
          <span class="target">${target !== undefined ? target+'°' : '—'}</span>
        </div>`;
    }).join('');

    return this._pvWrap(`
      ${this._pvHeader(meta.ru)}
      <div class="pv-content">
        ${curTemp !== null ? `
          <div class="pv-climate-head">
            <div class="cur-t">${curTemp.toFixed(1)}<span class="unit">°C</span></div>
            <div class="lbl">В КОМНАТЕ</div>
          </div>` : ''}
        <div class="pv-climate-list">${list}</div>
      </div>
    `);
  }

  // ============ VENTILATION ============
  _pvVentilation(cfg) {
    const fanIds = Array.isArray(cfg.entities?.ventilation_fans) ? cfg.entities.ventilation_fans : [];
    if (!fanIds.length) {
      return this._pvWrap(`${this._pvHeader('Вентиляция')}<div class="pv-content">${this._pvEmpty('Вентиляторы не привязаны','«Устройства» → Вентиляция')}</div>`);
    }
    const co2Eid = cfg.entities?.co2_sensor;
    const co2State = co2Eid ? this._pvEntState(co2Eid) : null;
    const co2Val = co2State && co2State.state !== 'unavailable' && co2State.state !== 'unknown'
      ? Math.round(parseFloat(co2State.state)) : null;
    const co2Cls = co2Val == null ? '' : co2Val > 1400 ? 'bad' : co2Val > 1000 ? 'mid' : 'good';
    const co2Lbl = co2Val == null ? '' : co2Val > 1400 ? 'НУЖНО ПРОВЕТРИТЬ' : co2Val > 1000 ? 'СРЕДНЕ' : 'ХОРОШО';

    // Use first fan for speed control demo
    const eid = fanIds[0];
    const s = this._pvEntState(eid);
    const curPct = s?.attributes?.percentage ?? (s?.state === 'on' ? 50 : 0);
    const speeds = [0, 33, 66, 100];
    const speedsHtml = speeds.map(p => `
      <div class="sp ${Math.abs(curPct - p) < 8 ? 'active' : ''}"
           data-pv-action="vent-speed" data-entity="${esc(eid)}" data-pct="${p}">
        ${p === 0 ? 'Выкл' : p === 33 ? 'Тихо' : p === 66 ? 'Средне' : 'Турбо'}
        <span class="pct">${p}%</span>
      </div>`).join('');

    return this._pvWrap(`
      ${this._pvHeader('Вентиляция')}
      <div class="pv-content">
        ${co2Val != null ? `
          <div class="pv-vent-co2 ${co2Cls}">
            <div class="v">${co2Val}<span class="unit">ppm</span></div>
            <div class="lbl">CO₂ · ${co2Lbl}</div>
          </div>` : ''}
        <div class="pv-vent-grid">${speedsHtml}</div>
      </div>
    `);
  }

  // ============ EVENT WIRING ============
  _wirePreviewEvents(panel, cfg) {
    const pane = this.shadowRoot.getElementById('preview-pane');
    if (!pane) return;
    const $$ = (sel) => pane.querySelectorAll(sel);

    // Screen picker (top of pane)
    $$('[data-pv-screen]').forEach(el => {
      el.onclick = () => {
        if (el.classList.contains('disabled')) {
          this._toast('Экран выключен — включите его в «Экраны»', 'warn', { duration: 2200 });
          return;
        }
        this._previewScreen = el.dataset.pvScreen;
        this._renderPreviewPane();
      };
    });

    // Nav inside preview (home-nav + menu tiles + back button)
    $$('[data-pv-action="nav-home"]').forEach(el => { el.onclick = () => { this._previewScreen = 'home'; this._renderPreviewPane(); }; });
    $$('[data-pv-action="nav-to"]').forEach(el => {
      el.onclick = () => {
        const tgt = el.dataset.target;
        const enabled = this._enabledScreens(cfg);
        if (tgt !== 'menu' && !enabled.includes(tgt)) {
          this._toast(`Экран «${SCREEN_META[tgt]?.ru || tgt}» выключен`, 'warn', { duration: 2200 });
          return;
        }
        this._previewScreen = tgt;
        this._renderPreviewPane();
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

    // ---- Fan / ventilation speed ----
    $$('[data-pv-action="vent-speed"]').forEach(el => {
      el.onclick = () => {
        const eid = el.dataset.entity;
        const pct = parseInt(el.dataset.pct, 10);
        this._pvSetPending(eid, pct === 0 ? 'off' : 'on', { percentage: pct });
        if (pct === 0) this._pvCallService('fan', 'turn_off', { entity_id: eid });
        else this._pvCallService('fan', 'set_percentage', { entity_id: eid, percentage: pct });
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
        this._renderPreviewPane();
      });
  }
}

customElements.define('bms-panel-editor', BMSPanelEditor);

console.info('%c BMS-PANEL %c 2.1.0 — live preview ',
  'color:#fff;background:#3a5bff;padding:2px 6px;border-radius:3px 0 0 3px',
  'color:#3a5bff;background:#f0f4ff;padding:2px 6px;border-radius:0 3px 3px 0');
