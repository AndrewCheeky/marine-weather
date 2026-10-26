/** Marine Weather Email & Web App v3.8.5b — Current-Aware Weedline Conditions.
 * Upgrade from v3.8.3. Scheduled refreshes alone retrieve weather/marine data.
 * v3.8.5b: hide normal freshness banners; show advisory only for missing or delayed data.
 * v3.8.5a: resilient Open-Meteo batch JSON recovery; v3.8.5: 75-minute refresh-ahead, forecast provider fallback and provenance logs.
 * v3.8.4: Weedline Conditions uses cached current set, speed and within-window trends.
 * This is a heuristic conditions index, NOT observed sargassum probability.
 * This code requires Google Apps Script and has not been live-executed.
 */
/**
 * Project: marine_wx_email working
 * Version: v3.8.5b
 * Scope: Web App + email (Current 6h, Weekend quick-look, Banks popup (Current/Tomorrow), Subscribers)
 * Not for navigation.
 *
 * === Changelog ===
 * v3.7.0
 * - FIX: Removed duplicate moonInfoFromVC() and kept a single correct implementation.
 * - FIX: Kept one parseVcTime_(s, dayIso, tz) signature and updated all callers.
 * - PERF: Added in-memory day+key index so MarineCache is read once per day+location per run.
 * - PERF: Replaced per-row cache writes with batch upsert (grouped setValues + append block).
 * - FIX: Unified cache cleanup function name to cleanupOldCacheRows_() and corrected callers.
 * - FIX: Footer HTML was malformed. Rebuilt footer HTML so it renders correctly and centers the two IP lines.
 */

const CONFIG = {
  VERSION: '3.9.0-rc1',

  LAT: 17.9085229,
  LON: -76.8103697,
  TIMEZONE: 'America/Jamaica',

  // Visual Crossing API Key (used for astronomy only)
  VISUAL_KEY: '', // Set VISUAL_CROSSING_KEY in Script Properties,

  RECIPIENT_EMAIL: '',
  SENDER_NAME: 'Marine Bot',
  LOCATION_NAME: 'Kingston Maiden Cay, Jamaica',

  GREEN:  { wave_m: 1.5, wind_kn: 12 },
  YELLOW: { wave_m: 2.0, wind_kn: 18 },

  CHOP: { bump_one_s: 3.5, bump_two_s: 2.5 },

  SHEET_ID: PropertiesService.getScriptProperties().getProperty('MW_PROD_SHEET_ID') || '',
  CACHE_SHEET_NAME: 'MarineCache',
  SUBS_SHEET_NAME: 'Subscribers',

  CURRENT_APP_URL: PropertiesService.getScriptProperties().getProperty('MW_PROD_WEBAPP_URL') || '',
  SUB_APP_URL: PropertiesService.getScriptProperties().getProperty('MW_PROD_SUB_URL') || '',

  FISHING_NOTES_EXCLUDE: [
    /avg seas/i,/avg wind/i,/^swell\b/i,/tidal range/i,/turning times/i,/\b(crescent|gibbous|quarter)\b/i,/pressure/i
  ],

  STATUS: {
    gust_yellow_kn: 18, gust_red_kn: 30,
    squall_gust_kn: 25, squall_precip_mm_per_h: 2,
    heavy_rain_day_mm: 20, heavy_rain_pop_pct: 80, moderate_rain_day_mm: 15,
    smallcraft_gust_warn_kn: 15, smallcraft_wave_warn_m: 1.0
  },

  COMFORT_ENABLED: true,
  HEAT_UV_BADGES_ENABLED: true
};
CONFIG.LOCAL_MARINE_IMAGE_PAGE = 'https://jamaica.weatherproof.fi/web/marine2.php';
CONFIG.BANKS_SHEET_NAME = CONFIG.BANKS_SHEET_NAME || 'banks';
CONFIG.LOCAL_MARINE_URL = 'https://jamaica.weatherproof.fi/web/website_2014/website_elements/news2.php?type=6';
/* ========================= LOGGING ========================= */
function logOk_(tag, msg){ Logger.log('✅ [' + tag + '] ' + msg); }
function logWarn_(tag, msg){ Logger.log('⚠️ [' + tag + '] ' + msg); }
function logErr_(tag, msg){ Logger.log('❌ [' + tag + '] ' + msg); }

/* ========================= BANKS ========================= */
function ensureBanksSheet_(){
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  let sh = ss.getSheetByName(CONFIG.BANKS_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.BANKS_SHEET_NAME);
    sh.appendRow(['key','name','lat','lon']);
  } else {
    const hdr = sh.getRange(1,1,1,4).getValues()[0];
    const need = ['key','name','lat','lon'];
    const ok = hdr.length >= 4 && need.every((v,i)=>String(hdr[i]).toLowerCase()===v);
    if (!ok) { sh.clear(); sh.appendRow(['key','name','lat','lon']); }
  }
  return sh;
}

const BANKS = (function loadBanksOnce_(){
  const sh = ensureBanksSheet_();
  const rng = sh.getDataRange().getValues();
  const out = {};
  if (rng.length <= 1) {
    out.bowditch   = { name: 'Mackerel (Bowditch) Bank', lat: 17.520, lon: -76.947 };
    out.california = { name: 'California Bank',          lat: 17.750, lon: -76.783 };
    return out;
  }
  for (let i = 1; i < rng.length; i++) {
    const [kRaw, nameRaw, latRaw, lonRaw] = rng[i];
    const key = String(kRaw || '').trim().toLowerCase();
    const name = String(nameRaw || '').trim();
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (!key || !name) continue;
    if (!isFinite(lat) || !isFinite(lon)) continue;
    out[key] = { name, lat, lon };
  }
  if (!Object.keys(out).length) {
    out.bowditch   = { name: 'Mackerel (Bowditch) Bank', lat: 17.520, lon: -76.947 };
    out.california = { name: 'California Bank',          lat: 17.750, lon: -76.783 };
  }
  return out;
})();

function getBankOrDie_(key){
  const k = String(key||'').toLowerCase();
  if (BANKS[k]) return BANKS[k];
  throw new Error('Unknown bank key: ' + key);
}

/* ========================= CACHING (API + Sheet) ========================= */

const API_TTL_SEC   = 6 * 3600;
const WX_REFRESH_AHEAD_MS = 75 * 60 * 1000; // Trigger windows may drift up to an hour; refresh early.
const SHEET_TTL_MS  = 6 * 3600 * 1000;
const METRIC_TTL_MS = 6 * 3600 * 1000;

// In-memory per-run index: day+key -> { byHour: {HH: {rowIndex, rowValues}}, headerLen, numCols, key, dayStr }
const _DAY_INDEX = {};

function getAppUrl(){
  try { return ScriptApp.getService().getUrl(); } catch(_) { return ''; }
}
function cacheKey(prefix, lat, lon, tz, extra) {
  return `${prefix}:${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}:${tz}${extra?':'+extra:''}`;
}
/** Persistent last-good JSON cache, stored in a dedicated Drive folder.
 * CacheService is optional acceleration, not the source of truth.
 * One file per endpoint/location/date key; expiry measured from last SUCCESS.
 */
const WX_CACHE_FOLDER = 'MarineWeatherApiCache_v390_PROD';
const WX_MAX_STALE_MS = 24 * 3600 * 1000;
const WX_ASTRONOMY_MAX_STALE_MS = 48 * 3600 * 1000;
const WX_REPORT_READ_ONLY = true; // Emails and web reports never initiate Open-Meteo requests.
const WX_COOLDOWN_MS = 6 * 3600 * 1000;
const WX_MEMO = {};
const WX_STALE_USED = {};
let WX_REPORT_MODE = false; // Enabled around both email and web report rendering.
const WX_STATS = {apiRequests:0, cacheHits:0, cacheMisses:0, staleFallbacks:0, http429:0, errors:0};
function wxLocationLabel_(key) {
  const match = key.match(/^[^:]+:([-\d.]+),([-\d.]+):/);
  if (!match) return key;
  const lat = Number(match[1]), lon = Number(match[2]);
  const sites = [{name:CONFIG.LOCATION_NAME,lat:CONFIG.LAT,lon:CONFIG.LON}]
    .concat(Object.keys(BANKS).map(k=>BANKS[k]));
  const site = sites.find(x=>Number(x.lat).toFixed(3)===lat.toFixed(3) && Number(x.lon).toFixed(3)===lon.toFixed(3));
  return site ? site.name : lat.toFixed(3)+','+lon.toFixed(3);
}
function wxLogSummary_() {
  Logger.log('[API SUMMARY] Requests=' + WX_STATS.apiRequests +
    ' | Cache hits=' + WX_STATS.cacheHits +
    ' | Cache misses=' + WX_STATS.cacheMisses +
    ' | Stale fallbacks=' + WX_STATS.staleFallbacks +
    ' | HTTP 429=' + WX_STATS.http429 + ' | Errors=' + WX_STATS.errors);
}
let WX_FOLDER_MEMO = null;

function wxKey_(key) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key);
  return bytes.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}
function wxFolder_() {
  if (WX_FOLDER_MEMO) return WX_FOLDER_MEMO;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('WX_CACHE_FOLDER_ID');
  if (id) {
    try { WX_FOLDER_MEMO = DriveApp.getFolderById(id); WX_FOLDER_MEMO.getName(); return WX_FOLDER_MEMO; }
    catch (_) { /* Recreate if deleted */ }
  }
  // Isolated folder; do not reuse any existing folder by name.
  WX_FOLDER_MEMO = DriveApp.createFolder(WX_CACHE_FOLDER);
  props.setProperty('WX_CACHE_FOLDER_ID', WX_FOLDER_MEMO.getId());
  return WX_FOLDER_MEMO;
}
function wxRead_(key) {
  if (Object.prototype.hasOwnProperty.call(WX_MEMO, key)) return WX_MEMO[key];
  const name = wxKey_(key) + '.json';
  const files = wxFolder_().getFilesByName(name);
  if (!files.hasNext()) return (WX_MEMO[key] = null);
  try {
    const file = files.next();
    const record = JSON.parse(file.getBlob().getDataAsString());
    if (!record || record.key !== key || !record.savedAt || !record.data) return (WX_MEMO[key] = null);
    return (WX_MEMO[key] = record);
  } catch (e) {
    logWarn_('CACHE', 'Cannot read ' + key + ': ' + e);
    return (WX_MEMO[key] = null);
  }
}
function wxWrite_(key, data, sourceTimestamp) {
  const record = { key:key, savedAt:sourceTimestamp || Date.now(), data:data };
  const name = wxKey_(key) + '.json';
  const files = wxFolder_().getFilesByName(name);
  const body = JSON.stringify(record);
  if (files.hasNext()) files.next().setContent(body);
  else wxFolder_().createFile(name, body, MimeType.PLAIN_TEXT);
  WX_MEMO[key] = record;
  return record;
}
/**
 * READ-ONLY CACHE INTEGRITY DIAGNOSTIC (v3.8.5c).
 * Run wxCacheIntegrityDiagnostic() manually from the Apps Script editor.
 * Never refreshes APIs, edits cache files, or modifies the email/web output.
 * Logs the exact cache key, matching file count, selected record, newest
 * valid record, and age in hours for weather and marine at three locations.
 * "Selected" reproduces wxRead_() first-file selection for comparison.
 */
function wxCacheIntegrityDiagnostic() {
  const tz = CONFIG.TIMEZONE;
  const now = Date.now();
  const locations = [
    {name:'Kingston / Maiden Cay', lat:CONFIG.LAT, lon:CONFIG.LON},
    {name:'Mackerel (Bowditch)', lat:17.520, lon:-76.947},
    {name:'California Bank', lat:17.750, lon:-76.783}
  ];
  const folderId = PropertiesService.getScriptProperties().getProperty('WX_CACHE_FOLDER_ID');
  // Do not call wxFolder_ here: it can create a folder / change script properties.
  if (!folderId) {
    Logger.log('[CACHE DIAGNOSTIC] No WX_CACHE_FOLDER_ID script property. No changes made.');
    return;
  }
  let folder;
  try { folder = DriveApp.getFolderById(folderId); folder.getName(); }
  catch (e) { Logger.log('[CACHE DIAGNOSTIC] Cache folder inaccessible: ' + e); return; }
  const fmt = ms => ms == null ? 'N/A' : Utilities.formatDate(new Date(ms), tz, 'yyyy-MM-dd HH:mm:ss') + ' Jamaica';
  const hours = ms => ms == null ? 'N/A' : ((now-ms)/3600000).toFixed(2) + ' h';
  Logger.log('[CACHE DIAGNOSTIC] Started ' + fmt(now) + ' | folder=' + folderId + ' | READ ONLY');
  locations.forEach(site => ['forecast','marine'].forEach(type => {
    const key = cacheKey(type, site.lat, site.lon, tz) + (type === 'marine' ? ':cur' : '');
    const name = wxKey_(key) + '.json';
    const files = folder.getFilesByName(name);
    let count = 0, selected = null, newest = null, valid = 0, errors = 0;
    while (files.hasNext()) {
      const file = files.next();
      count++;
      let record = null;
      try {
        record = JSON.parse(file.getBlob().getDataAsString());
        if (!record || record.key !== key || !record.data || !Number.isFinite(Number(record.savedAt)) || Number(record.savedAt) <= 0) {
          record = null;
        }
      } catch (_) { errors++; }
      const entry = {
        fileId:file.getId(),
        savedAt:record ? Number(record.savedAt) : null,
        modifiedAt:file.getLastUpdated().getTime(),
        valid:!!record
      };
      if (count === 1) selected = entry;
      if (entry.valid) {
        valid++;
        if (!newest || entry.savedAt > newest.savedAt) newest = entry;
      }
    }
    const show = entry => entry ? ('savedAt=' + fmt(entry.savedAt) +
      ' | age=' + hours(entry.savedAt) + ' | DriveModified=' + fmt(entry.modifiedAt) +
      ' | valid=' + entry.valid + ' | fileId=' + entry.fileId) : 'NONE';
    Logger.log('[CACHE DIAGNOSTIC] ' + site.name + ' / ' + type +
      '\n  key=' + key + '\n  matchingFiles=' + count + ' validFiles=' + valid + ' parseErrors=' + errors +
      '\n  selected(first file)=' + show(selected) +
      '\n  newest(valid savedAt)=' + show(newest) +
      '\n  selectedIsNewest=' + (!!selected && !!newest && selected.fileId === newest.fileId));
  }));
  Logger.log('[CACHE DIAGNOSTIC] Complete. No cache or API changes made.');
}

function wxProvider_(key) {
  return key.indexOf('astroVC:') === 0 ? 'visualcrossing' :
         key.indexOf('marine:') === 0 ? 'openmeteo-marine' : 'openmeteo-forecast';
}
function wxCooldown_(provider) {
  return 'WX_COOLDOWN_' + provider;
}
function wxLastGood_(key, maxAgeMs) {
  const record = wxRead_(key);
  return record && Date.now() - record.savedAt <= maxAgeMs ? record.data : null;
}
function cachedFetchJson(key, url, ttlSec) {
  const ttlMs = Math.min(86400, Math.max(60, Number(ttlSec) || API_TTL_SEC)) * 1000;
  const provider = wxProvider_(key);
  const props = PropertiesService.getScriptProperties();
  const fresh = wxLastGood_(key, ttlMs);
  if (fresh) { WX_STATS.cacheHits++; Logger.log('[CACHE HIT] '+wxLocationLabel_(key)+' ('+(fresh._wxSource || provider)+')'); return fresh; }
  WX_STATS.cacheMisses++; Logger.log('[CACHE MISS] '+wxLocationLabel_(key)+' ('+provider+')');
  if (WX_REPORT_READ_ONLY && WX_REPORT_MODE && provider !== 'visualcrossing') {
    const previous = wxLastGood_(key, WX_MAX_STALE_MS);
    if (previous) {
      WX_STALE_USED[key] = wxRead_(key).savedAt;
      WX_STATS.staleFallbacks++;
      logWarn_('STALE', key + ' report used saved data; refresh required');
      return previous;
    }
    throw new Error('Forecast data is unavailable or more than 24 hours old for ' + wxLocationLabel_(key));
  }
  const cooldownUntil = Number(props.getProperty(wxCooldown_(provider)) || 0);
  if (cooldownUntil > Date.now()) {
    const stale = wxLastGood_(key, provider === 'visualcrossing' ? WX_ASTRONOMY_MAX_STALE_MS : WX_MAX_STALE_MS);
    if (stale) { WX_STALE_USED[key] = wxRead_(key).savedAt; WX_STATS.staleFallbacks++; logWarn_('STALE', key + ' provider cooldown; using cached data'); return stale; }
    throw new Error(provider + ' API cooling down; no cached data within 24 hours');
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    const stale = wxLastGood_(key, provider === 'visualcrossing' ? WX_ASTRONOMY_MAX_STALE_MS : WX_MAX_STALE_MS);
    if (stale) { WX_STALE_USED[key] = wxRead_(key).savedAt; WX_STATS.staleFallbacks++; return stale; }
    throw new Error('Weather refresh busy and no valid cached data: ' + key);
  }
  try {
    // Refresh memo because another execution may have populated the file while waiting.
    delete WX_MEMO[key];
    const second = wxLastGood_(key, ttlMs);
    if (second) { WX_STATS.cacheHits++; Logger.log('[CACHE HIT after lock] '+wxLocationLabel_(key)); return second; }
    if (Number(props.getProperty(wxCooldown_(provider)) || 0) > Date.now()) {
      const stale = wxLastGood_(key, provider === 'visualcrossing' ? WX_ASTRONOMY_MAX_STALE_MS : WX_MAX_STALE_MS);
      if (stale) { WX_STALE_USED[key] = wxRead_(key).savedAt; WX_STATS.staleFallbacks++; return stale; }
      throw new Error(provider + ' API cooling down; no usable cache');
    }
    let response, status, body;
    try {
      WX_STATS.apiRequests++; Logger.log('[API REQUEST] '+wxLocationLabel_(key)+' ('+provider+')');
      response = UrlFetchApp.fetch(url, { muteHttpExceptions:true, followRedirects:true });
      status = response.getResponseCode();
      body = response.getContentText();
    } catch (err) {
      const stale = wxLastGood_(key, provider === 'visualcrossing' ? WX_ASTRONOMY_MAX_STALE_MS : WX_MAX_STALE_MS);
      if (stale) { WX_STALE_USED[key] = wxRead_(key).savedAt; WX_STATS.staleFallbacks++; logWarn_('STALE', 'Network error: ' + err); return stale; }
      throw err;
    }
    if (status === 200) {
      const parsed = JSON.parse(body);
      if (!parsed || parsed.error || !parsed.hourly && !parsed.daily && !parsed.days)
        throw new Error('Invalid API payload for ' + key);
      wxWrite_(key, parsed);
      props.deleteProperty(wxCooldown_(provider));
      return parsed;
    }
    if (status === 429) {
      WX_STATS.http429++;
      props.setProperty(wxCooldown_(provider), String(Date.now() + WX_COOLDOWN_MS));
      logWarn_('429', provider + ' quota reached. Suppressing requests for 6 hours.');
    }
    const stale = wxLastGood_(key, provider === 'visualcrossing' ? WX_ASTRONOMY_MAX_STALE_MS : WX_MAX_STALE_MS);
    if (stale) { WX_STALE_USED[key] = wxRead_(key).savedAt; WX_STATS.staleFallbacks++; logWarn_('STALE', key + ' HTTP ' + status); return stale; }
    WX_STATS.errors++;
    const err = new Error(provider + ' API error ' + status + ': ' + String(body).slice(0, 250));
    err.httpStatus = status;
    throw err;
  } finally { lock.releaseLock(); }
}

/** v3.8.2: install four Jamaica-time daily refresh windows.
 * Apps Script triggers fire within the selected hour, not at an exact minute.
 * Run once after upgrading; removes the legacy v3.8 refresh triggers.
 */
