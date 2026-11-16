"""重写 APK，使未压缩的条目按 4 字节对齐（等同 zipalign 4）。用法：zipalign.py in.apk out.apk"""
import sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, 'w') as zout:
    for o in zin.infolist():
        zi = zipfile.ZipInfo(o.filename, date_time=(1980, 1, 1, 0, 0, 0))
        zi.compress_type, zi.external_attr = o.compress_type, o.external_attr
        if o.compress_type == zipfile.ZIP_STORED:
            off = zout.fp.tell() + 30 + len(o.filename.encode())
            zi.extra = b'\0' * ((-off) % 4)
        zout.writestr(zi, zin.read(o))
