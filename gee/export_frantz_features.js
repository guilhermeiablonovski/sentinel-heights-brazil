/**
 * export_frantz_features_gee.js
 * Earth Engine Code Editor port of export_frantz_features_gee.py (v3), both
 * products. Set PRODUCT = 'table' or 'cube'.
 *
 * PRODUCT A, 'table' (Frantz et al. 2021 point table). Per point: 18 base
 * layers (VV, VH, 10 Sentinel-2 bands, 6 indices) x 13 spectral-temporal
 * metrics over ALL clear observations of the year = 234 features, x 7
 * morphological operators with a 50 m circular element = 1638 features.
 * Total 1872 per point. One export task per city and layer.
 *
 * PRODUCT B, 'cube' (Yadav et al. 2025 style monthly cube, for the CNN).
 * 12 monthly composites per city, 7 bands each (default): Sentinel-1 monthly mean of VV
 * and VH per orbit direction in CUBE_ORBITS (default descending only: VV_DSC,
 * VH_DSC, because no ascending scenes exist over the three cities),
 * over scenes with both polarisations; Sentinel-2 B2 B3 B4 B8 B12
 * from the least cloudy image of the month, chosen per MGRS granule over the
 * city area and then mosaicked (Yadav picks per patch: coarser here). No pixel
 * masking. int16 GeoTIFF on a 10 m grid snapped to multiples of 2560 m in the
 * city's UTM zone, so 1280 m (128 px) patches nest in 2560 m CV blocks. S1 is
 * stored as dB x 100, S2 as reflectance x 10000, nodata -32768. One task per
 * city and month (12 per city). Cut chips later on a lab machine, not the Mac.
 *
 * Deviations from Frantz et al. (same as the Python script):
 *   Sentinel-1   FORCE/SNAP chain + bidirectional border-noise removal ->
 *                COPERNICUS/S1_GRD as ingested by Earth Engine (thermal and
 *                border noise removal, calibration, terrain correction with
 *                SRTM 30 m, no terrain flattening, dB). Both orbit directions
 *                pooled, as in Frantz.
 *   Sentinel-2   FORCE Level-2 -> Sen2Cor L2A (S2_SR_HARMONIZED) + Cloud Score+
 *                (cs_cdf >= CS_THRESHOLD); 20 m bands resampled bilinear.
 *   20->10 m     Frantz fuses with a neighbourhood-weighted method (2016b). Here,
 *                S2_SHARPEN applies a per-scene ratio sharpening with a 10 m
 *                guide band (my approximation; see settings). Cube B12 stays
 *                bilinear.
 *   Tasseled Cap Crist (1985) TM coefficients on B2 B3 B4 B8 B11 B12; not
 *                checked against FORCE's implementation.
 *   Year         Per city: LiDAR year clamped to [SENTINEL_YEAR_MIN,
 *                SENTINEL_YEAR_MAX] is the first year; the table product pools
 *                YEARS_SPAN years from there (default 2, DEVIATION: Frantz used
 *                one year; S1 2017 and S2 2018).
 *
 * NOT TESTED against Earth Engine (no access from the development sandbox).
 * It was only syntax-checked and run against a stub that records calls, to
 * catch JavaScript errors and confirm 1872 feature names, 36 table exports
 * and 24 cube exports for two cities, and a cube grid origin on multiples of
 * 2560 m. Earth Engine errors (band names, reducer output names, memory
 * limits, Dictionary.get with a default, the cloudOptimized option, the
 * blocking getInfo in cubeGrid) will only show up on the first real run.
 *
 * How to use:
 *  1. Upload <city>_sample_points as table assets named as in CITIES below,
 *     with columns sample_id, city, height_m, is_background, x_m, y_m.
 *  2. Set ASSET_ROOT.
 *  3. MODE = 'check': prints observations per pixel (VV, B8) and scenes per
 *     month for each active city. Read it before exporting.
 *  4. MODE = 'export', LAYERS = ['VV', 'B8'], CITY_FILTER = 'sao_paulo': one
 *     city and two layers. Compare a few values with the Python run or by hand.
 *  5. LAYERS = null, CITY_FILTER = null: all active cities and layers
 *     (2 cities x 18 layers = 36 tasks). Start them from the Tasks tab.
 */

// ---------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------

