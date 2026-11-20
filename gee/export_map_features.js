/**
 * export_map_features_gee.js  (Earth Engine Code Editor)
 *
 * Wall-to-wall feature export for the city maps. For three map windows (Porto Alegre,
 * Sao Paulo, Recife; bounding boxes from the project owner, clipped to the municipality
 * boundary) it exports, at 10 m, ONLY the 187 features the map model uses
 * (selected_features.txt of the final model, pasted below), one GeoTIFF per base layer
 * (16 layers, 48 tasks for the three cities).
 *
 * The recipe is IDENTICAL to export_frantz_features_gee.js (table product), copied from it:
 * same collections, Cloud Score+ threshold, bilinear 20 m bands (S2_SHARPEN off), Crist (1985)
 * Tasseled Cap, 13 STMs, 50 m circular morphology, the same per-city Sentinel window
 * (LiDAR year clamped to 2019..2021, two years), the same CRS. The pixel grid is anchored on
 * multiples of 10 m in the city's UTM zone, like the sample points.
 * Features are computed on the unclipped image and clipped only at the end, so the 50 m
 * morphological operators see real neighbours at the municipality border.
 * Pixels outside the municipality, and pixels with no observation, are written as -9999.
 *
 * NOT TESTED against Earth Engine (no access from the development sandbox); syntax-checked only.
 *
 * How to use:
 *  1. MODE = 'check': prints the municipality found for each window, the clipped area and the
 *     expected export size. Check the names and areas.
 *  2. MODE = 'export', CITY_FILTER = 'recife', LAYERS = ['VH']: one small test task. Open the
 *     GeoTIFF in QGIS (band names, values, alignment over the city).
 *  3. CITY_FILTER = null, LAYERS = null: all 48 tasks. Start them from the Tasks tab.
 */

var MODE = 'check';                 // 'check' | 'export'
var CITY_FILTER = null;             // e.g. 'recife'
var LAYERS = null;                  // e.g. ['VH'], null = all layers that hold a selected feature
var DRIVE_FOLDER = 'frantz_map_features';
var NODATA = -9999;
// Municipality boundaries. Default: FAO GAUL 2015 level 2, the polygon that contains the centre of
// each window. To use your own IBGE municipalities asset instead, set MUNI_ASSET to its path; the
// polygon containing the window centre is taken in the same way.
var MUNI_ASSET = 'FAO/GAUL/2015/level2';

var CS_THRESHOLD = 0.6;
var KERNEL_RADIUS_M = 50;
var SENTINEL_YEAR_MIN = 2019;
var SENTINEL_YEAR_MAX = 2021;
var YEARS_SPAN = 2;

var CITY_META = {
  porto_alegre: {lidar_year: 2010, crs: 'EPSG:32722',
                 bbox: [-51.2774673132032, -30.098493114730104, -51.127291924226, -29.96875016261815]},
  sao_paulo:    {lidar_year: 2017, crs: 'EPSG:32723',
                 bbox: [-46.70057379040051, -23.61546462757343, -46.56543845279634, -23.50071588275874]},
  recife:       {lidar_year: 2020, crs: 'EPSG:32725',
                 bbox: [-34.924738288187285, -8.096812141055025, -34.85165857368497, -8.022028820469245]}
};

