"""Where every notebook finds its inputs and writes its outputs. One file, no hardcoded paths elsewhere.

Folders (relative to the repository root; each can be moved with an environment variable):

  data/          small inputs: shipped with the repo or downloaded from Zenodo (see data/README.md)
                 (features table, folds.csv, selected_features.txt, ...)           FRANTZ_DATA
  data_raw/      NOT in the repo: building footprints, nDSM rasters, municipal boundaries.
                 Layout:  _footprints/<city>.gpkg   _ndsm/<city>.tif   _boundaries/<city>.gpkg
                 Where to get them: data/SOURCES.md                                   FRANTZ_RAW
  gee_exports/   files you download from Google Drive after running the Earth Engine
                 scripts in gee/ (folders frantz_features, frantz_features_natural,
                 frantz_patches, frantz_patches_natural, frantz_map_features,
                 frantz_map_cnn_inputs)                                               FRANTZ_GEE
  outputs/       everything the notebooks write (git-ignored)                          FRANTZ_OUT

Example: to keep the big folders on an external disk,
    export FRANTZ_OUT=/Volumes/disk/frantz_outputs FRANTZ_RAW=/Volumes/disk/PhD_data
"""
import os
from pathlib import Path

import pandas as pd

ROOT = Path(os.environ.get("FRANTZ_ROOT", Path(__file__).resolve().parent.parent))
DATA_DIR = Path(os.environ.get("FRANTZ_DATA", ROOT / "data"))
RAW_DIR = Path(os.environ.get("FRANTZ_RAW", ROOT / "data_raw"))
GEE_DIR = Path(os.environ.get("FRANTZ_GEE", ROOT / "gee_exports"))
OUT_DIR = Path(os.environ.get("FRANTZ_OUT", ROOT / "outputs"))

CITIES = ["porto_alegre", "sao_paulo", "rio_de_janeiro", "belo_horizonte",
          "salvador", "recife", "curitiba", "niteroi"]
EPSG = {"porto_alegre": 32722, "curitiba": 32722, "sao_paulo": 32723, "rio_de_janeiro": 32723,
        "niteroi": 32723, "belo_horizonte": 32723, "salvador": 32724, "recife": 32725}

# ---- inputs shipped / downloaded -------------------------------------------------------------
FOLDS_CSV = DATA_DIR / "folds.csv"                          # sample_id -> outer fold (16,954 training rows)
SELECTED_FEATURES = DATA_DIR / "selected_features.txt"      # the 187 bands of the map model
UNUSED_IDS = DATA_DIR / "unused_existing_ids.csv"           # rows the rebalancing left out (split = unused)


def _find_table():
    for name in ("features_full_1872_split.parquet", "features_full_1872_split.csv.gz", "features_full_1872_split.csv"):
        if (DATA_DIR / name).exists():
            return DATA_DIR / name
    return DATA_DIR / "features_full_1872_split.parquet"    # reported in the error message below


TABLE = _find_table()      # 36,217 rows: sample_id, city, height_m, is_background, x_m, y_m, split + 1,872 features


def read_table(usecols=None, nrows=None):
    """Read the features table whatever its format (.parquet, .csv.gz or .csv)."""
    if not TABLE.exists():
        raise FileNotFoundError(
            f"{TABLE} not found. Download it from https://zenodo.org/records/24416362 "
            f"(see data/README.md), or rebuild it with notebooks 01 to 02 if you have the raw data.")
    if TABLE.suffix == ".parquet":
        import pyarrow.parquet as pq
        if nrows is not None:
            names = pq.ParquetFile(TABLE).schema_arrow.names
            cols = [c for c in names if usecols is None or c in usecols]
            if nrows == 0:
                return pd.DataFrame(columns=cols)
            return next(pq.ParquetFile(TABLE).iter_batches(batch_size=nrows, columns=cols)).to_pandas()
        return pd.read_parquet(TABLE, columns=list(usecols) if usecols is not None else None)
    return pd.read_csv(TABLE, usecols=usecols, nrows=nrows)


# ---- raw municipal data (not in the repo) ----------------------------------------------------
FOOTPRINTS = lambda city: str(RAW_DIR / "_footprints" / f"{city}.gpkg")
NDSM = lambda city: str(RAW_DIR / "_ndsm" / f"{city}.tif")
BOUNDARY = lambda city: str(RAW_DIR / "_boundaries" / f"{city}.gpkg")

# ---- Earth Engine exports downloaded from Drive ----------------------------------------------
GEE_FEATURES = str(GEE_DIR / "frantz_features")
GEE_FEATURES_NATURAL = str(GEE_DIR / "frantz_features_natural")
GEE_PATCHES = str(GEE_DIR / "frantz_patches")
GEE_PATCHES_NATURAL = str(GEE_DIR / "frantz_patches_natural")
GEE_MAP_FEATURES = str(GEE_DIR / "frantz_map_features")
GEE_MAP_CNN_INPUTS = str(GEE_DIR / "frantz_map_cnn_inputs")

# ---- everything the notebooks write ------------------------------------------------------------
OUT = str(OUT_DIR)


def out(*parts):
    """OUT_DIR/<parts...>, folder created."""
    p = OUT_DIR.joinpath(*parts)
    p.mkdir(parents=True, exist_ok=True)
    return str(p)