var MODE = 'check';                 // 'check' | 'dry' | 'export'
var PRODUCT = 'table';              // 'table' (Frantz) | 'cube' (monthly cube) | 'patches' (reduced, CNN)
var MONTHS = null;                  // cube only: e.g. [1, 2] or null for 1..12
var ASSET_ROOT = 'projects/YOUR-EARTH-ENGINE-PROJECT/assets';
var DRIVE_FOLDER = 'frantz_features';   // 'natural' points add the suffix _natural; patches use PATCH_FOLDER
// Which points to export. 'train' = the stratified points (asset <city>_sample_points_wgs84).
// 'natural' = the natural-distribution TEST points (asset <city>_sample_points_natural_wgs84,
// made by natural_test_points() in the sampler notebook). Natural exports go to
// DRIVE_FOLDER + '_natural' so they never mix with the training exports.
var POINTS_SET = 'train';           // 'train' | 'natural'

var ACTIVE_CITIES = ['porto_alegre', 'sao_paulo', 'rio_de_janeiro', 'belo_horizonte', 'salvador', 'recife', 'curitiba', 'niteroi'];
var CITY_FILTER = null;             // e.g. 'recife' (any configured city) or null
var LAYERS = null;                  // e.g. ['VV', 'B8', 'NDVI'], null for all 18, ['VVH'] for the extension

var SENTINEL_YEAR_MIN = 2019;       // L2A is near-empty before 2019 over Brazil (checked)
var SENTINEL_YEAR_MAX = 2021;       // last allowed START year of the window
// DEVIATION from Frantz (one year): STMs are built from YEARS_SPAN consecutive
// years starting at the city's year, e.g. 2 gives 2019-2020. 1 reproduces Frantz.
// Applies to the table product only; the monthly cube stays on the start year.
var YEARS_SPAN = 2;

// EXTENSION/APPROXIMATION of Frantz's 20 m -> 10 m Sentinel-2 data fusion
// (Frantz et al. 2016b, not reproduced). Each 20 m band is sharpened per scene,
// before the time series is reduced, with a smoothing-filter-based intensity
// modulation (ratio) using a 10 m guide band:
//   sharp = band20 * guide10 / mean_to_20m(guide10), both upsampled bilinearly.
// The guide choice and the ratio limits below are MY assumptions, not from a
// paper. With S2_SHARPEN = false the 20 m bands are plain bilinear (old run).
// Exports go to DRIVE_FOLDER + '_sharp' when on, so the two runs never mix.
var S2_SHARPEN = false;               // pinned: set true to test the sharpening
var SHARPEN_GUIDE = {B5: 'B8', B6: 'B8', B7: 'B8', B8A: 'B8', B11: 'B4', B12: 'B4'};
var SHARPEN_RATIO_MIN = 0.5;        // ratio clamp, avoids blow-ups in shadow
var SHARPEN_RATIO_MAX = 2.0;
var SHARPEN_EPS = 0.005;            // floor for the degraded guide (reflectance)

// PRODUCT = 'patches': reduced alternative to the monthly cube. One small image
// patch centred on every sample point (the same points and labels as the table),
// seasonal median composites, exported straight from Earth Engine so no chipping
// step is needed on a lab machine. Median of a collection that is already
// masked per pixel (Cloud Score+ for S2), so it is a native median composite.
var PATCH_RADIUS_PX = 16;           // 16 -> 33 x 33 px (330 m); the centre pixel holds the point
var PATCH_SEASONS = [[1, 3], [4, 6], [7, 9], [10, 12]];   // calendar months, pooled over the YEARS_SPAN window
var PATCH_S2 = ['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B8A', 'B11', 'B12'];   // all ten, no indices
var PATCH_POINTS_PER_TASK = 200;    // points per export task; 'Computed value is too large' means lower it.
                                    // 150 points x 28 channels passed; 200 x 48 is untested.
var PATCH_TEST_N = null;            // e.g. 150 exports a RANDOM 150 points, one chunk, for a first test
var PATCH_NODATA = -9999;           // masked pixels (no clear observation in a season)
var PATCH_FOLDER = 'frantz_patches';

var CS_THRESHOLD = 0.6;             // Cloud Score+ cs_cdf; 0.5 to 0.65 is usual
var KERNEL_RADIUS_M = 50;
var TILE_SCALE = 4;

// lidar_year from the project owner; crs = WGS84 UTM zone of the city centre
var CITY_META = {
  porto_alegre:   {lidar_year: 2010, crs: 'EPSG:32722'},
  sao_paulo:      {lidar_year: 2017, crs: 'EPSG:32723'},
  rio_de_janeiro: {lidar_year: 2019, crs: 'EPSG:32723'},
  niteroi:        {lidar_year: 2019, crs: 'EPSG:32723'},
  curitiba:       {lidar_year: 2019, crs: 'EPSG:32722'},
  belo_horizonte: {lidar_year: 2013, crs: 'EPSG:32723'},
  salvador:       {lidar_year: 2017, crs: 'EPSG:32724'},
  recife:         {lidar_year: 2020, crs: 'EPSG:32725'},
  florianopolis:  {lidar_year: 2015, crs: 'EPSG:32722'}
};

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------