// The 187 features of the map model, in the order of selected_features.txt.
var SELECTED = [
  "VH_mean_GRD", "VH_p25_GRD", "VH_p50_GRD", "VH_p75_GRD", "VH_p90_GRD", "VH_p100_GRD",
  "B3_p10_ERO", "B3_p10_OPN", "B3_p25_ERO", "B3_p25_GRD", "B3_p50_ERO", "B3_p75_ERO",
  "B4_p10_ERO", "B4_p25_ERO", "B4_IQR_GRD", "B5_p10_ERO", "B5_p25_ERO", "B5_p50_ERO",
  "B5_IQR_GRD", "B6_mean_ERO", "B6_p10_ERO", "B6_p10_GRD", "B6_p25_ERO", "B6_p25_OPN",
  "B6_p50_ERO", "B6_p90_ERO", "B6_IQR_GRD", "B7_mean_ERO", "B7_p10_ERO", "B7_p25_ERO",
  "B7_p50_ERO", "B7_p75_ERO", "B7_IQR_GRD", "B8_mean_ERO", "B8_mean_OPN", "B8_p10_ERO",
  "B8_p10_OPN", "B8_p25_ERO", "B8_p25_OPN", "B8_p50_ERO", "B8_p50_OPN", "B8_p50_GRD",
  "B8_p75_ERO", "B8_p75_OPN", "B8_p90_ERO", "B8_kurtosis_ERO", "B8_IQR_GRD", "B8A_mean_ERO",
  "B8A_p10_ERO", "B8A_p25_ERO", "B8A_p25_OPN", "B8A_p25_GRD", "B8A_p50_ERO", "B8A_p50_GRD",
  "B8A_IQR_GRD", "B11_mean", "B11_p50", "B11_mean_ERO", "B11_mean_OPN", "B11_p10_ERO",
  "B11_p25_ERO", "B11_p25_OPN", "B11_p25_CLS", "B11_p50_ERO", "B11_p50_OPN", "B11_p75_ERO",
  "B11_p75_OPN", "B11_p90_ERO", "B11_p90_OPN", "B11_p100_ERO", "B11_p100_OPN", "B12_mean_ERO",
  "B12_mean_DIL", "B12_mean_OPN", "B12_p10_ERO", "B12_p25_OPN", "B12_p25_CLS", "B12_p50_ERO",
  "B12_p50_OPN", "B12_p75_ERO", "B12_p75_OPN", "B12_p90_ERO", "B12_p90_OPN", "NDVI_range_GRD",
  "TCG_p25_ERO", "NDBI_mean_GRD", "NDBI_stdDev_DIL", "NDBI_stdDev_CLS", "NDBI_stdDev_GRD", "NDBI_stdDev_BHT",
  "NDBI_p50_GRD", "NDBI_p75_GRD", "NDBI_p90_DIL", "NDBI_p90_GRD", "NDBI_p100_DIL", "NDBI_p100_GRD",
  "NDBI_skew_CLS", "NDBI_kurtosis_ERO", "NDBI_kurtosis_OPN", "NDBI_range_DIL", "NDBI_range_CLS", "NDBI_range_GRD",
  "NDBI_IQR_DIL", "NDBI_IQR_CLS", "NDBI_IQR_GRD", "NDBI_IQR_BHT", "TCB_mean_ERO", "TCB_mean_OPN",
  "TCB_p10_ERO", "TCB_p10_OPN", "TCB_p10_GRD", "TCB_p25_ERO", "TCB_p25_OPN", "TCB_p25_GRD",
  "TCB_p50_ERO", "TCB_p50_OPN", "TCB_p75_ERO", "TCB_p75_OPN", "TCB_p90_ERO", "TCB_p90_OPN",
  "TCB_kurtosis_ERO", "TCB_IQR_GRD", "TCW_mean", "TCW_p10", "TCW_p25", "TCW_p50",
  "TCW_p75", "TCW_mean_ERO", "TCW_mean_DIL", "TCW_mean_OPN", "TCW_mean_CLS", "TCW_p0_DIL",
  "TCW_p0_OPN", "TCW_p0_CLS", "TCW_p10_ERO", "TCW_p10_DIL", "TCW_p10_OPN", "TCW_p10_CLS",
  "TCW_p25_ERO", "TCW_p25_DIL", "TCW_p25_OPN", "TCW_p25_CLS", "TCW_p50_ERO", "TCW_p50_DIL",
  "TCW_p50_OPN", "TCW_p50_CLS", "TCW_p75_ERO", "TCW_p75_DIL", "TCW_p75_OPN", "TCW_p75_CLS",
  "TCW_p90_DIL", "TCW_p90_OPN", "TCW_p90_CLS", "TCW_range_OPN", "mNDWI_p90", "mNDWI_mean_DIL",
  "mNDWI_mean_CLS", "mNDWI_mean_GRD", "mNDWI_stdDev_DIL", "mNDWI_stdDev_CLS", "mNDWI_stdDev_GRD", "mNDWI_p0_DIL",
  "mNDWI_p0_CLS", "mNDWI_p0_GRD", "mNDWI_p10_DIL", "mNDWI_p10_CLS", "mNDWI_p10_GRD", "mNDWI_p25_DIL",
  "mNDWI_p25_CLS", "mNDWI_p25_GRD", "mNDWI_p50_DIL", "mNDWI_p50_CLS", "mNDWI_p50_GRD", "mNDWI_p75_DIL",
  "mNDWI_p75_CLS", "mNDWI_p90_DIL", "mNDWI_p90_CLS", "mNDWI_p100_CLS", "mNDWI_skew_ERO", "mNDWI_skew_OPN",
  "mNDWI_skew_CLS", "mNDWI_range_CLS", "mNDWI_range_GRD", "mNDWI_IQR_DIL", "mNDWI_IQR_CLS", "mNDWI_IQR_GRD",
  "mNDWI_IQR_BHT"
];

