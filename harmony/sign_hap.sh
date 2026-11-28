#!/usr/bin/env bash
# ============================================================================
# HGhub 0.0.5 · HarmonyOS HAP 签名（发布证书版）
# ----------------------------------------------------------------------------
# 默认参数已就位，直接跑无参数即可出签名包：
#   bash sign_hap.sh
#
# 也可以自己指定证书/Profile/密钥库：
#   bash sign_hap.sh <证书.cer> <Profile.p7b> [密钥库.p12] [alias] [密码]
#
# 两套证书的区别：
#   发布证书 → Profile 类型选「发布」，不需要设备 UDID，可在任意鸿蒙设备侧载
#   调试证书 → Profile 类型选「调试」，必须绑定手机 UDID，只能装绑过的那台
# 本项目已签发发布证书，所以默认走发布那套。
# ============================================================================
set -uo pipefail

KS_DIR="E:/HGhub-v005/交付/签名材料"
CERT="${1:-$KS_DIR/hghub-release.cer}"
PROFILE="${2:-$KS_DIR/hghub-release.p7b}"
KEYSTORE="${3:-$KS_DIR/hghub-release.p12}"
KEY_ALIAS="${4:-hghub-release}"
KEY_PWD="${5:-Hghub@2026}"
KS_PWD="${5:-Hghub@2026}"

SIGNER="E:/ohsdk3/sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar"
IN_HAP="E:/HGhub-v005/交付/HGhub_0.0.5_harmony_arm64_unsigned.hap"
OUT_HAP="E:/HGhub-v005/交付/HGhub_0.0.5_harmony_arm64_signed.hap"

for f in "$CERT" "$PROFILE" "$KEYSTORE" "$IN_HAP" "$SIGNER"; do
  if [ ! -f "$f" ]; then echo "!! 文件不存在：$f"; exit 1; fi
done

echo "==> 签名中..."
echo "    证书   : $CERT"
echo "    Profile: $PROFILE"
echo "    密钥库 : $KEYSTORE (alias=$KEY_ALIAS)"
java -jar "$SIGNER" sign-app \
  -keyAlias "$KEY_ALIAS" \
  -signAlg "SHA256withECDSA" \
  -mode "localSign" \
  -appCertFile "$CERT" \
  -profileFile "$PROFILE" \
  -inFile "$IN_HAP" \
  -keystoreFile "$KEYSTORE" \
  -outFile "$OUT_HAP" \
  -keyPwd "$KEY_PWD" \
  -keystorePwd "$KS_PWD"

if [ ! -f "$OUT_HAP" ]; then
  echo "!! 签名失败：检查证书与 Profile 是否同一把密钥、Profile 里的包名是否 com.hghub.player"
  exit 1
fi

echo "==> 校验签名"
java -jar "$SIGNER" verify-app -inFile "$OUT_HAP" \
  -outCertChain "E:/hgport/out.cer" -outProfile "E:/hgport/out.p7b" 2>&1 | tail -5

echo "==> 完成：$OUT_HAP"
ls -lh "$OUT_HAP"
sha256sum "$OUT_HAP"
echo
echo "装机（鸿蒙设备开 USB 调试并连电脑）："
echo "  \"E:/ohsdk3/sdk/default/openharmony/toolchains/hdc.exe\" install -r \"$OUT_HAP\""
