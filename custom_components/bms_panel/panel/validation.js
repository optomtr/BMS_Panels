/**
 * Validation engine — клиентское зеркало validation.py.
 *
 * Запускается на каждое изменение working config'а и при первом рендере.
 * Возвращает плоский список Issue'ов, которые UI группирует и рендерит:
 *   - Top banner (sticky под toolbar) — все error + счётчики
 *   - Inline под полем — соответствующее правило
 *   - Bind-card обводка цвета severity
 *   - Save button блокируется при наличии error
 *
 * Правила тут — упрощённый набор из ТЗ Validation QA (топ-30 из 74).
 * Остальные 44 добавим в Round 2-3.
 */

export const SEV_ERROR = 'error';
export const SEV_WARN  = 'warning';
export const SEV_INFO  = 'info';

const SLUG_RE = /^[a-z0-9_-]{2,32}$/;

// ID нижнего ряда главного экрана. Должно совпадать с HOME_NAV_OPTIONS в const.py.
const HOME_NAV_OPTIONS = ['light','curtain','menu','music','ac','heating','ventilation'];
const HOME_NAV_REQUIRED_LEN = 5;

// Ключ binding'а → метаданные. Должно совпадать с BIND_KEYS в const.py.
export const BIND_KEYS = {
  lights:           { multi: true,  domain: 'light',        requiresScreen: 'light'       },
  curtains:         { multi: true,  domain: 'cover',        requiresScreen: 'curtain'     },
  media_players:    { multi: true,  domain: 'media_player', requiresScreen: 'music'       },
  acs:              { multi: true,  domain: 'climate',      requiresScreen: 'ac'          },
  heatings:         { multi: true,  domain: 'climate',      requiresScreen: 'heating'     },
  floors:           { multi: true,  domain: 'climate',      requiresScreen: 'floor'       },
  convectors:       { multi: true,  domain: 'climate',      requiresScreen: 'convector'   },
  ventilation_fans: { multi: true,  domain: 'fan',          requiresScreen: 'ventilation' },
  co2_sensor:       { multi: false, domain: 'sensor',       requiresScreen: 'ventilation' },
  temp_sensor:      { multi: false, domain: 'sensor',       requiresScreen: null          },
  humidity_sensor:  { multi: false, domain: 'sensor',       requiresScreen: null          },
  ac_temp_sensor:        { multi: false, domain: 'sensor', requiresScreen: 'ac'        },
  heating_temp_sensor:   { multi: false, domain: 'sensor', requiresScreen: 'heating'   },
  floor_temp_sensor:     { multi: false, domain: 'sensor', requiresScreen: 'floor'     },
  convector_temp_sensor: { multi: false, domain: 'sensor', requiresScreen: 'convector' },
  ac_fan:                { multi: false, domain: 'fan',    requiresScreen: 'ac'        },
  convector_fan:         { multi: false, domain: 'fan',    requiresScreen: 'convector' },
};

export const SCREEN_KEYS = ['light','curtain','music','ac','heating','floor','convector','ventilation'];

const SCREEN_TIMEOUT_OPTIONS = [15, 30, 60, 120, 300, 600];
const LANGUAGES = ['English', 'Русский'];

function makeIssue(id, severity, message, fixHint, anchor) {
  return { id, severity, message, fix_hint: fixHint || '', anchor: anchor || { type: 'global' } };
}

/**
 * @param {object} cfg — working config
 * @param {string} panelId — id текущей панели
 * @param {Array} allPanels — [{panel_id, panel_name, config}] для дубликатов между панелями
 * @param {object} hassStates — hass.states (entity_id → {state, attributes, ...})
 * @returns {Issue[]}
 */