function installMarineRefreshV382() {
  mw390RequireProduction_('triggers');
  const handlers = ['refreshMarineDataV38', 'refreshMarineDataV382', 'refreshMarineDataV383'];
  ScriptApp.getProjectTriggers().forEach(t => {
    if (handlers.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  [1,7,13,19].forEach(hour => ScriptApp.newTrigger('refreshMarineDataV383')
    .timeBased().atHour(hour).everyDays(1).inTimezone('America/Jamaica').create());
  Logger.log('[SCHEDULE] Installed refresh windows: 01, 07, 13, 19 Jamaica time');
}
/** Compatibility entry points for old manual workflows. */
function installMarineRefreshV38() { return installMarineRefreshV383(); }
function refreshMarineDataV38() { return refreshMarineDataV383(); }
function installMarineRefreshV383() { return installMarineRefreshV382(); }
function refreshMarineDataV383() { return refreshMarineDataV382(); }

function wxSitesV382_() {
  const seen = {};
  return [{name:CONFIG.LOCATION_NAME,lat:CONFIG.LAT,lon:CONFIG.LON}]
    .concat(Object.keys(BANKS).map(k => BANKS[k]))
    .filter(site => {
      const k = Number(site.lat).toFixed(5)+','+Number(site.lon).toFixed(5);
      if (seen[k]) return false;
      seen[k] = true; return true;
    });
}
function wxEndpointSpecV382_(type) {
  if (type === 'forecast') return {
    base:'https://api.open-meteo.com/v1/forecast',
    query:'&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,cloudcover,precipitation,precipitation_probability,temperature_2m,relative_humidity_2m,uv_index,surface_pressure' +
      '&daily=weathercode,precipitation_sum,precipitation_probability_max,precipitation_hours,sunrise,sunset,uv_index_max' +
      '&windspeed_unit=kn'
  };
  return {
    base:'https://marine-api.open-meteo.com/v1/marine',
    query:'&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_level_height_msl,sea_surface_temperature,ocean_current_velocity,ocean_current_direction'
  };
}
/** Assess persisted cache ages; do not change subscriber cache TTL. */
function wxBatchCacheStatusV384d_(keys) {
  const now = Date.now();
  const ttl = API_TTL_SEC * 1000;
  let oldestAge = 0, missing = 0, due = false;
  keys.forEach(key => {
    const record = wxRead_(key);
    if (!record || !Number.isFinite(Number(record.savedAt)) || Number(record.savedAt) > now) {
      missing++; due = true; return;
    }
    const age = now - Number(record.savedAt);
    oldestAge = Math.max(oldestAge, age);
    if (age >= ttl - WX_REFRESH_AHEAD_MS) due = true;
  });
  return {due:due, missing:missing, oldestAgeMs:oldestAge,
    remainingMs: missing ? 0 : Math.max(0, ttl - oldestAge)};
}
function wxBatchAgeTextV384d_(ms) { return Math.round(ms / 60000) + ' min'; }
/** Batch refresh one endpoint for all sites. Each result is persisted under
 * the SAME per-location keys used by existing renderers. No API provider names
 * are passed into subscriber-facing content.
 */
/** v3.8.5: VC fallback for atmospheric forecast only. VC does not provide the
 * ocean wave/current fields used by the marine renderer; never substitute VC
 * weather for missing marine observations. All values are converted into the
 * Open-Meteo-shaped arrays consumed by the existing reports.
 * Script Property: VISUAL_CROSSING_KEY (recommended). No secrets in source.
 */
function wxVcFallbackForecastV385_(site, tz) {
  const key = PropertiesService.getScriptProperties().getProperty('VISUAL_CROSSING_KEY') || CONFIG.VISUAL_KEY;
  if (!key) { Logger.log('[FALLBACK SKIP] Visual Crossing key not configured'); return null; }
  const url = 'https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/' +
    encodeURIComponent(site.lat + ',' + site.lon) + '?unitGroup=metric&include=hours,days' +
    '&elements=datetime,datetimeEpoch,temp,humidity,precip,precipprob,precipcover,cloudcover,windspeed,windgust,winddir,pressure,uvindex,conditions,icon,sunrise,sunset' +
    '&key=' + encodeURIComponent(key) + '&contentType=json';
  const resp = UrlFetchApp.fetch(url, {muteHttpExceptions:true,followRedirects:true});
  WX_STATS.apiRequests++;
  const status = resp.getResponseCode();
  if (status === 429) {
    WX_STATS.http429++;
    PropertiesService.getScriptProperties().setProperty(wxCooldown_('visualcrossing-weather'), String(Date.now()+WX_COOLDOWN_MS));
    throw new Error('Visual Crossing forecast quota exceeded');
  }
  if (status !== 200) throw new Error('Visual Crossing forecast HTTP ' + status);
  const json = JSON.parse(resp.getContentText());
  if (!json.days || !json.days.length) throw new Error('Visual Crossing forecast missing days');
  const h = {time:[],wind_speed_10m:[],wind_gusts_10m:[],wind_direction_10m:[],cloudcover:[],precipitation:[],temperature_2m:[],relative_humidity_2m:[],uv_index:[],surface_pressure:[]};
  const d = {time:[],weathercode:[],precipitation_sum:[],precipitation_probability_max:[],precipitation_hours:[],sunrise:[],sunset:[],uv_index_max:[]};
  const n = v => v == null || v === '' ? null : (isFinite(Number(v)) ? Number(v) : null);
  const kn = v => n(v) == null ? null : n(v) * 0.539956803; // VC metric winds are km/h.
  const code = day => {
    const s = String(day.conditions || '').toLowerCase();
    if (/thunder/.test(s)) return 95;
    if (/snow/.test(s)) return 71;
    if (/rain|showers|drizzle/.test(s)) return 61;
    if (/fog|mist/.test(s)) return 45;
    if (/overcast/.test(s)) return 3;
    if (/cloud/.test(s)) return 2;
    return 0;
  };
  json.days.forEach(day => {
    const date = day.datetime;
    d.time.push(date); d.weathercode.push(code(day));
    d.precipitation_sum.push(n(day.precip)); d.precipitation_probability_max.push(n(day.precipprob));
    d.precipitation_hours.push(n(day.precipcover) == null ? null : 24*n(day.precipcover)/100);
    d.sunrise.push(day.sunrise ? date+'T'+day.sunrise.slice(0,5) : null);
    d.sunset.push(day.sunset ? date+'T'+day.sunset.slice(0,5) : null);
    d.uv_index_max.push(n(day.uvindex));
    (day.hours || []).forEach(hour => {
      h.time.push(date+'T'+String(hour.datetime).slice(0,5));
      h.wind_speed_10m.push(kn(hour.windspeed)); h.wind_gusts_10m.push(kn(hour.windgust));
      h.wind_direction_10m.push(n(hour.winddir)); h.cloudcover.push(n(hour.cloudcover));
      h.precipitation.push(n(hour.precip)); h.temperature_2m.push(n(hour.temp));
      h.relative_humidity_2m.push(n(hour.humidity)); h.uv_index.push(n(hour.uvindex));
      h.surface_pressure.push(n(hour.pressure));
    });
  });
  if (!h.time.length) throw new Error('Visual Crossing forecast missing hourly data');
  return {hourly:h,daily:d, hourly_units:{wind_speed_10m:'kn',wind_gusts_10m:'kn'},
    timezone:tz, _wxSource:'visualcrossing-weather'};
}
function wxForecastFallbackBatchV385_(sites, keys, reason) {
  const props = PropertiesService.getScriptProperties();
  if (Number(props.getProperty(wxCooldown_('visualcrossing-weather')) || 0) > Date.now()) {
    Logger.log('[FALLBACK SKIP] Visual Crossing weather cooldown'); return;
  }
  Logger.log('[FALLBACK] Open-Meteo forecast failed ('+reason+'); trying Visual Crossing per site');
  let ok=0, failed=0;
  sites.forEach((site,i) => {
    try {
      const result=wxVcFallbackForecastV385_(site, CONFIG.TIMEZONE);
      if (result) { wxWrite_(keys[i], result, Date.now()); ok++; }
    } catch(e) { failed++; logWarn_('FALLBACK',site.name+': '+e.message); }
  });
  Logger.log('[FALLBACK SUMMARY] VC forecast updated='+ok+' failed='+failed);
}
/** v3.8.5a: Strict response validation, with bounded sub-batch recovery.
 * A broken multi-location JSON response must not discard valid locations.
 * No API URLs, keys or raw response content are logged.
 */
function wxParseBatchV385a_(response, expected, type) {
  const body = response.getContentText();
  let parsed;
  try { parsed = JSON.parse(body); }
  catch (e) {
    Logger.log('[BATCH JSON] '+type+' invalid JSON bytes='+body.length+
      ' expectedLocations='+expected+' error='+String(e.message).slice(0,180));
    return null;
  }
  const results = Array.isArray(parsed) ? parsed : [parsed];
  if (results.length !== expected || results.some(x => !x || x.error ||
      !x.hourly || !Array.isArray(x.hourly.time) || !x.hourly.time.length ||
      (type === 'forecast' && (!x.daily || !Array.isArray(x.daily.time))))) {
    Logger.log('[BATCH SHAPE] '+type+' expected='+expected+' received='+results.length);
    return null;
  }
  return results;
}
function wxRecoverForecastV385a_(sites, keys, tz, spec) {
  let recovered=0, failed=0;
  const missingSites=[], missingKeys=[];
  // Smaller batches avoid the 13-location response that triggered the JSON error.
  // At most four additional requests, then VC for unsuccessful locations only.
  for (let start=0; start<sites.length; start+=4) {
    const subset=sites.slice(start,start+4);
    const subsetKeys=keys.slice(start,start+4);
    const url=spec.base+'?latitude='+encodeURIComponent(subset.map(x=>x.lat).join(','))+
      '&longitude='+encodeURIComponent(subset.map(x=>x.lon).join(','))+
      spec.query+'&timezone='+encodeURIComponent(tz);
    let valid=null;
    try {
      WX_STATS.apiRequests++;
      const resp=UrlFetchApp.fetch(url,{muteHttpExceptions:true,followRedirects:true});
      const code=resp.getResponseCode();
      if (code===429) {
        WX_STATS.http429++;
        PropertiesService.getScriptProperties().setProperty(wxCooldown_('openmeteo-forecast'),String(Date.now()+WX_COOLDOWN_MS));
        Logger.log('[BATCH RECOVERY] Open-Meteo HTTP 429; stopping retries');
        missingSites.push(...sites.slice(start)); missingKeys.push(...keys.slice(start));
        break;
      }
      if (code===200) valid=wxParseBatchV385a_(resp,subset.length,'forecast');
      else Logger.log('[BATCH RECOVERY] Open-Meteo HTTP '+code+' locations='+subset.length);
    } catch(e) { Logger.log('[BATCH RECOVERY] '+String(e.message).slice(0,180)); }
    if (valid) {
      const stamp=Date.now();
      valid.forEach((data,i)=>wxWrite_(subsetKeys[i],data,stamp));
      recovered+=valid.length;
    } else {
      failed+=subset.length;
      missingSites.push(...subset); missingKeys.push(...subsetKeys);
    }
  }
  Logger.log('[BATCH RECOVERY SUMMARY] Open-Meteo recovered='+recovered+' VC needed='+missingSites.length);
  if (missingSites.length) wxForecastFallbackBatchV385_(missingSites,missingKeys,'Open-Meteo batch recovery incomplete');
  return recovered;
}
function wxRefreshBatchV382_(type, sites, tz) {
  const isMarine = type === 'marine';
  const provider = isMarine ? 'openmeteo-marine' : 'openmeteo-forecast';
  const keys = sites.map(site => cacheKey(type, site.lat, site.lon, tz) + (isMarine ? ':cur' : ''));
  const now = Date.now();
  const props = PropertiesService.getScriptProperties();
  const status = wxBatchCacheStatusV384d_(keys);
  Logger.log('[BATCH CHECK] '+type+' oldest='+wxBatchAgeTextV384d_(status.oldestAgeMs)+
    ' remaining='+wxBatchAgeTextV384d_(status.remainingMs)+
    ' missing='+status.missing+' refreshAhead='+wxBatchAgeTextV384d_(WX_REFRESH_AHEAD_MS));
  if (!status.due) {
    Logger.log('[BATCH SKIP] '+type+' cache safely outside refresh-ahead window');
    return;
  }
  Logger.log('[BATCH DUE] '+type+' reason='+(status.missing ? 'missing cache' :
    status.remainingMs === 0 ? 'expired cache' : 'within refresh-ahead window'));
  const providerCooling = Number(props.getProperty(wxCooldown_(provider)) || 0) > now;
  if (providerCooling && (isMarine || (!status.missing && status.remainingMs > 0))) {
    logWarn_('BATCH', type+' in cooldown; keeping last successful data');
    return;
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) { logWarn_('BATCH',type+' skipped: another refresh is running'); return; }
  try {
    keys.forEach(k => { delete WX_MEMO[k]; });
    const lockedStatus = wxBatchCacheStatusV384d_(keys);
    if (!lockedStatus.due) {
      Logger.log('[BATCH SKIP] '+type+' cache refreshed by another execution');
      return;
    }
    if (Number(props.getProperty(wxCooldown_(provider)) || 0) > Date.now()) {
      if (!isMarine && (lockedStatus.missing || lockedStatus.remainingMs === 0)) {
        Logger.log('[BATCH FALLBACK] forecast expired or missing during Open-Meteo cooldown; trying Visual Crossing');
        wxForecastFallbackBatchV385_(sites, keys, 'Open-Meteo cooldown; expired or missing cache');
      } else {
        logWarn_('BATCH', type+' in cooldown; keeping last successful data');
      }
      return;
    }
    const spec = wxEndpointSpecV382_(type);
    const lat = sites.map(x => x.lat).join(',');
    const lon = sites.map(x => x.lon).join(',');
    const url = spec.base+'?latitude='+encodeURIComponent(lat)+'&longitude='+encodeURIComponent(lon)+
      spec.query+'&timezone='+encodeURIComponent(tz);
    WX_STATS.apiRequests++;
    Logger.log('[API REQUEST] '+type+' batched locations='+sites.length);
    let response = UrlFetchApp.fetch(url, {muteHttpExceptions:true,followRedirects:true});
    let status = response.getResponseCode();
    if (!isMarine && (status === 400 || status === 422)) {
      WX_STATS.apiRequests++;
      Logger.log('[API REQUEST] weather compatibility retry without optional probability');
      response = UrlFetchApp.fetch(url.replace(',precipitation_probability', ''),
        {muteHttpExceptions:true,followRedirects:true});
      status = response.getResponseCode();
    }
    // Some marine models do not support currents. Retry only on a parameter error,
    // never on a quota or server error. Preserve the same :cur cache key so that
    // downstream reports can use the compatible payload transparently.
    if (isMarine && (status === 400 || status === 422)) {
      // Optional swell parameters may not be supported by the selected marine model.
      // Fall back to the known-working request without losing currents.
      const reduced = url.replace(',swell_wave_height,swell_wave_direction,swell_wave_period', '');
      WX_STATS.apiRequests++;
      Logger.log('[API REQUEST] marine compatibility retry without optional swell fields');
      response = UrlFetchApp.fetch(reduced, {muteHttpExceptions:true,followRedirects:true});
      status = response.getResponseCode();
      if (status === 400 || status === 422) {
        WX_STATS.apiRequests++;
        Logger.log('[API REQUEST] marine compatibility retry without currents');
        response = UrlFetchApp.fetch(reduced.replace(',ocean_current_velocity,ocean_current_direction', ''),
          {muteHttpExceptions:true,followRedirects:true});
        status = response.getResponseCode();
      }
    }
    if (status === 429) {
      WX_STATS.http429++;
      props.setProperty(wxCooldown_(provider), String(Date.now()+WX_COOLDOWN_MS));
      logWarn_('429',provider+' quota reached; cooldown applied');
      if (!isMarine) wxForecastFallbackBatchV385_(sites, keys, 'HTTP 429');
      return;
    }
    if (status !== 200) {
      WX_STATS.errors++;
      logWarn_('BATCH',type+' HTTP '+status+'; retaining previous data');
      if (!isMarine) wxForecastFallbackBatchV385_(sites, keys, 'HTTP '+status);
      return;
    }
    const results = wxParseBatchV385a_(response, sites.length, type);
    if (!results) {
      WX_STATS.errors++;
      logWarn_('BATCH',type+' invalid JSON or response shape; previous data retained until replacement');
      if (!isMarine) wxRecoverForecastV385a_(sites, keys, tz, spec);
      return;
    }
    const savedAt = Date.now();
    results.forEach((data, i) => wxWrite_(keys[i], data, savedAt));
    props.deleteProperty(wxCooldown_(provider));
    Logger.log('[BATCH] '+type+' updated '+results.length+' locations source=Open-Meteo');
  } catch(e) { WX_STATS.errors++; logWarn_('BATCH',type+' '+e); if (!isMarine) wxForecastFallbackBatchV385_(sites, keys, 'exception'); }
  finally { lock.releaseLock(); }
}
function refreshMarineDataV382() {
  mw390RequireProduction_('refresh');
  const tz = CONFIG.TIMEZONE;
  const sites = wxSitesV382_();
  wxRefreshBatchV382_('forecast', sites, tz);
  wxRefreshBatchV382_('marine', sites, tz);
  // Astronomy cache uses the existing 24-hour per-date logic.
  [0,1].forEach(offset => {
    const d = new Date(Date.now()+offset*86400000);
    const iso = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    try { fetchAstronomyVC(CONFIG.LAT, CONFIG.LON, tz, iso); }
    catch(e) { logWarn_('REFRESH','Astronomy '+iso+': '+e); }
  });
  try { mw8PublishSnapshots_(); } catch(snapshotErr) { Logger.log('[SNAPSHOT] Previous published version retained: '+snapshotErr); }
  wxLogSummary_();
}

/* ========================= FETCHERS ========================= */
function fetchForecast(lat, lon, tz){
  const key = cacheKey('forecast', lat, lon, tz);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`
    + `&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,cloudcover,precipitation,precipitation_probability,temperature_2m,relative_humidity_2m,uv_index,surface_pressure`
    + `&daily=weathercode,precipitation_sum,precipitation_probability_max,precipitation_hours,sunrise,sunset,uv_index_max`
    + `&windspeed_unit=kn&timezone=${encodeURIComponent(tz)}`;
  return cachedFetchJson(key, url, API_TTL_SEC);
}
function fetchMarine(lat, lon, tz){
  const keyBase = cacheKey('marine', lat, lon, tz);
  const urlWithCurrents = 'https://marine-api.open-meteo.com/v1/marine'
    + '?latitude=' + encodeURIComponent(lat)
    + '&longitude=' + encodeURIComponent(lon)
    + '&hourly=' + [
      'wave_height','wave_direction','wave_period',
      'swell_wave_height','swell_wave_direction','swell_wave_period',
      'sea_level_height_msl','sea_surface_temperature',
      'ocean_current_velocity','ocean_current_direction'
    ].join(',')
    + '&timezone=' + encodeURIComponent(tz);
  try {
    const json = cachedFetchJson(keyBase + ':cur', urlWithCurrents, API_TTL_SEC);
    logOk_('MARINE', 'Marine data loaded (waves/SST/sea-level/currents)');
    return json;
  } catch (e) {
    if (e.httpStatus !== 400 && e.httpStatus !== 422) throw e;
    logWarn_('MARINE', 'Currents unsupported, trying without: ' + e);
    const urlNoCurrents = 'https://marine-api.open-meteo.com/v1/marine'
      + '?latitude=' + encodeURIComponent(lat)
      + '&longitude=' + encodeURIComponent(lon)
      + '&hourly=' + [
        'wave_height','wave_direction','wave_period',
      'swell_wave_height','swell_wave_direction','swell_wave_period',
        'sea_level_height_msl','sea_surface_temperature'
      ].join(',')
      + '&timezone=' + encodeURIComponent(tz);
    const json = cachedFetchJson(keyBase + ':nocur', urlNoCurrents, API_TTL_SEC);
    logOk_('MARINE', 'Marine data loaded (no currents)');
    return json;
  }
}
function fetchLocalMarineImageUrl_(){
  var pageUrl = CONFIG.LOCAL_MARINE_IMAGE_PAGE || 'https://jamaica.weatherproof.fi/web/marine2.php';
  var tz = CONFIG.TIMEZONE || 'Etc/UTC';

  // Cache for ~10 minutes (fast, still fresh)
  var cache = CacheService.getScriptCache();
  var key = 'localMarineImg:' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd') + ':' + Math.floor(Date.now() / 600000);
// yyyy-MM-dd:HH:m
  var cached = cache.get(key);
  if (cached) return cached;

  var res = UrlFetchApp.fetch(pageUrl, { muteHttpExceptions:true, followRedirects:true });
  var code = res.getResponseCode();
  var html = res.getContentText() || '';

  if (code !== 200 || !html) return '';

  // Extract first <img ... src="...">
  var m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (!m || !m[1]) return '';

  var src = String(m[1]).trim();

  // Make absolute if needed
  if (src && src.indexOf('http') !== 0) {
    try {
      var base = new URL(pageUrl);
      src = base.origin + (src.charAt(0) === '/' ? '' : '/') + src;
    } catch(e) {}
  }

  try { cache.put(key, src, 10 * 60); } catch(_) {}
  return src;
}

function renderLocalMarineImageBlock_(){
  var pageUrl = CONFIG.LOCAL_MARINE_IMAGE_PAGE || 'https://jamaica.weatherproof.fi/web/marine2.php';
  var imgUrl = fetchLocalMarineImageUrl_();
  if (!imgUrl) {
    return '<a href="'+pageUrl+'" target="_blank" rel="noopener noreferrer" '
      + 'style="display:inline-block;padding:10px 14px;border-radius:8px;background:#0f766e;color:#fff;text-decoration:none;font-weight:700;">'
      + 'Open Local Marine Map'
      + '</a>';
  }
  // otherwise keep the image version (same as earlier)
  return ''
    + '<div style="margin:10px 0 12px 0;">'
    +   '<a href="'+pageUrl+'" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">'
    +     '<img src="'+imgUrl+'" style="width:70%;max-width:640px;height:auto;border:1px solid #e5e7eb;border-radius:10px;display:block;margin:0 auto;" />'
    +   '</a>'
    + '</div>';
}


/* ========================= VISUAL CROSSING ASTRONOMY ========================= */
function fetchAstronomyVC(lat, lon, tz, dayIso){
  const vcKey = PropertiesService.getScriptProperties().getProperty('VISUAL_CROSSING_KEY') || CONFIG.VISUAL_KEY;
  if (!vcKey) throw new Error('Missing VISUAL_CROSSING_KEY Script Property.');
  const key = cacheKey('astroVC', lat, lon, tz, dayIso);
  const base = 'https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline';
  const url  = `${base}/${encodeURIComponent(lat)},${encodeURIComponent(lon)}/${encodeURIComponent(dayIso)}`
             + `?unitGroup=metric&include=days&key=${encodeURIComponent(vcKey)}&contentType=json`;
  return cachedFetchJson(key, url, 24 * 3600);
}

// Single signature: parseVcTime_(s, dayIso, tz)
function parseVcTime_(s, dayIso, tz){
  if (!s) return null;
  var str = String(s).trim();
  if (!str) return null;

  // time-only like "18:23" or "18:23:00"
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(str)) {
    if (!dayIso || !/^\d{4}-\d{2}-\d{2}$/.test(String(dayIso))) return null;
    var parts = str.split(':');
    var hh = Number(parts[0]), mm = Number(parts[1]), ss = Number(parts[2] || 0);
    if (!isFinite(hh) || !isFinite(mm) || !isFinite(ss)) return null;

    var ymd = String(dayIso).split('-');
    var y = Number(ymd[0]), m = Number(ymd[1]) - 1, d = Number(ymd[2]);
    if (!isFinite(y) || !isFinite(m) || !isFinite(d)) return null;

    var dt = new Date(y, m, d, hh, mm, ss);
    if (isNaN(dt.getTime())) return null;
    return dt;
  }

  // ISO with offset like "2025-12-12T18:23:00-0500"
  try {
    if (/^[\d-]+T[\d:]+\-\d{4}$/.test(str)) str = str.replace(/(\-)(\d{2})(\d{2})$/, '$1$2:$3');
    var d2 = new Date(str);
    if (isNaN(d2.getTime())) return null;
    return d2;
  } catch (_) {
    return null;
  }
}

function moonLabelAccurate(p){
  if (p < 0.03 || p > 0.97) return 'New Moon';
  if (p < 0.22) return 'Waxing Crescent';
  if (p < 0.28) return 'First Quarter';
  if (p < 0.47) return 'Waxing Gibbous';
  if (p < 0.53) return 'Full Moon';
  if (p < 0.72) return 'Waning Gibbous';
  if (p < 0.78) return 'Last Quarter';
  return 'Waning Crescent';
}
function moonLabelFromFraction_(p){ return moonLabelAccurate(p); }

// Single correct moonInfoFromVC()
function moonInfoFromVC(range, tz, lat, lon){
  const dayIso = Utilities.formatDate(range.start, tz, 'yyyy-MM-dd');
  const data = fetchAstronomyVC(lat, lon, tz, dayIso);
  const day = data && data.days && data.days.length ? data.days[0] : null;

  const p = (day && (day.moonphase != null)) ? Number(day.moonphase) : null;

  let illumPct = null;
  if (day && day.moonillumination != null) {
    const iv = Number(day.moonillumination);
    illumPct = isFinite(iv) ? (iv <= 1.01 ? Math.round(iv * 1000) / 10 : Math.round(iv * 10) / 10) : null;
  } else if (p != null) {
    const illum = 0.5 * (1 - Math.cos(2 * Math.PI * p));
    illumPct = Number((illum * 100).toFixed(1));
  }

  const rise    = day ? parseVcTime_(day.moonrise,    dayIso, tz) : null;
  const set     = day ? parseVcTime_(day.moonset,     dayIso, tz) : null;
  const transit = day ? parseVcTime_(day.moontransit, dayIso, tz) : null;

  const maxAltDt = (function(){
    const start = range.start.getTime(), end = range.end.getTime();
    if (transit && transit.getTime() >= start && transit.getTime() <= end) return transit;
    if (rise && set) {
      const mid = new Date((rise.getTime() + set.getTime()) / 2);
      const t = mid.getTime();
      if (t >= start && t <= end) return mid;
    }
    return null;
  })();

  return {
    label: (p != null) ? moonLabelFromFraction_(p) : '—',
    fraction: (p != null) ? Number(p.toFixed(3)) : null,
    illumination: illumPct,
    riseLocal: day && /^\\d{1,2}:\\d{2}(?::\\d{2})?$/.test(String(day.moonrise||'')) ? String(day.moonrise).slice(0,5) : (rise ? Utilities.formatDate(rise, tz, 'HH:mm') : null),
    setLocal:  day && /^\\d{1,2}:\\d{2}(?::\\d{2})?$/.test(String(day.moonset||'')) ? String(day.moonset).slice(0,5) : (set ? Utilities.formatDate(set, tz, 'HH:mm') : null),
    overheadTimeLocal: maxAltDt ? Utilities.formatDate(maxAltDt, tz, 'HH:mm') : null,
    overheadAltitudeDeg: null
  };
}
/* ========================= SHEET CACHE ========================= */
function cacheSheet(){
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const name = CONFIG.CACHE_SHEET_NAME || 'MarineCache';
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const header = [
    'key','lat','lon','day','hour','tz',
    'avgWaveM','avgWindKn','avgWavePeriodS',
    'peakWaveM','peakWindKn','peakGustKn',
    'avgSstC','swellDirMeanDeg','windDirMeanDeg',
    'uvHourlyMax','uvDailyMax','hiHourlyMaxC',
    'precipSumMm','cloudAvgPct',
    'pressureDeltaHpa','squallFlag','tideExtremaJson',
    'locationName','conditionColor','comfortScore',
    'rowCountHours','metrics_updated_at','created_at','updated_at','source_note',
    'avgCurrentKn','currentDirMeanDeg'
  ];
  if (sh.getLastRow() === 0) {
    sh.appendRow(header);
  } else {
    const current = sh.getRange(1,1,1,header.length).getValues()[0];
    const same = current.length === header.length && current.every((v,i)=>String(v)===header[i]);
    if (!same) throw new Error('MarineCache schema mismatch. Back up and migrate sheet instead of clearing data.');
  }
  return sh;
}

function cacheKeyFor(lat, lon, tz) { return `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}|${tz}`; }

// Day+key index helpers
function dayIndexKey_(lat, lon, tz, dayStr){
  return cacheKeyFor(lat, lon, tz) + '|' + String(dayStr);
}
function buildDayIndexIfNeeded_(lat, lon, tz, dayStr){
  const idxKey = dayIndexKey_(lat, lon, tz, dayStr);
  if (_DAY_INDEX[idxKey]) return _DAY_INDEX[idxKey];

  const sh = cacheSheet();
  const last = sh.getLastRow();
  const numCols = sh.getLastColumn();

  const byHour = {};
  if (last > 1) {
    const vals = sh.getRange(2, 1, last - 1, numCols).getValues();
    const key = cacheKeyFor(lat, lon, tz);

    for (let i = 0; i < vals.length; i++) {
      const r = vals[i];
      if (String(r[0]) !== key) continue;          // col A key
      if (String(r[3]) !== String(dayStr)) continue; // col D day
      const hh = String(r[4]).padStart(2,'0');     // col E hour
      byHour[hh] = { rowIndex: i + 2, rowValues: r }; // sheet row index
    }
  }

  _DAY_INDEX[idxKey] = { sh, numCols, byHour, key: cacheKeyFor(lat, lon, tz), dayStr: String(dayStr) };
  return _DAY_INDEX[idxKey];
}

function asNum_(x){
  return (typeof x === 'number' && isFinite(x)) ? x : (isFinite(Number(x)) ? Number(x) : null);
}

/**
 * Batch upsert cache rows for one (lat,lon,tz,day) keyed by hour.
 * - Updates contiguous runs with one setValues where possible.
 * - Appends new rows in one append block.
 */
function upsertCacheRowsBatch_(lat, lon, tz, dayStr, rowsByHour){
  const idx = buildDayIndexIfNeeded_(lat, lon, tz, dayStr);
  const sh = idx.sh;

  const updates = []; // {rowIndex, row:Array}
  const appends = []; // row:Array

  const nowIso = new Date().toISOString();

  Object.keys(rowsByHour).sort().forEach(hh => {
    const payload = rowsByHour[hh];
    const row = [
      idx.key, lat, lon, dayStr, hh, tz,
      payload.avgWaveM, payload.avgWindKn, payload.avgWavePeriodS,
      payload.peakWaveM, payload.peakWindKn, payload.peakGustKn,
      payload.avgSstC, payload.swellDirMeanDeg, payload.windDirMeanDeg,
      payload.uvHourlyMax, payload.uvDailyMax, payload.hiHourlyMaxC,
      payload.precipSumMm, payload.cloudAvgPct,
      payload.pressureDeltaHpa, payload.squallFlag ? 1 : 0, payload.tideExtremaJson || '',
      payload.locationName || CONFIG.LOCATION_NAME,
      payload.conditionColor || '',
      payload.comfortScore != null ? Number(payload.comfortScore) : null,
      payload.rowCountHours,
      payload.metrics_updated_at || nowIso,
      payload.created_at || nowIso,
      nowIso,
      payload.source_note || '',
      payload.avgCurrentKn != null ? Number(payload.avgCurrentKn) : null,
      payload.currentDirMeanDeg != null ? Number(payload.currentDirMeanDeg) : null
    ];

    const found = idx.byHour[hh];
    if (found && found.rowIndex) {
      // preserve created_at if existing
      const existing = found.rowValues || [];
      if (existing[28]) row[28] = existing[28];
      updates.push({ rowIndex: found.rowIndex, row });
    } else {
      appends.push(row);
    }
  });

  // Update: group contiguous rowIndex runs
  if (updates.length) {
    updates.sort((a,b)=>a.rowIndex-b.rowIndex);
    let runStart = 0;
    while (runStart < updates.length) {
      let runEnd = runStart;
      while (runEnd + 1 < updates.length && updates[runEnd+1].rowIndex === updates[runEnd].rowIndex + 1) runEnd++;
      const startRow = updates[runStart].rowIndex;
      const block = updates.slice(runStart, runEnd+1).map(x=>x.row);
      sh.getRange(startRow, 1, block.length, block[0].length).setValues(block);

      // refresh index for those hours
      for (let k=runStart;k<=runEnd;k++){
        const hh = String(updates[k].row[4]).padStart(2,'0');
        idx.byHour[hh] = { rowIndex: updates[k].rowIndex, rowValues: updates[k].row };
      }
      runStart = runEnd + 1;
    }
  }

  // Append in one go
  if (appends.length) {
    const start = sh.getLastRow() + 1;
    sh.getRange(start, 1, appends.length, appends[0].length).setValues(appends);

    // update index with new rows
    for (let i=0;i<appends.length;i++){
      const r = appends[i];
      const hh = String(r[4]).padStart(2,'0');
      idx.byHour[hh] = { rowIndex: start + i, rowValues: r };
    }
  }
}

/**
 * Cache cleanup: keep only the last N days (by local CONFIG.TIMEZONE day).
 * Default is 2 days: today and yesterday.
 */
function cleanupOldCacheRows_(maxAgeDaysBack) {
  try {
    var sh = cacheSheet();
    var last = sh.getLastRow();
    if (last <= 1) { logOk_('CLEAN', 'Cache empty. Nothing to delete.'); return; }

    if (!isFinite(maxAgeDaysBack) || maxAgeDaysBack < 0) {
      logWarn_('CLEAN', 'Invalid maxAgeDaysBack, skipping cleanup.');
      return;
    }

    var tz = CONFIG.TIMEZONE || Session.getScriptTimeZone() || 'Etc/UTC';
    var todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var today = new Date(todayStr + 'T00:00:00');

    var numRows = last - 1;
    var numCols = sh.getLastColumn();
    var data = sh.getRange(2, 1, numRows, numCols).getValues();
    var rowsToDelete = [];

    for (var i = 0; i < data.length; i++) {
      var rowIndex = i + 2;
      var row = data[i];
      var dayDate = normalizeDayToMidnight_(row[3]);
      if (!dayDate) { rowsToDelete.push(rowIndex); continue; }

      var ageMs = today.getTime() - dayDate.getTime();
      var ageDays = Math.floor(ageMs / (24 * 3600 * 1000));
      if (ageDays < 0) continue;
      if (ageDays > maxAgeDaysBack) rowsToDelete.push(rowIndex);
    }

    if (!rowsToDelete.length) { logOk_('CLEAN', 'No old/junk rows found to delete.'); return; }

    rowsToDelete.sort(function (a, b) { return b - a; });
    rowsToDelete.forEach(function (r) { sh.deleteRow(r); });

    // Clear in-memory index since sheet changed
    for (var k in _DAY_INDEX) delete _DAY_INDEX[k];

    logOk_('CLEAN', 'Deleted ' + rowsToDelete.length + ' old/junk cache row(s).');
  } catch (err) {
    logErr_('CLEAN', 'Cleanup failed: ' + err);
  }
}

function normalizeDayToMidnight_(raw) {
  if (raw instanceof Date) {
    var d = new Date(raw.getTime());
    d.setHours(0, 0, 0, 0);
    return d;
  }
  var s = String(raw || '').trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;

  var parts = s.split('-');
  var year  = Number(parts[0]);
  var month = Number(parts[1]) - 1;
  var day   = Number(parts[2]);
  if (!isFinite(year) || !isFinite(month) || !isFinite(day)) return null;

  var d2 = new Date(year, month, day);
  if (isNaN(d2.getTime())) return null;
  d2.setHours(0, 0, 0, 0);
  return d2;
}

/* ========================= TIME RANGES ========================= */
function getCurrentRange(tz){
  const nowLocalISO = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:00:00");
  const start = new Date(nowLocalISO), end = new Date(start.getTime() + 6*3600e3);
  return { start, end };
}
function getTomorrowRange(tz){
  const now = new Date();
  const dayStart = new Date(Utilities.formatDate(now, tz, 'yyyy-MM-dd') + 'T00:00:00');
  const t0 = new Date(dayStart.getTime() + 86400000); t0.setHours(7,0,0,0);
  const t1 = new Date(t0); t1.setHours(17,0,0,0);
  return { start: t0, end: t1 };
}
function getFullDayRange(d, tz){
  const dayStart=new Date(Utilities.formatDate(d,tz,'yyyy-MM-dd')+'T00:00:00');
  const dayEnd=new Date(dayStart.getTime()+24*3600*1000);
  return {start:dayStart,end:dayEnd};
}
function isInRange(iso,range){ const t=new Date(iso).getTime(); return t>=range.start.getTime() && t<range.end.getTime(); }
function toLocalHour(d,tz){ return Utilities.formatDate((d instanceof Date)?d:new Date(d), tz, 'EEE HH:mm'); }
function formatDateHuman(d,tz){ if(typeof d==='string') return d; return Utilities.formatDate(d, tz, 'EEE, MMM d'); }

/* ========================= UTIL ========================= */
function fmt(x,d){ return (x==null||isNaN(x))?'—':Number(x).toFixed(d); }
function round(x,d){ const p=Math.pow(10,d|0); return Math.round(x*p)/p; }
function isNum(x){ return typeof x==='number' && isFinite(x); }
function dirToCompass(deg){
  if(deg==null||isNaN(deg))return'—';
  const dirs=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const i=Math.floor((((deg%360)+360)%360)/22.5+0.5)%16;
  return dirs[i];
}
function circularMeanDeg(arr){
  let x=0,y=0;
  arr.forEach(d=>{ const r=d*Math.PI/180; x+=Math.cos(r); y+=Math.sin(r); });
  if(x===0&&y===0)return null;
  const mean=Math.atan2(y,x)*180/Math.PI;
  return (mean+360)%360;
}
function mToFt(m){ return (m==null||isNaN(m))?null:(m*3.28084); }
function cToF(c){ return (c==null||isNaN(c))?null:(c*9/5+32); }

/* ========================= JOIN/SUMMARY ========================= */
function joinHourly(marine, wind, range){
  const byIso = {};
  const mh = (marine && marine.hourly) ? marine.hourly : {};
  const units = (marine && marine.hourly_units) ? marine.hourly_units : {};
  const curUnit = String(units.ocean_current_velocity || '').toLowerCase();

  function toKn(v){
    v = Number(v);
    if (!isFinite(v)) return null;
    if (curUnit.includes('kn'))   return v;
    if (curUnit.includes('km/h')) return v * 0.539956803;
    if (curUnit.includes('m/s'))  return v * 1.943844492;
    if (curUnit.includes('mph'))  return v * 0.868976242;
    return v;
  }

  (mh.time || []).forEach((iso,i)=>{ if(!isInRange(iso,range))return;
    (byIso[iso]=byIso[iso]||{}).wave_m = mh.wave_height ? mh.wave_height[i] : null;
    byIso[iso].wave_period_s          = mh.wave_period ? mh.wave_period[i] : null;
    byIso[iso].swell_dir_deg          = mh.wave_direction ? mh.wave_direction[i] : null;
    byIso[iso].sea_level_m            = mh.sea_level_height_msl ? mh.sea_level_height_msl[i] : null;
    byIso[iso].sst_c                  = mh.sea_surface_temperature ? mh.sea_surface_temperature[i] : null;
    const curVel                      = mh.ocean_current_velocity ? mh.ocean_current_velocity[i] : null;
    byIso[iso].current_kn             = toKn(curVel);
    byIso[iso].current_dir_deg        = mh.ocean_current_direction ? mh.ocean_current_direction[i] : null;
  });

  const wh = (wind && wind.hourly) ? wind.hourly : {};
  (wh.time || []).forEach((iso,i)=>{ if(!isInRange(iso,range))return;
    (byIso[iso]=byIso[iso]||{}).wind_kn      = wh.wind_speed_10m ? wh.wind_speed_10m[i] : null;
    byIso[iso].wind_gust_kn                  = wh.wind_gusts_10m ? wh.wind_gusts_10m[i] : null;
    byIso[iso].wind_dir_deg                  = wh.wind_direction_10m ? wh.wind_direction_10m[i] : null;
    byIso[iso].precipitation                 = wh.precipitation ? wh.precipitation[i] : null;
    byIso[iso].cloudcover                    = wh.cloudcover ? wh.cloudcover[i] : null;
    byIso[iso].temperature_2m                = wh.temperature_2m ? wh.temperature_2m[i] : null;
byIso[iso].relative_humidity_2m = wh.relative_humidity_2m ? wh.relative_humidity_2m[i] : null;

    byIso[iso].uv_index                      = wh.uv_index ? wh.uv_index[i] : null;
    byIso[iso].surface_pressure              = wh.surface_pressure ? wh.surface_pressure[i] : null;
  });

  return Object.keys(byIso).sort().map(t=>({ timeISO:t, ...byIso[t] }));
}

function summarize(rows, tz){
  const valid = rows.filter(r=>r.wave_m!=null||r.wind_kn!=null||r.current_kn!=null),
        nums=a=>a.filter(isNum),
        max=a=>a.length?Math.max(...a):null,
        min=a=>a.length?Math.min(...a):null,
        avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;

  const waves=nums(valid.map(r=>r.wave_m)),
        winds=nums(valid.map(r=>r.wind_kn)),
        gusts=nums(valid.map(r=>r.wind_gust_kn)),
        ssts=nums(valid.map(r=>r.sst_c)),
        swells=nums(valid.map(r=> (r.swell_dir_deg!=null ? r.swell_dir_deg : r.wave_dir_deg) )),
        wdirs=nums(valid.map(r=>r.wind_dir_deg)),
        periods=nums(valid.map(r=>r.wave_period_s)),
        currents=nums(valid.map(r=>r.current_kn)),
        cdirs=nums(valid.map(r=>r.current_dir_deg));

  const peakWaveM=max(waves), peakWindKn=max(winds), peakGustKn=max(gusts),
        avgWaveM=avg(waves),  avgWindKn=avg(winds), avgWavePeriodS=avg(periods),
        minWaveM=min(waves),  maxWaveM=max(waves),
        minWindKn=min(winds), maxWindKn=max(winds),
        avgCurrentKn=avg(currents), currentDirMeanDeg=cdirs.length?circularMeanDeg(cdirs):null;

  const avgSstC=avg(ssts),
        swellDirMeanDeg=swells.length?circularMeanDeg(swells):null,
        swellDirCompass=swellDirMeanDeg!=null?dirToCompass(swellDirMeanDeg):null,
        windDirMeanDeg=wdirs.length?circularMeanDeg(wdirs):null,
        windDirCompass=windDirMeanDeg!=null?dirToCompass(windDirMeanDeg):null;

  const pkW=peakWaveM==null?null:valid.find(r=>r.wave_m===peakWaveM)?.timeISO||null,
        pkV=peakWindKn==null?null:valid.find(r=>r.wind_kn===peakWindKn)?.timeISO||null,
        pkG=peakGustKn==null?null:valid.find(r=>r.wind_gust_kn===peakGustKn)?.timeISO||null;

  return { tz, countHours:valid.length,
           avgWaveM, avgWindKn, avgWavePeriodS,
           minWaveM, maxWaveM, minWindKn, maxWindKn,
           peakWaveM, peakWindKn, peakGustKn,
           peakWaveHourLocal:pkW?toLocalHour(pkW,tz):null,
           peakWindHourLocal:pkV?toLocalHour(pkV,tz):null,
           peakGustHourLocal:pkG?toLocalHour(pkG,tz):null,
           avgSstC, swellDirMeanDeg, swellDirCompass, windDirMeanDeg, windDirCompass,
           avgCurrentKn, currentDirMeanDeg, currentDirCompass: currentDirMeanDeg!=null?dirToCompass(currentDirMeanDeg):null
         };
}

/* ========================= SKY & METRICS ========================= */
function interpretWeatherCode(code){
  if (code==null) return {label:'—',category:'other'};
  if (code===0) return {label:'Sunny',category:'clear'};
  if (code===1) return {label:'Mainly Clear',category:'clear'};
  if (code===2) return {label:'Partly Cloudy',category:'cloud'};
  if (code===3) return {label:'Cloudy',category:'cloud'};
  if (code===45||code===48) return {label:'Foggy',category:'fog'};
  if ((code>=51&&code<=57)||(code>=61&&code<=67)||(code>=80&&code<=82)) return {label:'Rain',category:'rain'};
  if ((code>=71&&code<=77)||(code>=85&&code<=86)) return {label:'Snow',category:'snow'};
  if (code===95||code===96||code===99) return {label:'Thunderstorms',category:'storm'};
  return {label:'—',category:'other'};
}
function daySkySummary(weatherJson, range, tz, mForWind){
  const dayKey=Utilities.formatDate(range.start,tz,'yyyy-MM-dd');
  const d=(weatherJson && weatherJson.daily)?weatherJson.daily:{};
  const idx=(d.time||[]).findIndex(s=>s===dayKey);
  const wcode=(idx>=0&&d.weathercode)?d.weathercode[idx]:null,
        precipSum=(idx>=0&&d.precipitation_sum)?d.precipitation_sum[idx]:null,
        popMax=(idx>=0&&d.precipitation_probability_max)?d.precipitation_probability_max[idx]:null,
        precipH=(idx>=0&&d.precipitation_hours)?d.precipitation_hours[idx]:null;

  let cloudAvg=null;
  const H=(weatherJson && weatherJson.hourly)?weatherJson.hourly:{};
  if(H.time&&H.cloudcover){
    const vals=[];
    for(let i=0;i<H.time.length;i++){
      const iso=H.time[i]; if(isInRange(iso,range)) vals.push(Number(H.cloudcover[i]));
    }
    if(vals.length) cloudAvg=vals.reduce((a,b)=>a+b,0)/vals.length;
  }

  const base=interpretWeatherCode(wcode),
        windCompass=mForWind?.windDirCompass||null,
        windKn=mForWind?.avgWindKn||null,
        easterly=windCompass&&/^(E|ENE|ESE|SE|NE|SSE|NNE)$/.test(windCompass);

  function outSky(label,emoji,reason){
    const mm = (precipSum!=null)?Number(precipSum):null;
    const inches = (mm!=null)? Number((mm/25.4).toFixed(2)) : null;
    return {
      label, emoji, reason,
      precip_mm: (mm!=null)?Number(mm.toFixed(1)):null,
      precip_in: inches,
      precip_prob_max: popMax,
      cloudcover_avg:(cloudAvg!=null)?Math.round(cloudAvg):null
    };
  }

  if (base.category==='storm'||(popMax!=null&&popMax>=80&&precipSum!=null&&precipSum>=10)) return outSky('Thunderstorms','⛈️','High risk of thunder and heavy rain');
  if ((precipH!=null&&precipH>=1&&precipH<=6)&&(precipSum!=null&&precipSum<5)&&(windKn!=null&&windKn>=8&&windKn<=20)&&easterly) return outSky('Trade-wind Showers','🌦️','Brief easterly showers in trades');
  if ((precipSum!=null&&precipSum>=5)||(precipH!=null&&precipH>=6)||base.category==='rain') return outSky('Rainy','🌧️','Some rainfall expected');
  if ((cloudAvg!=null&&cloudAvg<=35)&&(precipSum==null||precipSum<1)) return outSky('Hazy','🌫️','Saharan dust / tropical haze');

  if (cloudAvg!=null){
    if(cloudAvg<=30) return outSky('Sunny','☀️','Clear skies, strong sunshine');
    if(cloudAvg<=60) return outSky('Partly Cloudy','⛅','Mix of sun and clouds');
    return outSky('Cloudy','☁️','Mostly cloudy');
  }
  return outSky(base.label,'🌤️','General conditions');
}

function heatIndexC(tC,rh){
  const T=tC*9/5+32, R=Math.min(100,Math.max(0,rh));
  if(T<80) return tC;
  let HI=-42.379+2.04901523*T+10.14333127*R-0.22475541*T*R-6.83783e-3*T*T-5.481717e-2*R*R+1.22874e-3*T*T*R+8.5282e-4*T*R*R-1.99e-6*T*T*R*R;
  if (R<13&&T>=80&&T<=112) HI-=((13-R)/4)*Math.sqrt((17-Math.abs(T-95))/17);
  if (R>85&&T>=80&&T<=87) HI+=((R-85)/10)*((87-T)/5);
  return (HI-32)*5/9;
}
function uvLevel(u){ if(u==null)return'—'; if(u<=2)return'Low'; if(u<=5)return'Moderate'; if(u<=7)return'High'; if(u<=10)return'Very High'; return'Extreme'; }
function uvColor(u){ if(u==null)return'#9e9e9e'; if(u<=2)return'#2e7d32'; if(u<=5)return'#f9a825'; if(u<=7)return'#ef6c00'; if(u<=10)return'#c62828'; return'#6a1b9a'; }
function heatIndexLevel(c){ if(c==null)return'—'; if(c<27)return'Minimal'; if(c<32)return'Caution'; if(c<41)return'Extreme Caution'; if(c<54)return'Danger'; return'Extreme Danger'; }
function heatIndexColor(c){ if(c==null)return'#9e9e9e'; if(c<27)return'#2e7d32'; if(c<32)return'#f9a825'; if(c<41)return'#ef6c00'; if(c<54)return'#c62828'; return'#6a1b9a'; }

function assessHeatUvOptionC(weatherJson, range, tz, mode){
  const d=(weatherJson&&weatherJson.daily)||{}, H=(weatherJson&&weatherJson.hourly)||{};
  const dayKey=Utilities.formatDate(range.start,tz,'yyyy-MM-dd');
  const dayIdx=(d.time||[]).findIndex(s=>s===dayKey);
  let uvVal=null, hiMaxC=null;

  if (mode==='hourly') {
    if (H.time && H.uv_index) {
      const uv = [];
      for (let i=0;i<H.time.length;i++){
        const iso=H.time[i]; if(isInRange(iso,range)) { const v=Number(H.uv_index[i]); if(isFinite(v)) uv.push(v); }
      }
      if (uv.length) uvVal = Number(Math.max(...uv).toFixed(1));
    }
  } else {
    uvVal = (dayIdx>=0&&d.uv_index_max!=null && d.uv_index_max[dayIdx]!=null)
      ? Number(Number(d.uv_index_max[dayIdx]).toFixed(1)) : null;
  }

  if (H.time && H.temperature_2m && H.relative_humidity_2m) {
    for (let i=0;i<H.time.length;i++){
      const iso = H.time[i]; if (!isInRange(iso, range)) continue;
      const tC = Number(H.temperature_2m[i]), rh = Number(H.relative_humidity_2m[i]);
      if (isFinite(tC) && isFinite(rh)) {
        const hi = heatIndexC(tC, rh);
        if (hiMaxC==null || hi>hiMaxC) hiMaxC = hi;
      }
    }
    if (hiMaxC!=null) hiMaxC = Number(hiMaxC.toFixed(1));
  }
  return { uv:{ value:uvVal, level:uvLevel(uvVal), color:uvColor(uvVal) },
           heat:{ valueC:hiMaxC, level:heatIndexLevel(hiMaxC), color:heatIndexColor(hiMaxC) } };
}

function pressureTrendHpa(weatherJson, range){
  const H=(weatherJson&&weatherJson.hourly)||{};
  const times=H.time||[], p=H.surface_pressure||[], inWin=[];
  for(let i=0;i<times.length;i++){
    const iso=times[i]; if(!isInRange(iso,range)) continue;
    const v=Number(p[i]); if(isFinite(v)) inWin.push({t:new Date(iso).getTime(), v});
  }
  if(inWin.length<2) return null;
  const start=inWin[0].v, end=inWin[inWin.length-1].v;
  return round(end-start,1);
}

function hasSquallRisk(weatherJson, range){
  const H=(weatherJson&&weatherJson.hourly)||{};
  const t = H.time||[], g = H.wind_gusts_10m||[], p = H.precipitation||[];
  for (let i=0;i<t.length;i++){
    if (!isInRange(t[i],range)) continue;
    if (g[i]>=CONFIG.STATUS.squall_gust_kn && p[i]>=CONFIG.STATUS.squall_precip_mm_per_h) return true;
  }
  return false;
}

function formatPressureTrend(dP, range, tz){
  if (dP == null) return { label: '—', text: '—' };
  const trend = dP < -0.5 ? 'Falling' : dP > 0.5 ? 'Rising' : 'Steady';
  const sign  = dP > 0 ? '+' : '';
  const span  = Utilities.formatDate(range.start, tz, 'HH:mm') + '–' +
                Utilities.formatDate(range.end, tz, 'HH:mm');
  return { label: trend, text: `${trend} (${sign}${dP.toFixed(1)} hPa over ${span})` };
}

/* ========================= MOON FALLBACK ========================= */
function moonPhaseForDateAt(dateObj, tz, lat, lon){
  const range = getFullDayRange(dateObj, tz);
  try {
    const moon = moonInfoFromVC(range, tz, lat, lon);
    if (!moon.riseLocal || !moon.setLocal) {
      const times = mwMoonTimesFallback_(dateObj, tz, lat, lon);
      moon.riseLocal = moon.riseLocal || times.riseLocal;
      moon.setLocal = moon.setLocal || times.setLocal;
    }
    return moon;
  }
  catch(e){
    logWarn_('ASTRO', 'VC astronomy fetch failed, falling back: ' + e);
    const fallback = moonPhaseForDate(dateObj, tz);
    const times = mwMoonTimesFallback_(dateObj, tz, lat, lon);
    fallback.riseLocal = times.riseLocal;
    fallback.setLocal = times.setLocal;
    return fallback;
  }
}

// Local astronomical fallback, used only if the existing astronomy lookup fails.
// Samples lunar altitude over the requested local calendar day; no API calls.
function mwMoonTimesFallback_(dateObj, tz, lat, lon) {
  const result = {riseLocal:null, setLocal:null};
  if (!isFinite(Number(lat)) || !isFinite(Number(lon))) return result;
  const day = Utilities.formatDate(dateObj, tz, 'yyyy-MM-dd');
  const rad = Math.PI / 180;
  const phi = Number(lat)*rad, lambda = Number(lon)*rad;
  const J2000 = 2451545;
  function altitude(ms) {
    const jd = ms / 86400000 + 2440587.5;
    const d = jd - J2000;
    const L = rad * (218.316 + 13.176396*d);
    const M = rad * (134.963 + 13.064993*d);
    const F = rad * (93.272 + 13.229350*d);
    const l = L + rad*6.289*Math.sin(M);
    const b = rad*5.128*Math.sin(F);
    const e = rad*23.4397;
    const ra = Math.atan2(Math.sin(l)*Math.cos(e)-Math.tan(b)*Math.sin(e),Math.cos(l));
    const dec = Math.asin(Math.sin(b)*Math.cos(e)+Math.cos(b)*Math.sin(e)*Math.sin(l));
    const theta = rad*(280.16+360.9856235*d)+lambda;
    const H = theta-ra;
    return Math.asin(Math.sin(phi)*Math.sin(dec)+Math.cos(phi)*Math.cos(dec)*Math.cos(H));
  }
  // 0.133 degrees accounts approximately for lunar refraction and apparent radius.
  const horizon = 0.133*rad;
  // Scan a wide UTC interval, retaining crossings on the target LOCAL date.
  const utcStart = Date.parse(day+'T00:00:00Z')-18*3600000;
  const utcEnd = utcStart+60*3600000;
  const step = 10*60000;
  let prevT=utcStart, prevA=altitude(prevT)-horizon;
  for(let t=prevT+step;t<=utcEnd;t+=step){
    const a=altitude(t)-horizon;
    if ((prevA<=0 && a>0) || (prevA>=0 && a<0)){
      let lo=prevT, hi=t;
      // Robust bisection with the original crossing direction.
      lo=prevT; hi=t;
      for(let j=0;j<18;j++){
        const mid=(lo+hi)/2, ma=altitude(mid)-horizon;
        if ((prevA<=0 && ma<=0) || (prevA>=0 && ma>=0)) lo=mid;
        else hi=mid;
      }
      const cross=new Date((lo+hi)/2);
      if(Utilities.formatDate(cross,tz,'yyyy-MM-dd')===day){
        const key=prevA<=0?'riseLocal':'setLocal';
        if(!result[key]) result[key]=Utilities.formatDate(cross,tz,'HH:mm');
      }
    }
    prevT=t; prevA=a;
  }
  return result;
}

function moonPhaseForDate(dateObj, tz){
  const localDayIso = Utilities.formatDate(dateObj, tz, 'yyyy-MM-dd');
  const localMid    = new Date(localDayIso + 'T00:00:00');
  const jd  = julianDay(localMid);
  const SYN = 29.530588853;
  const JD0 = 2451550.1;
  let age = (jd - JD0) % SYN;
  if (age < 0) age += SYN;
  const p     = age / SYN;
  const illum = 0.5 * (1 - Math.cos(2 * Math.PI * p));
  return { label: moonLabelAccurate(p),
           fraction: Number(p.toFixed(3)),
           illumination: Number((illum * 100).toFixed(1)),
           riseLocal: null, setLocal: null,
           overheadTimeLocal: null, overheadAltitudeDeg: null };
}

function julianDay(date){
  if (!(date instanceof Date)) throw new Error('julianDay: input is not a Date');
  const Y  = date.getUTCFullYear();
  const M0 = date.getUTCMonth() + 1;
  const D0 = date.getUTCDate();
  const A  = Math.floor((14 - M0) / 12);
  const Yp = Y + 4800 - A;
  const Mp = M0 + 12 * A - 3;
  const JDN = D0 + Math.floor((153 * Mp + 2)/5) + 365*Yp + Math.floor(Yp/4) - Math.floor(Yp/100) + Math.floor(Yp/400) - 32045;
  const h = date.getUTCHours(), m = date.getUTCMinutes(), s = date.getUTCSeconds();
  const frac = ((h - 12) / 24) + (m / 1440) + (s / 86400);
  return JDN + frac;
}

/* ========================= STATUS/COMFORT ========================= */
function classifyAvg(avgWaveM, avgWindKn){
  const w = avgWaveM ?? Infinity, v = avgWindKn ?? Infinity;
  if (w <= CONFIG.GREEN.wave_m && v <= CONFIG.GREEN.wind_kn) return 'GREEN';
  if (w <= CONFIG.YELLOW.wave_m && v <= CONFIG.YELLOW.wind_kn) return 'YELLOW';
  return 'RED';
}
function bumpStatus(status, steps){
  const order = ['GREEN','YELLOW','RED'];
  let i = Math.max(0, order.indexOf(status));
  i = Math.min(order.length-1, i + Math.max(0, steps|0));
  return order[i];
}
function classifyByAvgWithChop(m, sky, squall){
  let status = classifyAvg(m.avgWaveM, m.avgWindKn);
  const P = m.avgWavePeriodS;
  if (isNum(P)) {
    if (P <= CONFIG.CHOP.bump_two_s)      status = bumpStatus(status, 2);
    else if (P <= CONFIG.CHOP.bump_one_s) status = bumpStatus(status, 1);
  }
  if (/Thunder/.test(String(sky && sky.label))) status = bumpStatus(status, 1);
  if ((sky && sky.precip_mm != null && sky.precip_mm >= CONFIG.STATUS.heavy_rain_day_mm) ||
      (sky && sky.precip_prob_max >= CONFIG.STATUS.heavy_rain_pop_pct && sky.precip_mm >= CONFIG.STATUS.moderate_rain_day_mm)) {
    status = bumpStatus(status, 1);
  }
  if (squall) status = bumpStatus(status, 1);
  // Shared severity floor: comfort and hazardous peaks must not contradict GREEN.
  // Retain the established wave/wind/chop classification as a minimum severity.
  const preliminaryComfort = comfortScore(m, status, sky);
  const comfortStatus = mwUnifiedStatusFromComfort_(preliminaryComfort.score);
  status = mwWorseMarineStatus_(status, comfortStatus);
  if (isNum(m.peakGustKn)) {
    if (m.peakGustKn >= 25) status = 'RED';
    else if (m.peakGustKn >= 18) status = mwWorseMarineStatus_(status, 'YELLOW');
  }
  if (isNum(m.peakWaveM) && m.peakWaveM >= 2.0) status = 'RED';
  if (!isNum(m.avgWaveM) || !isNum(m.avgWindKn)) status = mwWorseMarineStatus_(status, 'YELLOW');
  return status;
}

function mwUnifiedStatusFromComfort_(score) {
  if (!isNum(score)) return 'YELLOW';
  return score >= 3.5 ? 'GREEN' : score >= 2.5 ? 'YELLOW' : 'RED';
}
function mwWorseMarineStatus_(a,b) {
  const rank={GREEN:0,YELLOW:1,AMBER:1,RED:2};
  return (rank[String(a).toUpperCase()]||0) >= (rank[String(b).toUpperCase()]||0)
    ? (String(a).toUpperCase()==='AMBER'?'YELLOW':a) : b;
}

function buildStatusInfo(cond, m, sky, squall){
  const reasons = [];
  if (m.avgWindKn != null) reasons.push(`avg wind ${fmt(m.avgWindKn,0)} kt`);
  if (m.avgWaveM  != null) reasons.push(`avg seas ${fmt(mToFt(m.avgWaveM),1)} ft`);
  if (isNum(m.avgWavePeriodS)) reasons.push(`chop ${fmt(m.avgWavePeriodS,1)} s`);
  if (isNum(m.avgCurrentKn)) reasons.push(`current ${fmt(m.avgCurrentKn,1)} kt`);
  if (m.currentDirCompass) reasons.push(`set ${m.currentDirCompass}`);
  if (/Thunder/.test(String(sky && sky.label))) reasons.push('thunder');
  if (squall) reasons.push('squalls');

  const cautions = [];
  const cfg = CONFIG.STATUS;
  if (isNum(m.peakGustKn) && m.peakGustKn > cfg.smallcraft_gust_warn_kn) {
    const t = m.peakGustHourLocal ? ` around ${m.peakGustHourLocal}` : '';
    cautions.push(`Small vessels: gusts to ${fmt(m.peakGustKn,0)} kt${t}.`);
  }
  if (isNum(m.peakWaveM) && m.peakWaveM >= cfg.smallcraft_wave_warn_m) {
    const t = m.peakWaveHourLocal ? ` around ${m.peakWaveHourLocal}` : '';
    cautions.push(`Small vessels: peak seas ~${fmt(mToFt(m.peakWaveM),1)} ft${t}.`);
  }
  const reasonText  = reasons.length ? ' • ' + reasons.join(', ') : '';
  const cautionText = cautions.length ? ' • ' + cautions.join(' ') : '';
  return { color: cond, reasonText, cautionText, full: reasonText + cautionText };
}

function comfortScore(m, cond, sky){
  const seasFt = mToFt(m.avgWaveM);
  const windKt = m.avgWindKn;
  const chopS  = m.avgWavePeriodS;

  function seasSub(ft){
    if (!isNum(ft)) return 3;
    if (ft <= 2.0) return 5;
    if (ft <= 3.0) return 4;
    if (ft <= 4.0) return 3;
    if (ft <= 5.0) return 2;
    return 1;
  }
  function windSub(kt){
    if (!isNum(kt)) return 3;
    if (kt <= 8)   return 5;
    if (kt <= 12)  return 4;
    if (kt <= 16)  return 3;
    if (kt <= 22)  return 2;
    return 1;
  }
  function chopPenalty(s){
    if (!isNum(s)) return 0;
    if (s <= 5) return 2;
    if (s <= 7) return 1;
    if (s >= 9) return -0.25;
    return 0;
  }

  const seas = seasSub(seasFt);
  const wind = windSub(windKt);
  let base = (0.5 * seas) + (0.35 * wind) + (0.15 * 3);
  base -= chopPenalty(chopS);
  if (sky && /Thunder|Rainy/.test(String(sky.label))) base -= 0.5;
  if (cond === 'YELLOW') base -= 0.25;
  if (cond === 'RED')    base -= 0.75;

  let score = Math.max(1, Math.min(5, Math.round(base)));
  const label = score>=5 ? 'Great for family outing'
              : score===4 ? 'Good for small craft'
              : score===3 ? 'Marginal — experienced only'
              : score===2 ? 'Rough — not recommended'
              : 'Stay in port';
  const color = score>=5 ? '#0a8754'
              : score===4 ? '#2e7d32'
              : score===3 ? '#c99a00'
              : score===2 ? '#ef6c00'
              : '#c62828';
  const emoji = score>=4 ? '😊' : score===3 ? '😐' : '⚠️';
  const reasons = [
    isNum(seasFt) ? `${fmt(seasFt,1)} ft seas` : null,
    isNum(windKt) ? `${fmt(windKt,0)} kt wind` : null,
    isNum(chopS)  ? `${fmt(chopS,1)} s chop` : null
  ].filter(Boolean).join(' • ');
  const advice = score>=4 ? 'Family friendly nearshore.'
               : score===3 ? 'Use caution. Pick protected water.'
               : 'Postpone or stay in the lee.';
  return { score, label, color, emoji, reasons, advice };
}

/* ========================= TIDES ========================= */
function findTideExtremes(rows, tz){
  try{
    const pts = rows.filter(r=>isNum(r.sea_level_m)).map(r=>({ms:new Date(r.timeISO).getTime(), v:Number(r.sea_level_m)})).sort((a,b)=>a.ms-b.ms);
    const highs=[], lows=[];
    for(let i=1;i<pts.length-1;i++){
      const p1=pts[i-1], p0=pts[i], p2=pts[i+1], y_1=p1.v, y0=p0.v, y1=p2.v;
      const isHigh=(y0>y_1&&y0>=y1), isLow=(y0<y_1&&y0<=y1); if(!isHigh&&!isLow) continue;
      const denom=2*(y_1-2*y0+y1); let x_v=0; if(Math.abs(denom)>1e-6) x_v=(y_1-y1)/denom;
      const peakMs=p0.ms+x_v*3600e3, yv=y0+0.5*(y1-y_1)*x_v+0.5*(y_1-2*y0+y1)*x_v*x_v;
      const rec={ ms:peakMs, time:Utilities.formatDate(new Date(peakMs),tz,'EEE HH:mm'), height_m:round(yv,2) };
      if(isHigh) highs.push(rec); if(isLow) lows.push(rec);
    }
    const dedup90=arr=>{
      const out=[],TH=90*60*1000;
      for(const x of arr.sort((a,b)=>a.ms-b.ms)){
        if(!out.length){out.push(x);continue;}
        const last=out[out.length-1];
        if(x.ms-last.ms>=TH) out.push(x);
        else if (Math.abs(x.height_m)>Math.abs(last.height_m)) out[out.length-1]=x;
      }
      return out;
    };
    const ret = { highs:dedup90(highs).slice(0,4), lows:dedup90(lows).slice(0,4) };
    logOk_('TIDE', `Found highs=${ret.highs.length} lows=${ret.lows.length}`);
    return ret;
  }catch(e){
    logErr_('TIDE', 'Error finding tide extrema: ' + e);
    return { highs:[], lows:[] };
  }
}

function formatTidesCompact(tides){
  const take=(arr,n)=>arr.slice(0,n).map(x=>`${fmt(mToFt(x.height_m),1)} ft @ ${x.time}`);
  const H=take((tides&&tides.highs||[]),2), L=take((tides&&tides.lows||[]),2);
  return [H[0]?`H ${H[0]}`:null,H[1]?`H ${H[1]}`:null,L[0]?`L ${L[0]}`:null,L[1]?`L ${L[1]}`:null].filter(Boolean).join(' • ');
}
function tideExtremaCompact(rows, tz){
  const tid = findTideExtremes(rows, tz);
  const toObj = x => ({ t: x.time, h_ft: Number((x.height_m*3.28084).toFixed(2)) });
  return JSON.stringify({ H: (tid.highs||[]).slice(0,3).map(toObj), L: (tid.lows||[]).slice(0,3).map(toObj) });
}

/* ========================= SARGASSUM / FISH TYPE ========================= */
/**
 * Weedline Conditions index (0–100). This is NOT a measured probability of
 * sargassum occurrence. Wind directions are meteorological FROM bearings;
 * current direction is an oceanographic TO bearing. Both are converted to
 * drift-to directions before comparison.
 * Optional rows are ALREADY FETCHED hourly rows, never additional API calls.
 */
function weedAngleDiff384_(a,b){
  return Math.abs((((a-b)%360)+540)%360-180);
}
function weedlineTrend384_(rows,range){
  const usable=(rows||[]).filter(r=>r && (!range || isInRange(r.timeISO,range)))
    .sort((a,b)=>new Date(a.timeISO)-new Date(b.timeISO));
  if(usable.length<4) return null;
  const half=Math.floor(usable.length/2);
  const avgField=(items,key)=>{
    const vals=items.map(r=>r[key]).filter(isNum);
    return vals.length>=2?vals.reduce((a,b)=>a+b,0)/vals.length:null;
  };
  const first=usable.slice(0,half), last=usable.slice(half);
  const w1=avgField(first,'wind_kn'), w2=avgField(last,'wind_kn');
  const c1=avgField(first,'current_kn'), c2=avgField(last,'current_kn');
  const h1=avgField(first,'wave_m'), h2=avgField(last,'wave_m');
  return {
    windDeltaKn:w1!=null&&w2!=null?w2-w1:null,
    currentDeltaKn:c1!=null&&c2!=null?c2-c1:null,
    waveDeltaM:h1!=null&&h2!=null?h2-h1:null
  };
}
function sargassumWeedlineProb(m,sky,rows,range){
  // Preserve baseline weather heuristic, but lower its influence so currents
  // and trends can contribute. No satellite observations are inferred.
  let score=25;
  if(isNum(m.windDirMeanDeg)){
    const wd=(m.windDirMeanDeg+360)%360;
    if(wd>=45&&wd<=135)score+=15;
    else if(wd>135&&wd<=160)score+=9;
    else if(wd>=200&&wd<=280)score-=6;
  }
  if(isNum(m.avgWindKn)){
    if(m.avgWindKn>=8&&m.avgWindKn<=16)score+=10;
    else if(m.avgWindKn<4||m.avgWindKn>22)score-=8;
  }
  if(isNum(m.avgWaveM)){
    if(m.avgWaveM>=0.6&&m.avgWaveM<=1.6)score+=8;
    else if(m.avgWaveM>2.2)score-=12;
    else if(m.avgWaveM<0.3)score-=6;
  }
  if(isNum(m.swellDirMeanDeg)){
    const sd=(m.swellDirMeanDeg+360)%360;
    if(sd>=45&&sd<=120)score+=5;
  }
  if(sky&&(sky.label==='Thunderstorms'||/Rain/i.test(String(sky.label))))score-=8;

  const notes=[];
  // A modest current can transport floating material. Strong currents can
  // disperse patches; no claim is made about actual convergence or presence.
  if(isNum(m.avgCurrentKn)){
    if(m.avgCurrentKn>=0.2&&m.avgCurrentKn<=1.0){score+=8;notes.push('moderate current');}
    else if(m.avgCurrentKn>1.5){score-=7;notes.push('strong current');}
    else if(m.avgCurrentKn<0.1){score-=3;notes.push('weak current');}
  }
  if(isNum(m.windDirMeanDeg)&&isNum(m.currentDirMeanDeg)){
    const windTo=(m.windDirMeanDeg+180+360)%360;
    const currentTo=(m.currentDirMeanDeg+360)%360;
    const angle=weedAngleDiff384_(windTo,currentTo);
    if(angle<=45){score+=8;notes.push('wind/current aligned');}
    else if(angle>=135){score-=8;notes.push('wind/current opposed');}
    else notes.push('cross-set drift');
  }
  const trend=weedlineTrend384_(rows,range);
  if(trend){
    if(isNum(trend.windDeltaKn)){
      if(trend.windDeltaKn>=5){score-=5;notes.push('wind strengthening');}
      else if(trend.windDeltaKn<=-5){score+=3;notes.push('wind easing');}
    }
    if(isNum(trend.waveDeltaM)){
      if(trend.waveDeltaM>=0.4){score-=5;notes.push('seas building');}
      else if(trend.waveDeltaM<=-0.4){score+=3;notes.push('seas easing');}
    }
    if(isNum(trend.currentDeltaKn)&&trend.currentDeltaKn>=0.5){
      score-=3;notes.push('current strengthening');
    }
  }
  score=Math.max(0,Math.min(100,Math.round(score)));
  const level=score>=70?'High':score>=45?'Moderate':'Low';
  const direction=m.currentDirCompass?('set '+m.currentDirCompass):'current set unavailable';
  return {percent:score,level,reason:direction+(notes.length?' • '+notes.join(', '):''),
          index:true,trendAvailable:!!trend};
}
function bestFishingType_(m){
  if (isNum(m.avgCurrentKn) && m.avgCurrentKn >= 0.5 && (m.avgWindKn||0) <= 15 && (m.avgWaveM||0) <= 1.8) return 'Pelagic (Trolling)';
  if ((m.avgWaveM||0) <= 1.5 && (m.avgWindKn||0) <= 12) return 'Reef (Bottom)';
  return 'Mixed (Play Conditions)';
}

/* ========================= FISHING SCORING ========================= */
function strikeRating_(m, tides, pressureDeltaHpa, moon, range, tz){
  let score = 5, notes = [];

  const highs = (tides && tides.highs) || [], lows = (tides && tides.lows) || [];
  const h = highs[0], l = lows[0];
  let tideRangeM = null;
  if (h && l) {
    tideRangeM = Math.abs(h.height_m - l.height_m);
    if (tideRangeM < 0.5) { score -= 1; notes.push('weak tide swing'); }
  } else { notes.push('tide data sparse'); }

  if (pressureDeltaHpa != null) {
    if (pressureDeltaHpa < -1.0) { score -= 1; notes.push('falling pressure'); }
    else if (pressureDeltaHpa > 1.0) { score += 0.5; notes.push('rising pressure'); }
  }

  if (isNum(m.avgCurrentKn)) {
    if (m.avgCurrentKn >= 0.3 && m.avgCurrentKn <= 1.0) { score += 0.5; notes.push('easy drift'); }
    else if (m.avgCurrentKn > 1.3) { score -= 0.5; notes.push('strong set'); }
  }

  if (isNum(m.avgWindKn) && m.avgWindKn > 18) { score -= 1; notes.push('windy'); }
  if (isNum(m.avgWaveM) && m.avgWaveM > 1.8) { score -= 1; notes.push('bumpy'); }

  if (moon && isNum(moon.illumination)) {
    const illum = moon.illumination;
    if (illum >= 90) { score -= 0.5; notes.push('bright moon'); }
    else if (illum <= 20) { score += 0.25; notes.push('darker moon'); }
  }

  let moonAltTxt = '';
  if (moon && moon.overheadTimeLocal) moonAltTxt = `Max alt @ ${moon.overheadTimeLocal}`;

  score = Math.max(1, Math.min(5, Math.round(score)));

  function pickAround(ext){
    if (!ext) return null;
    const ms = new Date(ext.ms);
    const start = range.start.getTime(), end = range.end.getTime();
    if (ms >= start && ms <= end) {
      const pre = Utilities.formatDate(new Date(ms - 30*60000), tz, 'HH:mm');
      const post= Utilities.formatDate(new Date(ms + 30*60000), tz, 'HH:mm');
      const tag = `(${ext===h?'High':'Low'} ${fmt(mToFt(ext.height_m),1)} ft)`;
      return { window: `${pre}–${post}`, tag };
    }
    return null;
  }
  const turn = pickAround(h) || pickAround(l);
  const bestTxt = turn ? `Best ${turn.window} ${turn.tag}` : '';

  const stars = '★★★★★'.slice(0,score) + '☆☆☆☆☆'.slice(score);
  const outNotes = [
    `${stars} (${score}/5)`,
    bestTxt || null,
    moonAltTxt || null,
    (tideRangeM!=null)?`Tidal range ~${fmt(mToFt(tideRangeM),1)} ft`:null
  ].filter(Boolean).join(' • ');

  return { score, stars, summary: outNotes, notes };
}

/* ========================= RENDER HELPERS ========================= */
const BADGE_HEIGHT_PX = 24;
const BADGE_RADIUS_PX = 8;
const BADGE_FONT_PX   = 13;
const BADGE_XPAD_PX   = 10;

function badgeBaseStyle_(bg, fg){
  return [
    'display:inline-flex',
    'align-items:center',
    'justify-content:center',
    'height:'+BADGE_HEIGHT_PX+'px',
    'line-height:'+BADGE_HEIGHT_PX+'px',
    'padding:0 '+BADGE_XPAD_PX+'px',
    'border-radius:'+BADGE_RADIUS_PX+'px',
    'font-weight:700',
    'font-size:'+BADGE_FONT_PX+'px',
    'background:'+bg,
    'color:'+fg
  ].join(';');
}

function renderComfortBadgeHtml(c){
  if (!c) return '—';
  var tip = (c.label + ' • ' + c.reasons + ' • ' + c.advice).replace(/[<>&]/g, m=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[m]));
  var style = badgeBaseStyle_(c.color, '#fff');
  return '<span title="'+tip+'" style="'+style+'">'
       +   '<span style="margin-right:6px;line-height:1">'+(c.emoji||'')+'</span>'
       +   'Comfort '+c.score+'/5'
       + '</span>';
}

function renderStatusWithComfort_(condition, statusInfo, comfortObj){
  var cColor = condition==='GREEN' ? '#0a8754' : condition==='YELLOW' ? '#c99a00' : '#c62828';
  var statusBadge = '<span style="'+badgeBaseStyle_(cColor,'#fff')+'">'+condition+'</span>';
  var comfortBadge = renderComfortBadgeHtml(comfortObj);
  var reasonText = (statusInfo && statusInfo.full) ? (' ' + String(statusInfo.full)) : '';
  return 'Status: ' + statusBadge + ' <span style="display:inline-block;width:6px;"></span> ' + comfortBadge + reasonText;
}

function renderUvBadgeHtml(uv){
  if (!uv || uv.value == null) return `<span style="background:#9e9e9e;color:#fff;padding:2px 6px;border-radius:6px;">UV —</span>`;
  return `<span style="background:${uv.color};color:#fff;padding:2px 6px;border-radius:6px;">☀️ UV ${uv.value} (${uv.level})</span>`;
}
function renderHeatBadgeHtml(heat){
  if (!heat || heat.valueC == null) return `<span style="background:#9e9e9e;color:#fff;padding:2px 6px;border-radius:6px;">HI —</span>`;
  return `<span style="background:${heat.color};color:#fff;padding:2px 6px;border-radius:6px;">🌡️ HI ${fmt(cToF(heat.valueC),1)}°F (${heat.level})</span>`;
}

function getLegendHtml(){
  return `<div style="margin-top:8px;font-size:12px;color:#555;">
    Legend — Status uses <b>Avg seas / Avg wind</b>
    (GREEN ≤ ${fmt(mToFt(CONFIG.GREEN.wave_m),1)} ft & ≤ ${CONFIG.GREEN.wind_kn} kt;
     YELLOW ≤ ${fmt(mToFt(CONFIG.YELLOW.wave_m),1)} ft & ≤ ${CONFIG.YELLOW.wind_kn} kt;
     else RED).
    <b>Chop</b> (avg period ≤ ${CONFIG.CHOP.bump_one_s}s) moves to Yellow;
    ≤ ${CONFIG.CHOP.bump_two_s}s moves to Red.
    Thunder, heavy rain, squalls, and strong currents can also bump color.
  </div>`;
}

/* ========================= MOON LINE ========================= */
function formatMoonLine_(moon){
  if (!moon) return '—';
  var bits = [];
  if (moon.label) bits.push(String(moon.label));
  if (moon.illumination != null && isFinite(Number(moon.illumination))) bits.push(String(Number(moon.illumination).toFixed(1)).replace(/\.0$/,'') + '%');
  if (moon.riseLocal) bits.push('Rise ' + String(moon.riseLocal));
  if (moon.setLocal)  bits.push('Set '  + String(moon.setLocal));
  if (moon.overheadTimeLocal) bits.push('Max alt @ ' + String(moon.overheadTimeLocal));
  return bits.join(' • ');
}

/* ========================= SHEET-CACHE AGGREGATOR ========================= */
function getHourlyAggWithSheetCache(lat, lon, range, tz, forecastJson, marineJson, locationNameForRow) {
  const begin = new Date(range.start);
  const end   = new Date(range.end);

  const rangeDayStr = Utilities.formatDate(begin, tz, 'yyyy-MM-dd');
  const idx = buildDayIndexIfNeeded_(lat, lon, tz, rangeDayStr);

  // Build rowsInWindow from in-memory index only (read once)
  const rowsInWindow = [];
  const hours = Object.keys(idx.byHour);
  for (let i=0;i<hours.length;i++){
    const hh = hours[i];
    const iso = rangeDayStr + 'T' + hh + ':00';
    const t = new Date(iso);
    if (t >= begin && t < end) rowsInWindow.push(idx.byHour[hh].rowValues);
  }

  // Freshness
  let newestGeneral = null;
  let newestMetrics = null;

  for (const r of rowsInWindow) {
    const updGen = new Date(String(r[29] || r[28] || r[27] || '')).getTime();
    if (isFinite(updGen) && (newestGeneral == null || updGen > newestGeneral)) newestGeneral = updGen;

    const updMet = new Date(String(r[27] || r[29] || r[28] || '')).getTime();
    if (isFinite(updMet) && (newestMetrics == null || updMet > newestMetrics)) newestMetrics = updMet;
  }

  // v3.8.3: A newly downloaded forecast invalidates older calculated summaries.
  const rawWeather = wxRead_(cacheKey('forecast', lat, lon, tz));
  const rawMarine = wxRead_(cacheKey('marine', lat, lon, tz) + ':cur');
  const sourceChanged = [rawWeather, rawMarine].some(record =>
    record && record.savedAt && (newestGeneral == null || record.savedAt > newestGeneral + 1000));
  const generalFresh = !sourceChanged && (newestGeneral != null) && ((Date.now() - newestGeneral) < SHEET_TTL_MS);
  const metricsFresh = !sourceChanged && (newestMetrics != null) && ((Date.now() - newestMetrics) < METRIC_TTL_MS);

  if (rowsInWindow.length >= 2 && generalFresh && metricsFresh) {
    const rows = rowsInWindow.map(r => ({
      timeISO: rangeDayStr + 'T' + String(r[4]).padStart(2, '0') + ':00',
      wave_m:         asNum_(r[6]),
      wind_kn:        asNum_(r[7]),
      wave_period_s:  asNum_(r[8]),
      wind_gust_kn:   asNum_(r[11]),
      sst_c:          asNum_(r[12]),
      swell_dir_deg:  asNum_(r[13]),
      wind_dir_deg:   asNum_(r[14]),
      cloudcover:     asNum_(r[19]),
      precipitation:  asNum_(r[18]),
      uv_index:       null,
      current_kn:     asNum_(r[31]),
      current_dir_deg:asNum_(r[32]),
      sea_level_m:    null
    }));

    const m   = summarize(rows, tz);
    const sky = daySkySummary(forecastJson, range, tz, m);

    const r0 = rowsInWindow[0];
    const extras = {
      uvHourlyMax:      r0[15],
      uvDailyMax:       r0[16],
      hiHourlyMaxC:     r0[17],
      pressureDeltaHpa: r0[20],
      squallFlag:       !!r0[21],
      tideExtremaJson:  r0[22],
      locationName:     r0[23],
      conditionColor:   r0[24],
      comfortScore:     r0[25],
      avgCurrentKn:     r0[31],
      currentDirMeanDeg:r0[32]
    };

    logOk_('CACHE', 'Reused MarineCache for window, no recompute');
    return { m, sky, extras };
  }

  // Recompute
  let joined = joinHourly(marineJson, forecastJson, range);
  let source_note = 'window';
  if (!joined.length) {
    joined = joinHourly(marineJson, forecastJson, getFullDayRange(range.start, tz));
    if (!joined.length) return { m: null, sky: null, extras: null };
    source_note = 'day-fallback';
  }

  const m   = summarize(joined, tz);
  const sky = daySkySummary(forecastJson, range, tz, m);

  const precipVals  = joined.map(x => Number(x.precipitation)).filter(isFinite);
  const cloudVals   = joined.map(x => Number(x.cloudcover)).filter(isFinite);
  const precipSumMm = precipVals.length ? precipVals.reduce((a, b) => a + b, 0) : null;
  const cloudAvgPct = cloudVals.length ? Math.round(cloudVals.reduce((a, b) => a + b, 0) / cloudVals.length) : null;

  const hourlyU = [];
  for (const j of joined) { const v = Number(j.uv_index); if (isFinite(v)) hourlyU.push(v); }
  const uvHourlyMax = hourlyU.length ? Number(Math.max(...hourlyU).toFixed(1)) : null;

  const d = (forecastJson && forecastJson.daily) ? forecastJson.daily : {};
  const dayKey = Utilities.formatDate(range.start, tz, 'yyyy-MM-dd');
  const dayIdx = (d.time || []).findIndex(s => s === dayKey);
  const uvDailyMax = (dayIdx >= 0 && d.uv_index_max && d.uv_index_max[dayIdx] != null)
    ? Number(Number(d.uv_index_max[dayIdx]).toFixed(1))
    : null;

  const hiVals = [];
  for (const j of joined) {
    const tC = Number(j.temperature_2m);
    const rh = Number(j.relative_humidity_2m);
    if (isFinite(tC) && isFinite(rh)) hiVals.push(heatIndexC(tC, rh));
  }
  const hiHourlyMaxC = hiVals.length ? Number(Math.max(...hiVals).toFixed(1)) : null;

  const pressureDeltaHpa = pressureTrendHpa(forecastJson, range);
  const squallFlag       = hasSquallRisk(forecastJson, range);

  const dayRows         = joinHourly(marineJson, forecastJson, getFullDayRange(range.start, tz));
  const tideExtremaJson = tideExtremaCompact(dayRows, tz);

  const cond            = classifyByAvgWithChop(m, sky, squallFlag);
  const conditionColor  = cond;
  const comfort         = CONFIG.COMFORT_ENABLED ? comfortScore(m, cond, sky) : null;
  const comfortScoreNum = comfort ? comfort.score : null;

  const metricsUpdatedAt = new Date().toISOString();

  // Build upserts by hour (batch)
  const upsertsByHour = {};
  for (const j of joined) {
    const t = new Date(j.timeISO);
    if (t < begin || t >= end) continue;
    const HH   = Utilities.formatDate(t, tz, 'HH');
    upsertsByHour[HH] = {
      avgWaveM:          j.wave_m,
      avgWindKn:         j.wind_kn,
      avgWavePeriodS:    j.wave_period_s,
      peakWaveM:         j.wave_m,
      peakWindKn:        j.wind_kn,
      peakGustKn:        j.wind_gust_kn,
      avgSstC:           j.sst_c,
      swellDirMeanDeg:   j.swell_dir_deg,
      windDirMeanDeg:    j.wind_dir_deg,
      uvHourlyMax:       uvHourlyMax,
      uvDailyMax:        uvDailyMax,
      hiHourlyMaxC:      hiHourlyMaxC,
      precipSumMm:       precipSumMm,
      cloudAvgPct:       cloudAvgPct,
      pressureDeltaHpa:  pressureDeltaHpa,
      squallFlag:        squallFlag,
      tideExtremaJson:   tideExtremaJson,
      locationName:      locationNameForRow || CONFIG.LOCATION_NAME,
      conditionColor:    conditionColor,
      comfortScore:      comfortScoreNum,
      rowCountHours:     joined.length,
      metrics_updated_at:metricsUpdatedAt,
      source_note:       source_note,
      avgCurrentKn:      m.avgCurrentKn,
      currentDirMeanDeg: m.currentDirMeanDeg
    };
  }

  // Upsert once for the day
  upsertCacheRowsBatch_(lat, lon, tz, rangeDayStr, upsertsByHour);

  const extras = {
    uvHourlyMax,
    uvDailyMax,
    hiHourlyMaxC,
    pressureDeltaHpa,
    squallFlag,
    tideExtremaJson,
    locationName:      locationNameForRow || CONFIG.LOCATION_NAME,
    conditionColor,
    comfortScore:      comfortScoreNum,
    avgCurrentKn:      m.avgCurrentKn,
    currentDirMeanDeg: m.currentDirMeanDeg
  };

  logOk_('CACHE', 'Recomputed and refreshed MarineCache for window (batch upsert)');
  return { m, sky, extras };
}

/* ========================= BANKS BUILDERS ========================= */
function buildBankConditions(bank, tz, range){
  const marine=fetchMarine(bank.lat,bank.lon,tz);
  const forecast=fetchForecast(bank.lat,bank.lon,tz);

  const agg = getHourlyAggWithSheetCache(bank.lat, bank.lon, range, tz, forecast, marine, bank.name);

  let m=null, sky=null, extras=null;
  if (agg && agg.m) {
    m = agg.m; sky = agg.sky; extras = agg.extras;
  } else {
    const joined = joinHourly(marine, forecast, range);
    const rows = joined.length ? joined : joinHourly(marine, forecast, getFullDayRange(range.start, tz));
    if (!rows.length) throw new Error('No data for bank window.');
    m=summarize(rows,tz);
    sky=daySkySummary(forecast,range,tz,m);
    extras = { uvDailyMax:null, uvHourlyMax:null, hiHourlyMaxC:null, pressureDeltaHpa:null, squallFlag:hasSquallRisk(forecast,range), tideExtremaJson:'' };
  }

  const squall = extras && typeof extras.squallFlag === 'boolean' ? extras.squallFlag : hasSquallRisk(forecast,range);
  const cond = classifyByAvgWithChop(m, sky, squall);
  const statusInfo = buildStatusInfo(cond, m, sky, squall);

  const rows24= joinHourly(marine, forecast, getFullDayRange(range.start,tz));
  const tides = rows24.length ? findTideExtremes(rows24,tz) : {highs:[],lows:[]};
  const tideCompact = formatTidesCompact(tides);

  const weed = sargassumWeedlineProb(m, sky, rows24, range);
  const weedText = `${weed.level} (index ${weed.percent}/100)${weed.reason?` - ${weed.reason}`:''}`;

  let uvValue = extras && extras.uvDailyMax != null ? extras.uvDailyMax : null;
  let uvBadge = { value: uvValue, level: uvLevel(uvValue), color: uvColor(uvValue) };
  let hiBadge = { valueC: extras && extras.hiHourlyMaxC != null ? extras.hiHourlyMaxC : null,
                  level: heatIndexLevel(extras && extras.hiHourlyMaxC != null ? extras.hiHourlyMaxC : null),
                  color: heatIndexColor(extras && extras.hiHourlyMaxC != null ? extras.hiHourlyMaxC : null) };

  const rangeWave = (isNum(m.minWaveM)||isNum(m.maxWaveM)) ? `${fmt(mToFt(m.minWaveM),1)}–${fmt(mToFt(m.maxWaveM),1)} ft` : '—';
  const rangeWind = (isNum(m.minWindKn)||isNum(m.maxWindKn)) ? `${fmt(m.minWindKn,0)}–${fmt(m.maxWindKn,0)} kt` : '—';
  const avgLine   = `${fmt(mToFt(m.avgWaveM),1)} ft / ${fmt(m.avgWindKn,0)} kt • Chop ${m.avgWavePeriodS!=null?fmt(m.avgWavePeriodS,1)+' s':'—'}`
                  + ` (range ${rangeWave}; wind ${rangeWind})`;

  const dP = extras && extras.pressureDeltaHpa != null ? extras.pressureDeltaHpa : pressureTrendHpa(forecast, range);
  const pFmt = formatPressureTrend(dP, range, tz);

  const moon = (function(){
    try { return moonInfoFromVC(range, tz, bank.lat, bank.lon); }
    catch(e){ return moonPhaseForDate(range.start, tz); }
  })();

  const fish = strikeRating_(m, tides, dP, moon, range, tz);
  const fishType = bestFishingType_(m);

  return {
    name: bank.name,
    cond, statusInfo,
    comfort: comfortScore(m,cond,sky),
    weatherLine: `${sky.emoji} ${String(sky.label)} • ${String(sky.reason)}`
      +(sky.precip_in!=null?` • ${sky.precip_in} in`:``)
      +(sky.cloudcover_avg!=null?` • Cloud ${sky.cloudcover_avg}%`:``)
      +(sky.precip_prob_max!=null?` • Max PoP ${sky.precip_prob_max}%`:``)
      + (pFmt&&pFmt.text?` • Pressure: ${pFmt.text}`:''),
    avgSeaWind: avgLine,
    peakWave: `${fmt(mToFt(m.peakWaveM),1)} ft${m.peakWaveHourLocal?' at '+m.peakWaveHourLocal:''}`,
    peakWind: `${fmt(m.peakWindKn,0)} kt${m.peakWindHourLocal?' at '+m.peakWindHourLocal:''} • Gusts ${fmt(m.peakGustKn,0)} kt`,
    current: isNum(m.avgCurrentKn) ? `${fmt(m.avgCurrentKn,1)} kt${m.currentDirCompass?' • '+m.currentDirCompass:''}` : '—',
    sst: `${fmt(cToF(m.avgSstC),1)} °F`,
    swell: m.swellDirCompass?`${m.swellDirCompass} (${Math.round(m.swellDirMeanDeg)}°)`:'—',
    tidesCompact: tideCompact,
    weedlines: weedText,
    uvBadge, hiBadge,
    moonLine: formatMoonLine_(moon),
    fish, fishType
  };
}

function buildSingleBankCardHTML(bank, tz, range){
  const b = buildBankConditions(bank, tz, range);
  const statusLine = renderStatusWithComfort_(b.cond, b.statusInfo, b.comfort);
  const notes = b.fish && b.fish.summary ? b.fish.summary : '';
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;border:1px solid #e5e7eb;border-radius:8px;padding:10px;max-width:880px;">
    <h3 style="margin:0 0 6px;">${String(b.name)} — Quick-Look</h3>
    <p style="margin:0 0 10px;">${statusLine}</p>
    <table style="border-collapse:collapse;font-size:14px;width:100%;">
      <tr><td style="padding:6px 10px;border:1px solid #ddd;">Sky</td><td style="padding:6px 10px;border:1px solid #ddd;">${b.weatherLine}<br>${renderUvBadgeHtml(b.uvBadge)} • ${renderHeatBadgeHtml(b.hiBadge)}</td></tr>
      <tr><td style="padding:6px 10px;border:1px solid #ddd;">Avg Sea / Wind</td><td style="padding:6px 10px;border:1px solid #ddd;">${b.avgSeaWind}</td></tr>
      <tr><td style="padding:6px 10px;border:1px solid #ddd;">Peak Wave</td><td style="padding:6px 10px;border:1px solid #ddd;">${b.peakWave}</td></tr>
      <tr><td style="padding:6px 10px;border:1px solid #ddd;">Peak Wind</td><td style="padding:6px 10px;border:1px solid #ddd;">${b.peakWind}</td></tr>
      <tr><td style="padding:6px 10px;border:1px solid #ddd;">Current</td><td style="padding:6px 10px;border:1px solid #ddd;">${b.current}</td></tr>
      <tr><td style="padding:6px 10px;border:1px solid #ddd;">SST</td><td style="padding:6px 10px;border:1px solid #ddd;">${b.sst}</td></tr>
      <tr><td style="padding:6px 10px;border:1px solid #ddd;">Dominant Swell</td><td style="padding:6px 10px;border:1px solid #ddd;">${b.swell}</td></tr>
      <tr><td style="padding:6px 10px;border:1px solid #ddd;">Tides</td><td style="padding:6px 10px;border:1px solid #ddd;">${b.tidesCompact||'—'}</td></tr>
      <tr><td style="padding:6px 10px;border:1px solid #ddd;">Moon</td><td style="padding:6px 10px;border:1px solid #ddd;">${b.moonLine}</td></tr>
      <tr><td style="padding:6px 10px;border:1px solid #ddd;">Weedline Conditions</td><td style="padding:6px 10px;border:1px solid #ddd;">${b.weedlines}</td></tr>
      <tr><td style="padding:6px 10px;border:1px solid #ddd;">Fishing</td><td style="padding:6px 10px;border:1px solid #ddd;"><b>${b.fishType}</b> — ${notes}</td></tr>
    </table>
    <div style="margin-top:8px;font-size:12px;color:#666;">Not for navigation.</div>
  </div>`;
}

function buildBanksTableHTML(items){
  const two = items.slice(0,2);
  const col = x => `
    <td style="vertical-align:top;padding:8px;border:1px solid #e5e7eb;">
      <div>
        <b>Verdict</b><br>
        ${renderStatusWithComfort_(x.cond, null, x.comfort)}
        <div style="margin-top:6px;color:#6b7280;font-size:12px;">
          ${x.cond==='RED'?'RED — unsafe or poor conditions.':x.cond==='YELLOW'?'YELLOW — caution.':'GREEN — generally okay.'}
        </div>
      </div>
      <div style="margin-top:6px;"><b>Weather</b><br>${x.weatherLine}<br>${renderUvBadgeHtml(x.uvBadge)} • ${renderHeatBadgeHtml(x.hiBadge)}</div>
      <div style="margin-top:6px;"><b>Weedline Conditions</b><br>${x.weedlines}</div>
      <div style="margin-top:6px;"><b>Type</b><br>${x.fishType}</div>
      <div style="margin-top:6px;"><b>Peak Wave</b><br>${x.peakWave}</div>
      <div style="margin-top:6px;"><b>Peak Wind</b><br>${x.peakWind}</div>
      <div style="margin-top:6px;"><b>Avg Sea/Wind</b><br>${x.avgSeaWind}</div>
      <div style="margin-top:6px;"><b>Current</b><br>${x.current}</div>
      <div style="margin-top:6px;"><b>SST</b><br>${x.sst}</div>
      <div style="margin-top:6px;"><b>Dominant Swell</b><br>${x.swell}</div>
      <div style="margin-top:6px;"><b>Tides</b><br>${x.tidesCompact||'—'}</div>
      <div style="margin-top:6px;"><b>Moon</b><br>${x.moonLine}</div>
      <div style="margin-top:6px;"><b>Notes</b><br>${x.fish ? x.fish.summary : ''}</div>
    </td>`;
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;margin-top:14px;">
      <h3 style="margin:0 0 6px;">Marine Banks Fishing Forecast</h3>
      <div style="color:#374151;font-size:13px;margin-bottom:6px;">${two.map(x=>x.name).join(' and ')} — quick compare.</div>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <tr><th style="text-align:left;padding:8px;border:1px solid #e5e7eb;width:50%;">${two[0].name}</th><th style="text-align:left;padding:8px;border:1px solid #e5e7eb;width:50%;">${two[1].name}</th></tr>
        <tr>${col(two[0])}${col(two[1])}</tr>
      </table>
    </div>
  `;
}

/* ========================= EMAIL SEND ========================= */
function sendIndividually(subject, htmlBody, textBody){
  mw390RequireProduction_('email');
  const subscriberRows = listSubscribers();
  const subs = subscriberRows.filter(x => String(x.status||'').toLowerCase()==='subscribed').map(x=>String(x.email||'').trim()).filter(Boolean);
  const fallback = (CONFIG.RECIPIENT_EMAIL||'').split(/[;,]/).map(s=>s.trim()).filter(Boolean);
  const recipients = Array.from(new Set((subs.length?subs:fallback).map(e=>e.toLowerCase())));
  Logger.log('[EMAIL] Records='+ subscriberRows.length + ' records | Active='+subs.length + ' | Selected recipients='+recipients.length);
  let sent=0, failed=0;
  Logger.log(`📧 Sending individually to ${recipients.length} recipient(s).`);
  recipients.forEach(email=>{
    try{
      MailApp.sendEmail({ to:email, subject, name:CONFIG.SENDER_NAME, htmlBody, body:textBody });
      sent++;
    } catch(e){
      failed++;
      Logger.log(`Send error to ${email}: ${e}`);
    }
  });
  Logger.log('[EMAIL SUMMARY] Sent='+sent+' | Failed='+failed);
}

/* ========================= SUBSCRIBERS ========================= */
function ensureSubscriberSheet(){
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  let sh = ss.getSheetByName(CONFIG.SUBS_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.SUBS_SHEET_NAME);
    sh.appendRow(['email','status','created_at','updated_at']);
  }
  return sh;
}
function listSubscribers(){
  const sh = ensureSubscriberSheet();
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) { Logger.log('✅ Subscribers sheet exists but is empty.'); return []; }
  const rows = data.slice(1).map(r=>({ email:r[0], status:r[1], created_at:r[2], updated_at:r[3] }));
  Logger.log(`✅ Found ${rows.length} subscriber(s).`);
  return rows;
}

/* ========================= CURRENT RENDERERS ========================= */
function renderHtmlCurrent(m, condition, range, sky, heatUv, pressureFmt, moon, tides, banksHTML, opts){
  const title=opts&&opts.title?opts.title:`${CONFIG.LOCATION_NAME} — Marine Synopsis`;
  const comfortObj = CONFIG.COMFORT_ENABLED ? comfortScore(m, condition, sky) : null;
  const statusLine = renderStatusWithComfort_(condition, (opts && opts.statusInfo) || null, comfortObj);
  const forecastWindow = `${Utilities.formatDate(range.start, CONFIG.TIMEZONE, "EEE, MMM d, yyyy h:mm a")} – ${Utilities.formatDate(range.end, CONFIG.TIMEZONE, "h:mm a")} (Jamaica time)`;

  const skyLine=`${sky.emoji} ${String(sky.label)} • ${String(sky.reason)}`
    +(sky.precip_in!=null?` • ${sky.precip_in} in`:``)
    +(sky.cloudcover_avg!=null?` • Cloud ${sky.cloudcover_avg}%`:'')
    +(sky.precip_prob_max!=null?` • Max PoP ${sky.precip_prob_max}%`:'');

  const uvBadge  = renderUvBadgeHtml(heatUv && heatUv.uv);
  const hiBadge  = renderHeatBadgeHtml(heatUv && heatUv.heat);
  const pressureLine=pressureFmt&&pressureFmt.text?` • <b>Pressure:</b> ${String(pressureFmt.text)}`:'';

  const highs = (tides && tides.highs || []).slice(0,2).map(x=>`High ${fmt(mToFt(x.height_m),1)} ft @ ${x.time}`).join('; ') || '—';
  const lows  = (tides && tides.lows  || []).slice(0,2).map(x=>`Low ${fmt(mToFt(x.height_m),1)} ft @ ${x.time}`).join('; ')  || '—';

  const currentLine = (isNum(m.avgCurrentKn) ? `${fmt(m.avgCurrentKn,1)} kt` : '—')
    + (m.currentDirCompass ? ` • ${m.currentDirCompass}` : '');

  const waveRange = (isNum(m.minWaveM)||isNum(m.maxWaveM)) ? `${fmt(mToFt(m.minWaveM),1)}–${fmt(mToFt(m.maxWaveM),1)} ft` : '—';
  const windRange = (isNum(m.minWindKn)||isNum(m.maxWindKn)) ? `${fmt(m.minWindKn,0)}–${fmt(m.maxWindKn,0)} kt` : '—';
  const avgLine   = `${fmt(mToFt(m.avgWaveM),1)} ft / ${fmt(m.avgWindKn,0)} kt • Chop ${m.avgWavePeriodS!=null?fmt(m.avgWavePeriodS,1)+' s':'—'}`
                  + ` (range ${waveRange}; wind ${windRange})`;

  const moonLine = formatMoonLine_(moon);

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.45;max-width:860px;">
    <h3 style="margin:0 0 8px 0;">${String(title)}</h3>
    <p style="margin:0 0 8px 0;font-size:14px;"><b>Forecast window:</b> ${forecastWindow}</p>
    <p style="margin:0 0 10px 0;">${statusLine}</p>
    <table style="border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:6px 12px;border:1px solid #ddd;">Sky</td><td style="padding:6px 12px;border:1px solid #ddd;">${skyLine}<br/>${uvBadge} • ${hiBadge}${pressureLine}</td></tr>
      <tr><td style="padding:6px 12px;border:1px solid #ddd;">Peak Wave</td><td style="padding:6px 12px;border:1px solid #ddd;"><b>${fmt(mToFt(m.peakWaveM),1)} ft</b> ${m.peakWaveHourLocal?`at ${m.peakWaveHourLocal}`:''}</td></tr>
      <tr><td style="padding:6px 12px;border:1px solid #ddd;">Peak Wind</td><td style="padding:6px 12px;border:1px solid #ddd;"><b>${fmt(m.peakWindKn,0)} kt</b> ${m.peakWindHourLocal?`at ${m.peakWindHourLocal}`:''} • Gusts ${fmt(m.peakGustKn,0)} kt</td></tr>
      <tr><td style="padding:6px 12px;border:1px solid #ddd;">Avg Sea / Wind</td><td style="padding:6px 12px;border:1px solid #ddd;">${avgLine}</td></tr>
      <tr><td style="padding:6px 12px;border:1px solid #ddd;">Current</td><td style="padding:6px 12px;border:1px solid #ddd;">${currentLine}</td></tr>
      <tr><td style="padding:6px 12px;border:1px solid #ddd;">Sea Surface Temp</td><td style="padding:6px 12px;border:1px solid #ddd;">${fmt(cToF(m.avgSstC),1)} °F</td></tr>
      <tr><td style="padding:6px 12px;border:1px solid #ddd;">Dominant Swell</td><td style="padding:6px 12px;border:1px solid #ddd;">${m.swellDirCompass?`${m.swellDirCompass} (${Math.round(m.swellDirMeanDeg)}°)`:'—'}</td></tr>
      <tr><td style="padding:6px 12px;border:1px solid #ddd;">Tides (approx.)</td><td style="padding:6px 12px;border:1px solid #ddd;">${highs} | ${lows}</td></tr>
      <tr><td style="padding:6px 12px;border:1px solid #ddd;">Moon</td><td style="padding:6px 12px;border:1px solid #ddd;">${moonLine}</td></tr>
    </table>
    ${banksHTML || ''}
    ${getLegendHtml()}
    <p style="margin-top:12px;font-size:12px;color:#666;">Not for navigation.</p>
  </div>`;
}

function renderTextCurrent(m, condition, range, sky, heatUv, pressureFmt, moon, tides, opts){
  const title = (opts && opts.title) ? opts.title : `${CONFIG.LOCATION_NAME} — Marine Synopsis`;
  const span  = `${Utilities.formatDate(range.start, m.tz, 'EEE HH:mm')}–${Utilities.formatDate(range.end, m.tz, 'HH:mm')}`;
  const status = `Status: ${condition}${(opts&&opts.statusInfo&&opts.statusInfo.full)||''}`;
  const comfort = comfortScore(m, condition, sky);
  const skyBits = [
    sky.emoji + ' ' + sky.label + ' • ' + sky.reason,
    (sky.precip_in != null ? `${sky.precip_in} in` : ''),
    (sky.cloudcover_avg != null ? `Cloud ${sky.cloudcover_avg}%` : ''),
    (sky.precip_prob_max != null ? `Max PoP ${sky.precip_prob_max}%` : '')
  ].filter(Boolean).join(' • ');

  const highsTxt = (tides && tides.highs && tides.highs.length)
    ? tides.highs.slice(0,2).map(x => `High ${fmt(mToFt(x.height_m),1)} ft @ ${x.time}`).join('; ')
    : '—';
  const lowsTxt  = (tides && tides.lows && tides.lows.length)
    ? tides.lows.slice(0,2).map(x => `Low ${fmt(mToFt(x.height_m),1)} ft @ ${x.time}`).join('; ')
    : '—';

  const waveRange = (isNum(m.minWaveM)||isNum(m.maxWaveM)) ? `${fmt(mToFt(m.minWaveM),1)}–${fmt(mToFt(m.maxWaveM),1)} ft` : '—';
  const windRange = (isNum(m.minWindKn)||isNum(m.maxWindKn)) ? `${fmt(m.minWindKn,0)}–${fmt(m.maxWindKn,0)} kt` : '—';

  const currentTxt = (isNum(m.avgCurrentKn) ? `${fmt(m.avgCurrentKn,1)} kt` : '—')
    + (m.currentDirCompass ? ` • ${m.currentDirCompass}` : '');

  const moonTxt = formatMoonLine_(moon);

  const avgLine = `${fmt(mToFt(m.avgWaveM),1)} ft / ${fmt(m.avgWindKn,0)} kt • ${m.avgWavePeriodS!=null?fmt(m.avgWavePeriodS,1)+' s':'—'}`
                + ` (range ${waveRange}; wind ${windRange})`;

  const fb = opts && opts.usedFallback ? 'Note: Hourly slice sparse. Used full-day data.' : '';

  return [
    title,
    `Window: ${span}`,
    status,
    (fb?`(${fb})`:''), 
    `Comfort: ${comfort ? `${comfort.score}/5 — ${comfort.label}` : '—'}`,
    `Sky: ${skyBits}`,
    `UV: ${heatUv&&heatUv.uv?heatUv.uv.value:'—'} (${heatUv&&heatUv.uv?heatUv.uv.level:'—'}) • HI: ${heatUv&&heatUv.heat&&heatUv.heat.valueC!=null ? fmt(cToF(heatUv.heat.valueC),1) + '°F (' + heatUv.heat.level + ')' : '—'}`,
    `Pressure: ${pressureFmt&&pressureFmt.text?pressureFmt.text:'—'}`,
    `Moon: ${moonTxt}`,
    `Current: ${currentTxt}`,
    `Avg Sea/Wind/Chop: ${avgLine}`,
    `Peak Wave: ${fmt(mToFt(m.peakWaveM),1)} ft ${m.peakWaveHourLocal ? `at ${m.peakWaveHourLocal}` : ''}`,
    `Peak Wind: ${fmt(m.peakWindKn,0)} kt ${m.peakWindHourLocal ? `at ${m.peakWindHourLocal}` : ''} • Gusts ${fmt(m.peakGustKn,0)} kt`
  ].join('\n');
}

/* ========================= SYNOPSIS ========================= */
function buildSynopsisForRange(range, title){ return buildSynopsisForRangeCached(range, title); }

function buildSynopsisForRangeCached(range, title, suppressWebAdvisory){
  const tz = CONFIG.TIMEZONE;
  const marine   = fetchMarine(CONFIG.LAT, CONFIG.LON, tz);
  const forecast = fetchForecast(CONFIG.LAT, CONFIG.LON, tz);

  const agg = getHourlyAggWithSheetCache(CONFIG.LAT, CONFIG.LON, range, tz, forecast, marine, CONFIG.LOCATION_NAME);

  let rows = null, m=null, sky=null, usedFallback=false, extras=null;
  if (agg && agg.m) { m = agg.m; sky = agg.sky; extras = agg.extras || null; }
  else {
    rows = joinHourly(marine, forecast, range);
    if (!rows.length) { rows = joinHourly(marine, forecast, getFullDayRange(range.start,tz)); usedFallback = rows.length>0; }
    if (!rows.length) throw new Error('No hourly data found for window.');
    m=summarize(rows,tz);
    sky=daySkySummary(forecast, usedFallback?getFullDayRange(range.start,tz):range, tz, m);
  }

  const squall = extras && typeof extras.squallFlag === 'boolean' ? extras.squallFlag : hasSquallRisk(forecast, range);
  const dP = extras && extras.pressureDeltaHpa != null ? extras.pressureDeltaHpa : pressureTrendHpa(forecast, range);
  const pFmt = formatPressureTrend(dP, range, tz);

  const isCurrentSpan = (range.end.getTime() - new Date().getTime()) <= 6*3600e3;
  const heatUv = assessHeatUvOptionC(forecast, range, tz, isCurrentSpan ? 'hourly' : 'daily');

  const cond = classifyByAvgWithChop(m, sky, squall);
  const statusInfo = buildStatusInfo(cond, m, sky, squall);

  let moon;
  try { moon = moonInfoFromVC(range, tz, CONFIG.LAT, CONFIG.LON); }
  catch(e){ moon = moonPhaseForDate(range.start, tz); }

  const tides = findTideExtremes(joinHourly(marine, forecast, getFullDayRange(range.start, tz)), tz);

  const bow = buildBankConditions(BANKS.bowditch, tz, range);
  const cal = buildBankConditions(BANKS.california,  tz, range);
  const banksHTML = buildBanksTableHTML([bow, cal]);

  // v3.8.4f: The same plain-language source notice is used in email and web reports.
  const advisory = wxPlainAdvisoryV384f_([{name:CONFIG.LOCATION_NAME,lat:CONFIG.LAT,lon:CONFIG.LON}], range, tz);
  const staleNotice = advisory.caution ? advisory.html : '';
  return {
    html: (suppressWebAdvisory ? '' : staleNotice) + renderHtmlCurrent(m, cond, range, sky, heatUv, pFmt, moon, tides, banksHTML, { title, statusInfo, usedFallback }),
    text: (advisory.caution ? advisory.text + '\n\n' : '') +
      renderTextCurrent(m, cond, range, sky, heatUv, pFmt, moon, tides, { title, statusInfo, usedFallback }),
    cond, range
  };
}

/* ========================= QUOTES ========================= */
function getRandomFishingQuote_(){
  try{
    const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    const sh = ss.getSheetByName('fishing quotes');
    if (!sh) return null;
    const last = sh.getLastRow();
    if (last < 2) return null;
    const vals = sh.getRange(2,3,last-1,1).getValues().map(r=>String(r[0]||'').trim()).filter(Boolean);
    if (!vals.length) return null;
    return vals[Math.floor(Math.random()*vals.length)];
  }catch(e){ logWarn_('QUOTE','Unable to read fishing quotes: ' + e); return null; }
}

/* ========================= SHARED EMAIL / WEB PRESENTATION ========================= */
function wxSynopsisShellV384b_(synopsisHtml, quoteHtml, freshnessHtml, hideFooter) {
  return '<div style="width:100%;background:#f8fafc;padding:12px 0;">' +
    '<div style="max-width:640px;margin:0 auto;background:#ffffff;padding:12px;border:1px solid #e5e7eb;border-radius:10px;">' +
      (freshnessHtml || '') + (quoteHtml || '') + synopsisHtml + (hideFooter ? '' : renderFooterHtml()) +
    '</div></div>';
}

/* ========================= CRON/EMAIL ========================= */
function runMarineBrief() {
  WX_REPORT_MODE = true;
  try {
  cleanupOldCacheRows_(2);

  var range = getTomorrowRange(CONFIG.TIMEZONE);
  var syn = buildSynopsisForRangeCached(
    range,
    CONFIG.LOCATION_NAME + ' — Tomorrow Marine Forecast (' +
      formatDateHuman(range.start, CONFIG.TIMEZONE) + ')'
  );

  var subject = '[Marine ' + syn.cond + '] Kingston Marine Wx — Tomorrow ' +
    formatDateHuman(range.start, CONFIG.TIMEZONE);

  var quote = getRandomFishingQuote_();
  var quoteHtml = quote
    ? '<blockquote style="margin:0 0 12px 0;padding:8px 12px;border:4px solid #60a5fa;background:#f0f9ff;font-size:15pt;font-style:italic;">' +
        quote +
      '</blockquote>'
    : '';
  var quoteTxt  = quote ? '“' + quote + '”\n\n' : '';

  var wrapperHtml = wxSynopsisShellV384b_(syn.html, quoteHtml, '');

  var textOut = quoteTxt + syn.text + '\n\n' + renderFooterText();
  try { sendIndividually(subject, wrapperHtml, textOut); }
  finally { wxLogSummary_(); }
  } finally { WX_REPORT_MODE = false; }
}

/* ========================= FOOTERS / POPUP ========================= */
function renderFooterHtml(){
  const cur = CONFIG.CURRENT_APP_URL;
  const sub = CONFIG.SUB_APP_URL;
  const rjyc = 'https://www.youtube.com/channel/UCv-xyJPyHAA1PA8XMwMWeMQ/live';
  const oceanCurrents = 'https://fishing.andrewcheeky.com/';

  // NEW local marine source
  const local = (CONFIG.LOCAL_MARINE_URL || 'https://jamaica.weatherproof.fi/web/website_2014/website_elements/news2.php?type=6');

  const btn = (label, href, bg, id) =>
    `<a ${id ? `id="${id}"` : ''} href="${href}" style="display:inline-block;margin:10px 10px 0 0;padding:10px 14px;border-radius:8px;background:${bg};color:#fff;text-decoration:none;font-weight:700;">${label}</a>`;

  // Local forecast uses THIS app, so it can open in popup like Current/Weekend
  // Falls back safely if getAppUrl() is blank by using CURRENT_APP_URL.
  const base = CONFIG.CURRENT_APP_URL || '';

  return `
  <div style="margin-top:16px;border-top:1px solid #e0e0e0;padding-top:10px;font-size:12px;color:#555;">
    <div>Quick links:</div>
    ${cur ? btn('Current Conditions', cur + '?action=current', '#1976d2', 'curBtn') : ''}
    ${cur ? btn('Weekend Quick-Look', cur + '?action=weekend', '#2563eb', 'wkBtn') : ''}
    ${cur ? btn('Banks',  cur + '?action=banks',   '#0ea5e9') : ''}
    ${btn('Ocean Currents', oceanCurrents, '#0369a1', 'oceanBtn')}
    ${btn('Subscribe',   sub + '?action=subscribe',   '#2e7d32')}
    ${btn('Unsubscribe', sub + '?action=unsubscribe', '#c62828')}

    ${btn('RJYC Live',   rjyc,                        '#6b21a8')}
    ${base ? btn('Local Marine Forecast', cur + '?action=localmarine', '#0f766e', 'localBtn') : ''}

    <div style="margin-top:8px;color:#888;">
      “Current Conditions”, “Weekend Quick-Look”, and “Local Marine Forecast” open in a popup with a loading spinner. “Ocean Currents” opens in a separate popup window.
    </div>

    <script>
      (function(){
        function popupSpinnerHtml_(title, color){
          var t = title || 'Loading…';
          var c = color || '#1976d2';
          return '<!doctype html><html><head><meta charset="utf-8"><title>'+t+'</title>'
            + '<style>@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}'
            + 'body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#fff;color:#374151}'
            + '.wrap{height:100vh;display:flex;align-items:center;justify-content:center}'
            + '.box{text-align:center}'
            + '.sp{border:6px solid #f3f3f3;border-top:6px solid '+c+';border-radius:50%;width:48px;height:48px;animation:spin 1s linear infinite;margin:0 auto}'
            + '.msg{margin-top:12px;font-size:14px;color:#374151}</style></head>'
            + '<body><div class="wrap"><div class="box"><div class="sp"></div><div class="msg">'+t+'</div></div></div></body></html>';
        }
        function wirePopup(id, title, color){
  var a = document.getElementById(id);
  if (!a) return;

  a.addEventListener('click', function(ev){
    try { ev.preventDefault(); } catch(_) {}

    var href = a.getAttribute('href') || '';
    if (!href) return;

    // Viewport-based sizing
    var vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    var vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);

    // 80% desktop, slightly larger on mobile
    var isMobile = vw < 768;
    var width  = Math.floor(vw * (isMobile ? 0.95 : 0.8));
    var height = Math.floor(vh * (isMobile ? 0.85 : 0.8));

    // Sensible caps for large screens
    width  = Math.min(width, 1100);
    height = Math.min(height, 900);

    // Center the popup
    var left = Math.max(0, Math.floor((vw - width) / 2));
    var top  = Math.max(0, Math.floor((vh - height) / 2));

    var features =
      'popup=1,' +
      'width=' + width +
      ',height=' + height +
      ',left=' + left +
      ',top=' + top +
      ',menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes';

    var w = null;
    try {
      w = window.open('about:blank', id + '_popup', features);
      if (w && !w.closed) {
        try {
          w.document.open();
          w.document.write(popupSpinnerHtml_(title, color));
          w.document.close();
        } catch(_) {}
        try { w.location.href = href; } catch(_) {}
        try { w.focus(); } catch(_) {}
        return;
      }
    } catch(_) {}

    // Fallback: same tab
    try { window.location.href = href; } catch(_) {}
  });
}

        wirePopup('curBtn',   'Loading current conditions…', '#1976d2');
        wirePopup('wkBtn',    'Loading weekend quick-look…', '#2563eb');
        wirePopup('localBtn', 'Loading local marine forecast…', '#0f766e');
        // Open Ocean Currents in its own browser popup (top-level navigation, not an iframe).
        wirePopup('oceanBtn', 'Loading Ocean Currents…', '#0369a1');
      })();
    </script>

    <div style="margin-top:16px;width:100%;text-align:center;font-size:11px;color:#9ca3af;line-height:1.6;">
      <div style="text-align:center;">© 2025 AndrewCheeky.com. Unauthorized use prohibited. All IP preserved.</div>
      <div style="text-align:center;">Powered with precision by - Crafted for clarity.</div>
    </div>
  </div>`;
}


/* ========================= 3) ADD THESE NEW HELPERS ANYWHERE BELOW (e.g. near other render helpers) ========================= */
function stripUnsafeHtml_(html){
  // Remove scripts, iframes, objects, embeds. Keep basic formatting.
  if (!html) return '';
  var out = String(html);

  out = out.replace(/<\s*script[\s\S]*?<\/\s*script\s*>/gi, '');
  out = out.replace(/<\s*iframe[\s\S]*?<\/\s*iframe\s*>/gi, '');
  out = out.replace(/<\s*(object|embed)[\s\S]*?<\/\s*\1\s*>/gi, '');
  out = out.replace(/\son\w+\s*=\s*(['"]).*?\1/gi, ''); // remove inline handlers
  out = out.replace(/javascript:/gi, '');

  return out;
}

function extractBodyLike_(html){
  if (!html) return '';
  var s = String(html);

  // Try body content first
  var m = s.match(/<\s*body[^>]*>([\s\S]*?)<\s*\/\s*body\s*>/i);
  if (m && m[1]) return m[1];

  // Otherwise just return the raw
  return s;
}

function fetchLocalMarineHtml_(){
  var url = CONFIG.LOCAL_MARINE_URL || 'https://jamaica.weatherproof.fi/web/website_2014/website_elements/news2.php?type=6';

  // NO CACHE: always fetch live
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  var code = res.getResponseCode();
  var body = res.getContentText() || '';

  if (code !== 200) {
    return `<div style="color:#b91c1c;">Local source error: ${code}</div>`;
  }

  // Keep it safe and readable
  var inner = extractBodyLike_(body);
  inner = stripUnsafeHtml_(inner);

  // Light cleanup
  inner = inner.replace(/^\s+|\s+$/g, '');

  return inner;
}


function renderLocalMarinePage_(title, hideFooter){
  var tz = CONFIG.TIMEZONE || Session.getScriptTimeZone() || 'Etc/UTC';
  var nowStr = Utilities.formatDate(new Date(), tz, 'EEE, MMM d, yyyy HH:mm');
  var src = CONFIG.LOCAL_MARINE_URL || 'https://jamaica.weatherproof.fi/web/website_2014/website_elements/news2.php?type=6';
  var content = fetchLocalMarineHtml_();

  // Make links open in new tab inside popup
  content = String(content).replace(/<a\b([^>]*?)>/gi, function(_, attrs){
    var a = attrs || '';
    if (/target\s*=/i.test(a)) return '<a' + a + '>';
    return '<a' + a + ' target="_blank" rel="noopener noreferrer">';
  });

  // Basic page shell with your heading and readable formatting
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:920px;margin:12px auto;line-height:1.5;">
    <div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px;background:#ffffff;">
      <h2 style="margin:0 0 6px 0;">${String(title || 'Local Marine Weather Forecast')}</h2>
     
      <div style="border-top:1px solid #e5e7eb;margin:10px 0;"></div>

     

      <div id="localMarineWrap" style="font-size:14px;color:#111827;">
        ${content || '<div style="color:#b91c1c;">No content returned.</div>'}
      </div>
 ${renderLocalMarineImageBlock_()}

      <div style="margin-top:12px;font-size:12px;color:#6b7280;">
        Not for navigation.
      </div>
    </div>

    <div style="margin-top:12px;">
      ${hideFooter ? '' : renderFooterHtml()}
    </div>
  </div>`;
}

function renderFooterText(){
  const sub=CONFIG.SUB_APP_URL, rjyc='https://www.youtube.com/channel/UCv-xyJPyHAA1PA8XMwMWeMQ/live';
  return ['—','Ocean Currents: https://fishing.andrewcheeky.com/','Manage subscription:',`Subscribe: ${sub}?action=subscribe`,`Unsubscribe: ${sub}?action=unsubscribe`,`RJYC Live: ${rjyc}`].join('\n');
}

function renderBankCloseFooter(){
  var injectedBase = getAppUrl() || '';
  var injectedJS   = JSON.stringify(injectedBase);
  return `
    <div style="margin-top:16px;border-top:1px solid #e0e0e0;padding-top:10px;">
      <button id="closeBtn"
        style="padding:8px 12px;border-radius:6px;background:#6b7280;color:#fff;border:none;font-weight:600;cursor:pointer;">
        Close
      </button>
      <script>
        (function(){
          var injected = ${injectedJS};
          function safeBase(){
            try{
              if (!injected) return location.origin + location.pathname;
              var inj = new URL(injected, location.href);
              if (inj.origin !== location.origin) return location.origin + location.pathname;
              return inj.origin + inj.pathname;
            }catch(e){ return location.origin + location.pathname; }
          }
          var params   = new URLSearchParams(location.search);
          var isPopup  = params.get('popup') === '1';
          var btn      = document.getElementById('closeBtn');
          var backUrl  = safeBase() + '?action=banks';
          try { btn.textContent = isPopup && window.opener && !window.opener.closed ? 'Close' : 'Back'; } catch(_){}
          btn.onclick = function(){
            try{ if (isPopup && window.opener && window.opener.closed === false) { window.close(); return; } }catch(_){}
            try { location.href = backUrl; } catch(e){}
          };
        })();
      </script>
    </div>
  `;
}

/* ========================= v3.8.3 FORECAST FRESHNESS ========================= */
function wxEscapeHtmlV383_(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function wxSourceInfoV383_(lat, lon, tz, type) {
  const key = cacheKey(type, lat, lon, tz) + (type === 'marine' ? ':cur' : '');
  const record = wxRead_(key);
  const age = record && record.savedAt ? Date.now() - record.savedAt : Infinity;
  return { key:key, savedAt:record ? record.savedAt : null,
    available:!!record && age <= WX_MAX_STALE_MS,
    delayed:age > API_TTL_SEC * 1000, ageMs:age };
}
/** Plain-language source freshness for both HTML email and web pages.
 * "Retrieved" refers to when the service saved the forecast, not model issuance time.
 * Never call a source current solely because the other source updated.
 */
function wxPlainAdvisoryV384f_(sites, range, tz) {
  const seen = {};
  const info = [];
  (sites || []).forEach(site => ['forecast','marine'].forEach(type => {
    const id = type+':'+Number(site.lat).toFixed(5)+','+Number(site.lon).toFixed(5);
    if (seen[id]) return;
    seen[id] = true;
    info.push({name:site.name, type:type, status:wxSourceInfoV383_(site.lat,site.lon,tz,type)});
  }));
  const time = millis => Utilities.formatDate(new Date(millis), tz, 'MMM d, yyyy h:mm a');
  const windowText = range && range.start && range.end
    ? 'Forecast period: '+time(range.start.getTime())+' to '+time(range.end.getTime())+' Jamaica time.' : '';
  const caution = info.some(x => !x.status.available || x.status.delayed);
  // Normal, successfully refreshed forecasts do not need a visible status banner.
  // Retain an advisory only when data is unavailable or older than the cache TTL.
  if (!caution) return {html:'', text:'', caution:false};
  const lines = info.filter(x => !x.status.available || x.status.delayed).map(x => {
    const weather = x.type === 'forecast';
    const details = weather ? 'Wind, gusts, rainfall and thunderstorms' : 'Waves, swell and available ocean-current information';
    if (!x.status.available) return 'Unavailable: '+details+' could not be retrieved from a usable saved forecast for '+x.name+'.';
    const retrieved = time(x.status.savedAt)+' Jamaica time';
    if (x.status.delayed) return 'Previous Forecast: '+details+' are based on forecast information retrieved '+retrieved+'. A newer update could not be obtained.';
    return '';
  });
  const safety = caution ? 'Before heading out: Some conditions may have changed since the previous forecast. Check the latest official marine advisories and observe local conditions before going to sea.' : '';
  const heading = 'MARINE FORECAST ADVISORY';
  const text = [heading, windowText].concat(lines).concat(safety ? [safety] : []).filter(Boolean).join('\n');
  const color = '#92400e';
  const border = '#b45309';
  const bg = '#fffbeb';
  const html = '<div style="margin:10px 0;padding:12px;border:1px solid '+border+';background:'+bg+';color:'+color+';font:13px Arial,sans-serif;line-height:1.55">'+
    '<div style="font-weight:bold;margin-bottom:6px">'+wxEscapeHtmlV383_(heading)+'</div>'+
    (windowText ? '<div style="margin-bottom:8px">'+wxEscapeHtmlV383_(windowText)+'</div>' : '')+
    lines.map(line => '<div style="margin:7px 0">'+wxEscapeHtmlV383_(line)+'</div>').join('')+
    (safety ? '<div style="margin-top:9px;font-weight:bold">'+wxEscapeHtmlV383_(safety)+'</div>' : '')+'</div>';
  return {html:html, text:text, caution:caution};
}
function wxFreshnessBannerV383_(sites, range, tz) {
  return wxPlainAdvisoryV384f_(sites, range, tz).html;
}
function wxWebErrorV383_(title) {
  return HtmlService.createHtmlOutput('<div style="font:14px Arial,sans-serif;padding:16px;color:#7f1d1d">'+
    '<h3>'+wxEscapeHtmlV383_(title)+'</h3>'+ 
    'Forecast information is temporarily unavailable for the selected location or period. '+
    'Please check again later and consult official marine advisories before going to sea.</div>')
    .setTitle('Forecast unavailable');
}
/* ========================= WEB APP ========================= */
function doGet(e) {
  var mw8Action=e&&e.parameter?String(e.parameter.action||'').toLowerCase():'';
  if(mw8Action==='hourly') return mw8HourlyPage_(e);
  if(mw8Action==='snapshot') return mw8SnapshotJson_(e);
  if(mw8Action==='synopsis') return mw82SynopsisJson_(e);
  if(mw8Action==='synopsisview') return mw82SynopsisPage_(e);
  // Instagram: read-only cached forecast JSONP; no extra forecast provider calls.
  if (e && e.parameter && String(e.parameter.action || '').toLowerCase() === 'instagramdata') {
    return mwInstagramData_(e);
  }
  // Lightweight JSONP alert check for the separate GitHub-hosted website.
  if (e && e.parameter && String(e.parameter.action || '').toLowerCase() === 'marinealert') {
    return wxMarineAlertJsonp_(e);
  }
  WX_REPORT_MODE = true;
  try {
    const output = wxWebDispatchV383_(e);
    return output.setXFrameOptionsMode(
      HtmlService.XFrameOptionsMode.ALLOWALL
    );
  } catch (err) {
    Logger.log('[WEB ERROR] ' + String(err));
    return wxWebErrorV383_('Forecast unavailable')
      .setXFrameOptionsMode(
        HtmlService.XFrameOptionsMode.ALLOWALL
      );
  } finally {
    WX_REPORT_MODE = false;
  }
}
function wxWebDispatchV383_(e){
  const action = (e && e.parameter && e.parameter.action ? String(e.parameter.action) : '').toLowerCase();
  const hideFooter = !!(e && e.parameter && String(e.parameter.hideFooter || '') === '1');
  const tz = CONFIG.TIMEZONE;

  if (action === 'localmarine') {
    const html = renderLocalMarinePage_('Local Marine Weather Forecast', hideFooter);
    return HtmlService.createHtmlOutput(html).setTitle('Local Marine Forecast');
  }
  if (action === 'current') {
    const syn = buildSynopsisForRangeCached(getCurrentRange(tz), `${CONFIG.LOCATION_NAME} — Current Marine Outlook`, true);
    const banner = wxFreshnessBannerV383_([{name:CONFIG.LOCATION_NAME,lat:CONFIG.LAT,lon:CONFIG.LON}], getCurrentRange(tz), tz);
    return HtmlService.createHtmlOutput(wxSynopsisShellV384b_(syn.html, '', banner, hideFooter)).setTitle('Current Marine Outlook');
  }

  if (action === 'tomorrow') {
    const range = getTomorrowRange(tz);
    const syn = buildSynopsisForRangeCached(range,
      CONFIG.LOCATION_NAME + ' — Tomorrow Marine Forecast (' + formatDateHuman(range.start, tz) + ')', true);
    const banner = wxFreshnessBannerV383_([{name:CONFIG.LOCATION_NAME,lat:CONFIG.LAT,lon:CONFIG.LON}], range, tz);
    return HtmlService.createHtmlOutput(wxSynopsisShellV384b_(syn.html, '', banner, hideFooter)).setTitle('Tomorrow Marine Forecast');
  }

  if (action === 'weekend') {
    const today = new Date();
    const startOfDayLocal = d => { const nd=new Date(d); nd.setHours(0,0,0,0); return nd; };
    const nextDow = (base, dow) => { const d = startOfDayLocal(base); const diff = (dow + 7 - d.getDay()) % 7 || 7; d.setDate(d.getDate()+diff); return d; };
    const day0717 = d => { const s=new Date(d), e=new Date(d); s.setHours(7,0,0,0); e.setHours(17,0,0,0); return {start:s,end:e}; };
    const sat = nextDow(today, 6);
    const sun = nextDow(today, 0);
    let satSyn, sunSyn;
    try { satSyn = buildSynopsisForRangeCached(day0717(sat), `${CONFIG.LOCATION_NAME} — Saturday Quick-Look`, true); }
    catch(e1) { satSyn = { html:'<div style="color:#b91c1c;">Saturday forecast is temporarily unavailable.</div>', text:'', cond:'' }; }
    try { sunSyn = buildSynopsisForRangeCached(day0717(sun), `${CONFIG.LOCATION_NAME} — Sunday Quick-Look`, true); }
    catch(e2) { sunSyn = { html:'<div style="color:#b91c1c;">Sunday forecast is temporarily unavailable.</div>', text:'', cond:'' }; }

    const loader = `
      <div id="wkLoader" style="position:fixed;inset:0;background:#fff;display:flex;align-items:center;justify-content:center;z-index:9999;">
        <div style="text-align:center;">
          <div style="border:6px solid #f3f3f3;border-top:6px solid #3b82f6;border-radius:50%;width:48px;height:48px;animation:spin 1s linear infinite;margin:auto;"></div>
          <p style="margin-top:12px;color:#374151;font-size:14px;">Preparing weekend quick-look…</p>
        </div>
        <style>@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}</style>
      </div>
      <script>
        window.addEventListener('load', function(){
          var el = document.getElementById('wkLoader');
          if (!el) return;
          try { el.style.transition='opacity 200ms ease'; el.style.opacity='0';
                setTimeout(function(){ if (el && el.parentNode) el.parentNode.removeChild(el); }, 220);
          } catch(_) { el.style.display='none'; }
        });
      </script>
    `;
    const combo = `
      ${loader}
      <div style="font-family:Arial,sans-serif;">
        <h2>${String(CONFIG.LOCATION_NAME)} — Weekend Marine Quick-Look</h2>
        ${wxFreshnessBannerV383_([{name:CONFIG.LOCATION_NAME,lat:CONFIG.LAT,lon:CONFIG.LON}], null, tz)}
        ${satSyn.html || ''}
        ${sunSyn.html || ''}
        ${hideFooter ? '' : renderFooterHtml()}
      </div>`;
    return HtmlService.createHtmlOutput(combo).setTitle('Weekend Marine Quick-Look');
  }

  if (action === 'banks') {
    const opts = renderBankOptionsHtml_();
    const base = CONFIG.CURRENT_APP_URL;
    const baseJS = JSON.stringify(base || '');
    const hideFooterJS = JSON.stringify(hideFooter);

    const page = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:920px;">
        <h2>Select Bank — Fishing Quick-Look</h2>
        <div style="margin:8px 0 12px 0;font-size:13px;color:#374151;">
          Pick a bank and timeframe (Current 6h or Tomorrow 07–17). Tries a popup; if blocked, uses this tab.
        </div>

        <label for="bankSel" style="font-size:14px;">Bank:</label>
        <select id="bankSel" style="margin-left:8px;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;">
          <option value="" selected disabled>pick a bank</option>
          ${opts}
        </select>

        <label style="margin-left:12px;">
          <input type="radio" name="when" value="current" checked> Current
        </label>
        <label style="margin-left:8px;">
          <input type="radio" name="when" value="tomorrow"> Tomorrow
        </label>

        <button id="openBtn" style="margin-left:10px;padding:6px 10px;border-radius:6px;border:1px solid #d1d5db;background:#f3f4f6;cursor:pointer;">
          Open
        </button>

        <script>
          (function(){
            var sel  = document.getElementById('bankSel');
            var btn  = document.getElementById('openBtn');
            var base = ${baseJS};
            var hideFooter = ${hideFooterJS};
            base = typeof base === 'string' ? base : '';
            function appBase(){ if (base) return base; return location.origin + location.pathname; }
            function popupSpinnerHtml_(title){
              var t = title || 'Loading forecast…';
              return '<!doctype html><html><head><meta charset="utf-8"><title>'+t+'</title>'
                + '<style>@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}'
                + 'body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#fff;color:#374151}'
                + '.wrap{height:100vh;display:flex;align-items:center;justify-content:center}'
                + '.box{text-align:center}'
                + '.sp{border:6px solid #f3f3f3;border-top:6px solid #3b82f6;border-radius:50%;width:48px;height:48px;animation:spin 1s linear infinite;margin:0 auto}'
                + '.msg{margin-top:12px;font-size:14px;color:#374151}</style></head>'
                + '<body><div class="wrap"><div class="box"><div class="sp"></div><div class="msg">'+t+'</div></div></div></body></html>';
            }
            function chosenWhen(){
              var radios = document.getElementsByName('when');
              for (var i=0;i<radios.length;i++){ if (radios[i].checked) return radios[i].value; }
              return 'current';
            }
            function openBank(){
              var key = sel.value;
              if (!key) { try { alert('Please pick a bank.'); } catch(_) {} return; }
              var when = chosenWhen();
              var url = appBase() + '?action=bank&key=' + encodeURIComponent(key) + '&when=' + encodeURIComponent(when) + '&popup=1' + (hideFooter ? '&hideFooter=1' : '');
              var win = null;
              try {
                win = window.open('about:blank','bankQuickLook','popup=1,width=980,height=820,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes');
                if (win && !win.closed) {
                  try { win.document.open(); win.document.write(popupSpinnerHtml_('Loading forecast…')); win.document.close(); } catch(e){}
                  try { win.location.href = url; } catch(e){}
                }
              } catch(e) {}
              if (!win || win.closed) { try { alert('Popup blocked. Opening in this tab.'); } catch(_) {} try { window.location.href = url; } catch(_) {} }
              else { try { win.focus(); } catch(_) {} }
            }
            sel.addEventListener('change', function(){ if (sel.value) openBank(); });
            btn.addEventListener('click', openBank);
          })();
        </script>

        <div style="margin-top:12px;">${hideFooter ? '' : renderBankCloseFooter()}</div>
      </div>
    `;
    return HtmlService.createHtmlOutput(page).setTitle('Banks — Quick-Look');
  }

  if (action === 'bank') {
    try {
      const key  = (e && e.parameter && e.parameter.key) ? String(e.parameter.key) : '';
      const when = (e && e.parameter && e.parameter.when) ? String(e.parameter.when) : 'current';
      const bank = getBankOrDie_(key);
      const rng  = when === 'current' ? getCurrentRange(tz) : getTomorrowRange(tz);

      const card = buildSingleBankCardHTML(bank, tz, rng);

      const loader =
        '<div id="bankLoader" style="position:fixed;inset:0;background:#fff;' +
          'display:flex;align-items:center;justify-content:center;z-index:9999;">' +
          '<div style="text-align:center;">' +
            '<div style="border:6px solid #f3f3f3;border-top:6px solid #3b82f6;' +
              'border-radius:50%;width:48px;height:48px;animation:spin 1s linear infinite;margin:auto;"></div>' +
            '<p style="margin-top:12px;color:#374151;font-size:14px;">Preparing card…</p>' +
          '</div>' +
          '<style>@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}</style>' +
        '</div>' +
        '<script>' +
          'window.addEventListener("load", function(){' +
            'var el = document.getElementById("bankLoader");' +
            'if (!el) return;' +
            'try {' +
              'el.style.transition="opacity 200ms ease";' +
              'el.style.opacity="0";' +
              'setTimeout(function(){ if (el && el.parentNode) el.parentNode.removeChild(el); }, 220);' +
            '} catch(e) { el.style.display="none"; }' +
          '});' +
        '</script>';

      const page =
        loader +
        '<div style="font-family:Arial,Helvetica,sans-serif;max-width:920px;margin:12px auto;">' +
          wxFreshnessBannerV383_([bank], rng, tz) +
          card +
          (hideFooter ? '' : renderBankCloseFooter()) +
        '</div>';

      return HtmlService.createHtmlOutput(page).setTitle(bank.name + ' - Quick-Look');

    } catch (err) {
      return HtmlService.createHtmlOutput(
        '<div style="font-family:Arial,Helvetica,sans-serif;color:#b91c1c;padding:12px;">' +
          'Forecast information is temporarily unavailable for this bank. Please try again later.' +
        '</div>'
      ).setTitle('Bank - Error');
    }
  }

  if (action === 'subscribe' || action === 'unsubscribe') {
    const email = (e && e.parameter && e.parameter.email) ? String(e.parameter.email) : '';
    const res = action === 'subscribe' ? subscribe_(email) : unsubscribe_(email);
    const color = res.ok ? '#065f46' : '#991b1b';
    const msg = res.ok ? 'Success' : 'Issue';
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:24px auto;">
        <h3 style="margin:0 0 10px 0;">${msg}</h3>
        <div style="color:${color};margin-bottom:12px;">${String(res.msg)}</div>
        <form method="GET" action="">
          <input type="hidden" name="action" value="${action}">
          <input type="email" name="email" placeholder="you@example.com" required
                 style="padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;width:100%;max-width:320px;">
          <button type="submit" style="margin-left:8px;padding:6px 10px;border-radius:6px;border:1px solid #d1d5db;background:#f3f4f6;cursor:pointer;">${action==='subscribe'?'Subscribe':'Unsubscribe'}</button>
        </form>
        <div style="margin-top:18px;">${hideFooter ? '' : renderFooterHtml()}</div>
      </div>`;
    return HtmlService.createHtmlOutput(html).setTitle(action==='subscribe'?'Subscribe':'Unsubscribe');
  }

  return ContentService.createTextOutput('OK');
}

/* ========================= BANKS OPTIONS ========================= */
function renderBankOptionsHtml_(){
  const keys = Object.keys(BANKS);
  return keys.map(k=>`<option value="${k}">${BANKS[k].name}</option>`).join('');
}

/* ========================= TESTS ========================= */
function checkCacheSchema(){
  const sh = cacheSheet();
  const header = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  Logger.log(`Header columns: ${header.length}`);
  Logger.log(header.join(' | '));
}
function testCacheWriteOnce(){
  try {
    checkCacheSchema();
    const tz = CONFIG.TIMEZONE;
    const nowRange = getCurrentRange(tz);
    const marine = fetchMarine(CONFIG.LAT, CONFIG.LON, tz);
    const forecast = fetchForecast(CONFIG.LAT, CONFIG.LON, tz);
    const out = getHourlyAggWithSheetCache(CONFIG.LAT, CONFIG.LON, nowRange, tz, forecast, marine, CONFIG.LOCATION_NAME);
    if (!out || !out.m) throw new Error('No aggregates returned');
    Logger.log('✅ m.countHours=%s avgWaveM=%.2f avgWindKn=%.1f', out.m.countHours, out.m.avgWaveM, out.m.avgWindKn);
    Logger.log('✅ testCacheWriteOnce finished.');
  } catch (e) {
    Logger.log('❌ Cache/agg test failed: ' + e); throw e;
  }
}
function testTimezoneConfig(){ Logger.log("CONFIG.TIMEZONE = %s", CONFIG.TIMEZONE); }
function testCacheCleanup2d(){ cleanupOldCacheRows_(2); }

/* ========================= SUBSCRIBE HELPERS ========================= */
function subscribe_(email){
  try{
    if (!email) return { ok:false, msg:'Missing email' };
    const sh = ensureSubscriberSheet();
    const vals = sh.getDataRange().getValues();
    let found = -1;
    for (let i=1;i<vals.length;i++){ if (String(vals[i][0]).toLowerCase() === String(email).toLowerCase()) { found = i; break; } }
    const now = new Date();
    if (found > 0){
      sh.getRange(found+1, 2).setValue('subscribed');
      sh.getRange(found+1, 4).setValue(now);
    } else {
      sh.appendRow([email, 'subscribed', now, now]);
    }
    return { ok:true, msg:'Subscribed' };
  }catch(e){ return { ok:false, msg:String(e) }; }
}
function unsubscribe_(email){
  try{
    if (!email) return { ok:false, msg:'Missing email' };
    const sh = ensureSubscriberSheet();
    const vals = sh.getDataRange().getValues();
    let found = -1;
    for (let i=1;i<vals.length;i++){ if (String(vals[i][0]).toLowerCase() === String(email).toLowerCase()) { found = i; break; } }
    const now = new Date();
    if (found > 0){
      sh.getRange(found+1, 2).setValue('unsubscribed');
      sh.getRange(found+1, 4).setValue(now);
      return { ok:true, msg:'Unsubscribed' };
    }
    return { ok:false, msg:'Email not found' };
  }catch(e){ return { ok:false, msg:String(e) }; }
}


/** Official local marine alert, exposed as JSONP for the GitHub Pages origin.
 *  The response is intentionally data-only; the browser renders it using textContent.
 */
function wxMarineAlertJsonp_(e) {
  var cb = String((e && e.parameter && e.parameter.callback) || '');
  if (!/^[A-Za-z_$][\w$]{0,79}$/.test(cb)) {
    return ContentService.createTextOutput('Invalid callback').setMimeType(ContentService.MimeType.TEXT);
  }
  var result;
  try { result = wxReadMarineAlert_(); }
  catch (err) { result = {ok:false,active:false,error:'Alert status unavailable'}; Logger.log('Marine alert check: '+err); }
  return ContentService.createTextOutput(cb + '(' + JSON.stringify(result).replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029') + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
function wxReadMarineAlert_() {
  var cache = CacheService.getScriptCache();
  var saved = cache.get('wx_marine_alert_v1');
  if (saved) return JSON.parse(saved);
  var url = CONFIG.LOCAL_MARINE_URL || 'https://jamaica.weatherproof.fi/web/website_2014/website_elements/news2.php?type=6';
  var response = UrlFetchApp.fetch(url, {muteHttpExceptions:true,followRedirects:true});
  if (response.getResponseCode() !== 200) throw new Error('HTTP '+response.getResponseCode());
  var html = response.getContentText();
  // Preserve visible paragraph boundaries before stripping markup.
  var plain = String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<\s*br\s*\/?\s*>/gi,'\n')
    .replace(/<\/(?:p|div|h[1-6]|tr|li)\s*>/gi,'\n')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
    .replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n[ \t]+/g,'\n');
  // Capture only the official alert paragraph, stopping before the coast-by-coast forecast.
  var match = plain.match(/\b(RED|AMBER)\s+ALERT\s+IN\s+EFFECT\s*:\s*([\s\S]*?)(?=\n\s*\n|\n\s*(?:Inshore\s+(?:North|South)\s+Coast|Pedro\s+(?:and|&)\s+Morant|Outlook|MARINE WARNING MESSAGE)\s*:|$)/i);
  var result = {ok:true,active:false,level:null,message:'',issued:'',source:url};
  if (match) {
    var message = match[2].replace(/\s+/g,' ').replace(/\s*:\s*$/,'').trim();
    if (message) {
      result.active=true;
      result.level=match[1].toUpperCase();
      result.message=message.substring(0,1200);
      var dateMatch=plain.match(/(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4}\s+at\s+\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?)/i);
      if(dateMatch) result.issued=dateMatch[0];
    }
  }
  cache.put('wx_marine_alert_v1',JSON.stringify(result),300);
  return result;
}


/** Marine Weather Instagram cached-data endpoint. Read-only; no external API calls.
 * Paste this entire file into your existing Apps Script project as InstagramData.gs.
 * In the existing doGet(e), add as FIRST lines inside function body:
 *   if (e && e.parameter && String(e.parameter.action || '').toLowerCase() === 'instagramdata') {
 *     return mwInstagramData_(e);
 *   }
 * Redeploy the existing web app as a NEW VERSION. No triggers needed.
 */
function mwInstagramData_(e) {
  const cb = String(e.parameter.callback || '');
  if (!/^mwInstagramCallback_[0-9]+_[0-9]+$/.test(cb)) {
    return ContentService.createTextOutput('Invalid callback').setMimeType(ContentService.MimeType.TEXT);
  }
  let data;
  try { data = mwInstagramPayload_(String(e.parameter.day || 'tomorrow')); }
  catch (err) { Logger.log('[INSTAGRAM DATA] '+String(err)); data={ok:false,message:'Cached forecast temporarily unavailable.'}; }
  return ContentService.createTextOutput(cb+'('+JSON.stringify(data)+');').setMimeType(ContentService.MimeType.JAVASCRIPT);
}

// NOAA Solar Calculator-style sunrise/sunset (apparent upper limb, zenith 90.833°).
// Uses forecast-date and location; all computations local, no network/API requests.
function mwInstagramSolar_(dayIso, lat, lon, tz) {
  const DEG = Math.PI / 180;
  const utcMidnight = Date.parse(dayIso + 'T00:00:00Z');
  if (!Number.isFinite(utcMidnight) || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return {sunrise:'Unavailable', sunset:'Unavailable'};
  }
  const jd = utcMidnight / 86400000 + 2440587.5;
  const norm = x => ((x % 360) + 360) % 360;
  function solar(t) {
    const L = norm(280.46646 + t * (36000.76983 + 0.0003032 * t));
    const M = norm(357.52911 + t * (35999.05029 - 0.0001537 * t));
    const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
    const C = (1.914602 - t * (0.004817 + 0.000014 * t)) * Math.sin(M * DEG)
      + (0.019993 - 0.000101 * t) * Math.sin(2 * M * DEG)
      + 0.000289 * Math.sin(3 * M * DEG);
    const omega = 125.04 - 1934.136 * t;
    const lambda = L + C - 0.00569 - 0.00478 * Math.sin(omega * DEG);
    const epsilon0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
    const epsilon = epsilon0 + 0.00256 * Math.cos(omega * DEG);
    const decl = Math.asin(Math.sin(epsilon * DEG) * Math.sin(lambda * DEG));
    const y = Math.tan(epsilon * DEG / 2) ** 2;
    const eq = 4 / DEG * (y * Math.sin(2 * L * DEG)
      - 2 * e * Math.sin(M * DEG)
      + 4 * e * y * Math.sin(M * DEG) * Math.cos(2 * L * DEG)
      - 0.5 * y * y * Math.sin(4 * L * DEG)
      - 1.25 * e * e * Math.sin(2 * M * DEG));
    return {decl, eq};
  }
  function event(isRise) {
    // Iterate to the actual event time rather than assuming solar noon.
    let minutesUTC = isRise ? 360 : 1080;
    for (let i = 0; i < 6; i++) {
      const t = (jd + minutesUTC / 1440 - 2451545) / 36525;
      const {decl, eq} = solar(t);
      const cosH = (Math.cos(90.833 * DEG) - Math.sin(lat * DEG) * Math.sin(decl))
        / (Math.cos(lat * DEG) * Math.cos(decl));
      if (cosH < -1 || cosH > 1) return 'Unavailable';
      const hourAngle = Math.acos(Math.max(-1, Math.min(1, cosH))) / DEG;
      const next = 720 - 4 * (lon + (isRise ? hourAngle : -hourAngle)) - eq;
      if (Math.abs(next - minutesUTC) < 0.0001) { minutesUTC = next; break; }
      minutesUTC = next;
    }
    const instant = new Date(utcMidnight + Math.round(minutesUTC) * 60000);
    return Utilities.formatDate(instant, tz || 'America/Jamaica', 'h:mm a');
  }
  return {sunrise:event(true), sunset:event(false)};
}

function mwInstagramPayload_(which) {
  if (which !== 'today' && which !== 'tomorrow') return {ok:false,message:'Invalid forecast window.'};
  const tz=CONFIG.TIMEZONE || 'America/Jamaica';
  const now=new Date();
  const dayToday=Utilities.formatDate(now,tz,'yyyy-MM-dd');
  const date=new Date(dayToday+'T12:00:00Z');
  if(which==='tomorrow') date.setUTCDate(date.getUTCDate()+1);
  const day=Utilities.formatDate(date,'UTC','yyyy-MM-dd');
  const sheet=SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.CACHE_SHEET_NAME || 'MarineCache');
  if(!sheet || sheet.getLastRow()<2) return {ok:false,message:'No cached marine forecasts available.'};
  const values=sheet.getDataRange().getValues();
  const header=values.shift().map(String);
  const col={};header.forEach((h,i)=>col[h]=i);
  const required=['day','hour','lat','lon','avgWindKn','peakGustKn','avgWaveM','avgWavePeriodS','avgSstC','conditionColor','metrics_updated_at'];
  if(required.some(h=>col[h]===undefined))return {ok:false,message:'MarineCache columns have changed; please review mapping.'};
  const n=x=>x===''||x===null||x===undefined?null:(Number.isFinite(Number(x))?Number(x):null);
  // Normalize date cells whether stored as text or formatted spreadsheet dates.
  const cellDay=v=>v instanceof Date?Utilities.formatDate(v,tz,'yyyy-MM-dd'):String(v||'').trim().slice(0,10);
  const cellHour=v=>{if(v instanceof Date)return Number(Utilities.formatDate(v,tz,'HH'));const s=String(v||'').trim();return Number(s.split(':')[0]);};
  const pick=(lat,lon)=>values.filter(r=>cellDay(r[col.day])===day && cellHour(r[col.hour])>=7 && cellHour(r[col.hour])<17 && Math.abs(Number(r[col.lat])-lat)<0.002 && Math.abs(Number(r[col.lon])-lon)<0.002);
  const banks=[{name:'Mackerel (Bowditch)',lat:17.520,lon:-76.947},{name:'California Bank',lat:17.750,lon:-76.783}];
  // Use the same configured bank coordinates as the live forecast if available.
  if(typeof BANKS!=='undefined'){
    if(BANKS.bowditch) {banks[0].lat=Number(BANKS.bowditch.lat);banks[0].lon=Number(BANKS.bowditch.lon);}
    if(BANKS.california) {banks[1].lat=Number(BANKS.california.lat);banks[1].lon=Number(BANKS.california.lon);}
  }
  const locations=[{name:'Kingston / Maiden Cay',lat:Number(CONFIG.LAT),lon:Number(CONFIG.LON)}].concat(banks);
  const missing=[];
  let latest=0;
  const summaries=locations.map((loc,i)=>{
    const rows=pick(loc.lat,loc.lon);
    const avg=(key)=>{const arr=rows.map(r=>n(r[col[key]])).filter(v=>v!==null);return arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:null};
    const max=(key)=>{const arr=rows.map(r=>n(r[col[key]])).filter(v=>v!==null);return arr.length?Math.max.apply(null,arr):null};
    const colorValues=rows.map(r=>String(r[col.conditionColor]||'').trim().toUpperCase()).map(x=>x==='YELLOW'||x==='ORANGE'?'AMBER':x).filter(x=>['GREEN','AMBER','RED'].includes(x));
    const status=colorValues.includes('RED')?'RED':colorValues.includes('AMBER')?'AMBER':colorValues.includes('GREEN')?'GREEN':null;
    rows.forEach(r=>{const t=new Date(r[col.metrics_updated_at]).getTime();if(Number.isFinite(t)&&t>latest)latest=t;});
    // Use cached hourly peak fields; retain the earliest hour when peaks tie.
    const peakAt=(field)=>{
      if(col[field]===undefined)return {value:null,time:null};
      const candidates=rows.map(r=>({value:n(r[col[field]]),hour:cellHour(r[col.hour])})).filter(x=>x.value!==null&&Number.isFinite(x.hour));
      if(!candidates.length)return {value:null,time:null};
      candidates.sort((a,b)=>b.value-a.value||a.hour-b.hour);
      const h=candidates[0].hour;
      return {value:candidates[0].value,time:String(h).padStart(2,'0')+':00'};
    };
    // Hourly cache values are authoritative; fall back to averages for older rows
    // where the dedicated peak columns were not populated.
    const peakWithFallback=(primary,fallback)=>{
      const p=peakAt(primary);
      return p.value===null?peakAt(fallback):p;
    };
    const peakWind=peakWithFallback('peakWindKn','avgWindKn');
    const peakWave=peakWithFallback('peakWaveM','avgWaveM');
    const meanComfort=avg('comfortScore');
    // Use the same comfort bands and hazard floors as the web/email classifier.
    // Older cached hourly rows are reconciled at read time until refreshed.
    let unifiedStatus=meanComfort===null?null:mwUnifiedStatusFromComfort_(meanComfort);
    if(unifiedStatus) {
      if(status==='RED') unifiedStatus='RED';
      else if(status==='AMBER') unifiedStatus=mwWorseMarineStatus_(unifiedStatus,'YELLOW');
      const gust=max('peakGustKn');
      if(gust!==null && gust>=25) unifiedStatus='RED';
      else if(gust!==null && gust>=18) unifiedStatus=mwWorseMarineStatus_(unifiedStatus,'YELLOW');
      const peakSeas=max('peakWaveM');
      if(peakSeas!==null && peakSeas>=2.0) unifiedStatus='RED';
      if(avg('avgWindKn')===null || avg('avgWaveM')===null) unifiedStatus=mwWorseMarineStatus_(unifiedStatus,'YELLOW');
    }
    const out={name:loc.name,count:rows.length,peakWind,peakWave,wind:avg('avgWindKn'),gust:max('peakGustKn'),wave:avg('avgWaveM'),period:avg('avgWavePeriodS'),sst:avg('avgSstC'),uv:max('uvDailyMax'),current:avg('avgCurrentKn'),currentDir:avg('currentDirMeanDeg'),swellDir:avg('swellDirMeanDeg'),rainMm:avg('precipSumMm'),status:unifiedStatus,score:meanComfort};
    if(rows.length<2)missing.push(loc.name+' (insufficient cached hours)');
    for(const k of ['wind','gust','wave','period','status'])if(out[k]===null)missing.push(loc.name+' '+k);
    return out;
  });
  const f=(v,d=1)=>v===null?'—':Number(v).toFixed(d);
  const deg=v=>v===null?'—':(['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(((v%360)+360)%360/22.5)%16]);
  const primary=summaries[0],b1=summaries[1],b2=summaries[2];
  const poster={date:Utilities.formatDate(date,'UTC','EEEE, d MMMM yyyy'),location:'KINGSTON · MAIDEN CAY',status:primary.status||'—',comfort:primary.score===null?'—':f(primary.score,1)+'/5',condition:'07:00–17:00 forecast',wind:f(primary.wind)+' kt',gust:f(primary.gust)+' kt',seas:primary.wave===null?'—':f(primary.wave*3.28084)+' ft',period:f(primary.period)+' s',chop:f(primary.period)+' s',current:f(primary.current)+' kt',currentDir:deg(primary.currentDir),rain:primary.rainMm===null?'—':f(primary.rainMm)+' mm',uv:f(primary.uv,0),sst:primary.sst===null?'—':f(primary.sst*9/5+32)+'°F',swell:deg(primary.swellDir),bank1:'MACKEREL (BOWDITCH)',bank1status:b1.status||'—',bank1comfort:b1.score===null?'':f(b1.score,1)+'/5',bank1detail:'Seas '+(b1.wave===null?'—':f(b1.wave*3.28084)+' ft')+' · Wind '+f(b1.wind)+' kt',bank1rain:'Rain '+(b1.rainMm===null?'—':f(b1.rainMm)+' mm'),bank2:'CALIFORNIA BANK',bank2status:b2.status||'—',bank2comfort:b2.score===null?'':f(b2.score,1)+'/5',bank2detail:'Seas '+(b2.wave===null?'—':f(b2.wave*3.28084)+' ft')+' · Wind '+f(b2.wind)+' kt',bank2rain:'Rain '+(b2.rainMm===null?'—':f(b2.rainMm)+' mm'),note:'Forecast guidance only. Check official marine warnings before departure.',source:'Updated '+(latest?Utilities.formatDate(new Date(latest),tz,'d MMM HH:mm'):'unavailable')+' JA'};
  // Advisory windows use only cached hourly conditions at each destination.
  // They do not model route exposure, vessel speed, or transit duration.
  const windows=locations.map(loc=>{
    const byHour={};
    values.filter(r=>cellDay(r[col.day])===day && Math.abs(Number(r[col.lat])-loc.lat)<0.002 && Math.abs(Number(r[col.lon])-loc.lon)<0.002).forEach(r=>{
      const h=cellHour(r[col.hour]);
      if(h>=7&&h<17)byHour[h]=r;
    });
    const evaluate=(start)=>{
      const hours=[start,start+1];
      if(hours.some(h=>!byHour[h]))return null;
      let score=0;
      for(const h of hours){
        const r=byHour[h], get=k=>col[k]===undefined?null:n(r[col[k]]);
        const wind=get('avgWindKn'),gust=get('peakGustKn'),wave=get('avgWaveM'),period=get('avgWavePeriodS');
        const status=String(r[col.conditionColor]||'').toUpperCase();
        if([wind,gust,wave,period].some(v=>v===null))return null;
        // Conservative screening limits, NOT vessel-specific safety thresholds.
        if(status==='RED'||mwUnifiedStatusFromComfort_(get('comfortScore'))==='RED'||wind>16||gust>22||wave>1.2||period<5)return null;
        const rain=get('precipSumMm');
        if(rain!==null&&rain>4)return null;
        score+=wind/16+gust/22+wave/1.2+(period<7?(7-period)/2:0)+(rain===null?0:rain/4);
      }
      return {start,score};
    };
    const best=(starts)=>starts.map(evaluate).filter(Boolean).sort((a,b)=>a.score-b.score||a.start-b.start)[0];
    const dep=best([7,8,9,10]);
    // Returns screened separately for afternoon hours, without claiming route safety.
    const ret=best([12,13,14,15]);
    const fmt=w=>w?String(w.start).padStart(2,'0')+':00–'+String(w.start+2).padStart(2,'0')+':00':'None identified';
    return {destination:loc.name,departure:fmt(dep),return:fmt(ret),basis:'Destination hourly forecast only'};
  });
  poster.travelWindows=windows;
  poster.travelWindowNotice='Forecast-based guidance only; not a guarantee of safe passage. Route, vessel and transit time not assessed.';
  // Show only observed cached hourly peaks, never invented times.
  poster.peakWind=primary.peakWind.value===null?'':f(primary.peakWind.value)+' kt · '+primary.peakWind.time+' JA';
  poster.peakWave=primary.peakWave.value===null?'':f(primary.peakWave.value*3.28084)+' ft · '+primary.peakWave.time+' JA';
  const solar=mwInstagramSolar_(day, Number(CONFIG.LAT), Number(CONFIG.LON), tz);
  poster.sunrise=solar.sunrise==='Unavailable'?'':solar.sunrise;
  poster.sunset=solar.sunset==='Unavailable'?'':solar.sunset;
  // Astronomy is calculated locally; tide times come ONLY from cached MarineCache extrema.
  // Do not invent tides when the cached model does not provide them.
  // One GS-owned astronomy result for the exact Jamaica forecast day.
  // The existing fallback is retained; unavailable events are never invented.
  const moon=moonPhaseForDateAt(date,tz,Number(CONFIG.LAT),Number(CONFIG.LON));
  poster.moonPhase=moon.label||'—';
  poster.moonIllum=moon.illumination==null?'—':Number(moon.illumination).toFixed(1)+'%';
  poster.moonrise=moon.riseLocal||'';
  poster.moonset=moon.setLocal||'';
  const tideEntries=[];
  const seen={};
  const tideRows=values.filter(r=>cellDay(r[col.day])===day && Math.abs(Number(r[col.lat])-locations[0].lat)<0.002 && Math.abs(Number(r[col.lon])-locations[0].lon)<0.002);
  if(col.tideExtremaJson!==undefined){
    tideRows.forEach(r=>{
      try {
        const obj=JSON.parse(String(r[col.tideExtremaJson]||'{}'));
        ['H','L'].forEach(type=>(Array.isArray(obj[type])?obj[type]:[]).forEach(item=>{
          const t=String(item.t||'').trim();
          if(!t)return;
          const hm=t.match(/(\d{1,2}:\d{2})/);
          if(!hm)return;
          const clock=hm[1],key=type+clock;
          if(seen[key])return;
          seen[key]=true;
          tideEntries.push({type,time:clock,height:item.h_ft});
        }));
      } catch(_ignored){}
    });
  }
  const tideFmt=(type)=>tideEntries.filter(x=>x.type===type).sort((a,b)=>a.time.localeCompare(b.time)).slice(0,2).map(x=>x.time+(Number.isFinite(Number(x.height))?' ('+Number(x.height).toFixed(1)+' ft)':'')).join(' · ');
  poster.highTides=tideFmt('H');
  poster.lowTides=tideFmt('L');
  poster.tideNote='Model guidance · Jamaica local time';
  // Presentation only: omit unavailable values rather than displaying placeholders.
  Object.keys(poster).forEach(k=>{
    if(typeof poster[k]==='string' && /^(?:Unavailable|—|unknown)$/i.test(poster[k].trim())) poster[k]='';
  });
  // Cache stores precipitation totals (mm) for the forecast window; never label as mm/hr or probability.
  // Block export if data are older than 24 hours, or a required location has missing values.
  const stale=!latest || (Date.now()-latest)>24*3600*1000 || latest>Date.now()+10*60*1000;
  poster.freshness=stale?'Delayed':'Current';
  poster.lastSuccessfulUpdate=latest?Utilities.formatDate(new Date(latest),tz,'d MMM yyyy HH:mm')+' Jamaica':'Unavailable';
  return {ok:true,day,poster,freshness:poster.freshness,ready:!stale&&!missing.length,stale,missing,lastUpdated:latest?Utilities.formatDate(new Date(latest),tz,'d MMM yyyy HH:mm')+' Jamaica':'unknown',rowCounts:summaries.map(s=>s.name+': '+s.count+'h').join(' · ')};
}


/* === v8.1 TEST ONLY: canonical snapshot dates, hours and location keys ===
 * Dates: yyyy-MM-dd in America/Jamaica; hours: HH (00-23); timestamps: UTC ISO 8601.
 * No new weather requests, subscriber sends or production trigger changes.
 */
function mw8Date_(value) {
  var tz=CONFIG.TIMEZONE;
  if(value instanceof Date) {if(isNaN(value.getTime())) return '';return Utilities.formatDate(value,tz,'yyyy-MM-dd');}
  var s=String(value==null?'':value).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
  // ISO timestamps already carry a timezone: convert to Jamaica's calendar day.
  if(/^\d{4}-\d{2}-\d{2}T/.test(s)) {var iso=new Date(s);return isNaN(iso.getTime())?'':Utilities.formatDate(iso,tz,'yyyy-MM-dd');}
  var parsed=new Date(s);
  return isNaN(parsed.getTime())?'':Utilities.formatDate(parsed,tz,'yyyy-MM-dd');
}
function mw8Hour_(value){
  var n=Number(value);
  if(!isFinite(n)||Math.floor(n)!==n||n<0||n>23)return '';
  return ('0'+n).slice(-2);
}
function mw8Stamp_(value){
  if(value instanceof Date)return isNaN(value.getTime())?'':value.toISOString();
  if(value==null||String(value).trim()==='')return '';
  var d=new Date(value);return isNaN(d.getTime())?'':d.toISOString();
}
function mw8LocationKey_(site){
  if(Math.abs(Number(site.lat)-Number(CONFIG.LAT))<0.001&&Math.abs(Number(site.lon)-Number(CONFIG.LON))<0.001)return 'maiden';
  var keys=Object.keys(BANKS);
  for(var i=0;i<keys.length;i++){
    var b=BANKS[keys[i]];
    if(Math.abs(Number(site.lat)-Number(b.lat))<0.001&&Math.abs(Number(site.lon)-Number(b.lon))<0.001)return String(keys[i]).toLowerCase();
  }
  return '';
}
function mw8Site_(requested){
  var q=String(requested||'maiden').trim().toLowerCase();
  var sites=wxSitesV382_();
  for(var i=0;i<sites.length;i++){
    var s=sites[i];
    if(mw8LocationKey_(s)===q||String(s.name).trim().toLowerCase()===q)return s;
    if(q==='maiden cay'&&mw8LocationKey_(s)==='maiden')return s;
  }
  return null;
}
function mw8SnapshotSheet_(){
  var ss=SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sh=ss.getSheetByName('ForecastSnapshot');
  var base=['version','published_at','location','lat','lon','day','hour','metrics_json'];
  if(!sh){sh=ss.insertSheet('ForecastSnapshot');sh.appendRow(base.concat(['location_key']));return sh;}
  var actual=sh.getRange(1,1,1,Math.max(9,sh.getLastColumn())).getValues()[0];
  if(base.some(function(v,i){return String(actual[i])!==v;}))throw new Error('ForecastSnapshot schema mismatch; no changes made');
  if(String(actual[8]||'')==='')sh.getRange(1,9).setValue('location_key');
  else if(String(actual[8])!=='location_key')throw new Error('ForecastSnapshot location_key schema mismatch; no changes made');
  return sh;
}
function mw8PublishSnapshots_(){
  mw390RequireProduction_('snapshot');
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(10000))throw new Error('Snapshot publication already in progress');
  try{
    var values=cacheSheet().getDataRange().getValues(),headers=values[0].map(String),index={};
    headers.forEach(function(k,i){index[k]=i;});
    ['lat','lon','day','hour','metrics_updated_at'].forEach(function(k){if(index[k]===undefined)throw new Error('Missing MarineCache column '+k);});
    var sites=wxSitesV382_(),tz=CONFIG.TIMEZONE,allowed={};
    var today=Utilities.formatDate(new Date(),tz,'yyyy-MM-dd');
    var anchor=new Date(today+'T12:00:00Z');
    for(var d=0;d<3;d++)allowed[Utilities.formatDate(new Date(anchor.getTime()+d*86400000),tz,'yyyy-MM-dd')]=true;
    // Optional hourly values are read only from the existing Drive API cache.
    // No new requests, no changes to MarineCache schema.
    var extrasByKey=mw83CachedExtras_(sites,tz);
    var best={},present={};
    for(var r=1;r<values.length;r++){
      var v=values[r],day=mw8Date_(v[index.day]);if(!allowed[day])continue;
      var hour=mw8Hour_(v[index.hour]);if(!hour)continue;
      var lat=Number(v[index.lat]),lon=Number(v[index.lon]);
      var site=sites.filter(function(s){return Math.abs(Number(s.lat)-lat)<0.001&&Math.abs(Number(s.lon)-lon)<0.001;})[0];
      if(!site)continue;
      var locationKey=mw8LocationKey_(site);
      if(!locationKey)throw new Error('Unmapped snapshot location: '+site.name);
      var unique=locationKey+'|'+day+'|'+hour;
      var updated=mw8Stamp_(v[index.metrics_updated_at]);
      var score=updated?Date.parse(updated):0;
      if(best[unique]&&best[unique].score>=score)continue;
      var metrics={};
      headers.forEach(function(k,i){if(['key','source_note','created_at','updated_at'].indexOf(k)<0){
        var cell=v[i];metrics[k]=cell instanceof Date?cell.toISOString():cell;
      }});
      metrics.day=day;metrics.hour=hour;metrics.metrics_updated_at=updated;
      var extra=extrasByKey[locationKey]&&extrasByKey[locationKey][day+'T'+hour];
      metrics.swellHeightM=extra?extra.swellHeightM:null;
      metrics.swellPeriodS=extra?extra.swellPeriodS:null;
      metrics.swellDirectionDeg=extra?extra.swellDirectionDeg:null;
      metrics.rainProbabilityPct=extra?extra.rainProbabilityPct:null;
      // Model sea level is not a chart-datum tide prediction.
      metrics.modelSeaLevelM=extra?extra.modelSeaLevelM:null;
      best[unique]={score:score,site:site,locationKey:locationKey,day:day,hour:hour,metrics:metrics};
      present[locationKey]=true;
    }
    if(Object.keys(present).length!==sites.length)throw new Error('Snapshot not published: '+Object.keys(present).length+'/'+sites.length+' locations have calculated rows');
    var entries=Object.keys(best).sort().map(function(k){return best[k];});
    if(entries.length<sites.length*6)throw new Error('Snapshot not published: insufficient unique hourly records');
    var version=Utilities.formatDate(new Date(),tz,'yyyyMMdd-HHmmss');
    var published=new Date().toISOString();
    var rows=entries.map(function(e){return [version,published,e.site.name,Number(e.site.lat),Number(e.site.lon),e.day,e.hour,JSON.stringify(e.metrics),e.locationKey];});
    var target=mw8SnapshotSheet_();
    var startRow=target.getLastRow()+1;
    target.getRange(startRow,6,rows.length,2).setNumberFormat('@');
    target.getRange(startRow,1,rows.length,9).setValues(rows);
    SpreadsheetApp.flush();
    // Publish daily summaries before advancing the active version pointer.
    mw82PublishDaily_(version,published,entries);
    PropertiesService.getScriptProperties().setProperty('MW8_ACTIVE_SNAPSHOT',version);
    Logger.log('[SNAPSHOT] Published '+version+' with '+rows.length+' unique hourly rows / '+sites.length+' locations');
    return {version:version,locations:sites.length,hours:rows.length,published_at:published};
  }finally{lock.releaseLock();}
}
function mw8ReadSnapshot_(location,day){
  var version=PropertiesService.getScriptProperties().getProperty('MW8_ACTIVE_SNAPSHOT');
  if(!version)return {status:'Delayed',message:'Forecast information is being prepared. Check official marine advisories.',hours:[]};
  var site=mw8Site_(location),requestedKey=site?mw8LocationKey_(site):String(location||'').toLowerCase();
  var targetDay=day?mw8Date_(day):'';
  var sh=mw8SnapshotSheet_(),data=sh.getDataRange().getValues(),unique={},published='';
  for(var i=1;i<data.length;i++){
    var r=data[i];if(String(r[0])!==version)continue;
    var rowKey=String(r[8]||'').trim().toLowerCase();
    if(!rowKey){var legacy=mw8Site_(r[2]);rowKey=legacy?mw8LocationKey_(legacy):'';}
    if(requestedKey&&rowKey!==requestedKey)continue;
    var rowDay=mw8Date_(r[5]),hour=mw8Hour_(r[6]);
    if(!rowDay||!hour||(targetDay&&rowDay!==targetDay))continue;
    try{
      var metrics=JSON.parse(r[7]);metrics.day=rowDay;metrics.hour=hour;
      var updated=mw8Stamp_(metrics.metrics_updated_at),score=updated?Date.parse(updated):0;
      var k=rowKey+'|'+rowDay+'|'+hour;
      if(!unique[k]||score>unique[k].score)unique[k]={score:score,record:{key:rowKey,location:String(r[2]),day:rowDay,hour:hour,metrics:metrics}};
      published=mw8Stamp_(r[1])||published;
    }catch(err){Logger.log('[SNAPSHOT] Skipped invalid record '+i+': '+err.message);}
  }
  var hours=Object.keys(unique).map(function(k){return unique[k].record;});
  hours.sort(function(a,b){return (a.day+a.hour).localeCompare(b.day+b.hour);});
  var age=Date.now()-Date.parse(published);
  return {status:hours.length&&age>=0&&age<=8*3600000?'Current':'Delayed',version:version,published_at:published,hours:hours,
    notice:'Forecast guidance only; verify official marine advisories before going to sea.'};
}
function mw8HourlyPage_(e){
  var p=e&&e.parameter||{},day=mw8Date_(p.day||new Date());
  var requested=String(p.key||p.location||'maiden');
  var site=mw8Site_(requested),loc=site?site.name:requested;
  var payload=mw8ReadSnapshot_(requested,day);
  function esc(x){return String(x==null?'—':x).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  var fields=[['avgWindKn','Wind (kt)'],['peakGustKn','Gust (kt)'],['avgWaveM','Wave (m)'],['avgWavePeriodS','Period (s)'],['avgCurrentKn','Current (kt)'],['precipSumMm','Rain (mm)'],['uvHourlyMax','UV']];
  var html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:14px Arial,sans-serif;color:#172a39;margin:18px}table{border-collapse:collapse;width:100%;min-width:720px}th,td{padding:9px;border-bottom:1px solid #dce5eb;text-align:left}th{background:#eaf3f6;position:sticky;top:0}.scroll{overflow:auto}small{color:#536675}</style></head><body>'+
   '<h2>Hourly marine forecast — '+esc(loc)+'</h2><p>'+esc(day)+' · '+esc(payload.status)+' · Last published: '+esc(payload.published_at||'Unavailable')+'</p><div class="scroll"><table><thead><tr><th>Hour (Jamaica)</th>'+
   fields.map(function(f){return '<th>'+esc(f[1])+'</th>';}).join('')+'</tr></thead><tbody>'+
   payload.hours.map(function(row){return '<tr><td>'+esc(row.hour)+':00</td>'+fields.map(function(f){var v=row.metrics[f[0]];return '<td>'+esc(typeof v==='number'?Math.round(v*10)/10:v)+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table></div><p><small>'+esc(payload.notice||'Forecast temporarily unavailable. Verify official marine advisories.')+'</small></p></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Hourly Marine Forecast').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function mw8SnapshotJson_(e){
  var p=e&&e.parameter||{};
  var result=mw8ReadSnapshot_(String(p.key||p.location||'maiden'),String(p.day||''));
  var callback=String(p.callback||'');
  if(callback&&/^[a-zA-Z_$][\w.$]{0,90}$/.test(callback))return ContentService.createTextOutput(callback+'('+JSON.stringify(result)+');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
function mw8TestSnapshotPublication(){return mw8PublishSnapshots_();}
function mw8TestSnapshotReader(){
  var r=mw8ReadSnapshot_('maiden',Utilities.formatDate(new Date(),CONFIG.TIMEZONE,'yyyy-MM-dd'));
  Logger.log(JSON.stringify({status:r.status,version:r.version,published_at:r.published_at,hours:r.hours.length,first:r.hours[0]||null}));
  return {status:r.status,version:r.version,hours:r.hours.length};
}


/** v8.1 TEST ONLY — read-only checks for active snapshot across every location. */
function mw8ValidateAllLocations_(){
  var sites=wxSitesV382_(), today=Utilities.formatDate(new Date(),CONFIG.TIMEZONE,'yyyy-MM-dd');
  var report=[],seenKeys={},errors=[];
  var active=PropertiesService.getScriptProperties().getProperty('MW8_ACTIVE_SNAPSHOT');
  if(!active)throw new Error('No active snapshot version');
  sites.forEach(function(site){
    var key=mw8LocationKey_(site);
    if(!key){errors.push('Unmapped site: '+site.name);return;}
    if(seenKeys[key])errors.push('Duplicate location key: '+key);
    seenKeys[key]=true;
    var result=mw8ReadSnapshot_(key,'');
    var seen={},dates={},bad=0,duplicates=0,metricsErrors=0;
    result.hours.forEach(function(row){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(row.day)||!/^([01]\d|2[0-3])$/.test(row.hour))bad++;
      var id=row.day+'|'+row.hour;
      if(seen[id])duplicates++;
      seen[id]=true;dates[row.day]=(dates[row.day]||0)+1;
      if(!row.metrics||!isFinite(Number(row.metrics.avgWindKn))||!isFinite(Number(row.metrics.avgWaveM)))metricsErrors++;
    });
    var todayRows=dates[today]||0;
    if(result.version!==active)errors.push(key+': version mismatch');
    if(!result.hours.length)errors.push(key+': no snapshot records');
    if(!todayRows)errors.push(key+': no rows for '+today);
    if(bad||duplicates||metricsErrors)errors.push(key+': invalid dates/hours='+bad+', duplicate hours='+duplicates+', invalid metrics='+metricsErrors);
    report.push({key:key,name:site.name,status:result.status,version:result.version,hours:result.hours.length,today:todayRows,days:dates,invalidDateOrHour:bad,duplicateHours:duplicates,invalidMetrics:metricsErrors});
  });
  if(report.length!==14)errors.push('Expected 14 locations, found '+report.length);
  Logger.log('[MW8 VALIDATION] '+JSON.stringify({activeVersion:active,date:today,locations:report.length,passed:errors.length===0,errors:errors}));
  report.forEach(function(row){Logger.log('[MW8 LOCATION] '+JSON.stringify(row));});
  return {passed:errors.length===0,activeVersion:active,locations:report.length,errors:errors,report:report};
}
function mw8TestValidateAllLocations(){return mw8ValidateAllLocations_();}


/* === v8.2 TEST ONLY — daily marine synopsis from existing hourly cache ===
 * The active snapshot pointer advances only after both hourly and daily rows are saved.
 * Missing source metrics are explicitly null, never inferred or fabricated.
 * No weather provider requests or subscriber emails.
 */
function mw82DailySheet_(){
  var ss=SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sh=ss.getSheetByName('DailySynopsis');
  var headers=['version','published_at','location_key','location','day','synopsis_json'];
  if(!sh){sh=ss.insertSheet('DailySynopsis');sh.appendRow(headers);}
  var actual=sh.getRange(1,1,1,6).getValues()[0];
  if(headers.some(function(h,i){return String(actual[i])!==h;}))throw new Error('DailySynopsis schema mismatch; no changes made');
  return sh;
}
function mw82Number_(v){return v!==null&&v!==undefined&&v!==''&&isFinite(Number(v))?Number(v):null;}
function mw82Compass_(degrees){
  var n=mw82Number_(degrees);if(n===null)return null;
  return ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(((n%360)+360)%360/22.5)%16];
}
function mw82Mean_(rows,field){
  var vals=rows.map(function(r){return mw82Number_(r.metrics[field]);}).filter(function(x){return x!==null;});
  return vals.length?vals.reduce(function(a,b){return a+b;},0)/vals.length:null;
}
function mw82Peak_(rows,field){
  var found=null;rows.forEach(function(r){var v=mw82Number_(r.metrics[field]);if(v!==null&&(!found||v>found.value))found={value:v,time:r.hour+':00'};});return found;
}
function mw82TideEvents_(rows){
  for(var i=0;i<rows.length;i++){
    var s=rows[i].metrics.tideExtremaJson;
    if(!s)continue;
    try{var t=typeof s==='string'?JSON.parse(s):s;if(t&&typeof t==='object')return t;}catch(err){}
  }
  return null;
}
function mw82BuildSynopsis_(key,name,day,rows,version,published){
  rows.sort(function(a,b){return a.hour.localeCompare(b.hour);});
  var peakWave=mw82Peak_(rows,'peakWaveM'),peakGust=mw82Peak_(rows,'peakGustKn');
  var best=null;
  // Lowest combined sea/wind exposure is a descriptive indicator, not a safety or fishing score.
  rows.forEach(function(r){var sea=mw82Number_(r.metrics.avgWaveM),wind=mw82Number_(r.metrics.avgWindKn);
    if(sea===null||wind===null)return;
    var score=sea*1.94384+wind/10;
    if(!best||score<best.rank)best={time:r.hour+':00',wave_m:sea,wind_kt:wind,rank:score};
  });
  var hourly=rows.map(function(r){var m=r.metrics;return {
    time:r.hour+':00',wave_m:mw82Number_(m.avgWaveM),wind_kt:mw82Number_(m.avgWindKn),
    wind_direction:mw82Compass_(m.windDirMeanDeg),gust_kt:mw82Number_(m.peakGustKn),
    wave_period_s:mw82Number_(m.avgWavePeriodS),swell_direction:mw82Compass_(m.swellDirMeanDeg),
    swell_height_m:mw82Number_(m.swellHeightM),swell_period_s:mw82Number_(m.swellPeriodS),rain_mm:mw82Number_(m.precipSumMm),
    rain_probability_pct:mw82Number_(m.rainProbabilityPct),tide_height_ft:null,
    model_sea_level_m:mw82Number_(m.modelSeaLevelM),current_kt:mw82Number_(m.avgCurrentKn),
    current_direction:mw82Compass_(m.currentDirMeanDeg),sea_temp_c:mw82Number_(m.avgSstC),
    uv:mw82Number_(m.uvHourlyMax),comfort:mw82Number_(m.comfortScore),status:m.conditionColor||null
  };});
  var colors=rows.map(function(r){return r.metrics.conditionColor;}).filter(Boolean);
  var status=colors.indexOf('RED')>=0?'RED':colors.indexOf('YELLOW')>=0?'YELLOW':colors.indexOf('GREEN')>=0?'GREEN':null;
  return {version:version,published_at:published,location_key:key,location:name,day:day,
    status:status,comfort_score:mw82Mean_(rows,'comfortScore'),fishing_score:null,
    mean_wave_m:mw82Mean_(rows,'avgWaveM'),mean_wind_kt:mw82Mean_(rows,'avgWindKn'),
    mean_wave_period_s:mw82Mean_(rows,'avgWavePeriodS'),mean_current_kt:mw82Mean_(rows,'avgCurrentKn'),
    mean_sea_temp_c:mw82Mean_(rows,'avgSstC'),rain_total_mm:rows.reduce(function(sum,r){return sum+(mw82Number_(r.metrics.precipSumMm)||0);},0),
    rain_probability_pct:mw82Mean_(rows,'rainProbabilityPct'),
    mean_swell_height_m:mw82Mean_(rows,'swellHeightM'),mean_swell_period_s:mw82Mean_(rows,'swellPeriodS'),
    peak_wave:peakWave,peak_gust:peakGust,
    best_low_exposure_window:best?{time:best.time,wave_m:best.wave_m,wind_kt:best.wind_kt}:null,
    tide_events:mw82TideEvents_(rows),hourly_tide_height_ft:null,moon_phase:null,moon_illumination_pct:null,
    hourly:hourly,notice:'Forecast guidance only; verify official marine advisories before going to sea.'};
}
function mw82PublishDaily_(version,published,entries){
  var grouped={};entries.forEach(function(e){
    var id=e.locationKey+'|'+e.day;
    if(!grouped[id])grouped[id]={key:e.locationKey,name:e.site.name,day:e.day,rows:[]};
    grouped[id].rows.push({hour:e.hour,metrics:e.metrics});
  });
  var keys=Object.keys(grouped).sort();if(!keys.length)throw new Error('No daily synopsis rows');
  var rows=keys.map(function(id){var g=grouped[id],summary=mw82BuildSynopsis_(g.key,g.name,g.day,g.rows,version,published);
    return [version,published,g.key,g.name,g.day,JSON.stringify(summary)];});
  var sh=mw82DailySheet_(),start=sh.getLastRow()+1;
  sh.getRange(start,5,rows.length,1).setNumberFormat('@');
  sh.getRange(start,1,rows.length,6).setValues(rows);
  SpreadsheetApp.flush();
  Logger.log('[MW8.2 DAILY] Published '+rows.length+' summaries with hourly snapshot '+version);
  return rows.length;
}
function mw82ReadSynopsis_(requested,day){
  var version=PropertiesService.getScriptProperties().getProperty('MW8_ACTIVE_SNAPSHOT');
  var site=mw8Site_(requested),key=site?mw8LocationKey_(site):String(requested||'maiden').toLowerCase();
  var targetDay=mw8Date_(day||new Date()),sh=mw82DailySheet_();
  var values=sh.getDataRange().getValues();
  for(var i=values.length-1;i>=1;i--){var r=values[i];
    if(String(r[0])!==version||String(r[2]).toLowerCase()!==key||mw8Date_(r[4])!==targetDay)continue;
    try{var data=JSON.parse(r[5]),stamp=mw8Stamp_(r[1]),age=Date.now()-Date.parse(stamp);
      data.freshness=age>=0&&age<=8*3600000?'Current':'Delayed';return data;
    }catch(err){Logger.log('[MW8.2 DAILY] Invalid row '+(i+1)+': '+err.message);}
  }
  return {location_key:key,day:targetDay,status:'Delayed',freshness:'Delayed',hourly:[],
    notice:'Forecast information is temporarily unavailable; verify official marine advisories before going to sea.'};
}
function mw82SynopsisJson_(e){
  var p=e&&e.parameter||{},result=mw82ReadSynopsis_(p.key||p.location||'maiden',p.day||'');
  var callback=String(p.callback||'');
  if(callback&&/^[a-zA-Z_$][\w.$]{0,90}$/.test(callback))return ContentService.createTextOutput(callback+'('+JSON.stringify(result)+');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
function mw82SynopsisPage_(e){
  var p=e&&e.parameter||{},d=mw82ReadSynopsis_(p.key||p.location||'maiden',p.day||'');
  function esc(v){return String(v==null?'—':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function fmt(v,unit){return v===null||v===undefined?'Not available':(Math.round(v*10)/10)+' '+(unit||'');}
  var h='<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:14px Arial,sans-serif;color:#172a39;margin:20px}table{border-collapse:collapse;width:100%;min-width:750px}th,td{padding:8px;border-bottom:1px solid #dce5eb;text-align:left}th{background:#eaf3f6}.scroll{overflow:auto}.stats{display:flex;flex-wrap:wrap;gap:16px}.stats>div{border:1px solid #dce5eb;border-radius:8px;padding:12px;min-width:120px}small{color:#536675}</style></head><body>'+
    '<h2>'+esc(d.location||d.location_key)+' — Marine synopsis</h2><p>'+esc(d.day)+' · '+esc(d.status||'Unavailable')+' · '+esc(d.freshness||'Delayed')+'</p><div class="stats">'+
    '<div>Seas<br><b>'+esc(fmt(d.mean_wave_m,'m'))+'</b></div><div>Wind<br><b>'+esc(fmt(d.mean_wind_kt,'kt'))+'</b></div><div>Wave period<br><b>'+esc(fmt(d.mean_wave_period_s,'s'))+'</b></div><div>Current<br><b>'+esc(fmt(d.mean_current_kt,'kt'))+'</b></div><div>Sea temperature<br><b>'+esc(fmt(d.mean_sea_temp_c,'°C'))+'</b></div></div>'+
    '<p>Peak wave: '+esc(d.peak_wave?fmt(d.peak_wave.value,'m')+' at '+d.peak_wave.time:'Not available')+' · Peak gust: '+esc(d.peak_gust?fmt(d.peak_gust.value,'kt')+' at '+d.peak_gust.time:'Not available')+'</p>'+
    '<p>Lowest combined wave/wind exposure: '+esc(d.best_low_exposure_window?d.best_low_exposure_window.time:'Not available')+' (not a safety recommendation)</p>'+
    '<p>Hourly tide heights and fishing score: Not available; model sea-level values are not chart-datum tide predictions. Optional swell and rain probability display only when cached data exists.</p>'+
    '<h3>Hourly / advanced view</h3><div class="scroll"><table><thead><tr><th>Time</th><th>Seas (m)</th><th>Wind (kt)</th><th>Direction</th><th>Gust (kt)</th><th>Wave period (s)</th><th>Swell (m)</th><th>Swell period (s)</th><th>Rain (mm)</th><th>Rain chance (%)</th><th>Model sea level (m)</th><th>Current (kt)</th></tr></thead><tbody>'+
    (d.hourly||[]).map(function(r){return '<tr>'+[r.time,r.wave_m,r.wind_kt,r.wind_direction,r.gust_kt,r.wave_period_s,r.swell_height_m,r.swell_period_s,r.rain_mm,r.rain_probability_pct,r.model_sea_level_m,r.current_kt].map(function(v){return '<td>'+esc(v)+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table></div><p><small>'+esc(d.notice)+'</small></p></body></html>';
  return HtmlService.createHtmlOutput(h).setTitle('Marine Synopsis — TEST').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function mw82TestValidateDaily(){
  var sites=wxSitesV382_(),day=mw8Date_(new Date()),errors=[],report=[];
  sites.forEach(function(site){var key=mw8LocationKey_(site),d=mw82ReadSynopsis_(key,day);
    var hours=d.hourly||[],seen={};hours.forEach(function(r){if(seen[r.time])errors.push(key+': duplicate '+r.time);seen[r.time]=true;});
    if(!hours.length)errors.push(key+': no daily synopsis');
    if(d.version!==PropertiesService.getScriptProperties().getProperty('MW8_ACTIVE_SNAPSHOT'))errors.push(key+': version mismatch');
    report.push({key:key,day:day,hours:hours.length,status:d.status,freshness:d.freshness});
  });
  Logger.log('[MW8.2 VALIDATION] '+JSON.stringify({passed:!errors.length,locations:report.length,errors:errors}));
  report.forEach(function(r){Logger.log('[MW8.2 LOCATION] '+JSON.stringify(r));});
  return {passed:!errors.length,errors:errors,report:report};
}

/* === v8.3 TEST: OPTIONAL DATA FROM ALREADY-CACHED HOURLY API RESPONSES ===
 * Request definitions above include additional supported parameters on future
 * scheduled refreshes. Publishing snapshots does not call external APIs.
 * All times are provider-local Jamaica YYYY-MM-DDTHH, without UTC conversion.
 */
function mw83CachedExtras_(sites,tz){
  var result={};
  sites.forEach(function(site){
    var key=mw8LocationKey_(site), base=cacheKey('marine',site.lat,site.lon,tz);
    var marine=wxRead_(base+':cur')||wxRead_(base+':nocur');
    var weather=wxRead_(cacheKey('forecast',site.lat,site.lon,tz));
    var hours={};
    function merge(record,fields){
      if(!record||!record.data||!record.data.hourly)return;
      var h=record.data.hourly;
      (h.time||[]).forEach(function(t,i){
        var match=String(t).match(/^(\d{4}-\d{2}-\d{2})T(\d{2})/);
        if(!match)return;
        var k=match[1]+'T'+match[2],dst=hours[k]||(hours[k]={});
        fields.forEach(function(f){
          var arr=h[f[0]],v=arr&&arr[i];
          dst[f[1]]=v!==null&&v!==undefined&&v!==''&&isFinite(Number(v))?Number(v):null;
        });
      });
    }
    merge(marine,[['swell_wave_height','swellHeightM'],['swell_wave_period','swellPeriodS'],
      ['swell_wave_direction','swellDirectionDeg'],['sea_level_height_msl','modelSeaLevelM']]);
    merge(weather,[['precipitation_probability','rainProbabilityPct']]);
    result[key]=hours;
  });
  return result;
}
function mw83TestOptionalFields(){
  var sites=wxSitesV382_(),extras=mw83CachedExtras_(sites,CONFIG.TIMEZONE),report=[];
  sites.forEach(function(s){var k=mw8LocationKey_(s),values=Object.keys(extras[k]||{}).map(function(h){return extras[k][h];});
    function count(field){return values.filter(function(v){return v[field]!==null&&v[field]!==undefined;}).length;}
    report.push({key:k,cache_hours:values.length,swell_height_hours:count('swellHeightM'),
      rain_probability_hours:count('rainProbabilityPct'),model_sea_level_hours:count('modelSeaLevelM')});
  });
  Logger.log('[MW8.3 OPTIONAL CACHE] '+JSON.stringify(report));
  return report;
}



/* === v3.9.0 RELEASE SAFETY GATES === */
function mw390RequireProduction_(operation) {
  var p=PropertiesService.getScriptProperties();
  if(p.getProperty('MW_ENV')!=='PRODUCTION') throw new Error('Release blocked: MW_ENV must be PRODUCTION');
  if(!CONFIG.SHEET_ID) throw new Error('Release blocked: MW_PROD_SHEET_ID not configured');
  if(operation==='email' && p.getProperty('MW_EMAIL_ENABLED')!=='YES') throw new Error('Release blocked: subscriber emails disabled');
  if(operation==='triggers' && p.getProperty('MW_TRIGGERS_APPROVED')!=='YES') throw new Error('Release blocked: triggers not approved');
  if(operation==='refresh' && p.getProperty('MW_REFRESH_ENABLED')!=='YES') throw new Error('Release blocked: refresh disabled');
  if(operation==='snapshot' && p.getProperty('MW_SNAPSHOT_ENABLED')!=='YES') throw new Error('Release blocked: snapshot publication disabled');
}
function mw390Preflight() {
  var p=PropertiesService.getScriptProperties();
  var id=p.getProperty('MW_PROD_SHEET_ID')||'';
  var checks={environment:p.getProperty('MW_ENV'),sheetConfigured:!!id,
    emailEnabled:p.getProperty('MW_EMAIL_ENABLED')==='YES',
    refreshEnabled:p.getProperty('MW_REFRESH_ENABLED')==='YES',
    snapshotsEnabled:p.getProperty('MW_SNAPSHOT_ENABLED')==='YES',
    triggersApproved:p.getProperty('MW_TRIGGERS_APPROVED')==='YES',
    webAppUrlConfigured:!!p.getProperty('MW_PROD_WEBAPP_URL'),
    subscribeUrlConfigured:!!p.getProperty('MW_PROD_SUB_URL'),
    astronomyKeyConfigured:!!p.getProperty('VISUAL_CROSSING_KEY'),
    cacheFolderId:p.getProperty('WX_CACHE_FOLDER_ID')||'(will create dedicated folder on first use)'};
  if(id){try{var ss=SpreadsheetApp.openById(id);checks.sheetName=ss.getName();
    checks.subscribersTab=!!ss.getSheetByName('Subscribers');
    checks.marineCacheTab=!!ss.getSheetByName('MarineCache');
  }catch(e){checks.sheetError=String(e);}}
  Logger.log('[MW390 PREFLIGHT] '+JSON.stringify(checks));return checks;
}
