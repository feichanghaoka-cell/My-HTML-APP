"""把 APK 重新打包：未压缩的条目按 4 字节对齐（Android 11+ 要求 resources.arsc 如此）。
用法：zipalign.py in.apk out.apk"""
import struct
import sys
import zipfile

STORED_SUFFIXES = ('.arsc', '.png')

src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as zin, open(dst, 'wb') as raw:
    with zipfile.ZipFile(raw, 'w') as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            info = zipfile.ZipInfo(item.filename, date_time=(2020, 1, 1, 0, 0, 0))
            info.external_attr = item.external_attr
            stored = item.filename.endswith(STORED_SUFFIXES)
            info.compress_type = zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED
            if stored:
                # 本地文件头 30 字节 + 文件名 + extra，之后才是数据
                start = raw.tell() + 30 + len(item.filename.encode('utf-8'))
                pad = (4 - start % 4) % 4
                if pad:
                    # 用一个无意义的 extra 字段补齐（头 4 字节 + 内容）
                    pad_len = pad if pad >= 4 else pad + 4
                    info.extra = struct.pack('<HH', 0xD935, pad_len - 4) + b'\0' * (pad_len - 4)
            zout.writestr(info, data)