export function validate(cfg, panelId, allPanels, hassStates) {
  const out = [];
  cfg = cfg || {};
  allPanels = allPanels || [];
  hassStates = hassStates || {};

  // ---- A. Конфиг панели ----
  if (panelId && !SLUG_RE.test(panelId)) {
    out.push(makeIssue('V01', SEV_ERROR,
      `Panel ID «${panelId}» содержит недопустимые символы.`,
      'Разрешены латиница, цифры, _ и - (2–32 символа).',
      { type: 'field', key: 'panel_id' }));
  }

  const bg = cfg.background_dim ?? 30;
  if (bg < 0 || bg > 100) {
    out.push(makeIssue('V06', SEV_ERROR,
      `Затемнение фона = ${bg}, допустимо 0–100.`,
      'Подвиньте слайдер в допустимый диапазон.',
      { type: 'field', key: 'background_dim' }));
  } else if (bg === 0) {
    out.push(makeIssue('V07', SEV_WARN,
      'Фон полностью прозрачный — текст может быть нечитаемым.',
      'Рекомендуется 30–60%.',
      { type: 'field', key: 'background_dim' }));
  }

  // Guard на undefined — конфиг может быть частично загружен до миграции.
  if (cfg.screen_timeout !== undefined && !SCREEN_TIMEOUT_OPTIONS.includes(cfg.screen_timeout)) {
    out.push(makeIssue('V08', SEV_ERROR,
      `Lock screen после: «${cfg.screen_timeout}» не поддерживается.`,
      `Выберите из: ${SCREEN_TIMEOUT_OPTIONS.join(', ')} сек.`,
      { type: 'field', key: 'screen_timeout' }));
  }

  if (cfg.language !== undefined && !LANGUAGES.includes(cfg.language)) {
    out.push(makeIssue('V09', SEV_ERROR,
      `Язык «${cfg.language}» не поддерживается.`,
      `Доступны: ${LANGUAGES.join(', ')}.`,
      { type: 'field', key: 'language' }));
  }

  // ---- B. Экраны / home_nav ----
  const screens = cfg.screens || {};
  if (Object.keys(screens).length > 0 && Object.values(screens).every(s => !s?.enabled)) {
    out.push(makeIssue('V10', SEV_ERROR,
      'Все экраны выключены — на панели будет только главный экран без меню.',
      'Включите хотя бы один экран.',
      { type: 'card', key: 'screens' }));
  }

  // Сгруппировать bind-ключи по экранам — для проверки «экран enabled, но привязок 0»
  const screenToBindKeys = {};
  for (const [bk, meta] of Object.entries(BIND_KEYS)) {
    if (meta.requiresScreen) {
      (screenToBindKeys[meta.requiresScreen] ||= []).push(bk);
    }
  }
  const entities = cfg.entities || {};
  for (const [screen, bks] of Object.entries(screenToBindKeys)) {
    if (!screens[screen]?.enabled) continue;
    const anyBound = bks.some(bk => {
      const v = entities[bk];
      return BIND_KEYS[bk].multi ? (v || []).length > 0 : !!v;
    });
    if (!anyBound) {
      out.push(makeIssue(`V_screen_${screen}_empty`, SEV_WARN,
        `Экран «${screen}» включён, но устройства не привязаны.`,
        'Выберите устройства на вкладке «Устройства» — иначе на панели будет пусто.',
        { type: 'screen_warning', key: screen }));
    }
  }

  // home_nav
  const nav = cfg.home_nav || [];
  if (nav.length !== HOME_NAV_REQUIRED_LEN) {
    out.push(makeIssue('V19', SEV_ERROR,
      `В нижнем ряду главного экрана должно быть ровно ${HOME_NAV_REQUIRED_LEN} иконок (сейчас: ${nav.length}).`,
      '', { type: 'card', key: 'home_nav' }));
  }
  nav.forEach((item, idx) => {
    if (!HOME_NAV_OPTIONS.includes(item)) {
      out.push(makeIssue(`V20_${idx}`, SEV_ERROR,
        `Иконка «${item}» неизвестна Android-приложению.`,
        `Допустимые: ${HOME_NAV_OPTIONS.join(', ')}.`,
        { type: 'home_nav_item', index: idx }));
    } else if (item !== 'menu' && !screens[item]?.enabled) {
      out.push(makeIssue(`V17_${idx}`, SEV_ERROR,
        `Иконка «${item}» в нижнем ряду, но экран выключен.`,
        'Включите экран на вкладке «Экраны» или замените иконку.',
        { type: 'home_nav_item', index: idx }));
    }
  });
  if (nav.length && !nav.includes('menu')) {
    out.push(makeIssue('V21', SEV_WARN,
      'В нижнем ряду нет иконки «menu».',
      'Без неё пользователь не откроет остальные экраны иначе как свайпом. Рекомендуется добавить.',
      { type: 'card', key: 'home_nav' }));
  }
  // menu может повторяться — это plain-заполнитель. Дубликаты остальных — баг.
  const nonMenu = nav.filter(n => n !== 'menu');
  if (new Set(nonMenu).size < nonMenu.length) {
    out.push(makeIssue('V18', SEV_WARN,
      'В нижнем ряду есть дубликаты иконок (кроме «menu»).',
      'Каждый раздел должен встречаться один раз — лишние слоты можно занять «menu».',
      { type: 'card', key: 'home_nav' }));
  }

  // ---- C. Entity — формат, существование, домен, состояние ----
  const ENTITY_FORMAT = /^[a-z0-9_]+\.[a-z0-9_]+$/;
  for (const [bk, meta] of Object.entries(BIND_KEYS)) {
    const val = entities[bk];
    const ids = (val && (Array.isArray(val) ? val : [val])) || [];
    for (const eid of ids) {
      if (!eid) continue;

      // V11 — формат entity_id (latin-only, точка, без пробелов)
      if (!ENTITY_FORMAT.test(eid)) {
        out.push(makeIssue(`V11_${bk}_${eid}`, SEV_ERROR,
          `«${eid}» — невалидный entity_id.`,
          'Допустимы только латиница, цифры и _. Формат: domain.object_name.',
          { type: 'bind_card', key: bk, entity_id: eid }));
        continue;
      }

      // Домен
      if (!eid.startsWith(meta.domain + '.')) {
        out.push(makeIssue(`V_domain_${bk}_${eid}`, SEV_ERROR,
          `«${eid}» не из домена ${meta.domain}.*.`,
          `Выберите entity ${meta.domain}.* — иначе не будет работать.`,
          { type: 'bind_card', key: bk, entity_id: eid }));
        continue;
      }

      const st = hassStates[eid];
      if (!st) {
        out.push(makeIssue(`V22_${bk}_${eid}`, SEV_ERROR,
          `«${eid}» больше не существует в Home Assistant.`,
          'Возможно удалили или переименовали. Уберите из списка.',
          { type: 'bind_card', key: bk, entity_id: eid }));
        continue;
      }
      if (st.state === 'unavailable') {
        out.push(makeIssue(`V23_${bk}_${eid}`, SEV_WARN,
          `«${eid}» сейчас недоступен.`,
          'На панели будет показан серым. Проверьте интеграцию-источник.',
          { type: 'bind_card', key: bk, entity_id: eid }));
      }

      // ---- D. Атрибуты по доменам ----
      const a = st.attributes || {};
      if (meta.domain === 'climate') {
        const modes = a.hvac_modes;
        if (!Array.isArray(modes) || modes.length === 0) {
          out.push(makeIssue(`V26_${eid}`, SEV_ERROR,
            `«${eid}» не сообщает поддерживаемые режимы (hvac_modes пуст).`,
            'Кнопки HEAT/COOL/AUTO не появятся. Переподключите термостат в HA.',
            { type: 'bind_card', key: bk, entity_id: eid }));
        } else {
          if (bk === 'acs' && !modes.includes('cool')) {
            out.push(makeIssue(`V27_${eid}`, SEV_WARN,
              `«${eid}» привязан к AC, но не поддерживает охлаждение.`,
              'Если это радиатор — переместите в Heating.',
              { type: 'bind_card', key: bk, entity_id: eid }));
          }
          if (['heatings','floors','convectors'].includes(bk) && !modes.includes('heat')) {
            out.push(makeIssue(`V28_${bk}_${eid}`, SEV_WARN,
              `«${eid}» в отопительном экране, но не поддерживает heat.`,
              'Сцены «Тёплый» работать не будут.',
              { type: 'bind_card', key: bk, entity_id: eid }));
          }
        }
        // V37 — диапазон температур у термостата не совпадает с UI слайдером (16-30°C)
        const minT = Number(a.min_temp);
        const maxT = Number(a.max_temp);
        if (Number.isFinite(minT) && Number.isFinite(maxT)) {
          // Для тёплого пола диапазон может быть 5-35 (электрический) — норм.
          // Для AC 16-30 типично. Ловим только странные случаи (диапазон <5 = баг).
          if (maxT - minT < 5) {
            out.push(makeIssue(`V37_${eid}`, SEV_WARN,
              `«${eid}» — диапазон температур узкий (${minT}–${maxT}°).`,
              'Регулировка с панели будет работать только в этом диапазоне.',
              { type: 'bind_card', key: bk, entity_id: eid }));
          }
        }
      }

      // V41 — media_player без поддержки громкости / play
      if (meta.domain === 'media_player') {
        const sf = Number(a.supported_features) | 0;
        // bit 4 (=4) = VOLUME_SET, bit 14 (=16384) = PLAY
        if (!(sf & 4)) {
          out.push(makeIssue(`V41_${eid}`, SEV_WARN,
            `«${eid}» не поддерживает регулировку громкости.`,
            'Слайдер volume на экране Music работать не будет.',
            { type: 'bind_card', key: bk, entity_id: eid }));
        }
        if (!(sf & 16384) && !(sf & 1)) {
          out.push(makeIssue(`V41play_${eid}`, SEV_WARN,
            `«${eid}» не поддерживает Play/Pause.`,
            'Главная кнопка плеера не сработает.',
            { type: 'bind_card', key: bk, entity_id: eid }));
        }
      }

      // V44 — cover без позиционирования (для штор с слайдером 0-100%)
      if (meta.domain === 'cover' && bk === 'curtains') {
        const sf = Number(a.supported_features) | 0;
        // bit 2 (=4) = SET_POSITION
        if (!(sf & 4)) {
          out.push(makeIssue(`V44_${eid}`, SEV_INFO,
            `«${eid}» не поддерживает установку процента открытия.`,
            'Кнопки 25/50/75% будут просто открывать/закрывать полностью.',
            { type: 'bind_card', key: bk, entity_id: eid }));
        }
      }
      if (meta.domain === 'sensor' && bk === 'co2_sensor') {
        if (a.unit_of_measurement && a.unit_of_measurement !== 'ppm') {
          out.push(makeIssue(`V50_${eid}`, SEV_WARN,
            `CO₂-сенсор использует «${a.unit_of_measurement}», а не ppm.`,
            'Пороги индикатора (свежий/душновато/плохо) рассчитаны на ppm.',
            { type: 'bind_card', key: bk, entity_id: eid }));
        }
      }
      if (meta.domain === 'sensor' && ['temp_sensor','ac_temp_sensor','heating_temp_sensor','floor_temp_sensor','convector_temp_sensor'].includes(bk)) {
        if (a.device_class && a.device_class !== 'temperature') {
          out.push(makeIssue(`V45_${bk}_${eid}`, SEV_WARN,
            `«${eid}» не помечен как температурный (device_class=${a.device_class}).`,
            'Проверьте — возможно это другой сенсор.',
            { type: 'bind_card', key: bk, entity_id: eid }));
        }
      }
    }
  }

  // ---- E. Дубликаты ----
  // Read-only домены (sensor, binary_sensor и т.д.) делить между слотами/панелями —
  // НОРМА. Например один датчик температуры комнаты может питать AC + Heating + Floor
  // одновременно, или один уличный термометр — две панели. Не репортим вообще.
  // Запрещаем только для actuator-ов, где команды экранов конфликтуют.
  const READ_ONLY_DOMAINS = new Set([
    'sensor', 'binary_sensor', 'weather', 'person', 'zone',
    'sun', 'device_tracker', 'input_text', 'input_number',
  ]);
  const isReadOnly = (eid) => READ_ONLY_DOMAINS.has((eid || '').split('.', 1)[0]);

  // одна entity в нескольких слотах ОДНОЙ панели
  const seenInKeys = new Map();
  for (const [bk, val] of Object.entries(entities)) {
    const ids = (val && (Array.isArray(val) ? val : [val])) || [];
    for (const eid of ids) {
      if (!eid) continue;
      const arr = seenInKeys.get(eid) || [];
      arr.push(bk);
      seenInKeys.set(eid, arr);
    }
  }
  for (const [eid, keys] of seenInKeys) {
    if (keys.length <= 1) continue;
    if (isReadOnly(eid)) continue;  // sensor в N слотах — это OK
    out.push(makeIssue(`V56_${eid}`, SEV_WARN,
      `«${eid}» привязан одновременно к: ${keys.join(', ')}.`,
      'Один и тот же исполнитель в нескольких слотах — команды экранов будут конфликтовать.',
      { type: 'duplicate_self', entity_id: eid }));
  }

  // одна entity в 2-х панелях — dedup по (eid, other_panel)
  const myEnts = new Set();
  for (const [bk, val] of Object.entries(entities)) {
    const ids = (val && (Array.isArray(val) ? val : [val])) || [];
    for (const eid of ids) if (eid) myEnts.add(eid);
  }
  const seenDups = new Set();
  for (const p of allPanels) {
    if (p.panel_id === panelId) continue;
    const otherEnts = p.config?.entities || {};
    const otherName = p.panel_name || p.panel_id;
    for (const [bk, val] of Object.entries(otherEnts)) {
      const ids = (val && (Array.isArray(val) ? val : [val])) || [];
      for (const eid of ids) {
        if (isReadOnly(eid)) continue;
        const dupKey = `${eid}|${otherName}`;
        if (myEnts.has(eid) && !seenDups.has(dupKey)) {
          seenDups.add(dupKey);
          out.push(makeIssue(`V55_${eid}_${otherName}`, SEV_WARN,
            `«${eid}» уже привязан к панели «${otherName}».`,
            'Если случайно — отвяжите от одной из панелей.',
            { type: 'duplicate', entity_id: eid, other_panel: otherName }));
        }
      }
    }
  }

  // ---- F. У пользователя нет ни одной entity такого домена, но экран enabled ----
  const domainHas = {};
  for (const eid of Object.keys(hassStates)) {
    const d = eid.split('.', 1)[0];
    domainHas[d] = (domainHas[d] || 0) + 1;
  }
  const screenDomainMap = {
    light:       'light',
    curtain:     'cover',
    music:       'media_player',
    ac:          'climate',
    heating:     'climate',
    floor:       'climate',
    convector:   'climate',
    ventilation: 'fan',
  };
  for (const [screen, dom] of Object.entries(screenDomainMap)) {
    if (screens[screen]?.enabled && !domainHas[dom]) {
      out.push(makeIssue(`V60_${screen}`, SEV_WARN,
        `В Home Assistant нет ни одного устройства ${dom}.*, а экран «${screen}» включён.`,
        'Выключите экран или сначала установите интеграцию-источник.',
        { type: 'screen_warning', key: screen }));
    }
  }

  return out;
}

export function summary(issues) {
  return {
    error:   issues.filter(i => i.severity === SEV_ERROR).length,
    warning: issues.filter(i => i.severity === SEV_WARN).length,
    info:    issues.filter(i => i.severity === SEV_INFO).length,
    total:   issues.length,
  };
}

export function hasErrors(issues) {
  return issues.some(i => i.severity === SEV_ERROR);
}
