/**
 * export_map_cnn_inputs_gee.js  (Earth Engine Code Editor)
 *
 * Wall-to-wall CNN inputs for the city maps. Same three map windows as
 * export_map_features_gee.js (Porto Alegre, Sao Paulo, Recife; bbox clipped to the municipality),
 * but instead of the 187 Frantz features it exports the 48 channels of the CNN patches:
 * four seasonal median composites (S1 = Jan-Mar, S2 = Apr-Jun, S3 = Jul-Sep, S4 = Oct-Dec),
 * each with VV, VH, B2, B3, B4, B5, B6, B7, B8, B8A, B11, B12.
 *
 * The recipe is IDENTICAL to PRODUCT = 'patches' in export_frantz_features_gee.js (copied from
 * seasonComposite there): descending IW Sentinel-1 scenes with both polarisations, median in dB;
 * Sentinel-2 L2A (S2_SR_HARMONIZED) with the Cloud Score+ mask cs_cdf >= 0.6, reflectance 0-1,
 * 20 m bands bilinear, median; per-city Sentinel window = LiDAR year clamped to 2019..2021, two
 * years (Porto Alegre and Sao Paulo 2019-2020, Recife 2020-2021); nodata -9999; float32;
 * grid on multiples of 10 m in the city's UTM zone, like the patches.
 * The band names (S1_VV ... S4_B12) and their order are the channel order of `x` in the patch
 * TFRecords, so channel i of the map is channel i of the training patches.
 *
 * Border margin: a CNN needs neighbours around every pixel it predicts. The export region is the
 * clipped window (municipality inside the bbox) BUFFERED by MARGIN_M (default 160 m = 16 px, the
 * half-width of a 33 px patch), so pixels at the municipality border still get a full patch.
 * Predictions in the margin should be discarded (mask with the municipality, or crop to the
 * <city>_pred.tif grid of the classical map).
 *
 * One task per city and season (12 bands each): 12 tasks for the three cities. Expected size,
 * float32: about 100 MB per task for Porto Alegre and Sao Paulo, about 35 MB for Recife
 * (MODE = 'check' prints the exact numbers).
 *
 *
 * How to use:
 *  1. MODE = 'check': prints the municipality, the export area with margin and the size per task.
 *  2. MODE = 'export', CITY_FILTER = 'recife', SEASONS = [1]: one small test task. Open it in QGIS
 *     over recife_map_B8 (classical map export): the grids must coincide pixel for pixel.
 *  3. CITY_FILTER = null, SEASONS = null: all 12 tasks. Start them from the Tasks tab.
 */

var MODE = 'check';                 // 'check' | 'export'
var CITY_FILTER = null;             // e.g. 'recife'
var SEASONS = null;                 // e.g. [1] or [1, 3]; null = all four
var DRIVE_FOLDER = 'frantz_map_cnn_inputs';
var NODATA = -9999;
var MARGIN_M = 160;                 // 16 px; raise to PATCH_PX/2 * 10 m if the CNN uses wider patches
var MUNI_ASSET = 'FAO/GAUL/2015/level2';

var CS_THRESHOLD = 0.6;
var SENTINEL_YEAR_MIN = 2019;
var SENTINEL_YEAR_MAX = 2021;
var YEARS_SPAN = 2;
var PATCH_SEASONS = [[1, 3], [4, 6], [7, 9], [10, 12]];
var PATCH_S2 = ['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B8A', 'B11', 'B12'];

var CITY_META = {
  porto_alegre: {lidar_year: 2010, crs: 'EPSG:32722',
                 bbox: [-51.2774673132032, -30.098493114730104, -51.127291924226, -29.96875016261815]},
  sao_paulo:    {lidar_year: 2017, crs: 'EPSG:32723',
                 bbox: [-46.70057379040051, -23.61546462757343, -46.56543845279634, -23.50071588275874]},
  recife:       {lidar_year: 2020, crs: 'EPSG:32725',
                 bbox: [-34.924738288187285, -8.096812141055025, -34.85165857368497, -8.022028820469245]}
};

function sentinelYear(y) { return Math.min(Math.max(y, SENTINEL_YEAR_MIN), SENTINEL_YEAR_MAX); }

function dateRange(year) {
  var start = ee.Date.fromYMD(year, 1, 1);
  return {start: start, end: start.advance(YEARS_SPAN, 'year')};
}

function seasonNames(i) {
  var tag = 'S' + (i + 1);
  return ['VV', 'VH'].concat(PATCH_S2).map(function (b) { return tag + '_' + b; });
}

