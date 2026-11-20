"""Paths and spatial folds shared by the CNN notebooks.

Folders (each can be moved with an environment variable):

  data/cnn/                          FRANTZ_PATCHES   the CNN tensors (Zenodo, see data/README.md):
      patch_dataset_train/*.tfrecord.gz
      patch_dataset_test/*.tfrecord.gz
      <city>/sample_points_natural_dist.csv
  outputs/cnn/                       FRANTZ_OUT       MLflow databases, models, figures, synthetic patches

Folds: the CNN uses the SAME outer folds as the classical models (data/folds.csv). A patch is
identified by its block id f"{city}_{bx}_{by}" (bx, by = block coordinates stored in the TFRecord);
folds.csv has one row per sample with that block id and its fold. Every block sits in exactly one fold.
"""
import os
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(os.environ.get("FRANTZ_ROOT", Path(__file__).resolve().parent.parent))
DATA_DIR = Path(os.environ.get("FRANTZ_DATA", ROOT / "data"))
PATCH_DIR = Path(os.environ.get("FRANTZ_PATCHES", DATA_DIR / "cnn"))
OUT = Path(os.environ.get("FRANTZ_OUT", ROOT / "outputs")) / "cnn"
OUT.mkdir(parents=True, exist_ok=True)

TRAIN_DIR = PATCH_DIR / "patch_dataset_train"
TEST_DIR = PATCH_DIR / "patch_dataset_test"
DIST_GLOB = PATCH_DIR / "*" / "sample_points_natural_dist.csv"
FOLDS_CSV = DATA_DIR / "folds.csv"

_BLOCK_FOLD = None


def _block_fold():
    global _BLOCK_FOLD
    if _BLOCK_FOLD is None:
        f = pd.read_csv(FOLDS_CSV)
        assert f.groupby("block")["fold"].nunique().max() == 1, "a block appears in two folds"
        _BLOCK_FOLD = dict(zip(f["block"], f["fold"].astype(int)))
    return _BLOCK_FOLD


def fold_of(city, bx, by, k=5):
    """Outer fold (0..4) of each patch, read from data/folds.csv. Raises KeyError for a block that is not
    in the training table (for example test patches), so a wrong split cannot pass silently."""
    assert k == 5, "data/folds.csv was built with 5 folds"
    m = _block_fold()
    return np.array([m[f"{c}_{int(a)}_{int(b)}"] for c, a, b in zip(city, bx, by)])