var S2_BANDS = ['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B8A', 'B11', 'B12'];
var INDICES = ['NDVI', 'TCG', 'NDBI', 'TCB', 'TCW', 'mNDWI'];
var BASE_LAYERS = ['VV', 'VH'].concat(S2_BANDS, INDICES);
// EXTENSION beyond Frantz et al. (2021), not part of the default 18-layer run.
// VVH (Li et al. 2020, Eq. 1) = VV * gamma^VH, gamma = 5, computed from the
// annual mean VV and VH. Request it with LAYERS = ['VVH']. Exports 8 features.
var EXT_LAYERS = ['VVH'];
var VVH_GAMMA = 5;

var STATS = ['mean', 'stdDev', 'p0', 'p10', 'p25', 'p50', 'p75', 'p90', 'p100',
             'skew', 'kurtosis', 'range', 'IQR'];
var OPS = ['ERO', 'DIL', 'OPN', 'CLS', 'GRD', 'THT', 'BHT'];
var META = ['sample_id', 'city', 'height_m', 'is_background', 'x_m', 'y_m'];

// Crist (1985) reflectance-factor Tasseled Cap, TM bands 1-5 and 7
var TCB_COEF = [0.2043, 0.4158, 0.5524, 0.5741, 0.3124, 0.2303];
var TCG_COEF = [-0.1603, -0.2819, -0.4934, 0.7940, -0.0002, -0.1446];
var TCW_COEF = [0.0315, 0.2021, 0.3102, 0.1594, -0.6806, -0.6109];

function sentinelYear(lidarYear) {
  return Math.min(Math.max(lidarYear, SENTINEL_YEAR_MIN), SENTINEL_YEAR_MAX);
}

function cityConfig(name) {
  var m = CITY_META[name];
  return {
    pointsAsset: ASSET_ROOT + '/frantz_replication/' + name +
                 (POINTS_SET === 'natural' ? '_sample_points_natural_wgs84' : '_sample_points_selected_wgs84'),
    crs: m.crs,
    lidarYear: m.lidar_year,
    year: sentinelYear(m.lidar_year)
  };
}

// ---------------------------------------------------------------------
// Feature names (plain JavaScript, used for column selection)
// ---------------------------------------------------------------------

function stmNames(layer) {
  return STATS.map(function (s) { return layer + '_' + s; });
}

function sstmNames(layer) {
  var out = [];
  stmNames(layer).forEach(function (n) {
    OPS.forEach(function (op) { out.push(n + '_' + op); });
  });
  return out;
}

// ---------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------

function dateRange(year) {
  var start = ee.Date.fromYMD(year, 1, 1);
  return {start: start, end: start.advance(YEARS_SPAN, 'year')};
}

function s1Collection(aoi, year, pol) {
  var r = dateRange(year);
  return ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(aoi).filterDate(r.start, r.end)
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', pol))
    .select([pol]);
}

var S2_10M = ['B2', 'B3', 'B4', 'B8'];
var S2_20M = ['B5', 'B6', 'B7', 'B8A', 'B11', 'B12'];
// Layers whose values change when S2_SHARPEN is on (10 m-only layers do not).
var SHARPEN_AFFECTED = S2_20M.concat(['TCG', 'TCB', 'TCW', 'NDBI', 'mNDWI']);

function sharpenedRefl(img) {
  // Reflectance (0-1) of all ten bands; the six 20 m bands are sharpened.
  var proj20 = img.select('B11').projection();
  var lowCache = {};
  function low(g) {               // guide aggregated to 20 m, back to 10 m bilinear
    if (!lowCache[g]) {
      lowCache[g] = img.select(g).divide(10000)
        .reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 64})
        .reproject(proj20)
        .resample('bilinear');
    }
    return lowCache[g];
  }
  var parts = [img.select(S2_10M).divide(10000)];
  S2_20M.forEach(function (b) {
    var g = SHARPEN_GUIDE[b];
    var g10 = img.select(g).divide(10000);
    var ratio = g10.divide(low(g).max(ee.Image(SHARPEN_EPS)))
      .clamp(SHARPEN_RATIO_MIN, SHARPEN_RATIO_MAX);
    parts.push(img.select(b).resample('bilinear').divide(10000)
      .multiply(ratio).rename(b));
  });
  return ee.Image.cat(parts).select(S2_BANDS);
}