var S2_BANDS = ['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B8A', 'B11', 'B12'];
var STATS = ['mean', 'stdDev', 'p0', 'p10', 'p25', 'p50', 'p75', 'p90', 'p100',
             'skew', 'kurtosis', 'range', 'IQR'];
var TCB_COEF = [0.2043, 0.4158, 0.5524, 0.5741, 0.3124, 0.2303];
var TCG_COEF = [-0.1603, -0.2819, -0.4934, 0.7940, -0.0002, -0.1446];
var TCW_COEF = [0.0315, 0.2021, 0.3102, 0.1594, -0.6806, -0.6109];

function layerOf(name) { return name.split('_')[0]; }
function stmOf(name) { return name.split('_').slice(0, 2).join('_'); }
function sentinelYear(y) { return Math.min(Math.max(y, SENTINEL_YEAR_MIN), SENTINEL_YEAR_MAX); }
function unique(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
function stmNames(layer) { return STATS.map(function (s) { return layer + '_' + s; }); }

function dateRange(year) {
  var start = ee.Date.fromYMD(year, 1, 1);
  return {start: start, end: start.advance(YEARS_SPAN, 'year')};
}

// ---- collections and features: copied from export_frantz_features_gee.js (S2_SHARPEN = false) ----
function s1Collection(aoi, year, pol) {
  var r = dateRange(year);
  return ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(aoi).filterDate(r.start, r.end)
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', pol))
    .select([pol]);
}

function addS2Layers(img) {
  var refl = img.select(S2_BANDS).resample('bilinear').divide(10000);
  var ndvi = refl.normalizedDifference(['B8', 'B4']).rename('NDVI');
  var ndbi = refl.normalizedDifference(['B11', 'B8']).rename('NDBI');
  var mndwi = refl.normalizedDifference(['B3', 'B11']).rename('mNDWI');
  var tcIn = refl.select(['B2', 'B3', 'B4', 'B8', 'B11', 'B12']);
  function tc(coef, name) {
    return tcIn.multiply(ee.Image.constant(coef)).reduce(ee.Reducer.sum()).rename(name);
  }
  var out = refl.addBands([ndvi, tc(TCG_COEF, 'TCG'), ndbi, tc(TCB_COEF, 'TCB'),
                           tc(TCW_COEF, 'TCW'), mndwi]);
  var clear = img.select('cs_cdf').gte(CS_THRESHOLD);
  return out.updateMask(clear).copyProperties(img, ['system:time_start']);
}

function s2Collection(aoi, year, layer) {
  var r = dateRange(year);
  var sr = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(aoi).filterDate(r.start, r.end);
  var cs = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED').filterBounds(aoi).filterDate(r.start, r.end);
  return sr.linkCollection(cs, ['cs_cdf']).map(addS2Layers).select([layer]);
}

function collectionFor(layer, aoi, year) {
  if (layer === 'VV' || layer === 'VH') { return s1Collection(aoi, year, layer); }
  return s2Collection(aoi, year, layer);
}

function buildStm(col, layer) {
  var reducer = ee.Reducer.mean()
    .combine({reducer2: ee.Reducer.stdDev(), sharedInputs: true})
    .combine({reducer2: ee.Reducer.percentile([0, 10, 25, 50, 75, 90, 100]), sharedInputs: true})
    .combine({reducer2: ee.Reducer.skew(), sharedInputs: true})
    .combine({reducer2: ee.Reducer.kurtosis(), sharedInputs: true});
  var r = col.select([layer]).reduce(reducer);
  var rng = r.select(layer + '_p100').subtract(r.select(layer + '_p0')).rename(layer + '_range');
  var iqr = r.select(layer + '_p75').subtract(r.select(layer + '_p25')).rename(layer + '_IQR');
  return r.addBands([rng, iqr]).select(stmNames(layer));
}

function morphOps(b, name) {
  var kernel = ee.Kernel.circle({radius: KERNEL_RADIUS_M, units: 'meters'});
  var ero = b.focal_min({kernel: kernel});
  var dil = b.focal_max({kernel: kernel});
  var opn = ero.focal_max({kernel: kernel});
  var cls = dil.focal_min({kernel: kernel});
  return [ero.rename(name + '_ERO'), dil.rename(name + '_DIL'),
          opn.rename(name + '_OPN'), cls.rename(name + '_CLS'),
          dil.subtract(ero).rename(name + '_GRD'),
          b.subtract(opn).rename(name + '_THT'),
          cls.subtract(b).rename(name + '_BHT')];
}
// ---- end of copied part ----

function window_(city) {
  var b = CITY_META[city].bbox;
  var box = ee.Geometry.Rectangle([b[0], b[1], b[2], b[3]], null, false);
  var muni = ee.FeatureCollection(MUNI_ASSET).filterBounds(box.centroid(1)).first();
  var geom = ee.Feature(muni).geometry().intersection(box, 1);
  return {box: box, muni: ee.Feature(muni), geom: geom};
}

function layerImage(layer, city, w) {
  var cfg = CITY_META[city];
  var names = SELECTED.filter(function (n) { return layerOf(n) === layer; });
  var year = sentinelYear(cfg.lidar_year);
  var aoi = w.box.buffer(500);            // collection filter only; features are not clipped yet
  var stm = buildStm(collectionFor(layer, aoi, year), layer);
  var parts = [stm];
  unique(names.filter(function (n) { return n.split('_').length === 3; }).map(stmOf))
    .forEach(function (s) { parts = parts.concat(morphOps(stm.select(s), s)); });
  return ee.Image.cat(parts).select(names).toFloat().clip(w.geom).unmask(NODATA, false);
}

function run() {
  var cities = CITY_FILTER ? [CITY_FILTER] : Object.keys(CITY_META);
  var allLayers = unique(SELECTED.map(layerOf));
  var layers = LAYERS || allLayers;
  if (SELECTED.length !== 187) { throw new Error('SELECTED must hold the 187 names of selected_features.txt'); }
  layers.forEach(function (l) {
    if (allLayers.indexOf(l) < 0) { throw new Error('No selected feature in layer ' + l + '. Layers: ' + allLayers.join(', ')); }
  });
  cities.forEach(function (city) {
    if (!CITY_META[city]) { throw new Error('Unknown city ' + city); }
    var cfg = CITY_META[city];
    var w = window_(city);
    var year = sentinelYear(cfg.lidar_year);
    if (MODE === 'check') {
      var nb = SELECTED.length;
      var area = w.geom.area(10);
      print(city + ': Sentinel window ' + year + '-' + (year + YEARS_SPAN - 1) + ', ' + cfg.crs,
            'municipality', w.muni.toDictionary(),
            'window area km2 (bbox, clipped)', w.box.area(10).divide(1e6), area.divide(1e6),
            'export size, GB float32 (' + nb + ' bands)', area.divide(100).multiply(nb * 4).divide(1e9));
      Map.addLayer(w.box, {color: 'grey'}, city + ' bbox', false);
      Map.addLayer(w.geom, {color: 'red'}, city + ' export area');
      return;
    }
    if (MODE !== 'export') { throw new Error("MODE must be 'check' or 'export'"); }
    layers.forEach(function (layer) {
      var desc = city + '_map_' + layer;
      Export.image.toDrive({
        image: layerImage(layer, city, w),
        description: desc,
        folder: DRIVE_FOLDER,
        fileNamePrefix: desc,
        region: w.geom,
        crs: cfg.crs,
        crsTransform: [10, 0, 0, 0, -10, 0],      // grid on multiples of 10 m, like the sample points
        maxPixels: 1e10,
        fileFormat: 'GeoTIFF'
      });
      print('task created: ' + desc + ' (' + SELECTED.filter(function (n) { return layerOf(n) === layer; }).length + ' bands)');
    });
  });
  if (MODE === 'check') { Map.centerObject(window_(cities[0]).box, 12); }
}

run();
