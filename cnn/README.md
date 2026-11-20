# cnn/: optional small CNN (Step 3)

Dense building height from 33 x 33 patches with 48 channels (4 seasons x [VV, VH, B2, B3, B4, B5, B6, B7, B8, B8A, B11, B12]).
Targets per pixel: LiDAR nDSM mean, building height, building fraction. The network is trained on the building height with a masked
RMSE on log1p(m); metrics are reported per pixel, per building pixel and by height class (paper classes 2, 6, 15, 30 m).
Experiments are tracked with MLflow (SQLite databases under `outputs/cnn/`).

## Setup

The CNN needs TensorFlow 2.15 with numpy 1.26 and an NVIDIA GPU, which conflicts with the main environment, so it has its own image:

```bash
docker build -t sentinel-heights-cnn cnn/
docker run --gpus all -p 8888:8888 -v "$PWD":/tf sentinel-heights-cnn jupyter lab --ip 0.0.0.0 --allow-root --notebook-dir /tf
```

Requirements: Docker 24+, NVIDIA driver and NVIDIA Container Toolkit (`nvidia-smi` must work inside the container).

## Data

Download the CNN tensors from Zenodo (same record as the features table) into `data/cnn/`:

```
data/cnn/patch_dataset_train/*.tfrecord.gz
data/cnn/patch_dataset_test/*.tfrecord.gz
data/cnn/<city>/sample_points_natural_dist.csv
```

They are built by `notebooks/03_create_cnn_patches` from the Earth Engine patch exports. Paths live in `cnn/cnn_setup.py`
(`FRANTZ_PATCHES` and `FRANTZ_OUT` move them).

## Folds

The CNN uses the same outer folds as the classical models, read from `data/folds.csv` through `cnn_setup.fold_of`
(block id `city_bx_by`). Fold 0 is the hold-out, fold 1 the inner validation (early stopping and model selection), folds 2 to 4 train.
This makes CNN predictions comparable with the classical results and usable in the stack by `sample_id`.

**Deviation from the original CNN experiments:** they used a CRC32 hash of the block id for the folds (about 18% agreement with
`folds.csv`, i.e. chance). Their reported numbers (for example hold-out RMSE_px 8.75 m for the selected U-Net) belong to that old
split and must be re-run before being compared with the classical models.

## Final model

The CNN reported in the paper is the multi-task U-Net of `cnn_04_multitask_height` (footprint head plus 32-bin height head, backbone `u48_c2`:
filters 48/96/192, two convolutions per block, no attention), chosen by Thiago Leão. It is the two-output model, not the attention variants
(squeeze-and-excitation and temporal attention were tested in `cnn_02_architecture_search` and did not beat the plain backbone).
It must be re-run on the shared folds before any number is reported.

## Notebooks (run from the repository root or `cnn/notebooks`)

| Notebook | What |
|---|---|
| `cnn_00_experiment_summary` | Decision record: fold comparison, architecture search, context size, synthetic data, multi-task result. Runs from `cnn/results/*.csv` and `data/folds.csv`, no GPU |
| `cnn_01_baseline` | Baseline U-Net pipeline: folds, rotation augmentation, MLflow, validation and hold-out metrics, final test |
| `cnn_02_architecture_search` | Three-round U-Net search (filters, convolutions, squeeze-and-excitation, temporal attention, mixed loss), context experiment, hold-out, maps |
| `cnn_03_context_scale` | 3 x 3 mosaics of neighbouring patches (up to 99 x 99 px) to test larger context |
| `cnn_04_multitask_height` | Footprint head (BCE + Dice) plus a height head with 32 log-spaced bins in metres, trained where height > 0; prediction = p(building) x conditional height |

## Known issues

* Synthetic patches (SMOTE and cGAN) were generated from the old training set. `cnn_02_architecture_search` stops with an error on
  purpose if the normalisation statistics differ, so the generator notebook has to be re-run on the new training rows
  (hold-out and validation rows must never feed the generator). The generator notebook is not in this repository yet.
* `cnn_03_context_scale`: the 3 x 3 mosaic cell found 0 valid mosaics on the sparse sample points (the recorded run);
  larger context needs TFRecords exported at the larger size. The coordinate keys are now fixed to `x_m, y_m`; not run after this edit.
* The notebooks are in Portuguese (comments and prints).
* `cnn_04_multitask_height` reads the backbone from the latest `runs_cnn_iterative/*/config.json` and falls back to `u32_c2` if none exists; the final model uses `u48_c2`, so run notebook C2 first or set `BEST_SPEC` by hand.
* `cnn_00_experiment_summary` was executed here (outputs included). Apart from it, nothing in `cnn/` was run after the folds and paths were changed (no GPU or tensors here); syntax was checked only.
