"""Convert the merged features table (CSV from notebook 02) to the float32 parquet that is shipped.

    python scripts/make_release_table.py data/features_full_1872_split.csv [data/features_full_1872_split.parquet]

Features become float32 (the notebooks cast them to float32 anyway), metadata keep their types. Prints the SHA-256
to paste into scripts/download_data.py.
"""
import hashlib
import pathlib
import sys

import pandas as pd

META = ["sample_id", "city", "height_m", "is_background", "x_m", "y_m", "split"]


def main():
    src = pathlib.Path(sys.argv[1])
    dst = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else src.with_suffix(".parquet")
    df = pd.read_csv(src)
    feats = [c for c in df.columns if c not in META]
    df[feats] = df[feats].astype("float32")
    df.to_parquet(dst, index=False, compression="zstd")
    h = hashlib.sha256(dst.read_bytes()).hexdigest()
    print(f"{dst}: {len(df)} rows, {len(feats)} features, {dst.stat().st_size / 1e6:.1f} MB\nsha256 {h}")


if __name__ == "__main__":
    main()
