# Mabi Config FPS Fix

마비노기 설정 파일의 `DummyCharRenderModeFPS` 값을 `-1`로 변경해 간소화 기능이 항상 작동하도록 도와주는 도구입니다. 게임에서 내보낸 `.muo` 파일을 수정한 뒤 `문서\마비노기\설정\목록` 폴더에 넣고 `환경설정 → 환경설정 내보내기/가져오기`의 가져오기 버튼으로 적용합니다.

## 웹 페이지

- GitHub Pages: https://mabinewb.github.io/mabi-config-fps-fix/

## 포함 내용

- `docs/`: GitHub Pages용 웹 앱
- `mabi_fps_fix_tool.py`: Windows용 간단 GUI 도구
- `mabiconfig_codec.py`: 설정 파일 인코딩/디코딩 로직

## 웹 앱 배포

GitHub Pages는 `docs/` 폴더를 기준으로 배포합니다.