function addS2Layers(img) {
  // Reflectance (0-1), the six indices, then the clear-sky mask.
  var refl = S2_SHARPEN ? sharpenedRefl(img)
                        : img.select(S2_BANDS).resample('bilinear').divide(10000);
  var ndvi = refl.normalizedDifference(['B8', 'B4']).rename('NDVI');
  var ndbi = refl.normalizedDifference(['B11', 'B8']).rename('NDBI');
  var mndwi = refl.normalizedDifference(['B3', 'B11']).rename('mNDWI');
  var tcIn = refl.select(['B2', 'B3', 'B4', 'B8', 'B11', 'B12']);

  function tc(coef, name) {
    return tcIn.multiply(ee.Image.constant(coef))
      .reduce(ee.Reducer.sum()).rename(name);
  }

  var out = refl.addBands([ndvi, tc(TCG_COEF, 'TCG'), ndbi, tc(TCB_COEF, 'TCB'),
                           tc(TCW_COEF, 'TCW'), mndwi]);
  var clear = img.select('cs_cdf').gte(CS_THRESHOLD);
  return out.updateMask(clear).copyProperties(img, ['system:time_start']);
}

function s2Collection(aoi, year, layer) {
  var r = dateRange(year);
  var sr = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(aoi).filterDate(r.start, r.end);
  var cs = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED')
    .filterBounds(aoi).filterDate(r.start, r.end);
  var linked = sr.linkCollection(cs, ['cs_cdf']);
  return linked.map(addS2Layers).select([layer]);
}

function collectionFor(layer, aoi, year) {
  if (layer === 'VV' || layer === 'VH') {
    return s1Collection(aoi, year, layer);
  }
  return s2Collection(aoi, year, layer);
}

// ---------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------

function buildStm(col, layer) {
  var reducer = ee.Reducer.mean()
    .combine({reducer2: ee.Reducer.stdDev(), sharedInputs: true})
    .combine({reducer2: ee.Reducer.percentile([0, 10, 25, 50, 75, 90, 100]),
              sharedInputs: true})
    .combine({reducer2: ee.Reducer.skew(), sharedInputs: true})
    .combine({reducer2: ee.Reducer.kurtosis(), sharedInputs: true});
  var r = col.select([layer]).reduce(reducer);
  var rng = r.select(layer + '_p100').subtract(r.select(layer + '_p0'))
    .rename(layer + '_range');
  var iqr = r.select(layer + '_p75').subtract(r.select(layer + '_p25'))
    .rename(layer + '_IQR');
  return r.addBands([rng, iqr]).select(stmNames(layer));
}

function morphOps(b, name) {
  // 7 morphological operators, circular structuring element. The kernel is in
  // metres, so it becomes a 5-pixel radius at the 10 m sampling scale.
  var kernel = ee.Kernel.circle({radius: KERNEL_RADIUS_M, units: 'meters'});
  var ero = b.focal_min({kernel: kernel});
  var dil = b.focal_max({kernel: kernel});
  var opn = ero.focal_max({kernel: kernel});   // opening = dilation(erosion)
  var cls = dil.focal_min({kernel: kernel});   // closing = erosion(dilation)
  return [ero.rename(name + '_ERO'), dil.rename(name + '_DIL'),
          opn.rename(name + '_OPN'), cls.rename(name + '_CLS'),
          dil.subtract(ero).rename(name + '_GRD'),
          b.subtract(opn).rename(name + '_THT'),
          cls.subtract(b).rename(name + '_BHT')];
}

function buildSstm(stm, layer) {
  var bands = [];
  stmNames(layer).forEach(function (name) {
    bands = bands.concat(morphOps(stm.select(name), name));
  });
  return ee.Image.cat(bands);
}

// EXTENSION (not in Frantz): VVH from Li et al. (2020), Eq. 1: VV * gamma^VH.
// Choice not stated in the paper: VV and VH are averaged in linear power over
// the window (IW scenes that carry both polarisations), then combined. The paper
// does not state the units it used, so linear is an inference.
function buildVvh(aoi, year) {
  var r = dateRange(year);
  var col = ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(aoi).filterDate(r.start, r.end)
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'));
  var lin = col.map(function (img) {
    return ee.Image(10).pow(img.select(['VV', 'VH']).divide(10))
      .copyProperties(img, ['system:time_start']);
  });
  var m = lin.mean();
  var vvh = m.select('VV').multiply(ee.Image(VVH_GAMMA).pow(m.select('VH')))
    .rename('VVH');
  return vvh.addBands(ee.Image.cat(morphOps(vvh, 'VVH')));
}

