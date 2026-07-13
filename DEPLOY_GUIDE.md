# 배포 가이드

## 1단계 — Firebase 프로젝트 만들기

1. https://console.firebase.google.com 접속 (Google 계정 로그인)
2. **프로젝트 추가** 클릭 → 이름 입력 (예: `club-reservation`)
3. 왼쪽 메뉴 **빌드 → Realtime Database** → **데이터베이스 만들기**
4. 위치: `asia-southeast1` (싱가포르, 한국에서 가장 가까움)
5. 보안 규칙: **테스트 모드**로 시작 (30일 후 수정 필요)

---

## 2단계 — Firebase 설정값 복사

1. Firebase 콘솔 왼쪽 ⚙️ → **프로젝트 설정**
2. **내 앱** 섹션 → **웹** 아이콘 클릭 → 앱 등록
3. 표시되는 `firebaseConfig` 객체를 복사
4. `src/firebase.js` 파일 열고 해당 부분에 붙여넣기

---

## 3단계 — Firebase 보안 규칙 설정

Realtime Database → 규칙 탭 → 아래 내용으로 교체 후 게시:

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

(단순 동아리방 예약 수준에서는 이것으로 충분합니다)

---

## 4단계 — GitHub 레포 만들기

1. https://github.com/new 접속
2. 레포 이름 입력 (예: `club-room-reservation`)
3. **Public** 선택 → 생성
4. 이 폴더 전체를 push:

```bash
git init
git add .
git commit -m "init"
git remote add origin https://github.com/HYW1Z/club-room-reservation.git
git push -u origin main
```

---

## 5단계 — vite.config.js 수정

```js
base: '/club-room-reservation/',  // 레포 이름과 동일하게
```

---

## 6단계 — GitHub Pages 활성화

1. 레포 → **Settings** → **Pages**
2. **Source**: `GitHub Actions` 선택
3. 이후 main 브랜치에 push할 때마다 자동 배포됨

---

## 최종 URL

```
https://HYW1Z.github.io/club-room-reservation/
```

---

## 관리자 비밀번호 변경 방법

`src/App.jsx` 파일 첫 부분:

```js
const ADMIN_PW = "0923";  // ← 여기 수정
```

수정 후 `git push` 하면 자동 배포됩니다.
