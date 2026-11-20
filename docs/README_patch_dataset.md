# Building height patches for a CNN (eight Brazilian cities)

Cities: Porto Alegre, São Paulo, Rio de Janeiro, Belo Horizonte, Salvador, Recife, Curitiba, Niterói.

Two sets, one TFRecord file per city and set (GZIP-compressed), kept in separate folders:

| set | folder | file | records |
|---|---|---|---|
| training / validation (stratified by height) | `patch_dataset/` | `<city>_dataset.tfrecord.gz` | every training-side point of the city; filter on `split` (below) |
| test (natural height distribution) | `patch_dataset_natural/` | `<city>_test_dataset.tfrecord.gz` | 1,100 per city (1,000 buildings + 100 background) |

The exact count per city and split is in `patch_counts.csv` in each folder.

Each record is one 33 x 33 pixel patch (10 m pixels, 330 m on a side) centred on a sample point, with
Sentinel-1/2 inputs and building-height targets derived from LiDAR (nDSM) and building footprints.
Both sets have exactly the same record format.

## What is in each record

| key | shape (flat length) | meaning |
|---|---|---|
| `x` | 48 x 33 x 33 (52,272) | model inputs, see channel order below |
| `y` | 3 x 33 x 33 (3,267) | dense targets, see below |
| `height_m` | 1 | scalar label of the sample point (area-weighted mean building height within 50 m) |
| `is_background` | 1 | 1 for the zero-height points sampled at least 100 m from any building |
| `x_m`, `y_m` | 1 | coordinates of the sample point, UTM metres in the city's zone (table below) |
| `block_x`, `block_y` | 1 | 2,560 m spatial block indices |
| `sample_id`, `city` | 1 | identifiers (bytes). Test ids contain `_nat_` |
| `split` | 1 | bytes: `train`, `unused`, `excluded` or `test` (see below) |

Arrays are stored flat in row-major order. Reshape to `[channels, 33, 33]`.

### `split` values

* `train`: the balanced training set (the same rows the classical models use). Use only these for training, validation and tuning.
* `unused`: Porto Alegre, São Paulo and Rio de Janeiro points the rebalancing left out (mostly short buildings, so that no
  city dominates any height slice). They stay in the files but are **not** part of the training set. Do not train on them.
* `excluded`: a training-side point within 50 m of a test point. Never train, validate or tune on them.
* `test`: all records in the test files. Use only for the final evaluation.

The loader below keeps only `train`, which drops `unused` and `excluded` in one step.

Training-side records per old city: Porto Alegre 1,579 train + 2,440 unused + 130 excluded = 4,149; São Paulo
2,906 + 3,758 + 41 = 6,705; Rio de Janeiro 2,976 + 3,655 + 79 = 6,710. The five new cities have `train` and `excluded`
records only (360 excluded across the five). All `train` counts include the background points.

### UTM zones (WGS84) of the patch grids

| city | zone | EPSG |
|---|---|---|
| Porto Alegre, Curitiba | 22S | 32722 |
| São Paulo, Rio de Janeiro, Niterói, Belo Horizonte | 23S | 32723 |
| Salvador | 24S | 32724 |
| Recife | 25S | 32725 |

### Channel order of `x` (48)

Four seasons (S1 = Jan to Mar, S2 = Apr to Jun, S3 = Jul to Sep, S4 = Oct to Dec), each with 12 bands in this order:

`VV, VH, B2, B3, B4, B5, B6, B7, B8, B8A, B11, B12`

So channel `i` is season `i // 12`, band `i % 12`.

* Sentinel-1 (`VV`, `VH`): median of descending IW scenes, in dB.
* Sentinel-2 (`B2` ... `B12`): median surface reflectance (0 to 1) of Sen2Cor L2A scenes, after a per-pixel Cloud Score+ mask (`cs_cdf >= 0.6`). The 20 m bands (B5, B6, B7, B8A, B11, B12) are bilinearly resampled to 10 m.
* Time window: two years pooled per season (a season median uses both years), starting at the LiDAR year clamped to
  2019..2021: 2019 and 2020 for every city except Recife (LiDAR 2020), which uses 2020 and 2021.
