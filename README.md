# 10m resolution building height from Sentinel-1/2 in Brazilian cities

Code for the CMP263 (UFRGS) course paper by Guilherme Iablonovski, Thiago Leão and Matheus Pessoa.
The main goal is to predict building heights in a Global South context by feeding Sentinel-1/2 derived features (x) and LiDAR-derived height labels (y) to Machine Learning and Deep Learning models. The feature engineering steps follow the one proposed by Frantz et al. (2021, *Remote Sensing of Environment* 252, 112128) through spectral-temporal metrics and morphological features from Sentinel-1/2. The study areas comprise of eight major Brazilian cities: Porto Alegre, São Paulo, Rio de Janeiro, Belo Horizonte, Salvador, Recife, Curitiba and Niterói.

The pipeline has three steps, run in this order, plus the CNN (Step 3, in `cnn/`). **Step 0 (feature engineering) cannot be run from this repository alone**, because it needs the municipal building footprints and nDSM (LiDAR) rasters, which are not redistributed. Steps 1 and 2 start from the shipped features table and can be fully rerun.

![Comparison over Porto Alegre](cover.png)

## Steps

### Step 0. Feature engineering (needs external data)

Builds the sample points and labels from the footprints and nDSMs, extracts the 1,872 Sentinel-1/2 features in Earth Engine,
and merges them into the features table. **It cannot be run without the raw data**: download the footprints and LiDAR from the
city hall portals listed in `data/SOURCES.md` and place them in `data_raw/`. It also needs an Earth Engine account (scripts in `gee/`; set `ASSET_ROOT` to your own project).

To skip it, use the features table we ship: 36,217 rows x 1,872 features, published on Zenodo
(together with the CNN patch tensors).

Notebooks: `01_create_sample_points`, `02_merge_gee_exports`, `03_create_cnn_patches` (the CNN patch dataset) and `04_descriptive_statistics` (descriptive figures and tables of the dataset, built from the features table that steps 01 to 03 produce; section 1 runs from the shipped table).

### Step 1. Spot check

Eight algorithms are tested with default hyper-parameters on the features table, with spatial 5-fold cross-validation.
Notebook: `05_spot_checking`. Runs from the shipped table.

### Step 2. Tuning, training and testing

Nested spatial CV tuning of HistGB and SVR, stacking, final model and natural test evaluation, interpretation, radar importance check and
leave-one-city-out (`06_tuning_and_final_model`), then the full-city maps and building-stock check (`07_full_city_maps`).
Notebook 06 runs from the shipped table; notebook 07 also needs the Earth Engine map exports and the raw data of Step 1.

### Step 3. Small CNN

A U-Net that predicts a dense height map from 33 x 33 patches (4 seasons x Sentinel-1 VV/VH and ten Sentinel-2 bands, 48 channels).
It lives in `cnn/` with its own Docker image (TensorFlow 2.15, which conflicts with the main environment) and uses the same
spatial folds as Steps 1 and 2 (`data/folds.csv`). See `cnn/README.md`. Classical ML remains the core of the paper.

## Quick start (Steps 1 and 2)

```bash
conda env create -f environment.yml          # Python 3.13, scikit-learn 1.7.2
conda activate sentinel-heights-brazil
jupyter lab                                  # open notebooks/05_spot_checking.ipynb, then 06_...
```

Start Jupyter from the repository root or from `notebooks/`; every notebook finds `notebooks/config.py` either way. All
paths are in that one file and can be moved with environment variables (`FRANTZ_DATA`, `FRANTZ_RAW`, `FRANTZ_GEE`,
`FRANTZ_OUT`), for example to keep the large `outputs/` on an external disk.

To check the algorithm structure in minutes before the long run, set `FAST = True` in the config cell of notebook 05 or 06.

## Notebooks

| Step | # | Notebook | Needs | Runtime (full run) |
|---|---|---|---|---|
| 0. Feature engineering | 01 | `01_create_sample_points` | raw data (footprints, nDSM) | minutes per city |
| 0. Feature engineering | 02 | `02_merge_gee_exports` | Earth Engine exports | seconds |
| 0. Feature engineering | 03 | `03_create_cnn_patches` | raw data, GEE patches, TensorFlow | minutes per city |
| 0. Feature engineering | 04 | `04_descriptive_statistics` | features table (section 1); Earth Engine and footprints (sections 2 and 3, optional) | minutes |
| 1. Spot check | 05 | `05_spot_checking` | features table | hours (SVR about 10 min per fold, random forest about 5 min per fold) |
| 2. Tuning | 06 | `06_tuning_and_final_model` | features table | many hours (one HistGB outer fold took 21 to 86 min) |
| 2. Tuning | 07 | `07_full_city_maps` | notebook 06 models, GEE map exports, raw data | tens of minutes per city |
| 3. CNN | C0 | `cnn/notebooks/cnn_00_experiment_summary` | shipped tables only | seconds |
| 3. CNN | C1 | `cnn/notebooks/cnn_01_baseline` | CNN tensors, GPU | hours |
| 3. CNN | C2 | `cnn/notebooks/cnn_02_architecture_search` | CNN tensors, GPU, synthetic patches | many hours |
| 3. CNN | C3 | `cnn/notebooks/cnn_03_context_scale` | CNN tensors, GPU | hours |
| 3. CNN | C4 | `cnn/notebooks/cnn_04_multitask_height` | CNN tensors, GPU | hours |

## Method in brief

![Summary](summary.png)

* **Label:** area-weighted mean height of the building parts whose centroid lies within 50 m of the pixel.
* **Features:** 18 layers (Sentinel-1 VV, VH; ten Sentinel-2 bands; six indices) x 13 spectral-temporal metrics x 8 morphological operators within 50 m = 1,872.
* **Spatial CV:** `StratifiedGroupKFold(5)`, groups = city + 2,560 m block, strata = height classes [2, 6, 15, 30] m.
  Scaling, imputation, feature selection and tuning are fitted inside the training folds only. The natural test set is read only for the final evaluation.
* **Tuning:** nested, 3 inner folds; HistGB (25 random-search candidates) and SVR (12), macro RMSE as the criterion;
  ensembles are the plain mean and a non-negative linear stacker fitted on inner out-of-fold predictions.

## Expected results

* Nested CV, macro RMSE in m: mean of HistGB and SVR 7.08; stack of all four tuned variants 7.18; HistGB 7.26; SVR 7.27; HistGB weighted 7.44; SVR weighted 7.89.
* Natural test set, final model: RMSE 4.06 m, macro RMSE 6.72 m, bias +2.05 m.
* Full-city maps, building volume (map minus LiDAR reference, footprints from the reference): total error +45.8% (Porto Alegre), +59.7% (São Paulo), +20.3% (Recife).

## Repository layout

```
notebooks/    config.py and the seven notebooks
cnn/          CNN: Dockerfile, cnn_setup.py, four notebooks (own README)
gee/          Earth Engine Code Editor scripts (JavaScript): features, map features, CNN inputs
data/         small shipped inputs, README.md, SOURCES.md
data_raw/     NOT in the repo: footprints, nDSMs, boundaries
gee_exports/  NOT in the repo: downloads from Google Drive
outputs/      everything the notebooks write
```

## Citation and licence

Frantz, D., Schug, F., Okujeni, A., Navacchi, C., Wagner, W., van der Linden, S., & Hostert, P. (2021). National-scale
mapping of building height using Sentinel-1 and Sentinel-2 time series. *Remote Sensing of Environment*, 252, 112128.
https://doi.org/10.1016/j.rse.2020.112128
