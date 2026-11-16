# My-HTML-APP

- `gear/` — 器材库：个人拍摄器材库网页应用（数据存本机，可离线使用）
- `gear-android/` — 把 `gear/` 打包成安卓安装包的外壳工程；运行 `build.sh` 生成 APK。`gearkit.keystore` 是签名密钥（密码 gearkit），以后更新必须用同一把密钥签名，否则手机上要先卸载才能安装