function vvhNames() {
  return ['VVH'].concat(OPS.map(function (op) { return 'VVH_' + op; }));
}

// ---------------------------------------------------------------------
// Product B: monthly cube
// ---------------------------------------------------------------------

// Orbit directions in the cube. Checked 2019-2020 over PA, SP and Rio: S1 has
// NO ascending scenes there, so ASC bands would be all nodata. Add 'ASC' only
// for a city where the check shows ascending coverage.
var CUBE_ORBITS = ['DSC'];
var CUBE_BANDS_S1 = [];
CUBE_ORBITS.forEach(function (o) { CUBE_BANDS_S1.push('VV_' + o, 'VH_' + o); });
var CUBE_BANDS_S2 = ['B2', 'B3', 'B4', 'B8', 'B12'];
var CUBE_BANDS = CUBE_BANDS_S1.concat(CUBE_BANDS_S2);
var CUBE_BUFFER_M = 1000;
var BLOCK_M = 2560;                 // spatial CV block = 2 x 1280 m Yadav patch
var NODATA = -32768;
var CUBE_FOLDER = 'frantz_yadav_cube';
var CLOUD_SCALE_M = 100;            // scale for the per-image cloud fraction

function monthRange(year, month) {
  var start = ee.Date.fromYMD(year, month, 1);
  return {start: start, end: start.advance(1, 'month')};
}

function s1Month(aoi, year, month, orbitPass, tag) {
  // Monthly mean (dB) of VV and VH over scenes that have both polarisations.
  var r = monthRange(year, month);
  var col = ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(aoi).filterDate(r.start, r.end)
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.eq('orbitProperties_pass', orbitPass))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
    .select(['VV', 'VH']);
  var names = ['VV_' + tag, 'VH_' + tag];
  var empty = ee.Image.constant([0, 0]).rename(names)
    .updateMask(ee.Image.constant(0));
  return ee.Image(ee.Algorithms.If(col.size().gt(0),
                                   col.mean().rename(names), empty));
}

function s2Month(aoi, year, month) {
  // For each MGRS granule keep the image with the lowest cloud fraction over
  // the AOI, then mosaic the granules. Cloud fraction = share of valid pixels
  // with cs_cdf < CS_THRESHOLD. Images with no valid pixel in the AOI get 1.
  var r = monthRange(year, month);
  var sr = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(aoi).filterDate(r.start, r.end);
  var cs = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED')
    .filterBounds(aoi).filterDate(r.start, r.end);
  var linked = sr.linkCollection(cs, ['cs_cdf']);

  var scored = linked.map(function (img) {
    var frac = img.select('cs_cdf').lt(CS_THRESHOLD).reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: aoi,
      scale: CLOUD_SCALE_M,
      maxPixels: 1e9,
      bestEffort: true,
      tileScale: 4
    });
    return img.set('CLOUD_LOCAL', ee.Number(ee.Dictionary(frac).get('cs_cdf', 1)));
  });
  var tiles = scored.aggregate_array('MGRS_TILE').distinct();

  var best = function (t) {
    var sub = scored.filter(ee.Filter.eq('MGRS_TILE', t)).sort('CLOUD_LOCAL');
    return ee.Image(sub.first()).select(CUBE_BANDS_S2).resample('bilinear');
  };
  var mosaic = ee.ImageCollection.fromImages(tiles.map(best)).mosaic();
  return mosaic.select(CUBE_BANDS_S2);
}

function cubeImage(aoi, year, month) {
  var pass = {ASC: 'ASCENDING', DSC: 'DESCENDING'};
  var s1 = ee.Image.cat(CUBE_ORBITS.map(function (o) {
    return s1Month(aoi, year, month, pass[o], o);
  })).multiply(100);
  var s2 = s2Month(aoi, year, month);
  var img = ee.Image.cat([s1, s2]).select(CUBE_BANDS);
  return img.round().unmask(NODATA).toInt16();
}

var gridCache = {};

