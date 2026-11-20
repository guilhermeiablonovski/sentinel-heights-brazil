"""Write the point files to upload to Earth Engine (Tier B of the README), from the shipped features table.

    python scripts/make_gee_point_assets.py [--out outputs/gee_point_assets]

For each city it writes
    <city>_sample_points_selected_wgs84.csv  training points (split train, excluded, unused: the rows that were exported)
    <city>_sample_points_natural_wgs84.csv   natural test points (split test)
with columns sample_id, city, height_m, is_background, x_m, y_m, lon, lat.
Upload each CSV in the Earth Engine Code Editor (Assets > New > Table upload, X column = lon, Y column = lat) under
<ASSET_ROOT>/frantz_replication/ with exactly that name (without .csv), then run gee/export_frantz_features.js
with POINTS_SET = 'train' and again with 'natural'.
x_m, y_m are metres in the UTM zone of the city (config.EPSG); lon, lat are computed here with pyproj.
"""
import argparse
import pathlib
import sys

import pandas as pd
from pyproj import Transformer

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "notebooks"))
import config  # noqa: E402

COLS = ["sample_id", "city", "height_m", "is_background", "x_m", "y_m"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(config.OUT_DIR / "gee_point_assets"))
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    t = config.read_table(usecols=COLS + ["split"])
    for city, g in t.groupby("city"):
        tr = Transformer.from_crs(config.EPSG[city], 4326, always_xy=True)
        g = g.copy()
        g["lon"], g["lat"] = tr.transform(g.x_m.to_numpy(), g.y_m.to_numpy())
        for tag, mask in (("sample_points_selected_wgs84", g.split != "test"), ("sample_points_natural_wgs84", g.split == "test")):
            d = g[mask][COLS + ["lon", "lat"]]
            d.to_csv(out / f"{city}_{tag}.csv", index=False)
            print(f"{city}_{tag}.csv: {len(d)} points")
    print("written to", out)


if __name__ == "__main__":
    main()