// ---- copied from export_frantz_features_gee.js (S2_SHARPEN = false, PRODUCT = 'patches') ----
function s2Refl(img) {
  var refl = img.select(PATCH_S2).resample('bilinear').divide(10000);
  var clear = img.select('cs_cdf').gte(CS_THRESHOLD);
  return refl.updateMask(clear).copyProperties(img, ['system:time_start']);
}

function seasonComposite(aoi, year, i) {
  var tag = 'S' + (i + 1);
  var months = PATCH_SEASONS[i];
  var r = dateRange(year);
  var cal = ee.Filter.calendarRange(months[0], months[1], 'month');
  var s1 = ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(aoi).filterDate(r.start, r.end).filter(cal)
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.eq('orbitProperties_pass', 'DESCENDING'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
    .select(['VV', 'VH']);
  var sr = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(aoi).filterDate(r.start, r.end).filter(cal);
  var cs = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED')
    .filterBounds(aoi).filterDate(r.start, r.end).filter(cal);
  var s2 = sr.linkCollection(cs, ['cs_cdf']).map(s2Refl).select(PATCH_S2);
  return ee.Image.cat([
    s1.median().rename([tag + '_VV', tag + '_VH']),
    s2.median().rename(PATCH_S2.map(function (b) { return tag + '_' + b; }))
  ]);
}
// ---- end of copied part ----
// Note: in the patch product addS2Layers also computed the six indices before .select(PATCH_S2);
// they were dropped by that select, so computing only the ten bands here gives the same values.

function window_(city) {
  var b = CITY_META[city].bbox;
  var box = ee.Geometry.Rectangle([b[0], b[1], b[2], b[3]], null, false);
  var muni = ee.FeatureCollection(MUNI_ASSET).filterBounds(box.centroid(1)).first();
  var geom = ee.Feature(muni).geometry().intersection(box, 1);
  var region = geom.buffer(MARGIN_M, 1);
  return {box: box, muni: ee.Feature(muni), geom: geom, region: region};
}

function seasonImage(city, w, i) {
  var year = sentinelYear(CITY_META[city].lidar_year);
  return seasonComposite(w.region.buffer(1000), year, i)
    .select(seasonNames(i)).toFloat()
    .unmask(NODATA, false)            // no clear observation in the season -> -9999, as in the patches
    .clip(w.region).unmask(NODATA, false);
}

function run() {
  var cities = CITY_FILTER ? [CITY_FILTER] : Object.keys(CITY_META);
  var seasons = SEASONS || [1, 2, 3, 4];
  seasons.forEach(function (s) {
    if ([1, 2, 3, 4].indexOf(s) < 0) { throw new Error('SEASONS holds 1..4, got ' + s); }
  });
  cities.forEach(function (city) {
    if (!CITY_META[city]) { throw new Error('Unknown city ' + city); }
    var cfg = CITY_META[city];
    var w = window_(city);
    var year = sentinelYear(cfg.lidar_year);
    if (MODE === 'check') {
      var area = w.region.area(10);
      print(city + ': Sentinel window ' + year + '-' + (year + YEARS_SPAN - 1) + ', ' + cfg.crs +
            ', margin ' + MARGIN_M + ' m',
            'municipality', w.muni.toDictionary(),
            'area km2 (clipped, with margin)', w.geom.area(10).divide(1e6), area.divide(1e6),
            'size per season task, MB float32 (12 bands)', area.divide(100).multiply(12 * 4).divide(1e6));
      Map.addLayer(w.region, {color: 'blue'}, city + ' export region (with margin)');
      Map.addLayer(w.geom, {color: 'red'}, city + ' municipality window');
      return;
    }
    if (MODE !== 'export') { throw new Error("MODE must be 'check' or 'export'"); }
    seasons.forEach(function (s) {
      var desc = city + '_mapcnn_S' + s;
      Export.image.toDrive({
        image: seasonImage(city, w, s - 1),
        description: desc,
        folder: DRIVE_FOLDER,
        fileNamePrefix: desc,
        region: w.region,
        crs: cfg.crs,
        crsTransform: [10, 0, 0, 0, -10, 0],      // same 10 m grid as the patches and the classical map
        maxPixels: 1e10,
        fileFormat: 'GeoTIFF'
      });
      print('task created: ' + desc + ' (' + seasonNames(s - 1).join(', ') + ')');
    });
  });
  if (MODE === 'check') { Map.centerObject(window_(cities[0]).box, 12); }
}

run();