function cubeGrid(city, cfg) {
  // Snap the AOI bounds to BLOCK_M in the city's UTM CRS. Uses one blocking
  // getInfo call per city (cached). Returns aoi, region, crsTransform, size.
  if (gridCache[city]) { return gridCache[city]; }
  var points = ee.FeatureCollection(cfg.pointsAsset);
  var aoi = points.geometry().bounds().buffer(CUBE_BUFFER_M);
  var ring = aoi.bounds().transform(cfg.crs, 1).coordinates().get(0).getInfo();
  var xs = ring.map(function (p) { return p[0]; });
  var ys = ring.map(function (p) { return p[1]; });
  var xmin = Math.floor(Math.min.apply(null, xs) / BLOCK_M) * BLOCK_M;
  var ymin = Math.floor(Math.min.apply(null, ys) / BLOCK_M) * BLOCK_M;
  var xmax = Math.ceil(Math.max.apply(null, xs) / BLOCK_M) * BLOCK_M;
  var ymax = Math.ceil(Math.max.apply(null, ys) / BLOCK_M) * BLOCK_M;
  var g = {
    aoi: aoi,
    region: ee.Geometry.Rectangle({coords: [xmin, ymin, xmax, ymax],
                                   proj: cfg.crs, geodesic: false}),
    transform: [10, 0, xmin, 0, -10, ymax],
    w: (xmax - xmin) / 10,
    h: (ymax - ymin) / 10
  };
  gridCache[city] = g;
  return g;
}

// ---------------------------------------------------------------------
// Product C: reduced patch set for a CNN (one patch per sample point)
// ---------------------------------------------------------------------

function patchBandNames() {
  var out = [];
  PATCH_SEASONS.forEach(function (m, i) {
    ['VV', 'VH'].concat(PATCH_S2).forEach(function (b) { out.push('S' + (i + 1) + '_' + b); });
  });
  return out;
}

function seasonComposite(aoi, year, i) {
  // Median of the descending S1 scenes (dB) and of the cloud-masked S2 L2A
  // scenes (reflectance 0-1) in the season's months, over the whole window.
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
  var s2 = sr.linkCollection(cs, ['cs_cdf']).map(addS2Layers).select(PATCH_S2);
  return ee.Image.cat([
    s1.median().rename([tag + '_VV', tag + '_VH']),
    s2.median().rename(PATCH_S2.map(function (b) { return tag + '_' + b; }))
  ]);
}

function patchImage(aoi, year) {
  var bands = PATCH_SEASONS.map(function (m, i) { return seasonComposite(aoi, year, i); });
  var kernel = ee.Kernel.square({radius: PATCH_RADIUS_PX, units: 'pixels'});
  return ee.Image.cat(bands).select(patchBandNames())
    .unmask(PATCH_NODATA).neighborhoodToArray(kernel);
}