* Nodata is `-9999` (a pixel with no clear observation in that season). Mask it, do not train on it as a value.

### Channels of `y` (3), same grid as `x`

0. `ndsm_mean`: mean nDSM over all valid LiDAR pixels in the 10 m cell (includes vegetation and other objects).
1. `bldg_height`: mean nDSM over only the LiDAR pixels inside a building footprint. `-9999` where the cell has no building.
2. `bldg_frac`: share of the cell covered by building footprints (0 to 1).

Negative nDSM values were clipped to 0. `-9999` marks cells with no nDSM or, for `bldg_height`, no building.
Use `bldg_height` with `bldg_frac` (or its mask) if you want building height only, or `ndsm_mean` for the raw nDSM.

### Geometry

North-up, 10 m pixels. The sample point lies in the centre pixel (row 16, column 16). The grid is anchored on multiples of 10 m
in the city's UTM zone. The Earth Engine arrays arrive south-up and were flipped to north-up before writing, for both `x` and `y`.

## Loading in TensorFlow

```python
import glob, tensorflow as tf
C_IN, C_OUT, S, NODATA = 48, 3, 33, -9999.0
PATCH_PX = 11        # width of the patch the model sees, odd, 3 to 33; the files hold 33 (see "Choosing the patch width")

spec = {"x": tf.io.FixedLenFeature([C_IN * S * S], tf.float32),
        "y": tf.io.FixedLenFeature([C_OUT * S * S], tf.float32),
        "height_m": tf.io.FixedLenFeature([1], tf.float32),
        "is_background": tf.io.FixedLenFeature([1], tf.float32),
        "x_m": tf.io.FixedLenFeature([1], tf.float32),
        "y_m": tf.io.FixedLenFeature([1], tf.float32),
        "block_x": tf.io.FixedLenFeature([1], tf.float32),
        "block_y": tf.io.FixedLenFeature([1], tf.float32),
        "sample_id": tf.io.FixedLenFeature([1], tf.string),
        "city": tf.io.FixedLenFeature([1], tf.string),
        "split": tf.io.FixedLenFeature([1], tf.string)}

def parse(rec):
    e = tf.io.parse_single_example(rec, spec)
    x = tf.transpose(tf.reshape(e["x"], [C_IN, S, S]), [1, 2, 0])      # (33, 33, 48), channels last
    y = tf.transpose(tf.reshape(e["y"], [C_OUT, S, S]), [1, 2, 0])     # (33, 33, 3)
    h = PATCH_PX // 2                                                  # centre crop, the point is at row/col 16
    x, y = x[16 - h:17 + h, 16 - h:17 + h], y[16 - h:17 + h, 16 - h:17 + h]
    return {"x": x, "y": y, "mask": tf.cast(y != NODATA, tf.float32),
            "height_m": e["height_m"][0], "city": e["city"][0],
            "block_x": e["block_x"][0], "block_y": e["block_y"][0],
            "sample_id": e["sample_id"][0], "split": e["split"][0]}

def load(folder, pattern):
    files = sorted(glob.glob(f"{folder}/{pattern}"))
    return tf.data.TFRecordDataset(files, compression_type="GZIP").map(parse)

train_all = load("patch_dataset", "*_dataset.tfrecord.gz")
ds = train_all.filter(lambda d: d["split"] == b"train")             # drops `unused` and `excluded`
test = load("patch_dataset_natural", "*_test_dataset.tfrecord.gz")  # final evaluation only
```

Replace `-9999` in `x` (for example with 0 plus a validity channel) and mask `y` in the loss.

## Splitting: use the classical models' folds

To compare and stack the CNN with the classical models, train and validate on **exactly the same five folds**. They are in
`folds.csv` (columns `sample_id, city, fold, block`; 16,954 rows, one per `train` record), shipped next to the patch folders.
It is identical to the folds of the classical spot-check and tuning runs. Look the fold up by `sample_id`:

