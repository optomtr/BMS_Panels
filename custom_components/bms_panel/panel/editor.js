/**
 * BMS Smart Panel — полноэкранный редактор в сайдбаре HA.
 * Загружается через panel_custom как Web Component <bms-panel-editor>.
 * hass инжектится автоматически.
 */

const SCREEN_OPTIONS = [
  { id: 'light',       label: 'Light',       icon: 'mdi:lightbulb-outline' },
  { id: 'curtain',     label: 'Curtain',     icon: 'mdi:curtains' },
  { id: 'music',       label: 'Music',       icon: 'mdi:music' },
  { id: 'ac',          label: 'AC',          icon: 'mdi:air-conditioner' },
  { id: 'heating',     label: 'Heating',     icon: 'mdi:radiator' },
  { id: 'floor',       label: 'Floor heat',  icon: 'mdi:heating-coil' },
  { id: 'convector',   label: 'Convector',   icon: 'mdi:radiator-disabled' },
  { id: 'ventilation', label: 'Ventilation', icon: 'mdi:fan' },
];
const HOME_NAV_OPTIONS = ['light','curtain','menu','music','ac','heating','ventilation'];

const STYLES = `
:host {
  display: block;
  background: var(--primary-background-color);
  min-height: 100vh;
  font-family: var(--paper-font-body1_-_font-family, system-ui);
  color: var(--primary-text-color);
}
.toolbar {
  display: flex; align-items: center; gap: 12px;
  padding: 0 16px;
  height: var(--header-height, 56px);
  background: var(--app-header-background-color, var(--primary-color));
  color: var(--app-header-text-color, #fff);
  position: sticky; top: 0; z-index: 10;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}
.toolbar-title { font-size: 20px; font-weight: 400; flex: 1; }
.toolbar .btn { background: rgba(255,255,255,0.15); color: #fff; border: none; }
.toolbar .btn:hover { background: rgba(255,255,255,0.25); }

.layout { display: flex; min-height: calc(100vh - 56px); }
.sidebar {
  width: 280px; flex-shrink: 0;
  background: var(--card-background-color);
  border-right: 1px solid var(--divider-color);
  padding: 16px 0;
  overflow-y: auto;
}
.sidebar-header {
  padding: 0 16px 8px;
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
}
.panel-list-item:hover { background: var(--secondary-background-color); }
.panel-list-item.active {
  background: var(--secondary-background-color);
  border-left-color: var(--primary-color);
  font-weight: 500;
}
.panel-list-item .meta {
  font-size: 11px; color: var(--secondary-text-color);
}
.panel-list-item .name { flex: 1; }
.sidebar-add {
  margin: 12px 16px;
  display: flex; gap: 8px; align-items: center;
  padding: 10px 12px;
  border: 1px dashed var(--divider-color);
  border-radius: 6px;
  cursor: pointer;
  color: var(--primary-color);
  font-size: 14px;
}
.sidebar-add:hover { background: var(--secondary-background-color); }

.content {
  flex: 1;
  padding: 24px;
  max-width: 900px;
}
.empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-height: 60vh; text-align: center; gap: 16px;
  color: var(--secondary-text-color);
}
.empty-state ha-icon { --mdc-icon-size: 64px; opacity: 0.5; }
.empty-state h2 { color: var(--primary-text-color); margin: 0; }

.card {
  background: var(--card-background-color);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 20px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}
.card-title { font-size: 16px; font-weight: 500; margin: 0 0 16px; color: var(--primary-text-color); }
.card-sub { font-size: 12px; color: var(--secondary-text-color); margin: -8px 0 12px; }

.field-row {
  display: flex; align-items: center; gap: 12px;
  margin: 10px 0;
}
.field-row label { width: 160px; font-size: 14px; color: var(--secondary-text-color); }
.field-row .control { flex: 1; }
.field-row input[type=range] { width: 100%; }
.field-row .val { width: 50px; text-align: right; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }

select, input[type=text], input[type=number] {
  background: var(--card-background-color);
  border: 1px solid var(--divider-color);
  color: var(--primary-text-color);
  padding: 8px 10px; border-radius: 6px; font-size: 14px;
  font-family: inherit;
  width: 100%; box-sizing: border-box;
}

.screen-list { display: flex; flex-direction: column; gap: 6px; }
.screen-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px;
  background: var(--secondary-background-color);
  border: 1px solid var(--divider-color);
  border-radius: 8px;
  cursor: grab; user-select: none;
}
.screen-row.dragging { opacity: 0.4; }
.screen-row.drag-over { border-color: var(--primary-color); border-width: 2px; padding: 9px 13px; }
.screen-row .handle { color: var(--secondary-text-color); font-size: 18px; cursor: grab; }
.screen-row .name { flex: 1; font-size: 15px; }
.screen-row.disabled .name { opacity: 0.4; text-decoration: line-through; }

.entities-grid { display: grid; grid-template-columns: 200px 1fr; gap: 10px 16px; align-items: center; }

.bind-card {
  border: 1px solid var(--divider-color);
  border-radius: 10px;
  padding: 12px 16px;
  margin: 10px 0;
  background: var(--secondary-background-color);
}
.bind-card.empty { border-color: #ff9800; }
.bind-card-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 8px;
}
.bind-card-title { font-size: 14px; font-weight: 500; }
.bind-card-meta { font-size: 12px; color: var(--secondary-text-color); }
.bind-card-meta.warn { color: #ff9800; font-weight: 500; }
.bind-list {
  max-height: 220px;
  overflow-y: auto;
  display: flex; flex-direction: column; gap: 2px;
  background: var(--card-background-color);
  border-radius: 6px;
  padding: 6px;
}
.bind-item {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 8px;
  cursor: pointer; font-size: 13px;
  border-radius: 4px;
  user-select: none;
}
.bind-item:hover { background: var(--secondary-background-color); }
.bind-item input { margin: 0; cursor: pointer; }
.bind-item .nm { flex: 1; }
.bind-item .eid {
  font-size: 11px; color: var(--secondary-text-color);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
.bind-empty {
  padding: 18px; text-align: center;
  color: var(--secondary-text-color); font-size: 13px;
}

.home-nav-row { display: flex; align-items: center; gap: 10px; margin: 6px 0; }
.home-nav-row .num { width: 24px; color: var(--secondary-text-color); font-weight: 500; }
.home-nav-row select { flex: 1; }

.btn {
  padding: 8px 16px; border-radius: 6px;
  border: 1px solid var(--divider-color);
  background: var(--card-background-color);
  color: var(--primary-text-color);
  cursor: pointer; font-size: 14px; font-family: inherit;
}
.btn:hover { background: var(--secondary-background-color); }
.btn.primary { background: var(--primary-color); color: white; border-color: var(--primary-color); }
.btn.danger { color: var(--error-color); }
.btn.danger:hover { background: rgba(244, 67, 54, 0.08); }

.actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 8px; }
.saved { color: var(--success-color, #4caf50); font-size: 13px; opacity: 0; transition: opacity 0.3s; }
.saved.show { opacity: 1; }

.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 100;
}
.modal {
  background: var(--card-background-color);
  border-radius: 12px;
  padding: 24px;
  width: 400px; max-width: 90vw;
  box-shadow: 0 8px 32px rgba(0,0,0,0.3);
}
.modal h3 { margin: 0 0 16px; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }

@media (max-width: 700px) {
  .layout { flex-direction: column; }
  .sidebar { width: 100%; border-right: none; border-bottom: 1px solid var(--divider-color); }
  .entities-grid { grid-template-columns: 1fr; }
  .field-row { flex-direction: column; align-items: stretch; }
  .field-row label { width: auto; }
}
`;

class BMSPanelEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._activePanelId = null;
    this._workingCache = new Map();
    this._dirty = false;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) {
      this._renderShell();
      this._refresh();
    } else {
      this._refresh();
    }
  }

  set narrow(_) { /* ignore */ }
  set route(_) { /* ignore */ }
  set panel(_) { /* ignore */ }

  _renderShell() {
    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <div class="toolbar">
        <div class="toolbar-title">BMS Smart Panel — управление</div>
        <button class="btn" id="btn-help" title="Help">?</button>
      </div>
      <div class="layout">
        <aside class="sidebar" id="sidebar"></aside>
        <main class="content" id="content"></main>
      </div>
      <div id="modal-root"></div>
    `;
    this.shadowRoot.getElementById('btn-help').onclick = () => this._showHelp();
  }

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
      }))
      .sort((a, b) => a.panel_name.localeCompare(b.panel_name));
  }

  _extractConfig(attrs) {
    return {
      screens: attrs.screens || {},
      home_nav: attrs.home_nav || ['light','curtain','menu','music','ac'],
      background_dim: attrs.background_dim ?? 30,
      screen_timeout: attrs.screen_timeout ?? 30,
      language: attrs.language || 'English',
      entities: attrs.entities || {},
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

  _workingConfig(panel) {
    if (!this._workingCache.has(panel.panel_id)) {
      this._workingCache.set(panel.panel_id, JSON.parse(JSON.stringify(panel.config)));
    }
    return this._workingCache.get(panel.panel_id);
  }

  _refresh() {
    this._renderSidebar();
    this._renderContent();
  }

  // ============ SIDEBAR ============
  _renderSidebar() {
    const sidebar = this.shadowRoot.getElementById('sidebar');
    if (!sidebar) return;
    const panels = this._allPanels();
    sidebar.innerHTML = `
      <div class="sidebar-header">Панели (${panels.length})</div>
      ${panels.map(p => `
        <div class="panel-list-item ${p.panel_id === this._activePanelId ? 'active' : ''}"
             data-id="${p.panel_id}">
          <ha-icon icon="mdi:tablet-dashboard"></ha-icon>
          <div class="name">
            ${this._esc(p.panel_name)}
            <div class="meta">${p.panel_id}</div>
          </div>
        </div>
      `).join('')}
      <div class="sidebar-add" id="btn-add-panel">
        <ha-icon icon="mdi:plus"></ha-icon>
        <span>Добавить панель</span>
      </div>
    `;
    sidebar.querySelectorAll('.panel-list-item').forEach(item => {
      item.onclick = () => {
        this._activePanelId = item.dataset.id;
        this._refresh();
      };
    });
    sidebar.querySelector('#btn-add-panel').onclick = () => this._showAddPanel();
  }

  // ============ CONTENT ============
  _renderContent() {
    const content = this.shadowRoot.getElementById('content');
    if (!content) return;
    const panel = this._activePanel();
    if (!panel) {
      content.innerHTML = `
        <div class="empty-state">
          <ha-icon icon="mdi:tablet-dashboard"></ha-icon>
          <h2>Пока нет ни одной панели</h2>
          <p>Нажмите "Добавить панель" в левой колонке.<br>
             Затем установите APK на стенку и впишите в Settings → Panel ID такой же код.</p>
        </div>
      `;
      return;
    }
    const cfg = this._workingConfig(panel);
    const sortedScreens = SCREEN_OPTIONS
      .map(s => ({ ...s, enabled: cfg.screens[s.id]?.enabled ?? true, order: cfg.screens[s.id]?.order ?? 99 }))
      .sort((a, b) => a.order - b.order);

    content.innerHTML = `
      <div class="card">
        <h3 class="card-title">
          ${this._esc(panel.panel_name)}
          <span style="float:right; font-size: 12px; color: var(--secondary-text-color); font-weight: 400;">
            ID: <code>${panel.panel_id}</code>
          </span>
        </h3>
        <div class="card-sub">Изменения применяются на панели после нажатия «Сохранить».</div>
      </div>

      <div class="card">
        <h3 class="card-title">Дисплей</h3>
        <div class="field-row">
          <label>Затемнение фона</label>
          <input type="range" id="bg-dim" min="0" max="100" value="${cfg.background_dim}" class="control">
          <div class="val"><span id="bg-dim-val">${cfg.background_dim}</span>%</div>
        </div>
        <div class="field-row">
          <label>Lock screen после</label>
          <select id="timeout" class="control">
            ${[15,30,60,120,300,600].map(s => `<option value="${s}" ${cfg.screen_timeout===s?'selected':''}>${s<60?s+' сек':(s/60)+' мин'}</option>`).join('')}
          </select>
        </div>
        <div class="field-row">
          <label>Язык</label>
          <select id="lang" class="control">
            ${['English','Русский'].map(l => `<option value="${l}" ${cfg.language===l?'selected':''}>${l}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">Экраны меню</h3>
        <div class="card-sub">Перетащите ⋮⋮ чтобы поменять порядок. Свитч — включить или скрыть.</div>
        <div class="screen-list" id="screens">
          ${sortedScreens.map(s => `
            <div class="screen-row ${s.enabled ? '' : 'disabled'}" draggable="true" data-id="${s.id}">
              <span class="handle">⋮⋮</span>
              <ha-icon icon="${s.icon}"></ha-icon>
              <span class="name">${s.label}</span>
              <ha-switch ${s.enabled ? 'checked' : ''} data-id="${s.id}"></ha-switch>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">Главный экран — нижние 5 иконок</h3>
        <div class="card-sub">Какие иконки показывать в нижнем ряду главного экрана и в каком порядке.</div>
        ${cfg.home_nav.map((id, i) => `
          <div class="home-nav-row">
            <span class="num">${i+1}.</span>
            <select class="home-nav-select" data-idx="${i}">
              ${HOME_NAV_OPTIONS.map(o => `<option value="${o}" ${o===id?'selected':''}>${o}</option>`).join('')}
            </select>
          </div>
        `).join('')}
      </div>

      <div class="card">
        <h3 class="card-title">Привязки устройств</h3>
        <div class="card-sub" style="color: #ff9800;">
          <strong>Важно:</strong> выберите ТОЛЬКО те устройства которые относятся к этой панели (комнате).
          Не привязывайте всё подряд — у каждой панели свой список.
        </div>

        <h4 style="margin:18px 0 8px;font-size:14px;color:var(--secondary-text-color);">📺 Light (Свет)</h4>
        ${this._entityMulti('Лампы для этой панели', 'lights', 'light', cfg.entities)}

        <h4 style="margin:18px 0 8px;font-size:14px;color:var(--secondary-text-color);">🪟 Curtain (Шторы)</h4>
        ${this._entityMulti('Шторы / cover для этой панели', 'curtains', 'cover', cfg.entities)}

        <h4 style="margin:18px 0 8px;font-size:14px;color:var(--secondary-text-color);">🏠 Главный экран — датчики</h4>
        <div class="entities-grid">
          ${this._entityRow('Сенсор температуры', 'temp_sensor',     'sensor', cfg.entities.temp_sensor)}
          ${this._entityRow('Сенсор влажности',   'humidity_sensor', 'sensor', cfg.entities.humidity_sensor)}
        </div>

        <h4 style="margin:18px 0 8px;font-size:14px;color:var(--secondary-text-color);">❄️ AC (Кондиционер)</h4>
        ${this._entityMulti('Climate-термостаты AC', 'acs', 'climate', cfg.entities)}
        <div class="entities-grid" style="margin-top:8px;">
          ${this._entityRow('Сенсор текущей t° (опц.)',    'ac_temp_sensor', 'sensor', cfg.entities.ac_temp_sensor)}
          ${this._entityRow('Отдельный вентилятор (опц.)', 'ac_fan',         'fan',    cfg.entities.ac_fan)}
        </div>

        <h4 style="margin:18px 0 8px;font-size:14px;color:var(--secondary-text-color);">🔥 Heating (Радиатор)</h4>
        ${this._entityMulti('Climate-термостаты радиаторов', 'heatings', 'climate', cfg.entities)}
        <div class="entities-grid" style="margin-top:8px;">
          ${this._entityRow('Сенсор текущей t° (опц.)', 'heating_temp_sensor', 'sensor', cfg.entities.heating_temp_sensor)}
        </div>

        <h4 style="margin:18px 0 8px;font-size:14px;color:var(--secondary-text-color);">🟩 Floor heat (Тёплый пол)</h4>
        ${this._entityMulti('Climate-термостаты тёплого пола', 'floors', 'climate', cfg.entities)}
        <div class="entities-grid" style="margin-top:8px;">
          ${this._entityRow('Сенсор текущей t° (опц.)', 'floor_temp_sensor', 'sensor', cfg.entities.floor_temp_sensor)}
        </div>

        <h4 style="margin:18px 0 8px;font-size:14px;color:var(--secondary-text-color);">▭ Convector (Конвектор)</h4>
        ${this._entityMulti('Climate-термостаты конвекторов', 'convectors', 'climate', cfg.entities)}
        <div class="entities-grid" style="margin-top:8px;">
          ${this._entityRow('Сенсор текущей t° (опц.)',    'convector_temp_sensor', 'sensor', cfg.entities.convector_temp_sensor)}
          ${this._entityRow('Отдельный вентилятор (опц.)', 'convector_fan',         'fan',    cfg.entities.convector_fan)}
        </div>

        <h4 style="margin:18px 0 8px;font-size:14px;color:var(--secondary-text-color);">💨 Ventilation (Вентиляция)</h4>
        ${this._entityMulti('Fan-устройства вентиляции', 'ventilation_fans', 'fan', cfg.entities)}
        <div class="entities-grid" style="margin-top:8px;">
          ${this._entityRow('CO₂ сенсор', 'co2_sensor', 'sensor', cfg.entities.co2_sensor)}
        </div>

        <h4 style="margin:18px 0 8px;font-size:14px;color:var(--secondary-text-color);">🎵 Music (Музыка)</h4>
        ${this._entityMulti('Media player для этой панели', 'media_players', 'media_player', cfg.entities)}
      </div>

      <div class="card" style="position:sticky;bottom:0;z-index:5;border:2px solid transparent;" id="save-card">
        <div class="actions">
          <button class="btn primary" id="btn-save" style="min-width:140px;font-weight:500;">Сохранить</button>
          <button class="btn" id="btn-reload">Сбросить изменения</button>
          <button class="btn danger" id="btn-reset">Сбросить к дефолту</button>
          <button class="btn danger" id="btn-remove">Удалить панель</button>
          <span id="dirty-indicator" style="color:#ff9800;font-size:13px;display:none;font-weight:500;">● Несохранённые изменения</span>
          <span class="saved" id="saved">✓ Сохранено и отправлено в панель</span>
        </div>
      </div>
    `;
    this._dirty = false;
    this._updateSaveIndicator();
    this._wireContent(panel, cfg);
  }

  _entityRow(label, key, domain, current) {
    const opts = Object.entries(this._hass.states)
      .filter(([eid]) => eid.startsWith(domain + '.'))
      .map(([eid, s]) => ({ id: eid, name: s.attributes.friendly_name || eid }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return `
      <div>${label}</div>
      <select class="entity-select" data-key="${key}">
        <option value="">— не привязано —</option>
        ${opts.map(o => `<option value="${o.id}" ${current===o.id?'selected':''}>${this._esc(o.name)} (${o.id})</option>`).join('')}
      </select>
    `;
  }

  // Multi-select карточка с чекбоксами
  _entityMulti(label, key, domain, entities) {
    const selected = Array.isArray(entities[key]) ? entities[key] : (entities[key] ? [entities[key]] : []);
    const all = Object.entries(this._hass.states)
      .filter(([eid]) => eid.startsWith(domain + '.'))
      .map(([eid, s]) => ({ id: eid, name: s.attributes.friendly_name || eid }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const empty = selected.length === 0;
    return `
      <div class="bind-card ${empty ? 'empty' : ''}">
        <div class="bind-card-head">
          <div class="bind-card-title">${this._esc(label)}</div>
          <div class="bind-card-meta ${empty ? 'warn' : ''}">
            ${empty ? '⚠ Не выбрано — экран будет пустой' : `Выбрано: ${selected.length} из ${all.length}`}
          </div>
        </div>
        ${all.length === 0
          ? `<div class="bind-empty">В Home Assistant нет устройств с доменом <code>${domain}.*</code></div>`
          : `<div class="bind-list">
              ${all.map(o => `
                <label class="bind-item">
                  <input type="checkbox" class="entity-multi-cb" data-key="${key}" value="${o.id}" ${selected.includes(o.id) ? 'checked' : ''}>
                  <span class="nm">${this._esc(o.name)}</span>
                  <span class="eid">${o.id}</span>
                </label>
              `).join('')}
            </div>`
        }
      </div>
    `;
  }

  _markDirty() {
    this._dirty = true;
    this._updateSaveIndicator();
  }
  _updateSaveIndicator() {
    const ind = this.shadowRoot.getElementById('dirty-indicator');
    const card = this.shadowRoot.getElementById('save-card');
    const btn = this.shadowRoot.getElementById('btn-save');
    if (!ind || !card || !btn) return;
    if (this._dirty) {
      ind.style.display = '';
      card.style.borderColor = '#ff9800';
      btn.textContent = 'Сохранить *';
    } else {
      ind.style.display = 'none';
      card.style.borderColor = 'transparent';
      btn.textContent = 'Сохранить';
    }
  }

  _wireContent(panel, cfg) {
    const $ = (id) => this.shadowRoot.getElementById(id);

    $('bg-dim').oninput = e => {
      cfg.background_dim = parseInt(e.target.value);
      $('bg-dim-val').textContent = cfg.background_dim;
      this._markDirty();
    };
    $('timeout').onchange = e => { cfg.screen_timeout = parseInt(e.target.value); this._markDirty(); };
    $('lang').onchange = e => { cfg.language = e.target.value; this._markDirty(); };

    // Toggles + drag-and-drop
    this.shadowRoot.querySelectorAll('.screen-list ha-switch').forEach(sw => {
      sw.addEventListener('change', () => {
        const id = sw.dataset.id;
        if (!cfg.screens[id]) cfg.screens[id] = { enabled: true, order: 99 };
        cfg.screens[id].enabled = sw.checked;
        sw.closest('.screen-row').classList.toggle('disabled', !sw.checked);
        this._markDirty();
      });
    });

    let dragRow = null;
    this.shadowRoot.querySelectorAll('.screen-row').forEach(row => {
      row.ondragstart = e => {
        dragRow = row;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      };
      row.ondragend = () => {
        row.classList.remove('dragging');
        this.shadowRoot.querySelectorAll('.screen-row').forEach(r => r.classList.remove('drag-over'));
        const ids = [...this.shadowRoot.querySelectorAll('.screen-row')].map(r => r.dataset.id);
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

    this.shadowRoot.querySelectorAll('.home-nav-select').forEach(sel => {
      sel.onchange = () => {
        cfg.home_nav[parseInt(sel.dataset.idx)] = sel.value;
        this._markDirty();
      };
    });

    this.shadowRoot.querySelectorAll('.entity-select').forEach(sel => {
      sel.onchange = () => {
        cfg.entities[sel.dataset.key] = sel.value || null;
        this._markDirty();
      };
    });

    // Multi-select чекбоксы
    this.shadowRoot.querySelectorAll('.entity-multi-cb').forEach(cb => {
      cb.onchange = () => {
        const key = cb.dataset.key;
        const cur = Array.isArray(cfg.entities[key]) ? cfg.entities[key].slice() : [];
        const idx = cur.indexOf(cb.value);
        if (cb.checked && idx < 0) cur.push(cb.value);
        if (!cb.checked && idx >= 0) cur.splice(idx, 1);
        cfg.entities[key] = cur;
        // Обновляем счётчик в шапке карточки
        const card = cb.closest('.bind-card');
        if (card) {
          const meta = card.querySelector('.bind-card-meta');
          const all = card.querySelectorAll('.entity-multi-cb').length;
          if (cur.length === 0) {
            card.classList.add('empty');
            meta.className = 'bind-card-meta warn';
            meta.textContent = '⚠ Не выбрано — экран будет пустой';
          } else {
            card.classList.remove('empty');
            meta.className = 'bind-card-meta';
            meta.textContent = `Выбрано: ${cur.length} из ${all}`;
          }
        }
        this._markDirty();
      };
    });

    $('btn-save').onclick = () => this._save();
    $('btn-reload').onclick = () => {
      this._workingCache.delete(panel.panel_id);
      this._refresh();
    };
    $('btn-reset').onclick = () => {
      if (!confirm(`Сбросить конфиг панели «${panel.panel_name}» к дефолту?`)) return;
      this._hass.callService('bms_panel', 'reset_config', { panel_id: panel.panel_id })
        .then(() => {
          this._workingCache.delete(panel.panel_id);
          setTimeout(() => this._refresh(), 400);
        });
    };
    $('btn-remove').onclick = () => {
      if (!confirm(`Удалить панель «${panel.panel_name}»? Это удалит все её настройки.`)) return;
      this._hass.callService('bms_panel', 'remove_panel', { panel_id: panel.panel_id })
        .then(() => {
          this._workingCache.delete(panel.panel_id);
          this._activePanelId = null;
          setTimeout(() => this._refresh(), 400);
        });
    };
  }

  // ============ ADD PANEL MODAL ============
  _showAddPanel() {
    const root = this.shadowRoot.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal-backdrop" id="bk">
        <div class="modal">
          <h3>Добавить новую панель</h3>
          <p style="color: var(--secondary-text-color); font-size: 13px; margin: 0 0 16px;">
            Введите название и (опционально) уникальный код. Этот же код впишите на самой панели:
            Settings → Panel ID.
          </p>
          <div class="field-row">
            <label>Название</label>
            <input type="text" id="add-name" placeholder="Например, Панель кухни" class="control" autofocus>
          </div>
          <div class="field-row">
            <label>Panel ID (код)</label>
            <input type="text" id="add-id" placeholder="Авто, если пусто" class="control">
          </div>
          <div class="modal-actions">
            <button class="btn" id="cancel">Отмена</button>
            <button class="btn primary" id="ok">Создать</button>
          </div>
        </div>
      </div>
    `;
    const close = () => { root.innerHTML = ''; };
    root.querySelector('#bk').onclick = e => { if (e.target.id === 'bk') close(); };
    root.querySelector('#cancel').onclick = close;
    root.querySelector('#ok').onclick = () => {
      const name = root.querySelector('#add-name').value.trim();
      const id = root.querySelector('#add-id').value.trim().toLowerCase();
      if (!name) { alert('Введите название'); return; }
      this._hass.callService('bms_panel', 'add_panel', {
        panel_name: name,
        ...(id ? { panel_id: id } : {}),
      }).then(() => {
        close();
        setTimeout(() => {
          // Активируем созданную панель
          const wantId = id || name.toLowerCase().replace(/[^a-zа-я0-9_]+/g, '_').replace(/^_+|_+$/g, '');
          this._activePanelId = wantId;
          this._refresh();
        }, 500);
      }).catch(err => alert('Ошибка: ' + err.message));
    };
    setTimeout(() => root.querySelector('#add-name').focus(), 50);
  }

  _showHelp() {
    const root = this.shadowRoot.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal-backdrop" id="bk">
        <div class="modal" style="width: 540px;">
          <h3>BMS Smart Panel — как пользоваться</h3>
          <div style="font-size: 14px; color: var(--primary-text-color); line-height: 1.6;">
            <p><b>1. Добавить панель.</b> Слева "Добавить панель" → название (например, "Панель кухни"). Получите Panel ID (например, <code>kitchen</code>).</p>
            <p><b>2. На самой панели</b> (после установки APK): Settings → Panel ID → вписать тот же код <code>kitchen</code>.</p>
            <p><b>3. Настроить экраны:</b> здесь же выбираете какие экраны показывать (свитч), порядок (drag-and-drop ⋮⋮), какие 5 иконок на главном.</p>
            <p><b>4. Привязать устройства</b> (опционально): если у вас несколько кондиционеров/радиаторов — укажите конкретные entity_id для каждого экрана.</p>
            <p><b>Изменения применяются автоматически</b> на панели через WebSocket за 0.5-3 сек.</p>
          </div>
          <div class="modal-actions">
            <button class="btn primary" id="ok">Понял</button>
          </div>
        </div>
      </div>
    `;
    const close = () => { root.innerHTML = ''; };
    root.querySelector('#bk').onclick = e => { if (e.target.id === 'bk') close(); };
    root.querySelector('#ok').onclick = close;
  }

  // ============ SAVE ============
  _save() {
    const panel = this._activePanel();
    if (!panel) return;
    const cfg = this._workingConfig(panel);
    const btn = this.shadowRoot.getElementById('btn-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Отправляю…'; }
    this._hass.callService('bms_panel', 'update_config', {
      panel_id: panel.panel_id,
      config: cfg,
    }).then(() => {
      this._dirty = false;
      this._updateSaveIndicator();
      if (btn) { btn.disabled = false; }
      const el = this.shadowRoot.getElementById('saved');
      if (el) {
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 2500);
      }
    }).catch(err => {
      console.error('Save failed:', err);
      if (btn) { btn.disabled = false; btn.textContent = 'Сохранить *'; }
      alert('Ошибка сохранения: ' + (err.message || err));
    });
  }

  _esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
}

customElements.define('bms-panel-editor', BMSPanelEditor);

console.info('%c BMS-PANEL %c 1.0.0 — single addon ',
  'color:#fff;background:#3a5bff;padding:2px 6px;border-radius:3px 0 0 3px',
  'color:#3a5bff;background:#f0f4ff;padding:2px 6px;border-radius:0 3px 3px 0');