function exportPatches(city, cfg) {
  var names = patchBandNames();
  var side = 2 * PATCH_RADIUS_PX + 1;
  var perRow = names.length * side * side;
  var points = ee.FeatureCollection(cfg.pointsAsset);
  var aoi = points.geometry().bounds().buffer(1000);
  var chunks = 1;
  if (!PATCH_TEST_N) {
    chunks = Math.max(1, Math.ceil(points.size().getInfo() / PATCH_POINTS_PER_TASK));
  }
  if (MODE === 'dry') {
    print('[dry] ' + city + ' patches: ' + side + 'x' + side + ' px, ' + names.length +
          ' array properties per point (' + perRow + ' values per point), ' + chunks +
          ' task(s), years ' + cfg.year + '+' + YEARS_SPAN, 'points', points.size());
    return;
  }
  var img = patchImage(aoi, cfg.year);
  var ranked = points.randomColumn('chunk_rnd', 42);
  for (var k = 0; k < chunks; k++) {
    var part = PATCH_TEST_N ? ranked.sort('chunk_rnd').limit(PATCH_TEST_N)
      : ranked.filter(ee.Filter.and(ee.Filter.gte('chunk_rnd', k / chunks),
                                    ee.Filter.lt('chunk_rnd', (k + 1) / chunks)));
    var samples = img.sampleRegions({
      collection: part,
      properties: META,
      projection: ee.Projection(cfg.crs),
      scale: 10,
      tileScale: TILE_SCALE
    });
    var desc = city + '_patches_c' + (k + 1) + (PATCH_TEST_N ? '_test' : '');
    Export.table.toDrive({
      collection: samples,
      description: desc,
      folder: PATCH_FOLDER + (POINTS_SET === 'natural' ? '_natural' : ''),
      fileNamePrefix: desc,
      fileFormat: 'TFRecord',
      selectors: META.concat(names)
    });
    print('task created: ' + desc);
  }
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function exportCubeMonth(city, cfg, month) {
  var g = cubeGrid(city, cfg);
  var desc = city + '_cube_' + cfg.year + '_m' + pad2(month);
  var mb = g.w * g.h * CUBE_BANDS.length * 2 / 1e6;
  if (MODE === 'dry') {
    print('[dry] ' + desc + ': ' + g.w + ' x ' + g.h + ' px, about ' +
          Math.round(mb) + ' MB uncompressed');
    return;
  }
  Export.image.toDrive({
    image: cubeImage(g.aoi, cfg.year, month),
    description: desc,
    folder: CUBE_FOLDER,
    fileNamePrefix: desc,
    region: g.region,
    crs: cfg.crs,
    crsTransform: g.transform,
    maxPixels: 1e10,
    fileFormat: 'GeoTIFF',
    formatOptions: {cloudOptimized: true}
  });
  print('task created: ' + desc + ' (' + g.w + ' x ' + g.h + ' px)');
}

// ---------------------------------------------------------------------
// Product A jobs
// ---------------------------------------------------------------------

function tableFolder() {
  return DRIVE_FOLDER + (S2_SHARPEN ? '_sharp' : '') + (POINTS_SET === 'natural' ? '_natural' : '');
}

function exportLayer(city, cfg, layer) {
  var points = ee.FeatureCollection(cfg.pointsAsset);
  var aoi = points.geometry().bounds().buffer(1000);
  var feats, keep;
  if (layer === 'VVH') {
    feats = buildVvh(aoi, cfg.year);
    keep = META.concat(vvhNames());
  } else {
    var col = collectionFor(layer, aoi, cfg.year);
    var stm = buildStm(col, layer);
    feats = stm.addBands(buildSstm(stm, layer));
    keep = META.concat(stmNames(layer), sstmNames(layer));
  }

  var sampled = feats.reduceRegions({
    collection: points,
    reducer: ee.Reducer.first(),
    scale: 10,
    crs: cfg.crs,
    tileScale: TILE_SCALE
  });
  var table = sampled.select({propertySelectors: keep, retainGeometry: false});

  var desc = city + '_' + layer;
  if (MODE === 'dry') {
    print('[dry] ' + desc + ': years ' + cfg.year + '+' + YEARS_SPAN + ', ' +
          (keep.length - META.length) + ' features');
    return;
  }
  Export.table.toDrive({
    collection: table,
    description: desc,
    folder: tableFolder(),
    fileNamePrefix: desc,
    fileFormat: 'CSV'
  });
  print('task created: ' + desc);
}

function quantile(sorted, p) {
  return sorted[Math.floor(p * (sorted.length - 1))];
}

function checkSharpen(city, cfg) {
  // Consistency check on one scene: the sharpened bands, averaged back to 20 m,
  // should reproduce the original 20 m bands. Prints the mean absolute
  // difference next to the mean reflectance of each band. This does not
  // measure accuracy at 10 m, only that the method preserves the 20 m signal.
  var points = ee.FeatureCollection(cfg.pointsAsset).limit(200);
  var aoi = points.geometry().bounds().buffer(1000);
  var r = dateRange(cfg.year);
  var img = ee.Image(ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(aoi).filterDate(r.start, r.end)
    .sort('CLOUDY_PIXEL_PERCENTAGE').first());
  var proj10 = img.select('B2').projection();
  var proj20 = img.select('B11').projection();
  var orig = img.select(S2_20M).divide(10000);
  var back = sharpenedRefl(img).select(S2_20M).reproject(proj10)
    .reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 64})
    .reproject(proj20);
  var opts = {reducer: ee.Reducer.mean(), geometry: aoi, scale: 20,
              maxPixels: 1e9, bestEffort: true};
  print(city + ' sharpen check, scene ' + 'sorted by least cloud; mean |sharp@20m - original| per band',
        back.subtract(orig).abs().reduceRegion(opts),
        'mean original reflectance', orig.reduceRegion(opts));
}

