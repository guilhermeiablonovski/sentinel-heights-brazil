"""Download the features table (too large for GitHub) from Zenodo into data/.

    python scripts/download_data.py

EDIT the two constants below once the Zenodo record exists (the record is not created yet).
"""
import hashlib
import pathlib
import sys
import urllib.request

ZENODO_URL = "https://zenodo.org/records/XXXXXXX/files/features_full_1872_split.parquet"   # TODO: fill in after upload
SHA256 = ""                                                                                  # TODO: from scripts/make_release_table.py
DEST = pathlib.Path(__file__).resolve().parent.parent / "data" / "features_full_1872_split.parquet"


def main():
    if "XXXXXXX" in ZENODO_URL:
        sys.exit("The Zenodo record is not set yet: edit ZENODO_URL and SHA256 in scripts/download_data.py, "
                 "or place features_full_1872_split.parquet in data/ by hand.")
    DEST.parent.mkdir(exist_ok=True)
    print("downloading", ZENODO_URL)
    urllib.request.urlretrieve(ZENODO_URL, DEST)
    h = hashlib.sha256(DEST.read_bytes()).hexdigest()
    if SHA256 and h != SHA256:
        DEST.unlink()
        sys.exit(f"checksum mismatch: got {h}, expected {SHA256}")
    print("ok:", DEST, f"({DEST.stat().st_size / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()
