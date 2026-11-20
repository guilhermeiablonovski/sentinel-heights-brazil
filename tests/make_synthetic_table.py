"""Synthetic stand-in for data/features_full_1872_split.* with the same columns and column order, for smoke tests only.
The numbers are random (height depends weakly on a few features); nothing here says anything about the real results.

    python tests/make_synthetic_table.py --out /tmp/synth/features_full_1872_split.parquet [--rows 1200]
"""
import argparse
import pathlib

import numpy as np
import pandas as pd

S2 = ["B2", "B3", "B4", "B5", "B6", "B7", "B8", "B8A", "B11", "B12"]
LAYERS = ["VV", "VH"] + S2 + ["NDVI", "TCG", "NDBI", "TCB", "TCW", "mNDWI"]
STATS = ["mean", "stdDev", "p0", "p10", "p25", "p50", "p75", "p90", "p100", "skew", "kurtosis", "range", "IQR"]
OPS = ["ERO", "DIL", "OPN", "CLS", "GRD", "THT", "BHT"]
CITIES = ["porto_alegre", "sao_paulo", "rio_de_janeiro", "belo_horizonte", "salvador", "recife", "curitiba", "niteroi"]


def feature_names():
    stm = [f"{l}_{s}" for l in LAYERS for s in STATS]
    return stm + [f"{n}_{o}" for n in stm for o in OPS]          # 18 x 13 x 8 = 1,872


def make(rows=1200, seed=0):
    rng = np.random.default_rng(seed)
    names = feature_names()
    assert len(names) == 1872
    city = rng.choice(CITIES, rows)
    h = np.clip(rng.gamma(2.0, 5.0, rows) + 3, 3, 90)
    X = rng.normal(size=(rows, len(names))).astype("float32")
    for j in rng.choice(len(names), 25, replace=False):           # a few informative features
        X[:, j] += (h - h.mean()) / h.std() * rng.uniform(0.3, 1.0)
    X[rng.random(X.shape) < 0.02] = np.nan                          # a little missing data
    ix = np.arange(rows)
    meta = pd.DataFrame({
        "sample_id": [f"{c}_{i:06d}" for c, i in zip(city, ix)],
        "city": city, "height_m": h, "is_background": (rng.random(rows) < 0.03).astype(int),
        "x_m": 300000 + rng.uniform(0, 60000, rows), "y_m": 7000000 + rng.uniform(0, 60000, rows)})
    meta.loc[meta.is_background == 1, "height_m"] = 0.0
    split = np.full(rows, "train", dtype=object)
    split[rng.random(rows) < 0.12] = "test"
    split[(split == "train") & (rng.random(rows) < 0.04)] = "excluded"
    split[(split == "train") & (rng.random(rows) < 0.10)] = "unused"
    meta["split"] = split
    return pd.concat([meta, pd.DataFrame(X, columns=names)], axis=1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--rows", type=int, default=1200)
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    df = make(a.rows)
    if out.suffix == ".parquet":
        df.to_parquet(out, index=False)
    else:
        df.to_csv(out, index=False)
    print(out, df.shape, df.split.value_counts().to_dict())
