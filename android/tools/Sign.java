import com.android.apksig.ApkSigner;

import java.io.File;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.Collections;

/** 用法：Sign <keystore.p12> <密码> <别名> <in.apk> <out.apk> */
public class Sign {
    public static void main(String[] a) throws Exception {
        KeyStore ks = KeyStore.getInstance("PKCS12");
        try (FileInputStream in = new FileInputStream(a[0])) {
            ks.load(in, a[1].toCharArray());
        }
        PrivateKey key = (PrivateKey) ks.getKey(a[2], a[1].toCharArray());
        X509Certificate cert = (X509Certificate) ks.getCertificate(a[2]);
        ApkSigner.SignerConfig signer = new ApkSigner.SignerConfig.Builder(
                "nuanliu", key, Collections.singletonList(cert)).build();
        new ApkSigner.Builder(Collections.singletonList(signer))
                .setInputApk(new File(a[3]))
                .setOutputApk(new File(a[4]))
                .setV1SigningEnabled(false) // 最低支持 Android 8，只需要 v2 签名
                .setV2SigningEnabled(true)
                .build()
                .sign();
    }
}