```python
import pandas as pd
f = pd.read_csv("folds.csv")
fold_table = tf.lookup.StaticHashTable(
    tf.lookup.KeyValueTensorInitializer(tf.constant(f.sample_id.astype(str).values),
                                        tf.constant(f.fold.values, tf.int64)), default_value=-1)
ds = ds.map(lambda d: {**d, "fold": fold_table.lookup(d["sample_id"])})

k = 0                                                   # outer fold held out
val   = ds.filter(lambda d: d["fold"] == k)
train = ds.filter(lambda d: tf.logical_and(d["fold"] != k, d["fold"] >= 0))
```

Every `train` record has a fold (`-1` would mean a `sample_id` missing from `folds.csv`: stop and check). Tuning and early
stopping happen inside the training folds only; compute normalisation statistics on the training folds only (never on `test`).
Save the out-of-fold predictions as `sample_id, fold, cnn_pred` so they can enter the stacking step.

Neighbouring points are 50 m apart but patches are 110 to 330 m wide, so a random split would leak validation pixels into
training. The folds above are built from whole 2,560 m blocks, so a block is never split. Optionally drop training patches
within `PATCH_PX * 10` m of a held-out block's border to remove the remaining overlap.

## Choosing the patch width

The files hold 33 x 33 pixel patches (330 m), but the model does not have to use all of them.
`PATCH_PX` crops the centre, so the point stays in the middle pixel.

* `PATCH_PX = 11` (110 m): the same support as the classical models. The classic ML models' label and morphological features
  use a 50 m radius around the point, which fits inside 11 pixels. Use this for a like-for-like comparison with the classical
  models on the scalar label `height_m`.
* `PATCH_PX = 21` or `33`: more context than the classical models see. Fine as a comparison of patch widths on the same
  spatial folds, but a gain may come from the extra context and not from the model type.
* The dense targets `y` are a separate task (a height map per patch, as in Yadav et al.). Their pixels near the border of a
  small patch have little context, so use the full 33 for that task.

The width also sets how much test and training patches can overlap. Two square patches of width `PATCH_PX * 10` m share
no pixel only if their centres differ by at least that much in x or in y (Chebyshev distance). Report the test error on all
test records and on the "clean" ones whose patch holds no training point:

```python
dist = pd.concat([pd.read_csv(f"data/{c}/sample_points_natural_dist.csv") for c in CITIES])  # sample_id, dist_to_train_m, cheb_to_train_m
clean_ids = set(dist.sample_id[dist.cheb_to_train_m >= PATCH_PX * 10])
```

Distances must be measured to the `train` points only (not to `unused` ones, which are never trained on).

## Things to know about the data

* The training sampler picked the points by stratified 1 m height slices, so tall buildings are over-represented compared
  with the cities. Above 30 m every available point is used and the slices are not full; São Paulo and Rio de Janeiro supply
  about half of the points taller than 30 m. Validation scores inherit this.
* The test points follow each city's natural height distribution: most are 3 to 6 m and only a handful per city are above
  30 m. Do not quote per-class errors for the tallest classes on the test set; the validation folds are the place to judge
  tall buildings.
* Test and training patches can overlap (see above). Report it.
* LiDAR years: Porto Alegre 2010, Belo Horizonte 2013, São Paulo 2017, Salvador 2017, Rio de Janeiro 2019, Niterói 2019,
  Curitiba 2019, Recife 2020. The imagery is 2019 and 2020 (Recife 2020 and 2021), so the targets are least reliable where the gap is largest
  (Porto Alegre 9 years, Belo Horizonte 6).
* The height statistic behind `height_m` comes from the data providers and differs by city (median part height in Porto
  Alegre, São Paulo, Rio de Janeiro and Recife; closer to the mean in Curitiba and Salvador; near the 90th percentile in
  Belo Horizonte; the maximum in Niterói, where parts under 3 m were removed).
* Sentinel-1 observations per pixel over 2019 and 2020 differ between cities (about 60 in Rio, about 120 in Porto Alegre,
  120 to 180 in São Paulo; not yet counted for the five new cities).
* The nDSM includes vegetation. `ndsm_mean` is not building height.
* São Paulo's nDSM covers less ground than its footprints: 737 training patches and about 28% of the São Paulo test
  patches have no nDSM building cells near the point, so their dense `y` is `-9999` there. Their scalar `height_m` is fine.
* Fold sizes differ (about 2,900 to 4,000 records) because whole blocks go to one fold; height classes are balanced across folds.
