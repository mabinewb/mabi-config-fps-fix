# Mabi FPS Fix Web

GitHub Pages에 바로 올릴 수 있는 정적 웹 앱임.

## 기능
- 게임에서 내보낸 `.muo` 설정 파일 업로드
- `DummyCharRenderModeFPS` 값을 `-1`로 변경
- 가져오기용 `_patched.muo` 파일 다운로드
- 모든 처리를 브라우저 안에서 수행

## 사용 흐름
1. 게임의 `환경설정 → 환경설정 내보내기/가져오기`에서 `내보내기` 버튼을 누르고 `환경설정 → 그래픽-효과`만 체크
2. `문서\마비노기\설정\목록`에 저장된 `.muo` 파일을 웹 앱에서 수정
3. 다운로드한 `_patched.muo` 파일을 `문서\마비노기\설정\목록` 폴더로 이동
4. 같은 메뉴의 `가져오기` 버튼을 누르고 `_patched.muo` 파일을 선택한 뒤 `환경설정 → 그래픽-효과`만 체크하여 적용

## GitHub Pages 배포 방법
1. 저장소에 `docs/` 폴더를 포함해 푸시
2. GitHub 저장소 설정에서 **Pages** 열기
3. **Build and deployment**의 Source를 **Deploy from a branch**로 선택
4. 브랜치와 폴더를 `main` / `docs`로 지정
5. 저장 후 배포 완료를 기다리기

## 파일 구성
- `index.html`: 화면 구조
- `styles.css`: UI 스타일
- `app.js`: 브라우저용 MUO 코덱 및 FPS 수정 로직
- `favicon.ico`: 페이지 아이콘

## 주의
- 압축/해제는 CDN으로 불러오는 `pako`를 사용함
- 외부 서버 업로드 없이 로컬 브라우저에서만 파일을 처리함
