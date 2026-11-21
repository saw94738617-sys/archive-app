# 아카이브 (ARCHIVE)

옷 구매 기록 · 위시리스트 안드로이드 앱.

- `www/` 앱 화면 (index.html + real.js)
- `assets/` 앱 아이콘 · 시작 화면 원본
- `.github/workflows/build-apk.yml` main에 올리면 GitHub이 APK를 만들어 Releases에 올림

서명 키(`archive-release.jks`)는 저장소에 넣지 않음. GitHub Secrets의 `ARCHIVE_KEYSTORE_B64`, `ARCHIVE_KEYSTORE_PASS`로만 씀.
서명 키를 잃어버리면 같은 앱으로 업데이트할 수 없으니 따로 보관할 것.