function checkCity(city, cfg) {
  // Observation density per pixel and scenes per month. Frantz reports 74-231
  // Sentinel-1 and up to 72 clear Sentinel-2 observations per pixel (Germany).
  var year = cfg.year;
  var points = ee.FeatureCollection(cfg.pointsAsset).limit(200);
  var aoi = points.geometry().bounds().buffer(1000);
  print(city + ': LiDAR ' + cfg.lidarYear + ', Sentinel window ' + year + '-' +
        (year + YEARS_SPAN - 1) + ' (' + YEARS_SPAN + ' y), gap ' +
        (year - cfg.lidarYear) + ' y');

  if (S2_SHARPEN) { checkSharpen(city, cfg); }

  ['VV', 'B8'].forEach(function (layer) {
    var col = collectionFor(layer, aoi, year);
    var cnt = col.select([layer]).reduce(ee.Reducer.count());
    var vals = cnt.reduceRegions({
      collection: points,
      reducer: ee.Reducer.first(),
      scale: 10,
      crs: cfg.crs
    }).aggregate_array('first');
    vals.evaluate(function (v, err) {
      if (err) { print(city + ' ' + layer + ': error ' + err); return; }
      var s = (v || []).filter(function (x) { return x !== null; })
        .sort(function (a, b) { return a - b; });
      if (!s.length) {
        print(city + ' ' + layer +
              ': no observations returned (check asset path and year)');
        return;
      }
      print(city + ' ' + layer + ' observations per pixel: min ' + s[0] +
            ', p10 ' + quantile(s, 0.1) + ', median ' + quantile(s, 0.5) +
            ', p90 ' + quantile(s, 0.9) + ', max ' + s[s.length - 1]);
    });
  });

  var r = dateRange(year);
  var s1 = ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(aoi).filterDate(r.start, r.end)
    .filter(ee.Filter.eq('instrumentMode', 'IW'));
  var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(aoi).filterDate(r.start, r.end);

  function perMonth(col, y) {
    return ee.List.sequence(1, 12).map(function (m) {
      var start = ee.Date.fromYMD(y, ee.Number(m), 1);
      return col.filterDate(start, start.advance(1, 'month')).size();
    });
  }
  for (var k = 0; k < YEARS_SPAN; k++) {
    var y = year + k;
    print(city + ' ' + y + ' scenes per month Jan..Dec; a 0 in S1 DSC or S2 means a gap',
          'S1 ASC', perMonth(s1.filter(ee.Filter.eq('orbitProperties_pass', 'ASCENDING')), y),
          'S1 DSC', perMonth(s1.filter(ee.Filter.eq('orbitProperties_pass', 'DESCENDING')), y),
          'S2 L2A', perMonth(s2, y));
  }
}

// ---------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------

function run() {
  var cities = CITY_FILTER ? [CITY_FILTER] : ACTIVE_CITIES;
  var layers = LAYERS || BASE_LAYERS;
  var months = MONTHS || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  if (YEARS_SPAN !== 1 && YEARS_SPAN !== 2 && YEARS_SPAN !== 3) {
    throw new Error('YEARS_SPAN must be 1, 2 or 3');
  }
  S2_20M.forEach(function (b) {
    if (S2_10M.indexOf(SHARPEN_GUIDE[b]) < 0) {
      throw new Error('SHARPEN_GUIDE for ' + b + ' must be one of ' + S2_10M.join(', '));
    }
  });
  if (!(SHARPEN_RATIO_MIN > 0 && SHARPEN_RATIO_MIN < 1 && SHARPEN_RATIO_MAX > 1)) {
    throw new Error('SHARPEN_RATIO_MIN must be in (0,1) and SHARPEN_RATIO_MAX above 1');
  }
  if (POINTS_SET !== 'train' && POINTS_SET !== 'natural') {
    throw new Error("POINTS_SET must be 'train' or 'natural'");
  }
  if (PRODUCT !== 'table' && PRODUCT !== 'cube' && PRODUCT !== 'patches') {
    throw new Error("PRODUCT must be 'table', 'cube' or 'patches'");
  }
  months.forEach(function (m) {
    if (m < 1 || m > 12) { throw new Error('MONTHS takes values from 1 to 12'); }
  });
  cities.forEach(function (c) {
    if (!CITY_META[c]) { throw new Error('Unknown city ' + c); }
  });
  layers.forEach(function (l) {
    if (BASE_LAYERS.indexOf(l) < 0 && EXT_LAYERS.indexOf(l) < 0) {
      throw new Error('Unknown layer ' + l + '. Valid: ' +
                      BASE_LAYERS.concat(EXT_LAYERS).join(', '));
    }
  });

  if (PRODUCT === 'table' && MODE !== 'check') {
    print('S2_SHARPEN = ' + S2_SHARPEN + ', Drive folder ' + tableFolder() +
          '. Layers that depend on it: ' + SHARPEN_AFFECTED.join(', '));
  }
  cities.forEach(function (city) {
    var cfg = cityConfig(city);
    if (MODE === 'check') {
      checkCity(city, cfg);
    } else if (MODE === 'dry' || MODE === 'export') {
      if (PRODUCT === 'patches') {
        exportPatches(city, cfg);
      } else if (PRODUCT === 'cube') {
        months.forEach(function (m) { exportCubeMonth(city, cfg, m); });
      } else {
        layers.forEach(function (layer) { exportLayer(city, cfg, layer); });
      }
    } else {
      throw new Error("MODE must be 'check', 'dry' or 'export'");
    }
  });

  if (MODE === 'export') {
    print('Tasks created. Start them from the Tasks tab.');
  }
}

run();